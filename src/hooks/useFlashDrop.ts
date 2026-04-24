import { useState, useEffect, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import toast from 'react-hot-toast'
import { Device, FileEntry, Transfer, MAX_FILE_SIZE, formatSize } from '../types'

// ─── Backend URL (signaling server only) ──────────────────────────────────────
const getBackendUrl = () => {
    const envUrl = (import.meta as any).env.VITE_BACKEND_URL
    return envUrl ? envUrl.replace(/\/$/, '') : 'http://localhost:3001'
}
export const BACKEND_URL = getBackendUrl()

// ─── WebRTC config — public STUN servers for NAT traversal ───────────────────
const RTC_CONFIG: RTCConfiguration = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
    ],
}

// Chunk size: 64KB — absolute maximum safe cross-browser limit for RTCDataChannel
const CHUNK_SIZE = 64 * 1024

// ─── Device name detection ────────────────────────────────────────────────────
function getDeviceName(): string {
    const ua = navigator.userAgent
    const rand = Math.random().toString(36).substring(2, 6).toUpperCase()
    if (ua.includes('iPad') || (ua.includes('Mac') && 'ontouchend' in document)) return `iPad (${rand})`
    if (ua.includes('iPhone')) return `iPhone (${rand})`
    if (ua.includes('Android')) return `Android (${rand})`
    if (ua.includes('Mac') && !ua.includes('iPhone')) return `Mac (${rand})`
    if (ua.includes('Windows')) return `Windows PC (${rand})`
    if (ua.includes('Linux')) return `Linux (${rand})`
    return `Device (${rand})`
}

function guessDeviceType(name: string): Device['type'] {
    const l = name.toLowerCase()
    if (l.includes('iphone')) return 'iphone'
    if (l.includes('ipad')) return 'tablet'
    if (l.includes('mac')) return 'mac'
    if (l.includes('windows')) return 'windows'
    if (l.includes('android')) return 'android'
    if (l.includes('linux')) return 'linux'
    return 'unknown'
}

// ─── Types for in-flight P2P connections ─────────────────────────────────────
interface PeerState {
    pc: RTCPeerConnection
    dc?: RTCDataChannel
    transferId: string
    targetDeviceId: string
}

