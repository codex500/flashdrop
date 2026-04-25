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
                    socket.emit('webrtc-ice', { targetDeviceId: from, transferId, candidate: e.candidate })
                }
            }

            let fileHandle: any = null
            let writable: any = null
            let isUsingOPFS = false
            const receivedTracker = new Set<number>()
            const fallbackBuffer: { offset: number, blob: Blob }[] = []
            let receivedBytes = 0

            try {
                const root = await navigator.storage.getDirectory()
                fileHandle = await root.getFileHandle(`${transferId}_${fileName}`, { create: true })
                writable = await fileHandle.createWritable()
                isUsingOPFS = true
            } catch (err) {
                console.warn('OPFS not available, using memory fallback.', err)
            }

            let lastUiUpdate = 0
            let doneReceived = false

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
                            doneReceived = true
                            try {
                                let downloadUrl = ''
                                if (isUsingOPFS && writable) {
                                    await writable.close()
                                    const file = await fileHandle.getFile()
                                    downloadUrl = URL.createObjectURL(file)
                                } else {
                                    fallbackBuffer.sort((a, b) => a.offset - b.offset)
                                    const blob = new Blob(fallbackBuffer.map(x => x.blob), { type: mimeType })
                                    downloadUrl = URL.createObjectURL(blob)
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
                                console.error('Finalize error', err)
                                toast.error('Error saving file')
                            } finally {
                                pc.close()
                                peersRef.current.delete(transferId)
                            }
                        }
                    } else {
                        const data = ev.data as ArrayBuffer
                        const view = new DataView(data)
                        const messageId = view.getUint32(0, true)
                        const offset = view.getUint32(4, true)

                        if (!receivedTracker.has(messageId)) {
                            receivedTracker.add(messageId)
                            const chunkData = data.slice(8)
                            receivedBytes += chunkData.byteLength

                            if (isUsingOPFS && writable) {
                                try {
                                    await writable.write({ type: 'write', position: offset, data: new Uint8Array(data, 8) })
                                } catch (err) {
                                    console.error('OPFS write error', err)
                                }
                            } else {
                                fallbackBuffer.push({ offset, blob: new Blob([chunkData]) })
                            }

                            if (dc.readyState === 'open') dc.send(`ack:${messageId}`)

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
                            if (dc.readyState === 'open') dc.send(`ack:${messageId}`)
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

            // FIX: Reduced from 6 → 4 channels.
            // 6 unreliable channels multiplied by 20 concurrent reads = too many
            // simultaneous sends hitting SCTP at once, causing OperationError cascades.
            const NUM_CHANNELS = 4
            const dcs: RTCDataChannel[] = []
            let streamingStarted = false
            let openCount = 0

            // Safety fallback: start with whatever channels opened after 3s
            const streamingFallbackTimer = setTimeout(() => {
                if (!streamingStarted) {
                    const openDcs = dcs.filter(d => d.readyState === 'open')
                    if (openDcs.length > 0) {
                        streamingStarted = true
                        console.warn(`[FlashDrop] Fallback: starting with ${openDcs.length}/${NUM_CHANNELS} channels`)
                        const fileEntry = peer as any
                        if (fileEntry.file) streamFile(dcs, fileEntry.file, transferId)
                    }
                }
            }, 3000)

            for (let i = 0; i < NUM_CHANNELS; i++) {
                const dc = pc.createDataChannel(`file-${transferId}-${i}`, {
                    ordered: false,
                    // FIX: Raised from 0 → 3. maxRetransmits: 0 means zero
                    // tolerance for packet loss. On any dropped packet the
                    // SCTP layer immediately errors. 3 retransmits gives the
                    // transport a chance to recover without halting the stream.
                    maxRetransmits: 3,
                })
                dc.binaryType = 'arraybuffer'
                dcs.push(dc)

                dc.onopen = () => {
                    openCount++
                    // Wait for ALL channels before streaming to avoid
                    // sending on partially-initialized channel pool
                    if (openCount === NUM_CHANNELS && !streamingStarted) {
                        streamingStarted = true
                        clearTimeout(streamingFallbackTimer)
                        const fileEntry = peer as any
                        if (fileEntry.file) streamFile(dcs, fileEntry.file, transferId)
                    }
                }

                // FIX: Remove dead channel from active pool immediately on error
                dc.onerror = (err) => {
                    console.error('[DataChannel] Sender error:', err)
                    const idx = dcs.indexOf(dc)
                    if (idx !== -1) dcs.splice(idx, 1)
                    const aliveChannels = dcs.filter(d => d.readyState === 'open')
                    if (aliveChannels.length === 0 && streamingStarted) {
                        setTransfers(prev => prev.map(t =>
                            t.id === transferId ? { ...t, status: 'error', error: 'All channels failed' } : t
                        ))
                        toast.error('Transfer failed: all data channels closed')
                    }
                }
            }
            peer.dcs = dcs

            pc.onicecandidate = (e) => {
                if (e.candidate) {
                    socket.emit('webrtc-ice', { targetDeviceId: from, transferId, candidate: e.candidate })
                }
            }

            // FIX: ICE state monitoring — restartIce on failure, warn on disconnect
            pc.oniceconnectionstatechange = () => {
                const state = pc.iceConnectionState
                console.log(`[ICE] State: ${state} (transferId: ${transferId})`)
                if (state === 'failed') {
                    console.warn('[ICE] Connection failed — attempting ICE restart')
                    pc.restartIce()
                }
                if (state === 'disconnected') {
                    toast(`Connection unstable, retrying...`, { icon: '⚠️' })
                }
            }

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
        const startedAt = Date.now()
        let lastUiUpdate = 0

        // Chrome's DataChannel internal buffer hard cap is ~16MB.
        // Staying at 12MB gives a safe margin.
        const HARD_BUFFER_CAP = 12 * 1024 * 1024

        // ─── AIMD Controller State ───
        let chunkSize = 256 * 1024         // Starts at 256KB → max 1MB
        let maxBuffer = 8 * 1024 * 1024    // Starts at 8MB → max HARD_BUFFER_CAP
        let maxConcurrentReads = 10        // FIX: Start at 10, not 20.
                                           // 20 simultaneous reads meant 20 async
                                           // arrayBuffer() calls all resolving at once,
                                           // then 20 dc.send() calls firing before any
                                           // bufferedAmount update — overflowing SCTP.

        let currentOffset = 0
        let messageIdCounter = 0
        const inFlight = new Map<number, { offset: number, size: number, timestamp: number }>()
        const ackedMessages = new Set<number>()
        let ackedBytes = 0
        let isDone = false
        let activeReaders = 0
        let recentErrors = 0
        let recentAcks = 0

        // FIX: Pump mutex — prevents multiple concurrent pump() executions.
        // Without this, bufferedamountlow events on 4 channels + heartbeat +
        // sendChunk.finally() all invoke pump() simultaneously, each independently
        // passing the bufferedAmount check before any send has updated the counter.
        let isPumping = false

        // ─── AIMD Feedback Control Loop ───
        const controlInterval = setInterval(() => {
            if (isDone) return

            if (recentErrors > 0) {
                chunkSize = Math.max(128 * 1024, Math.floor(chunkSize * 0.5))
                maxBuffer = Math.max(4 * 1024 * 1024, Math.floor(maxBuffer * 0.5))
                maxConcurrentReads = Math.max(5, Math.floor(maxConcurrentReads * 0.5))
            } else if (recentAcks > 5) {
                const openDcs = dcs.filter(d => d.readyState === 'open')
                const avgBuffer = openDcs.length > 0
                    ? openDcs.reduce((sum, d) => sum + d.bufferedAmount, 0) / openDcs.length
                    : HARD_BUFFER_CAP

                // Only increase when channels are comfortably below the hard cap
                if (avgBuffer < HARD_BUFFER_CAP * 0.5) {
                    chunkSize = Math.min(1024 * 1024, chunkSize + 64 * 1024)
                    maxBuffer = Math.min(HARD_BUFFER_CAP, maxBuffer + 2 * 1024 * 1024)
                    maxConcurrentReads = Math.min(40, maxConcurrentReads + 3)
                }
            }

            recentErrors = 0
            recentAcks = 0

            dcs.forEach(dc => {
                if (dc.readyState === 'open') {
                    dc.bufferedAmountLowThreshold = Math.min(maxBuffer, HARD_BUFFER_CAP) / 2
                }
            })
        }, 1500)

        // Channel selector: pick the least-loaded open channel
        const getNextDc = (): RTCDataChannel | null => {
            const effectiveCap = Math.min(maxBuffer, HARD_BUFFER_CAP)
            let bestDc: RTCDataChannel | null = null
            let minBuffer = Infinity
            for (const dc of dcs) {
                if (dc.readyState === 'open' && dc.bufferedAmount < effectiveCap) {
                    if (dc.bufferedAmount < minBuffer) {
                        minBuffer = dc.bufferedAmount
                        bestDc = dc
                    }
                }
            }
            return bestDc
        }

        // Set initial thresholds and attach events AFTER channels are confirmed open
        dcs.forEach(dc => {
            if (dc.readyState === 'open') {
                dc.bufferedAmountLowThreshold = Math.min(maxBuffer, HARD_BUFFER_CAP) / 2
            }
            dc.addEventListener('bufferedamountlow', () => schedulePump())
            dc.addEventListener('error', () => { recentErrors++ })
            dc.addEventListener('message', (ev) => {
                if (typeof ev.data === 'string' && ev.data.startsWith('ack:')) {
                    const msgId = parseInt(ev.data.split(':')[1])
                    const flightData = inFlight.get(msgId)
                    if (flightData) {
                        ackedMessages.add(msgId)
                        inFlight.delete(msgId)
                        ackedBytes += flightData.size
                        recentAcks++

                        const now = Date.now()
                        if (now - lastUiUpdate > 100 || ackedBytes >= file.size) {
                            lastUiUpdate = now
                            const progress = Math.min(99, Math.round((ackedBytes / file.size) * 100))
                            const elapsed = (now - startedAt) / 1000
                            const speed = elapsed > 0 ? ackedBytes / elapsed : 0
                            setTransfers(prev => prev.map(t =>
                                t.id === transferId ? { ...t, progress, speed } : t
                            ))
                        }

                        if (ackedBytes >= file.size && !isDone) {
                            isDone = true
                            clearInterval(controlInterval)
                            clearInterval(heartbeatInterval)
                            const activeDc = dcs.find(d => d.readyState === 'open')
                            if (activeDc) activeDc.send('__done__')
                            setTransfers(prev => prev.map(t =>
                                t.id === transferId ? { ...t, status: 'completed', progress: 100 } : t
                            ))
                            toast.success('Transfer complete!')
                        } else {
                            schedulePump()
                        }
                    }
                }
            })
        })

        // schedulePump() — serializes all pump() entry points behind a mutex.
        // Any number of callers (bufferedamountlow, heartbeat, ack handler, finally)
        // can call schedulePump() — only ONE pump() runs at a time.
        const schedulePump = () => {
            if (isPumping || isDone) return
            isPumping = true
            setTimeout(async () => {
                await pump()
                isPumping = false
            }, 0)
        }

        const pump = async () => {
            if (isDone) return
            const now = Date.now()

            // 1. Retry timed-out chunks (one at a time to avoid burst)
            for (const [msgId, flight] of inFlight.entries()) {
                if (isDone) return
                if (now - flight.timestamp > 3000) {
                    if (activeReaders < maxConcurrentReads) {
                        activeReaders++
                        flight.timestamp = Date.now()
                        recentErrors++
                        await sendChunk(msgId, flight.offset, flight.size)
                        activeReaders--
                    }
                }
            }

            // 2. Sequential Pump — send ONE chunk at a time.
            // This ensures each dc.send() completes and bufferedAmount updates
            // before the next send decision is made. No burst overflow.
            while (currentOffset < file.size && activeReaders < maxConcurrentReads && !isDone) {
                const dc = getNextDc()
                if (!dc) break

                const size = Math.min(chunkSize, file.size - currentOffset)
                const offset = currentOffset
                const msgId = messageIdCounter++
                currentOffset += size

                inFlight.set(msgId, { offset, size, timestamp: Date.now() })
                activeReaders++
                await sendChunk(msgId, offset, size)
                activeReaders--
            }

            // If there's still data to send, schedule another pump tick
            if (currentOffset < file.size && !isDone) {
                schedulePump()
            }
        }

        const sendChunk = async (msgId: number, offset: number, size: number): Promise<void> => {
            try {
                if (offset > 0xFFFFFFFF) {
                    console.error('[FlashDrop] FATAL: offset exceeds Uint32 range — aborting chunk')
                    recentErrors++
                    return
                }

                const slice = file.slice(offset, offset + size)
                const buffer = await slice.arrayBuffer()

                // Re-select the best channel AFTER the async read.
                // The channel passed to pump() may be saturated by now.
                const dc = getNextDc()
                if (isDone || !dc) return

                // Build framed payload: [4B msgId][4B offset][data]
                const payload = new Uint8Array(8 + buffer.byteLength)
                const view = new DataView(payload.buffer)
                view.setUint32(0, msgId, true)
                view.setUint32(4, offset, true)
                payload.set(new Uint8Array(buffer), 8)

                try {
                    dc.send(payload.buffer)
                } catch (sendErr) {
                    console.warn('[DataChannel] dc.send() threw:', sendErr)
                    recentErrors++
                }
            } catch (e) {
                recentErrors++
            }
        }

        // FIX: Delay initial pump by 150ms after channels open.
        // Chrome's SCTP association needs a brief moment to be fully ready
        // for sends even after DataChannel readyState becomes 'open'.
        // Firing pump() immediately causes OperationError on the very first sends.
        await new Promise(resolve => setTimeout(resolve, 150))
        schedulePump()

        // Heartbeat — keeps pipeline alive during ACK quiet periods
        const heartbeatInterval = setInterval(() => {
            if (isDone) {
                clearInterval(heartbeatInterval)
            } else {
                schedulePump()
            }
        }, 200)
    }

    // ─── Utility: listen for one event then stop ──────────────────────────────
    function onceSocketEvent(socket: Socket, event: string, handler: (data: any) => void) {
        const wrapper = (data: any) => handler(data)
        socket.on(event, wrapper)
        return () => socket.off(event, wrapper)
    }

    // ─── Send files (one WebRTC connection per file) ──────────────────────────
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