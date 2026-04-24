import { useState, useCallback, useEffect } from 'react'
import toast from 'react-hot-toast'
import Header from './components/Header'
import DropZone from './components/DropZone'
import QRSection from './components/QRSection'
import DeviceList from './components/DeviceList'
import TransferProgress from './components/TransferProgress'
import { Device, FileEntry } from './types'
import { useFlashDrop } from './hooks/useFlashDrop'

export default function App() {
    // ── Dark mode — persisted in localStorage ──
    const [dark, setDark] = useState<boolean>(() => {
        const saved = localStorage.getItem('fd-dark')
        if (saved !== null) return saved === 'true'
        return window.matchMedia('(prefers-color-scheme: dark)').matches
    })

    useEffect(() => {
        const root = document.documentElement
        if (dark) root.classList.add('dark')
        else root.classList.remove('dark')
        localStorage.setItem('fd-dark', String(dark))
    }, [dark])

    const toggleDark = useCallback(() => setDark(d => !d), [])

    // ── Network ──
    const { sessionId, devices, transfers, sendFiles, dismissTransfer, clearCompletedTransfers } = useFlashDrop()

    // ── Files ──
    const [files, setFiles] = useState<FileEntry[]>([])

    const handleFilesAdded = useCallback((entries: FileEntry[]) => {
        setFiles(prev => [...prev, ...entries])
    }, [])

    const handleFileRemove = useCallback((id: string) => {
        setFiles(prev => {
            const entry = prev.find(f => f.id === id)
            if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl)
            return prev.filter(f => f.id !== id)
        })
    }, [])

    const handleClearAll = useCallback(() => {
        files.forEach(f => { if (f.previewUrl) URL.revokeObjectURL(f.previewUrl) })
        setFiles([])
    }, [files])

    // ── Transfers ──
    const handleSend = useCallback((device: Device) => {
        if (files.length === 0) { toast.error('Add files first'); return }
        sendFiles(device, files)
        setFiles([])
    }, [files, sendFiles])

    const handleDismiss = useCallback((id: string) => {
        dismissTransfer(id)
    }, [dismissTransfer])

    const activeTransfers = transfers.filter(t => t.status !== 'completed' && t.status !== 'error')
    const doneTransfers = transfers.filter(t => t.status === 'completed' || t.status === 'error')
    const isConnected = !!sessionId

    return (
        <div className="min-h-screen flex flex-col transition-colors duration-300">
            {/* Animated background mesh */}
            <div className="bg-mesh" />

            <Header dark={dark} onToggleDark={toggleDark} isConnected={isConnected} />

            <main className="flex-1 max-w-4xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6 pb-20">
                {/* Hero */}
                <div className="text-center py-3 animate-fade-in">
                    <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight font-display">
                        <span className="text-gradient">Instant File Sharing</span>
                    </h1>
                    <p className="text-slate-500 dark:text-slate-400 text-sm sm:text-base mt-2 font-medium max-w-md mx-auto">
                        Share files between any devices over the same Wi-Fi.
                        <span className="text-primary-500 dark:text-primary-400 font-semibold"> Up to 3GB</span> per file.
                    </p>
                </div>

                {/* Active transfers */}
                {activeTransfers.length > 0 && (
                    <TransferProgress transfers={activeTransfers} onDismiss={handleDismiss} />
                )}

                {/* Drop zone */}
                <DropZone
                    files={files}
                    onFilesAdded={handleFilesAdded}
                    onFileRemove={handleFileRemove}
                    onClearAll={handleClearAll}
                />

                {/* QR + Devices */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                    <QRSection sessionId={sessionId} />
                    <DeviceList devices={devices} files={files} onSend={handleSend} />
                </div>

                {/* Completed transfers */}
                {doneTransfers.length > 0 && (
                    <TransferProgress
                        transfers={doneTransfers}
                        onDismiss={handleDismiss}
                        onClearCompleted={clearCompletedTransfers}
                    />
                )}
            </main>

            <footer className="text-center py-5 text-xs border-t transition-colors duration-300 bg-white/50 dark:bg-dark-bg/50 backdrop-blur-sm border-slate-100 dark:border-dark-border">
                <span className="text-slate-400 dark:text-slate-600">
                    <span className="font-bold text-gradient-static">FlashDrop</span>
                    {' '}— Transfers happen over your local Wi-Fi. No data leaves your network.
                </span>
            </footer>
        </div>
    )
}