export function useFlashDrop() {
    const [sessionId, setSessionId] = useState<string>('')
    const [devices, setDevices] = useState<Device[]>([])
    const [transfers, setTransfers] = useState<Transfer[]>([])

    const socketRef = useRef<Socket | null>(null)
    const sessionIdRef = useRef<string>('')
    const deviceIdRef = useRef<string>('')

    // Active RTCPeerConnections keyed by transferId
    const peersRef = useRef<Map<string, PeerState>>(new Map())

    // ─── Socket.io connection (signaling only) ────────────────────────────────
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search)
        const initialSessionId = urlParams.get('session') || ''

        const socket = io(BACKEND_URL, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            timeout: 20000,
        })
        socketRef.current = socket

        // ── Session management ───────────────────────────────────────────────
        socket.on('connect', () => {
            socket.emit('connect-device', {
                sessionId: initialSessionId,
                deviceName: getDeviceName(),
            })
        })

        socket.on('device-joined', ({ device, sessionId: sid }: any) => {
            setSessionId(sid)
            sessionIdRef.current = sid
            deviceIdRef.current = device.deviceId
            const url = new URL(window.location.href)
            url.searchParams.set('session', sid)
            window.history.replaceState({}, '', url)
        })

        socket.on('device-list', (list: any[]) => {
            setDevices(list
                .filter(d => d.deviceId !== deviceIdRef.current)
                .map(d => ({
                    id: d.deviceId,
                    name: d.deviceName,
                    type: guessDeviceType(d.deviceName),
                    connected: true,
                    connectedAt: d.joinedAt,
                }))
            )
        })

        socket.on('device-left', ({ deviceId: id, deviceName }: any) => {
            toast(`${deviceName} disconnected`, { icon: '👋' })
            setDevices(prev => prev.filter(d => d.id !== id))
        })

        // ── Incoming file request (RECEIVER side) ────────────────────────────
        socket.on('file-request', async (payload: any) => {
            const { from, fromName, transferId, fileName, fileSize, mimeType } = payload

            // Add to transfers list as "pending"
            setTransfers(prev => [...prev, {
                id: transferId,
                fileName,
                fileSize,
                progress: 0,
                status: 'receiving',
                direction: 'receive',
                deviceName: fromName,
                deviceId: from,
                startedAt: Date.now(),
            }])

            toast(`${fromName} wants to send ${fileName} (${formatSize(fileSize)})`, { icon: '📥', duration: 8000 })

            // Auto-accept (you can add a confirm dialog here if desired)
            socket.emit('file-accepted', { targetDeviceId: from, transferId })

            // Set up RTCPeerConnection to receive
            const pc = new RTCPeerConnection(RTC_CONFIG)
            const startedAt = Date.now()

            peersRef.current.set(transferId, { pc, transferId, targetDeviceId: from })

            // ── ICE candidates from receiver → sender via signaling ──────────
            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    socket.emit('webrtc-ice', {
                        targetDeviceId: from,
                        transferId,
                        candidate: e.candidate,
                    })
                }
            }

            // ── OPFS Setup for Streaming to Disk ─────────────────────────────
            let fileHandle: any = null;
            let writable: any = null;
            let isUsingOPFS = false;
            
            const CHUNK_SIZE = 256 * 1024;
            const totalChunks = Math.ceil(fileSize / CHUNK_SIZE);
            const receivedChunksTracker = new Uint8Array(totalChunks); // 0 = missing, 1 = received
            const fallbackBuffer: ArrayBuffer[] = [];
            let receivedBytes = 0;

            try {
                const root = await navigator.storage.getDirectory();
                fileHandle = await root.getFileHandle(`${transferId}_${fileName}`, { create: true });
                writable = await fileHandle.createWritable();
                isUsingOPFS = true;
            } catch (err) {
                console.warn('OPFS not available, using memory fallback. Large files may crash.', err);
            }

            // ── DataChannel opened by sender ─────────────────────────────────
            pc.ondatachannel = (e) => {
                const dc = e.channel
                dc.binaryType = 'arraybuffer'
                let lastUiUpdate = 0

                dc.onopen = () => {
                    setTransfers(prev => prev.map(t =>
                        t.id === transferId ? { ...t, status: 'receiving' } : t
                    ))
                }

                dc.onmessage = async (ev) => {
                    if (typeof ev.data === 'string') {
                        // Control message — "done" signals end of transfer
                        if (ev.data === '__done__') {
                            try {
                                let downloadUrl = '';
                                if (isUsingOPFS && writable) {
                                    await writable.close();
                                    const file = await fileHandle.getFile();
                                    downloadUrl = URL.createObjectURL(file);
                                } else {
                                    const blob = new Blob(fallbackBuffer, { type: mimeType });
                                    downloadUrl = URL.createObjectURL(blob);
                                }

                                const a = document.createElement('a')
                                a.href = downloadUrl
                                a.download = fileName
                                document.body.appendChild(a)
                                a.click()
                                a.remove()
                                setTimeout(() => URL.revokeObjectURL(downloadUrl), 5000)

                                setTransfers(prev => prev.map(t =>
                                    t.id === transferId ? { ...t, status: 'completed', progress: 100 } : t
                                ))
                                toast.success(`Received ${fileName}`)
                            } catch (err) {
                                console.error('Finalize error', err);
                                toast.error('Error saving file');
                            } finally {
                                pc.close()
                                peersRef.current.delete(transferId)
                            }
                        }
                    } else {
                        // Binary chunk
                        const data = ev.data as ArrayBuffer;
                        const view = new DataView(data);
                        const idx = view.getUint32(0, true);
                        
                        if (receivedChunksTracker[idx] === 0) {
                            receivedChunksTracker[idx] = 1;
                            const chunkData = data.slice(4);
                            receivedBytes += chunkData.byteLength;

                            if (isUsingOPFS && writable) {
                                try {
                                    await writable.write({ type: 'write', position: idx * CHUNK_SIZE, data: new Uint8Array(data, 4) });
                                } catch(err) { console.error("OPFS write error", err); }
                            } else {
                                fallbackBuffer[idx] = chunkData;
                            }

                            const now = Date.now()
                            // Throttle UI updates
                            if (now - lastUiUpdate > 500 || receivedBytes >= fileSize) {
                                lastUiUpdate = now
                                const progress = Math.min(99, Math.round((receivedBytes / fileSize) * 100))
                                const elapsed = (now - startedAt) / 1000
                                const speed = elapsed > 0 ? receivedBytes / elapsed : 0

                                setTransfers(prev => prev.map(tr =>
                                    tr.id === transferId ? { ...tr, progress, speed, lastUpdate: now } : tr
                                ))
                            }
                        }

                        // Send ACK
                        if (dc.readyState === 'open') {
                            dc.send(`ack:${idx}`);
                        }
                    }
                }

                dc.onerror = (err) => {
                    console.error('[DataChannel] Error:', err)
                    setTransfers(prev => prev.map(t =>
                        t.id === transferId ? { ...t, status: 'error', error: 'Connection error' } : t
                    ))
                    toast.error(`Transfer failed: ${fileName}`)
                    pc.close()
                    peersRef.current.delete(transferId)
                }
            }

            // ── Wait for WebRTC offer from sender ────────────────────────────
            const offerCleanup = onceSocketEvent(socket, 'webrtc-offer', async (data: any) => {
                if (data.transferId !== transferId) return
                await pc.setRemoteDescription(new RTCSessionDescription(data.offer))
                const answer = await pc.createAnswer()
                await pc.setLocalDescription(answer)
                socket.emit('webrtc-answer', { targetDeviceId: from, transferId, answer })
                offerCleanup()
            })
        })

        // ── Receiver accepted our file (SENDER side) ─────────────────────────
        socket.on('file-accepted', async (payload: any) => {
            const { transferId, from } = payload
            const peer = peersRef.current.get(transferId)
            if (!peer) return

            const pc = peer.pc

            // Create data channel for this transfer
            const dc = pc.createDataChannel(`file-${transferId}`, {
                ordered: false, // Unordered for maximum speed
                maxRetransmits: 0 // Unreliable, we handle our own retries
            })
            dc.binaryType = 'arraybuffer'
            peer.dc = dc

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    socket.emit('webrtc-ice', {
                        targetDeviceId: from,
                        transferId,
                        candidate: e.candidate,
                    })
                }
            }

            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            socket.emit('webrtc-offer', { targetDeviceId: from, transferId, offer })

            // ── Wait for answer ──────────────────────────────────────────────
            const answerCleanup = onceSocketEvent(socket, 'webrtc-answer', async (data: any) => {
                if (data.transferId !== transferId) return
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer))
                answerCleanup()
            })

            // ── Start streaming when DataChannel opens ───────────────────────
            dc.onopen = () => {
                const fileEntry = peer as any
                if (!fileEntry.file) return
                streamFile(dc, fileEntry.file, transferId)
            }

            dc.onerror = (err) => {
                console.error('[DataChannel] Sender error:', err)
                setTransfers(prev => prev.map(t =>
                    t.id === transferId ? { ...t, status: 'error', error: 'Connection error' } : t
                ))
                toast.error('Transfer failed.')
            }
        })

        // ── Receiver declined ────────────────────────────────────────────────
        socket.on('file-declined', (payload: any) => {
            const { transferId } = payload
            const peer = peersRef.current.get(transferId)
            if (peer) { peer.pc.close(); peersRef.current.delete(transferId) }
            setTransfers(prev => prev.map(t =>
                t.id === transferId ? { ...t, status: 'error', error: 'Declined' } : t
            ))
            toast.error('File transfer was declined.')
        })

        // ── ICE candidates relay ─────────────────────────────────────────────
        socket.on('webrtc-ice', async (payload: any) => {
            const { transferId, candidate } = payload
            const peer = peersRef.current.get(transferId)
            if (peer?.pc && candidate) {
                try { await peer.pc.addIceCandidate(new RTCIceCandidate(candidate)) } catch { /* ignore */ }
            }
        })

        socket.on('error', ({ message }: any) => toast.error(message))
        socket.on('reconnect', () => toast.success('Reconnected'))
        socket.on('disconnect', (reason) => {
            if (reason === 'io server disconnect') toast.error('Disconnected from server')
        })

        return () => { socket.disconnect() }
    }, [])

    // ─── Stream file over DataChannel (Parallel Engine) ───────────────────────
    async function streamFile(dc: RTCDataChannel, file: File, transferId: string) {
        const startedAt = Date.now()
        let lastUiUpdate = 0
        
        const CHUNK_SIZE = 256 * 1024; // 256KB for faster throughput
        const MAX_CONCURRENCY = 40; // Max parallel chunks in-flight
        const RETRY_TIMEOUT_MS = 1000;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        
        let nextChunkIndex = 0;
        const ackedChunks = new Set<number>();
        const inFlight = new Map<number, number>(); // index -> timestamp
        
        let isPaused = false;
        let isDone = false;
        
        // Flow control thresholds (more aggressive for LAN)
        dc.bufferedAmountLowThreshold = 2 * 1024 * 1024;
        const MAX_BUFFER = 8 * 1024 * 1024; // 8MB

        dc.addEventListener('message', (ev) => {
            if (typeof ev.data === 'string') {
                if (ev.data.startsWith('ack:')) {
                    const idx = parseInt(ev.data.split(':')[1]);
                    ackedChunks.add(idx);
                    inFlight.delete(idx);
                    
                    // Update progress when a chunk is acked
                    const now = Date.now();
                    if (now - lastUiUpdate > 500 || ackedChunks.size === totalChunks) {
                        lastUiUpdate = now;
                        const progress = Math.min(99, Math.round((ackedChunks.size / totalChunks) * 100));
                        const elapsed = (now - startedAt) / 1000;
                        const sentBytes = ackedChunks.size * CHUNK_SIZE;
                        const speed = elapsed > 0 ? sentBytes / elapsed : 0;
                        setTransfers(prev => prev.map(t =>
                            t.id === transferId ? { ...t, progress, speed } : t
                        ));
                    }
                    
                    sendNext();
                } else if (ev.data === '__pause__') {
                    isPaused = true;
                } else if (ev.data === '__resume__') {
                    isPaused = false;
                    sendNext();
                }
            }
        });
        
        const sendChunk = async (idx: number) => {
            if (dc.readyState !== 'open') return;
            const offset = idx * CHUNK_SIZE;
            const slice = file.slice(offset, offset + CHUNK_SIZE);
            const buffer = await slice.arrayBuffer();
            
            const payload = new Uint8Array(4 + buffer.byteLength);
            const view = new DataView(payload.buffer);
            view.setUint32(0, idx, true); // little-endian
            payload.set(new Uint8Array(buffer), 4);
            
            try {
                dc.send(payload);
                inFlight.set(idx, Date.now());
            } catch(e) {
                console.error("DC send error", e);
            }
        };

        const sendNext = async () => {
            if (isDone || isPaused || dc.readyState !== 'open') return;
            if (dc.bufferedAmount > MAX_BUFFER) return;
            
            const now = Date.now();
            
            // 1. Retry timed-out chunks
            for (const [idx, lastSent] of inFlight.entries()) {
                if (now - lastSent > RETRY_TIMEOUT_MS) {
                    await sendChunk(idx);
                    if (dc.bufferedAmount > MAX_BUFFER) return;
                }
            }
            
            // 2. Send new chunks
            while (inFlight.size < MAX_CONCURRENCY && nextChunkIndex < totalChunks) {
                const idx = nextChunkIndex++;
                inFlight.set(idx, Date.now()); // Optimistic lock
                sendChunk(idx).catch(console.error);
                if (dc.bufferedAmount > MAX_BUFFER) break;
            }
            
            // 3. Check completion
            if (ackedChunks.size === totalChunks && !isDone) {
                isDone = true;
                if (dc.readyState === 'open') {
                    dc.send('__done__');
                    setTransfers(prev => prev.map(t =>
                        t.id === transferId ? { ...t, status: 'completed', progress: 100 } : t
                    ));
                    toast.success('Transfer complete!');
                }
            }
        };

        dc.addEventListener('bufferedamountlow', () => sendNext());
        sendNext(); // Initial trigger

        const interval = setInterval(() => {
            if (isDone || dc.readyState !== 'open') clearInterval(interval);
            else sendNext();
        }, 500);
    }

    // ─── Utility: listen for one event then stop ──────────────────────────────
    function onceSocketEvent(socket: Socket, event: string, handler: (data: any) => void) {
        const wrapper = (data: any) => handler(data)
        socket.on(event, wrapper)
        return () => socket.off(event, wrapper)
    }

    // ─── Send files (creates one WebRTC connection per file) ──────────────────
    const sendFiles = useCallback(async (targetDevice: Device, files: FileEntry[]) => {
        if (!sessionIdRef.current || !socketRef.current) return

        for (const entry of files) {
            if (entry.file.size > MAX_FILE_SIZE) {
                toast.error(`${entry.file.name} exceeds 3GB limit (${formatSize(entry.file.size)})`)
                return
            }
        }

        for (let i = 0; i < files.length; i++) {
            const entry = files[i]
            const transferId = `tx-${Date.now()}-${i}`

            setTransfers(prev => [...prev, {
                id: transferId,
                fileName: entry.file.name,
                fileSize: entry.file.size,
                progress: 0,
                status: 'sending',
                direction: 'send',
                deviceName: targetDevice.name,
                deviceId: targetDevice.id,
                startedAt: Date.now(),
                totalFiles: files.length,
                completedFiles: i,
            }])

            // Create peer connection for this transfer
            const pc = new RTCPeerConnection(RTC_CONFIG)

            // Store file reference on the peer state for later streaming
            const peerState: PeerState & { file: File } = {
                pc,
                transferId,
                targetDeviceId: targetDevice.id,
                file: entry.file,
            } as any
            peersRef.current.set(transferId, peerState)

            // Signal the receiver about the incoming file
            socketRef.current.emit('file-request', {
                targetDeviceId: targetDevice.id,
                transferId,
                fileName: entry.file.name,
                fileSize: entry.file.size,
                mimeType: entry.file.type || 'application/octet-stream',
            })

            toast(`Offering ${entry.file.name} to ${targetDevice.name}...`, { icon: '📤' })

            // Wait for transfer to complete before starting next file
            await new Promise<void>((resolve) => {
                const interval = setInterval(() => {
                    setTransfers(prev => {
                        const t = prev.find(t => t.id === transferId)
                        if (t?.status === 'completed' || t?.status === 'error') {
                            clearInterval(interval)
                            resolve()
                        }
                        return prev
                    })
                }, 500)
            })
        }
    }, [])

    const dismissTransfer = useCallback((id: string) => {
        setTransfers(prev => prev.filter(t => t.id !== id))
    }, [])

    const clearCompletedTransfers = useCallback(() => {
        setTransfers(prev => prev.filter(t => t.status !== 'completed' && t.status !== 'error'))
    }, [])

    return {
        sessionId,
        devices,
        transfers,
        sendFiles,
        dismissTransfer,
        clearCompletedTransfers,
    }
}
