import { useState, useEffect, useCallback, useRef } from 'react'
import { io, Socket } from 'socket.io-client'
import axios from 'axios'
import toast from 'react-hot-toast'
import { Device, FileEntry, Transfer, TransferStatus, MAX_FILE_SIZE, formatSize } from '../types'

const getBackendUrl = () => {
    const envUrl = (import.meta as any).env.VITE_BACKEND_URL;
    if (envUrl) {
        return envUrl.replace(/\/$/, ''); // Remove trailing slash
    }
    return 'http://localhost:3001';
};
export const BACKEND_URL = getBackendUrl();

function getDeviceName(): string {
    const ua = navigator.userAgent
    const isWin = ua.includes('Windows')
    const isMac = ua.includes('Mac') && !ua.includes('iPhone')
    const isIphone = ua.includes('iPhone')
    const isAndroid = ua.includes('Android')
    const isLinux = ua.includes('Linux') && !ua.includes('Android')
    const isIPad = ua.includes('iPad') || (ua.includes('Mac') && 'ontouchend' in document)
    const randomStr = Math.random().toString(36).substring(2, 6).toUpperCase()

    if (isIPad) return `iPad (${randomStr})`
    if (isIphone) return `iPhone (${randomStr})`
    if (isMac) return `Mac (${randomStr})`
    if (isWin) return `Windows PC (${randomStr})`
    if (isAndroid) return `Android (${randomStr})`
    if (isLinux) return `Linux (${randomStr})`
    return `Device (${randomStr})`
}

function guessDeviceType(name: string): Device['type'] {
    const lower = name.toLowerCase()
    if (lower.includes('iphone')) return 'iphone'
    if (lower.includes('ipad')) return 'tablet'
    if (lower.includes('mac')) return 'mac'
    if (lower.includes('windows')) return 'windows'
    if (lower.includes('android')) return 'android'
    if (lower.includes('linux')) return 'linux'
    return 'unknown'
}

