import { useCallback, useRef, useState, DragEvent, ChangeEvent } from 'react'
import { Upload, FileText, Image, Film, Music, Archive, X, FolderOpen, Trash2, HardDrive, AlertTriangle } from 'lucide-react'
import { FileEntry, MAX_FILE_SIZE, formatSize } from '../types'
import clsx from 'clsx'
import toast from 'react-hot-toast'

interface DropZoneProps {
    files: FileEntry[]
    onFilesAdded: (entries: FileEntry[]) => void
    onFileRemove: (id: string) => void
    onClearAll: () => void
}

function fileIcon(file: File) {
    const t = file.type
    if (t.startsWith('image/')) return <Image className="w-4 h-4 text-violet-400" />
    if (t.startsWith('video/')) return <Film className="w-4 h-4 text-rose-400" />
    if (t.startsWith('audio/')) return <Music className="w-4 h-4 text-amber-400" />
    if (t.includes('zip') || t.includes('rar') || t.includes('tar') || t.includes('7z'))
        return <Archive className="w-4 h-4 text-orange-400" />
    if (t.includes('pdf')) return <FileText className="w-4 h-4 text-red-400" />
    return <FileText className="w-4 h-4 text-primary-400" />
}

function fileIconBg(file: File) {
    const t = file.type
    if (t.startsWith('image/')) return 'bg-violet-50 dark:bg-violet-900/20 border-violet-100 dark:border-violet-800/30'
    if (t.startsWith('video/')) return 'bg-rose-50 dark:bg-rose-900/20 border-rose-100 dark:border-rose-800/30'
    if (t.startsWith('audio/')) return 'bg-amber-50 dark:bg-amber-900/20 border-amber-100 dark:border-amber-800/30'
    if (t.includes('zip') || t.includes('rar') || t.includes('tar'))
        return 'bg-orange-50 dark:bg-orange-900/20 border-orange-100 dark:border-orange-800/30'
    return 'bg-primary-50 dark:bg-primary-900/20 border-primary-100 dark:border-primary-800/30'
}

function makeEntries(files: File[]): { valid: FileEntry[]; oversized: string[] } {
    const valid: FileEntry[] = []
    const oversized: string[] = []

    files.forEach((file) => {
        if (file.size > MAX_FILE_SIZE) {
            oversized.push(file.name)
            return
        }
        const entry: FileEntry = {
            id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
            file,
        }
        if (file.type.startsWith('image/')) {
            entry.previewUrl = URL.createObjectURL(file)
        }
        valid.push(entry)
    })

    return { valid, oversized }
}

