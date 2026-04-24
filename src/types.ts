export interface FileEntry {
    id: string
    file: File
    previewUrl?: string
}

export interface Device {
    id: string
    name: string
    type: 'iphone' | 'android' | 'windows' | 'mac' | 'linux' | 'tablet' | 'unknown'
    connected: boolean
    connectedAt: number
}

export type TransferStatus = 'idle' | 'uploading' | 'sending' | 'receiving' | 'completed' | 'error' | 'awaiting_acceptance'

export interface Transfer {
    id: string        // maps to backend fileId
    fileName: string
    fileSize: number
    progress: number          // 0–100
    status: TransferStatus
    direction: 'send' | 'receive'
    deviceName: string
    deviceId: string
    error?: string
    downloadUrl?: string
    speed?: number            // bytes/sec
    startedAt?: number        // timestamp for ETA calculation
    batchId?: string          // group multi-file transfers
    totalFiles?: number       // total files in batch
    completedFiles?: number   // completed files in batch
}

/** Max file size: 3GB */
export const MAX_FILE_SIZE = 3 * 1024 * 1024 * 1024

/** Format bytes to human-readable string */
export function formatSize(bytes: number): string {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(i > 1 ? 1 : 0)} ${sizes[i]}`
}