export function useFlashDrop() {
    const [sessionId, setSessionId] = useState<string>('')
    const [devices, setDevices] = useState<Device[]>([])
    const [transfers, setTransfers] = useState<Transfer[]>([])

    const socketRef = useRef<Socket | null>(null)
    const sessionIdRef = useRef<string>('')
    const deviceIdRef = useRef<string>('')

    // 1. Initial connection — all socket listeners registered ONCE
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search)
        const initialSessionId = urlParams.get('session') || ''

        const newSocket = io(BACKEND_URL, {
            transports: ['websocket'],
            reconnection: true,
            reconnectionAttempts: 10,
            reconnectionDelay: 1000,
            timeout: 30000,
        })
        socketRef.current = newSocket

        newSocket.on('connect', () => {
            newSocket.emit('connect-device', {
                sessionId: initialSessionId,
                deviceName: getDeviceName(),
            })
        })

        newSocket.on('device-joined', ({ device, sessionId: newSessionId }: any) => {
            setSessionId(newSessionId)
            sessionIdRef.current = newSessionId
            deviceIdRef.current = device.deviceId

            const newUrl = new URL(window.location.href)
            newUrl.searchParams.set('session', newSessionId)
            window.history.replaceState({}, '', newUrl)
        })

        newSocket.on('device-list', (backendDevices: any[]) => {
            setDevices(backendDevices
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

        newSocket.on('device-left', ({ deviceId: leftDeviceId, deviceName }: any) => {
            toast(`${deviceName} disconnected`, { icon: '👋' })
            setDevices(prev => prev.filter(d => d.id !== leftDeviceId))
        })

        // ─── Receive file (download handler) ─────────────────────────────────
        newSocket.on('receive-file', async (payload: any) => {
            const newTransferId = payload.fileId
            const startedAt = Date.now()

            setTransfers(prev => [...prev, {
                id: newTransferId,
                fileName: payload.fileName,
                fileSize: payload.fileSize,
                progress: 0,
                status: 'receiving',
                direction: 'receive',
                deviceName: payload.fromName,
                deviceId: payload.from,
                downloadUrl: payload.downloadUrl,
                startedAt,
            }])

            toast(`Receiving ${payload.fileName} from ${payload.fromName}...`, { icon: '📥' })

            // Notify sender we accepted
            newSocket.emit('transfer-status', {
                targetDeviceId: payload.from,
                fileId: newTransferId,
                status: 'accepted',
                progress: 0
            })

            // PRODUCTION SAFEGUARD: Prevent browser RAM crash for large files
            if (payload.fileSize > 250 * 1024 * 1024) { // > 250MB
                const url = `${BACKEND_URL}${payload.downloadUrl}?name=${encodeURIComponent(payload.fileName)}`
                const a = document.createElement('a')
                a.href = url
                a.download = payload.fileName
                document.body.appendChild(a)
                a.click()
                a.remove()

                setTransfers(prev => prev.map(t =>
                    t.id === newTransferId ? { ...t, status: 'completed', progress: 100 } : t
                ))
                toast.success(`Started native download for ${payload.fileName}`)

                newSocket.emit('transfer-status', {
                    targetDeviceId: payload.from,
                    fileId: newTransferId,
                    status: 'done',
                    progress: 100
                })
                return
            }

            try {
                const response = await axios({
                    url: `${BACKEND_URL}${payload.downloadUrl}?name=${encodeURIComponent(payload.fileName)}`,
                    method: 'GET',
                    responseType: 'blob',
                    timeout: 30 * 60 * 1000, // 30 min timeout for large files
                    onDownloadProgress: (progressEvent) => {
                        if (progressEvent.total) {
                            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total)
                            const elapsed = (Date.now() - startedAt) / 1000
                            const speed = elapsed > 0 ? progressEvent.loaded / elapsed : 0

                            setTransfers(prev => prev.map(t =>
                                t.id === newTransferId
                                    ? { ...t, progress: percent, speed }
                                    : t
                            ))

                            newSocket.emit('transfer-status', {
                                targetDeviceId: payload.from,
                                fileId: newTransferId,
                                status: percent === 100 ? 'done' : 'downloading',
                                progress: percent
                            })
                        }
                    }
                })

                // Download it visually in browser
                const blob = new Blob([response.data])
                const objectUrl = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = objectUrl
                a.download = payload.fileName
                document.body.appendChild(a)
                a.click()
                a.remove()
                URL.revokeObjectURL(objectUrl)

                setTransfers(prev => prev.map(t =>
                    t.id === newTransferId
                        ? { ...t, status: 'completed', progress: 100 }
                        : t
                ))
                toast.success(`Received ${payload.fileName}`)

            } catch (err) {
                toast.error(`Failed to download ${payload.fileName}`)
                setTransfers(prev => prev.map(t =>
                    t.id === newTransferId
                        ? { ...t, status: 'error', error: 'Download failed' }
                        : t
                ))
                newSocket.emit('transfer-status', {
                    targetDeviceId: payload.from,
                    fileId: newTransferId,
                    status: 'declined',
                    progress: 0
                })
            }
        })

        // ─── Transfer status (sender sees receiver progress) ─────────────────
        newSocket.on('transfer-status', (payload: any) => {
            setTransfers(prev => prev.map(t => {
                if (t.id === payload.fileId) {
                    let newStatus: TransferStatus = t.status
                    if (payload.status === 'accepted') newStatus = 'sending'
                    else if (payload.status === 'declined') {
                        newStatus = 'error'
                        toast.error(`${t.deviceName} failed or declined the file.`)
                    }
                    else if (payload.status === 'downloading') newStatus = 'sending'
                    else if (payload.status === 'done') newStatus = 'completed'

                    // Map sender progress: upload was 0-50%, download is 50-100%
                    const mappedProgress = payload.status === 'downloading' || payload.status === 'done'
                        ? 50 + Math.round(payload.progress / 2)
                        : payload.progress || t.progress

                    return { ...t, progress: mappedProgress, status: newStatus }
                }
                return t
            }))

            if (payload.status === 'done') {
                toast.success('Transfer complete!')
            }
        })

        newSocket.on('error', ({ message }: any) => {
            toast.error(message)
        })

        newSocket.on('reconnect', () => {
            toast.success('Reconnected to server')
        })

        newSocket.on('disconnect', (reason) => {
            if (reason === 'io server disconnect') {
                toast.error('Disconnected from server')
            }
        })

        return () => {
            newSocket.disconnect()
        }
    }, [])

    // ─── Send files (sequential with progress) ──────────────────────────────
    const sendFiles = useCallback(async (targetDevice: Device, files: FileEntry[]) => {
        if (!sessionIdRef.current || !socketRef.current) return

        const batchId = `batch-${Date.now()}`
        const totalFiles = files.length

        // Validate file sizes before sending
        for (const entry of files) {
            if (entry.file.size > MAX_FILE_SIZE) {
                toast.error(`${entry.file.name} exceeds 3GB limit (${formatSize(entry.file.size)})`)
                return
            }
        }

        for (let i = 0; i < files.length; i++) {
            const entry = files[i]
            const newTransferId = `tx-local-${entry.id}`
            const startedAt = Date.now()

            setTransfers(prev => [...prev, {
                id: newTransferId,
                fileName: entry.file.name,
                fileSize: entry.file.size,
                progress: 0,
                status: 'uploading',
                direction: 'send',
                deviceName: targetDevice.name,
                deviceId: targetDevice.id,
                startedAt,
                batchId,
                totalFiles,
                completedFiles: i,
            }])

            toast(`Uploading ${entry.file.name} (${i + 1}/${totalFiles})...`, { icon: '⬆️' })

            const formData = new FormData()
            formData.append('file', entry.file)
            formData.append('sessionId', sessionIdRef.current)
            formData.append('targetDeviceId', targetDevice.id)

            let retries = 0
            const maxRetries = 1

            while (retries <= maxRetries) {
                try {
                    const response = await axios.post(`${BACKEND_URL}/upload`, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                        timeout: 30 * 60 * 1000, // 30 min timeout
                        onUploadProgress: (progressEvent) => {
                            if (progressEvent.total) {
                                // Upload is 0-50% of total transfer
                                const percent = Math.round((progressEvent.loaded * 50) / progressEvent.total)
                                const elapsed = (Date.now() - startedAt) / 1000
                                const speed = elapsed > 0 ? progressEvent.loaded / elapsed : 0

                                setTransfers(prev => prev.map(t =>
                                    t.id === newTransferId
                                        ? { ...t, progress: percent, status: 'uploading', speed }
                                        : t
                                ))
                            }
                        }
                    })

                    const { fileId, originalName, fileSize, mimeType } = response.data

                    // Update local transfer ID to match server ID
                    setTransfers(prev => prev.map(t =>
                        t.id === newTransferId
                            ? { ...t, id: fileId, status: 'sending', progress: 50, completedFiles: i + 1 }
                            : t
                    ))

                    // Notify receiver via WebSocket
                    socketRef.current!.emit('send-file', {
                        targetDeviceId: targetDevice.id,
                        fileId,
                        fileName: originalName,
                        fileSize,
                        mimeType
                    })

                    break // Success, exit retry loop

                } catch (err: any) {
                    if (retries < maxRetries) {
                        retries++
                        toast(`Retrying ${entry.file.name}...`, { icon: '🔄' })
                        await new Promise(r => setTimeout(r, 2000)) // Wait 2s before retry
                    } else {
                        const errorMsg = err?.response?.data?.error || err.message || 'Upload failed'
                        toast.error(`Failed: ${entry.file.name} — ${errorMsg}`)
                        setTransfers(prev => prev.map(t =>
                            t.id === newTransferId
                                ? { ...t, status: 'error', error: errorMsg }
                                : t
                        ))
                    }
                }
            }
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
