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

            socket.emit('file-accepted', { targetDeviceId: from, transferId })

            const pc = new RTCPeerConnection(RTC_CONFIG)
            const startedAt = Date.now()

            peersRef.current.set(transferId, { pc, transferId, targetDeviceId: from })

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
                                try {
                                    await writable.write({ type: 'write', position: offset, data: new Uint8Array(data, 8) });
                                } catch (err) {
                                    console.error("OPFS write error", err);
                                }
                            } else {
                                fallbackBuffer.push({ offset, blob: new Blob([chunkData]) });
                            }

                            if (dc.readyState === 'open') {
                                dc.send(`ack:${messageId}`);
                            }

                            const now = Date.now()
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
                            if (dc.readyState === 'open') {
                                dc.send(`ack:${messageId}`);
                            }
                        }
                    }
                }

                dc.onerror = (err) => {
                    console.error('[DataChannel] Receiver error:', err)
                    if (!doneReceived) {
                        setTransfers(prev => prev.map(t =>
                            t.id === transferId ? { ...t, status: 'error', error: 'Connection error' } : t
                        ))
                    }
                }
            }

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

            const NUM_CHANNELS = 6;
            const dcs: RTCDataChannel[] = [];
            let streamingStarted = false;

            // FIX 4: Track open count — wait for ALL channels before streaming
            let openCount = 0;

            // FIX 4: Safety fallback — start with whatever channels opened after 3s
            const streamingFallbackTimer = setTimeout(() => {
                if (!streamingStarted) {
                    const openDcs = dcs.filter(d => d.readyState === 'open');
                    if (openDcs.length > 0) {
                        streamingStarted = true;
                        console.warn(`[FlashDrop] Fallback: starting stream with ${openDcs.length}/${NUM_CHANNELS} channels open`);
                        const fileEntry = peer as any;
                        if (fileEntry.file) streamFile(dcs, fileEntry.file, transferId);
                    }
                }
            }, 3000);

            for (let i = 0; i < NUM_CHANNELS; i++) {
                const dc = pc.createDataChannel(`file-${transferId}-${i}`, {
                    ordered: false,
                    maxRetransmits: 0,
                });
                dc.binaryType = 'arraybuffer';
                dcs.push(dc);

                dc.onopen = () => {
                    openCount++;
                    // FIX 4: Only start streaming when ALL channels are open
                    if (openCount === NUM_CHANNELS && !streamingStarted) {
                        streamingStarted = true;
                        clearTimeout(streamingFallbackTimer);
                        const fileEntry = peer as any;
                        if (fileEntry.file) streamFile(dcs, fileEntry.file, transferId);
                    }
                };

                // FIX 3: Remove dead channel from pool on error
                dc.onerror = (err) => {
                    console.error('[DataChannel] Sender error:', err);

                    // Splice dead channel out of pool immediately
                    const idx = dcs.indexOf(dc);
                    if (idx !== -1) dcs.splice(idx, 1);

                    // If pool is entirely dead, fail the transfer
                    const aliveChannels = dcs.filter(d => d.readyState === 'open');
                    if (aliveChannels.length === 0 && streamingStarted) {
                        setTransfers(prev => prev.map(t =>
                            t.id === transferId ? { ...t, status: 'error', error: 'All channels failed' } : t
                        ));
                        toast.error('Transfer failed: all data channels closed');
                    }
                };
            }
            peer.dcs = dcs;

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    socket.emit('webrtc-ice', {
                        targetDeviceId: from,
                        transferId,
                        candidate: e.candidate,
                    })
                }
            }

            // FIX 5: ICE connection state monitoring + restartIce on failure
            pc.oniceconnectionstatechange = () => {
                const state = pc.iceConnectionState;
                console.log(`[ICE] State: ${state} (transferId: ${transferId})`);
                if (state === 'failed') {
                    console.warn('[ICE] Connection failed — attempting ICE restart');
                    pc.restartIce();
                }
                if (state === 'disconnected') {
                    toast(`Connection unstable, retrying...`, { icon: '⚠️' });
                }
            };

            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            socket.emit('webrtc-offer', { targetDeviceId: from, transferId, offer })

            const answerCleanup = onceSocketEvent(socket, 'webrtc-answer', async (data: any) => {
                if (data.transferId !== transferId) return
                await pc.setRemoteDescription(new RTCSessionDescription(data.answer))
                answerCleanup()
            })
        })

        socket.on('file-declined', (payload: any) => {
            const { transferId } = payload
            const peer = peersRef.current.get(transferId)
            if (peer) { peer.pc.close(); peersRef.current.delete(transferId) }
            setTransfers(prev => prev.map(t =>
                t.id === transferId ? { ...t, status: 'error', error: 'Declined' } : t
            ))
            toast.error('File transfer was declined.')
        })

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
        const startedAt = Date.now();
        let lastUiUpdate = 0;

        // FIX 1: Hard cap at 12MB — Chrome's internal DataChannel buffer caps at ~16MB.
        // Exceeding this causes OperationError: Failure to send data.
        const HARD_BUFFER_CAP = 12 * 1024 * 1024;

        // ─── Adaptive Controller State (AIMD) ───
        let chunkSize = 256 * 1024;
        let maxBuffer = 8 * 1024 * 1024;    // Starts at 8MB, grows up to HARD_BUFFER_CAP max
        let maxConcurrentReads = 20;

        let currentOffset = 0;
        let messageIdCounter = 0;

        const inFlight = new Map<number, { offset: number, size: number, timestamp: number }>();
        const ackedMessages = new Set<number>();
        let ackedBytes = 0;

        let isDone = false;
        let activeReaders = 0;

        let recentErrors = 0;
        let recentAcks = 0;

        // ─── Feedback Control Loop (AIMD) ───
        const controlInterval = setInterval(() => {
            if (isDone) return;

            if (recentErrors > 0) {
                // Multiplicative Decrease on instability
                chunkSize = Math.max(128 * 1024, Math.floor(chunkSize * 0.5));
                maxBuffer = Math.max(4 * 1024 * 1024, Math.floor(maxBuffer * 0.5));
                maxConcurrentReads = Math.max(10, Math.floor(maxConcurrentReads * 0.5));
            } else if (recentAcks > 5) {
                // FIX 7: Gate additive increase behind channel health check
                const openDcs = dcs.filter(d => d.readyState === 'open');
                const avgBuffer = openDcs.length > 0
                    ? openDcs.reduce((sum, d) => sum + d.bufferedAmount, 0) / openDcs.length
                    : HARD_BUFFER_CAP;

                if (avgBuffer < HARD_BUFFER_CAP * 0.5) {
                    // Additive Increase — only when channels are healthy (below 50% of hard cap)
                    chunkSize = Math.min(1024 * 1024, chunkSize + 64 * 1024);
                    // FIX 1: Cap maxBuffer at HARD_BUFFER_CAP, never 32MB
                    maxBuffer = Math.min(HARD_BUFFER_CAP, maxBuffer + 2 * 1024 * 1024);
                    maxConcurrentReads = Math.min(60, maxConcurrentReads + 5);
                }
            }

            recentErrors = 0;
            recentAcks = 0;

            // Adjust low watermark dynamically
            dcs.forEach(dc => {
                if (dc.readyState === 'open') {
                    dc.bufferedAmountLowThreshold = Math.min(maxBuffer, HARD_BUFFER_CAP) / 2;
                }
            });
        }, 1500);

        // FIX 1: Smart Channel Selector — enforce HARD_BUFFER_CAP in addition to adaptive maxBuffer
        const getNextDc = () => {
            let bestDc = null;
            let minBuffer = Infinity;
            const effectiveCap = Math.min(maxBuffer, HARD_BUFFER_CAP);
            for (const dc of dcs) {
                if (dc.readyState === 'open' && dc.bufferedAmount < effectiveCap) {
                    if (dc.bufferedAmount < minBuffer) {
                        minBuffer = dc.bufferedAmount;
                        bestDc = dc;
                    }
                }
            }
            return bestDc;
        };

        dcs.forEach(dc => {
            if (dc.readyState === 'open') {
                dc.bufferedAmountLowThreshold = Math.min(maxBuffer, HARD_BUFFER_CAP) / 2;
            }
            dc.addEventListener('bufferedamountlow', () => pump());
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
                            clearInterval(heartbeatInterval);
                            const activeDc = dcs.find(d => d.readyState === 'open');
                            if (activeDc) activeDc.send('__done__');

                            setTransfers(prev => prev.map(t =>
                                t.id === transferId ? { ...t, status: 'completed', progress: 100 } : t
                            ));
                            toast.success('Transfer complete!');
                        } else {
                            pump();
                        }
                    }
                }
            });
        });

        const pump = () => {
            if (isDone) return;
            const now = Date.now();

            // 1. Retry timed-out chunks
            for (const [msgId, flight] of inFlight.entries()) {
                if (now - flight.timestamp > 3000) {
                    const dc = getNextDc();
                    if (dc && activeReaders < maxConcurrentReads) {
                        activeReaders++;
                        flight.timestamp = Date.now();
                        recentErrors++;
                        sendChunk(msgId, flight.offset, flight.size, dc).finally(() => { activeReaders--; pump(); });
                    }
                }
            }

            // 2. Zero-Idle Pump
            while (currentOffset < file.size && activeReaders < maxConcurrentReads) {
                const dc = getNextDc();
                if (!dc) break;

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
                // FIX 6: Guard against Uint32 offset overflow (safe up to ~4GB, assertion for future)
                if (offset > 0xFFFFFFFF) {
                    console.error('[FlashDrop] FATAL: offset exceeds Uint32 range — file corruption would occur. Aborting chunk.');
                    recentErrors++;
                    return;
                }

                const slice = file.slice(offset, offset + size);
                const buffer = await slice.arrayBuffer();

                // FIX 2: Re-validate readyState AND bufferedAmount AFTER the async gap
                if (isDone || dc.readyState !== 'open') return;
                if (dc.bufferedAmount >= Math.min(maxBuffer, HARD_BUFFER_CAP)) {
                    // Buffer filled during async read — leave in inFlight for retry
                    recentErrors++;
                    return;
                }

                // Header: 4 bytes msgId + 4 bytes offset
                const payload = new Uint8Array(8 + buffer.byteLength);
                const view = new DataView(payload.buffer);
                view.setUint32(0, msgId, true);
                view.setUint32(4, offset, true);
                payload.set(new Uint8Array(buffer), 8);

                // FIX 2: Send the underlying ArrayBuffer (better perf than Uint8Array)
                dc.send(payload.buffer);
            } catch (e) {
                recentErrors++;
                // Leave in inFlight — retry loop will re-send
            }
        };

        pump(); // Ignite engine

        // Heartbeat — keep pipeline alive during quiet ACK periods
        // Note: reference captured for cleanup on transfer complete
        const heartbeatInterval = setInterval(() => {
            if (isDone) {
                clearInterval(heartbeatInterval);
            } else {
                pump();
            }
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

            const pc = new RTCPeerConnection(RTC_CONFIG)

            const peerState: PeerState & { file: File } = {
                pc,
                transferId,
                targetDeviceId: targetDevice.id,
                file: entry.file,
            } as any
            peersRef.current.set(transferId, peerState)

            socketRef.current.emit('file-request', {
                targetDeviceId: targetDevice.id,
                transferId,
                fileName: entry.file.name,
                fileSize: entry.file.size,
                mimeType: entry.file.type || 'application/octet-stream',
            })

            toast(`Offering ${entry.file.name} to ${targetDevice.name}...`, { icon: '📤' })

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