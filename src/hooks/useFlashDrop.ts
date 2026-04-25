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
    dcs?: RTCDataChannel[]
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
            
            const receivedTracker = new Set<number>();
            const fallbackBuffer: { offset: number, blob: Blob }[] = [];
            let receivedBytes = 0;

            try {
                const root = await navigator.storage.getDirectory();
                fileHandle = await root.getFileHandle(`${transferId}_${fileName}`, { create: true });
                writable = await fileHandle.createWritable();
                isUsingOPFS = true;
            } catch (err) {
                console.warn('OPFS not available, using memory fallback. Large files may crash.', err);
            }

            // ── DataChannels opened by sender (Multi-Channel) ────────────────
            let lastUiUpdate = 0;
            let doneReceived = false;

            pc.ondatachannel = (e) => {
                const dc = e.channel
                dc.binaryType = 'arraybuffer'

                dc.onopen = () => {
                    setTransfers(prev => prev.map(t =>
                        t.id === transferId ? { ...t, status: 'receiving' } : t
                    ))
                }

                dc.onmessage = async (ev) => {
                    if (typeof ev.data === 'string') {
                        // Control message — "done" signals end of transfer
                        if (ev.data === '__done__' && !doneReceived) {
                            doneReceived = true;
                            try {
                                let downloadUrl = '';
                                if (isUsingOPFS && writable) {
                                    await writable.close();
                                    const file = await fileHandle.getFile();
                                    downloadUrl = URL.createObjectURL(file);
                                } else {
                                    fallbackBuffer.sort((a, b) => a.offset - b.offset);
                                    const blob = new Blob(fallbackBuffer.map(x => x.blob), { type: mimeType });
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
                        const data = ev.data as ArrayBuffer;
                        const view = new DataView(data);
                        const messageId = view.getUint32(0, true);
                        const offset = view.getUint32(4, true);
                        
                        if (!receivedTracker.has(messageId)) {
                            receivedTracker.add(messageId);
                            const chunkData = data.slice(8);
                            receivedBytes += chunkData.byteLength;

                            if (isUsingOPFS && writable) {
                                // Await the write to enforce receiver-side backpressure!
                                try {
                                    await writable.write({ type: 'write', position: offset, data: new Uint8Array(data, 8) });
                                } catch(err) {
                                    console.error("OPFS write error", err);
                                }
                            } else {
                                fallbackBuffer.push({ offset, blob: new Blob([chunkData]) });
                            }

                            // Send ACK ONLY AFTER successfully storing the chunk to maintain backpressure
                            if (dc.readyState === 'open') {
                                dc.send(`ack:${messageId}`);
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
                        } else {
                            // Already received, but ACK might have been lost. Re-send ACK!
                            if (dc.readyState === 'open') {
                                dc.send(`ack:${messageId}`);
                            }
                        }
                    }
                }

                dc.onerror = (err) => {
                    console.error('[DataChannel] Error:', err)
                    if (!doneReceived) {
                        setTransfers(prev => prev.map(t =>
                            t.id === transferId ? { ...t, status: 'error', error: 'Connection error' } : t
                        ))
                    }
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

            // Create multi-channel pool for maximum throughput
            const NUM_CHANNELS = 6;
            const dcs: RTCDataChannel[] = [];
            let streamingStarted = false;
            let openCount = 0;

            for (let i = 0; i < NUM_CHANNELS; i++) {
                const dc = pc.createDataChannel(`file-${transferId}-${i}`, {
                    ordered: false, 
                    maxRetransmits: 0 
                });
                dc.binaryType = 'arraybuffer';
                dcs.push(dc);
                
                dc.onopen = () => {
                    openCount++;
                    if (openCount === NUM_CHANNELS && !streamingStarted) {
                        streamingStarted = true;
                        const fileEntry = peer as any;
                        if (fileEntry.file) streamFile(dcs, fileEntry.file, transferId);
                    }
                };
                
                dc.onerror = (err) => {
                    console.error('[DataChannel] Sender error:', err);
                    const idx = dcs.indexOf(dc);
                    if (idx !== -1) dcs.splice(idx, 1);
                    const allClosed = dcs.length === 0 || dcs.every(d => d.readyState === 'closed');
                    if (allClosed) {
                        setTransfers(prev => prev.map(t =>
                            t.id === transferId ? { ...t, status: 'error', error: 'All channels failed' } : t
                        ));
                        toast.error('Connection lost');
                        // isDone and interval are inside streamFile, which will gracefully stop on readyState !== 'open'
                    }
                };
            }
            peer.dcs = dcs;
            
            setTimeout(() => {
                if (!streamingStarted && dcs.some(d => d.readyState === 'open')) {
                    streamingStarted = true;
                    const fileEntry = peer as any;
                    if (fileEntry.file) streamFile(dcs, fileEntry.file, transferId);
                }
            }, 3000);

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    socket.emit('webrtc-ice', {
                        targetDeviceId: from,
                        transferId,
                        candidate: e.candidate,
                    })
                }
            }
            
            pc.oniceconnectionstatechange = () => {
                if (pc.iceConnectionState === 'failed') {
                    pc.restartIce();
                } else if (pc.iceConnectionState === 'disconnected') {
                    toast.error('Connection disconnected', { icon: '⚠️' });
                }
            };

            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            socket.emit('webrtc-offer', { targetDeviceId: from, transferId, offer })

            // ── Wait for answer ──────────────────────────────────────────────
            const answerCleanup = onceSocketEvent(socket, 'webrtc-answer', async (data: any) => {
                if (data.transferId !== transferId) return
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer))
                answerCleanup()
            })
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

    async function streamFile(dcs: RTCDataChannel[], file: File, transferId: string) {
        const HARD_BUFFER_CAP = 12 * 1024 * 1024;
        const startedAt = Date.now();
        let lastUiUpdate = 0;
        
        // ─── Adaptive Controller State (AIMD) ───
        let chunkSize = 256 * 1024; // Start at 256KB, adapts up to 1MB
        let maxBuffer = 8 * 1024 * 1024; // Start at 8MB per channel, adapts up to 32MB
        let maxConcurrentReads = 20; // Start at 20, adapts up to 60
        
        let currentOffset = 0;
        let messageIdCounter = 0;
        
        const inFlight = new Map<number, { offset: number, size: number, timestamp: number }>();
        const ackedMessages = new Set<number>();
        let ackedBytes = 0;
        
        let isDone = false;
        let activeReaders = 0;
        
        // Metrics for control loop
        let recentErrors = 0;
        let recentAcks = 0;
        
        // ─── Feedback Control Loop ───
        const controlInterval = setInterval(() => {
            if (isDone) return;
            
            // Additive Increase, Multiplicative Decrease (AIMD)
            if (recentErrors > 0) {
                // Instability detected: Multiplicative Decrease
                chunkSize = Math.max(128 * 1024, Math.floor(chunkSize * 0.5));
                maxBuffer = Math.max(4 * 1024 * 1024, Math.floor(maxBuffer * 0.5));
                maxConcurrentReads = Math.max(10, Math.floor(maxConcurrentReads * 0.5));
            } else if (recentAcks > 5) {
                let openDcs = dcs.filter(d => d.readyState === 'open');
                let avgBuffer = openDcs.length > 0 ? openDcs.reduce((sum, d) => sum + d.bufferedAmount, 0) / openDcs.length : 0;
                
                if (avgBuffer < HARD_BUFFER_CAP * 0.5) {
                    // Stable throughput: Additive Increase
                    chunkSize = Math.min(1024 * 1024, chunkSize + 64 * 1024);
                    maxBuffer = Math.min(HARD_BUFFER_CAP, maxBuffer + 2 * 1024 * 1024);
                    maxConcurrentReads = Math.min(60, maxConcurrentReads + 5);
                }
            }
            
            // Reset metrics window
            recentErrors = 0;
            recentAcks = 0;
            
            // Adjust low watermark dynamically based on maxBuffer
            dcs.forEach(dc => { dc.bufferedAmountLowThreshold = maxBuffer / 2; });
        }, 1500);

        const getNextDc = () => {
            let bestDc = null;
            let minBuffer = Infinity;
            for (const dc of dcs) {
                if (dc.readyState === 'open' && dc.bufferedAmount < Math.min(maxBuffer, HARD_BUFFER_CAP)) {
                    if (dc.bufferedAmount < minBuffer) {
                        minBuffer = dc.bufferedAmount;
                        bestDc = dc;
                    }
                }
            }
            return bestDc; // Returns null if all channels are saturated
        };

        dcs.forEach(dc => {
            dc.bufferedAmountLowThreshold = maxBuffer / 2;
            dc.addEventListener('bufferedamountlow', () => pump());
            
            // Error-Aware Recovery
            dc.addEventListener('error', () => { recentErrors++; });
            
            dc.addEventListener('message', (ev) => {
                if (typeof ev.data === 'string' && ev.data.startsWith('ack:')) {
                    const msgId = parseInt(ev.data.split(':')[1]);
                    const flightData = inFlight.get(msgId);
                    
                    if (flightData) {
                        ackedMessages.add(msgId);
                        inFlight.delete(msgId);
                        ackedBytes += flightData.size;
                        recentAcks++;
                        
                        const now = Date.now();
                        if (now - lastUiUpdate > 100 || ackedBytes >= file.size) {
                            lastUiUpdate = now;
                            const progress = Math.min(99, Math.round((ackedBytes / file.size) * 100));
                            const elapsed = (now - startedAt) / 1000;
                            const speed = elapsed > 0 ? ackedBytes / elapsed : 0;
                            
                            setTransfers(prev => prev.map(t =>
                                t.id === transferId ? { ...t, progress, speed } : t
                            ));
                        }
                        
                        if (ackedBytes >= file.size && !isDone) {
                            isDone = true;
                            clearInterval(controlInterval);
                            const activeDc = dcs.find(d => d.readyState === 'open');
                            if (activeDc) activeDc.send('__done__');
                            
                            setTransfers(prev => prev.map(t =>
                                t.id === transferId ? { ...t, status: 'completed', progress: 100 } : t
                            ));
                            toast.success('Transfer complete!');
                        } else {
                            // Keep pipeline fully saturated
                            pump();
                        }
                    }
                }
            });
        });
        
        const pump = () => {
            if (isDone) return;
            const now = Date.now();
            
            // 1. Retry failed / timed-out chunks
            for (const [msgId, flight] of inFlight.entries()) {
                if (now - flight.timestamp > 3000) { // 3s timeout
                    const dc = getNextDc();
                    if (dc && activeReaders < maxConcurrentReads) {
                        activeReaders++;
                        flight.timestamp = Date.now();
                        recentErrors++; // Treat timeout as error for AIMD
                        sendChunk(msgId, flight.offset, flight.size, dc).finally(() => { activeReaders--; pump(); });
                    }
                }
            }
            
            // 2. Zero-Idle Pump
            while (currentOffset < file.size && activeReaders < maxConcurrentReads) {
                const dc = getNextDc();
                if (!dc) break; // Network buffers are fully saturated
                
                const size = Math.min(chunkSize, file.size - currentOffset);
                const offset = currentOffset;
                const msgId = messageIdCounter++;
                currentOffset += size;
                
                inFlight.set(msgId, { offset, size, timestamp: Date.now() });
                activeReaders++;
                
                sendChunk(msgId, offset, size, dc).finally(() => { activeReaders--; pump(); });
            }
        };

        const sendChunk = async (msgId: number, offset: number, size: number, dc: RTCDataChannel) => {
            try {
                const slice = file.slice(offset, offset + size);
                const buffer = await slice.arrayBuffer();
                
                // Safe Send Layer: Check readyState before sending
                if (isDone || dc.readyState !== 'open') return;
                
                if (dc.bufferedAmount >= Math.min(maxBuffer, HARD_BUFFER_CAP)) { recentErrors++; return; }
                
                if (offset > 0xFFFFFFFF) { console.error('FATAL: offset exceeds Uint32 range'); recentErrors++; return; }
                
                // Header: 4 bytes msgId, 4 bytes offset
                const payload = new Uint8Array(8 + buffer.byteLength);
                const view = new DataView(payload.buffer);
                view.setUint32(0, msgId, true);
                view.setUint32(4, offset, true);
                payload.set(new Uint8Array(buffer), 8);
                
                dc.send(payload.buffer);
            } catch(e) {
                recentErrors++;
                // Leave in inFlight; retry loop will catch it
            }
        };

        pump(); // Ignite engine

        const heartbeatInterval = setInterval(() => {
            if (isDone) clearInterval(heartbeatInterval);
            else pump();
        }, 200);
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