export default function DropZone({ files, onFilesAdded, onFileRemove, onClearAll }: DropZoneProps) {
    const [isDragging, setIsDragging] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)

    const totalSize = files.reduce((acc, f) => acc + f.file.size, 0)
    const sizePercent = Math.min((totalSize / MAX_FILE_SIZE) * 100, 100)

    const processFiles = useCallback((rawFiles: File[]) => {
        const { valid, oversized } = makeEntries(rawFiles)

        if (oversized.length > 0) {
            toast.error(`${oversized.length} file(s) exceed 3GB limit: ${oversized.join(', ')}`)
        }

        if (valid.length > 0) {
            onFilesAdded(valid)
            toast.success(`${valid.length} file${valid.length > 1 ? 's' : ''} added`)
        }
    }, [onFilesAdded])

    const handleDrop = useCallback(
        (e: DragEvent<HTMLDivElement>) => {
            e.preventDefault()
            setIsDragging(false)
            const dropped = Array.from(e.dataTransfer.files)
            if (!dropped.length) return
            processFiles(dropped)
        },
        [processFiles]
    )

    const handleChange = useCallback(
        (e: ChangeEvent<HTMLInputElement>) => {
            const selected = Array.from(e.target.files ?? [])
            if (!selected.length) return
            processFiles(selected)
            e.target.value = ''
        },
        [processFiles]
    )

    return (
        <section className="card p-5 sm:p-6 animate-fade-in">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-primary-500/10 to-accent-500/10 dark:from-primary-500/20 dark:to-accent-500/20 flex items-center justify-center">
                        <Upload className="w-3.5 h-3.5 text-primary-500" />
                    </div>
                    Upload Files
                </h2>
                {files.length > 0 && (
                    <button
                        onClick={onClearAll}
                        className="text-xs font-medium text-slate-400 dark:text-slate-500 hover:text-rose-500 dark:hover:text-rose-400 transition-colors flex items-center gap-1"
                    >
                        <Trash2 className="w-3 h-3" />
                        Clear all
                    </button>
                )}
            </div>

            {/* Drop Area */}
            <div
                role="button"
                tabIndex={0}
                aria-label="Drop files here or click to select"
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => inputRef.current?.click()}
                onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
                className={clsx(
                    'relative flex flex-col items-center justify-center gap-3',
                    'rounded-2xl border-2 border-dashed cursor-pointer',
                    'transition-all duration-300 px-6 py-10 select-none text-center',
                    isDragging
                        ? 'border-primary-400 dark:border-primary-500 bg-primary-50/80 dark:bg-primary-900/20 scale-[1.01] shadow-glow-sm'
                        : 'border-slate-200 dark:border-dark-border bg-slate-50/50 dark:bg-dark-surface/40 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-primary-50/30 dark:hover:bg-primary-900/10'
                )}
            >
                {isDragging && (
                    <div className="absolute inset-0 rounded-2xl pointer-events-none">
                        <div className="absolute inset-0 rounded-2xl border-2 border-primary-300 dark:border-primary-500 drag-ripple" />
                    </div>
                )}

                <div className={clsx(
                    'w-14 h-14 rounded-2xl flex items-center justify-center transition-all duration-300',
                    isDragging
                        ? 'bg-primary-100 dark:bg-primary-900/40 shadow-glow-sm'
                        : 'bg-white dark:bg-dark-card shadow-sm border border-slate-100 dark:border-dark-border'
                )}>
                    <Upload className={clsx(
                        'w-6 h-6 transition-all duration-300',
                        isDragging ? 'text-primary-500 scale-110' : 'text-slate-400 dark:text-slate-500'
                    )} />
                </div>

                <div>
                    <p className="font-semibold text-slate-700 dark:text-slate-200 text-sm">
                        {isDragging ? 'Release to add files' : 'Drag & drop files here'}
                    </p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
                        or click to browse • Max 3GB per file
                    </p>
                </div>

                <input
                    ref={inputRef}
                    type="file"
                    multiple
                    className="hidden"
                    onChange={handleChange}
                    aria-hidden="true"
                />
            </div>

            {/* Select Files Button */}
            <button
                id="select-files-btn"
                onClick={() => inputRef.current?.click()}
                className="btn-secondary w-full mt-3"
            >
                <FolderOpen className="w-4 h-4" />
                Select Files
            </button>

            {/* File List */}
            {files.length > 0 && (
                <div className="mt-4 space-y-3">
                    {/* Summary Bar */}
                    <div className="flex items-center justify-between">
                        <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                            <HardDrive className="w-3 h-3" />
                            {files.length} file{files.length !== 1 ? 's' : ''} • {formatSize(totalSize)}
                        </p>
                        {totalSize > MAX_FILE_SIZE * 0.8 && (
                            <span className="text-xs font-medium text-amber-500 flex items-center gap-1">
                                <AlertTriangle className="w-3 h-3" />
                                Near limit
                            </span>
                        )}
                    </div>

                    {/* Size Progress */}
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-dark-surface rounded-full overflow-hidden">
                        <div
                            className={clsx(
                                'h-full rounded-full transition-all duration-500',
                                sizePercent >= 90 ? 'bg-gradient-to-r from-rose-500 to-rose-400'
                                    : sizePercent >= 70 ? 'bg-gradient-to-r from-amber-500 to-amber-400'
                                        : 'bg-gradient-to-r from-primary-500 to-accent-500'
                            )}
                            style={{ width: `${sizePercent}%` }}
                        />
                    </div>

                    {/* File Items */}
                    <ul className="space-y-2 max-h-60 overflow-y-auto pr-1">
                        {files.map((entry, i) => (
                            <li
                                key={entry.id}
                                className="file-enter flex items-center gap-3 bg-white/60 dark:bg-dark-surface/60 rounded-xl px-3 py-2.5 border border-slate-100 dark:border-dark-border backdrop-blur-sm hover:border-primary-200 dark:hover:border-primary-800/40 transition-colors group"
                                style={{ animationDelay: `${i * 40}ms` }}
                            >
                                {entry.previewUrl ? (
                                    <img
                                        src={entry.previewUrl}
                                        alt={entry.file.name}
                                        className="w-10 h-10 rounded-lg object-cover flex-shrink-0 border border-slate-200 dark:border-dark-border"
                                    />
                                ) : (
                                    <div className={clsx(
                                        'w-10 h-10 rounded-lg border flex items-center justify-center flex-shrink-0',
                                        fileIconBg(entry.file)
                                    )}>
                                        {fileIcon(entry.file)}
                                    </div>
                                )}

                                <div className="flex-1 min-w-0">
                                    <p className="text-sm font-medium text-slate-700 dark:text-slate-200 truncate">{entry.file.name}</p>
                                    <p className="text-xs text-slate-400 dark:text-slate-500">{formatSize(entry.file.size)}</p>
                                </div>

                                <button
                                    onClick={(e) => { e.stopPropagation(); onFileRemove(entry.id) }}
                                    className="btn-icon text-slate-300 dark:text-slate-600 hover:text-rose-500 dark:hover:text-rose-400 p-1.5 -mr-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-all"
                                    aria-label={`Remove ${entry.file.name}`}
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </section>
    )
}
