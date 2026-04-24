import { ArrowUpRight, ArrowDownLeft, CheckCircle2, AlertCircle, FileText, X, Zap, Clock, Gauge } from 'lucide-react'
import { Transfer, formatSize } from '../types'
import clsx from 'clsx'

interface TransferProgressProps {
    transfers: Transfer[]
    onDismiss: (id: string) => void
    onClearCompleted?: () => void
}

function statusLabel(t: Transfer): string {
    switch (t.status) {
        case 'uploading': return 'Uploading to server…'
        case 'sending': return `Sending to ${t.deviceName}…`
        case 'receiving': return `Receiving from ${t.deviceName}…`
        case 'completed': return 'Transfer complete!'
        case 'error': return t.error ?? 'Transfer failed'
        default: return 'Waiting…'
    }
}

function barColorClass(status: Transfer['status']) {
    switch (status) {
        case 'uploading': case 'sending': case 'receiving': return 'progress-fill'
        case 'completed': return 'progress-fill-success'
        case 'error': return 'progress-fill-error'
        default: return 'bg-slate-300 dark:bg-slate-600'
    }
}

function formatSpeed(bps: number): string {
    if (!bps || bps <= 0) return '—'
    if (bps >= 1048576) return `${(bps / 1048576).toFixed(1)} MB/s`
    if (bps >= 1024) return `${(bps / 1024).toFixed(0)} KB/s`
    return `${bps.toFixed(0)} B/s`
}

function estimateETA(t: Transfer): string {
    if (!t.speed || t.speed <= 0 || t.progress >= 100) return '—'
    const rem = t.fileSize * (1 - t.progress / 100)
    const s = rem / t.speed
    if (s < 60) return `${Math.ceil(s)}s`
    if (s < 3600) return `${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s`
    return `${Math.floor(s / 3600)}h ${Math.ceil((s % 3600) / 60)}m`
}

function TransferItem({ transfer: t, onDismiss }: { transfer: Transfer; onDismiss: (id: string) => void }) {
    const isDone = t.status === 'completed' || t.status === 'error'
    const isActive = t.status === 'uploading' || t.status === 'sending' || t.status === 'receiving'

    return (
        <div className={clsx('card p-4 space-y-3 file-enter', isDone && t.status === 'completed' && 'border-emerald-100 dark:border-emerald-800/20', isDone && t.status === 'error' && 'border-rose-100 dark:border-rose-800/20')}>
            <div className="flex items-start gap-3">
                <div className={clsx('w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0', t.status === 'completed' ? 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800/30' : t.status === 'error' ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-100 dark:border-rose-800/30' : 'bg-slate-50 dark:bg-dark-surface border-slate-100 dark:border-dark-border')}>
                    {t.status === 'completed' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : t.status === 'error' ? <AlertCircle className="w-4 h-4 text-rose-500" /> : <FileText className="w-4 h-4 text-slate-400 dark:text-slate-500" />}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-800 dark:text-slate-100 truncate">{t.fileName}</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{formatSize(t.fileSize)}</p>
                </div>
                <div className={clsx('flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold flex-shrink-0', t.direction === 'send' ? 'bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-400 border border-primary-100 dark:border-primary-800/30' : 'bg-cyan-50 dark:bg-cyan-900/20 text-accent-600 dark:text-accent-400 border border-cyan-100 dark:border-cyan-800/30')}>
                    {t.direction === 'send' ? <><ArrowUpRight className="w-3.5 h-3.5" />Send</> : <><ArrowDownLeft className="w-3.5 h-3.5" />Receive</>}
                </div>
                {isDone && <button onClick={() => onDismiss(t.id)} className="btn-icon text-slate-300 dark:text-slate-600 hover:text-slate-500 dark:hover:text-slate-400 p-1 -mt-1 -mr-1 flex-shrink-0" aria-label="Dismiss"><X className="w-4 h-4" /></button>}
            </div>
            <div className="space-y-2">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                        {t.status === 'completed' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />}
                        {t.status === 'error' && <AlertCircle className="w-3.5 h-3.5 text-rose-500" />}
                        <span className={clsx('text-xs font-medium', t.status === 'completed' ? 'text-emerald-600 dark:text-emerald-400' : t.status === 'error' ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500 dark:text-slate-400')}>{statusLabel(t)}</span>
                    </div>
                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300 tabular-nums">{t.progress}%</span>
                </div>
                <div className="h-2 w-full bg-slate-100 dark:bg-dark-surface rounded-full overflow-hidden">
                    <div className={clsx('h-full rounded-full transition-all duration-500 ease-out', barColorClass(t.status))} style={{ width: `${t.progress}%` }} role="progressbar" aria-valuenow={t.progress} aria-valuemin={0} aria-valuemax={100} />
                </div>
                {isActive && (
                    <div className="flex items-center gap-4 text-xs text-slate-400 dark:text-slate-500">
                        <span className="flex items-center gap-1"><Gauge className="w-3 h-3" />{formatSpeed(t.speed || 0)}</span>
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />ETA: {estimateETA(t)}</span>
                    </div>
                )}
            </div>
        </div>
    )
}

export default function TransferProgress({ transfers, onDismiss, onClearCompleted }: TransferProgressProps) {
    if (transfers.length === 0) return null
    const doneCount = transfers.filter(t => t.status === 'completed' || t.status === 'error').length
    return (
        <section className="animate-slide-up">
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500/10 to-rose-500/10 dark:from-violet-500/20 dark:to-rose-500/20 flex items-center justify-center">
                        <Zap className="w-3.5 h-3.5 text-violet-500" />
                    </div>
                    Transfers
                    <span className="text-xs font-medium text-slate-400 ml-1">({transfers.length})</span>
                </h2>
                {doneCount > 0 && onClearCompleted && (
                    <button onClick={onClearCompleted} className="text-xs font-medium text-slate-400 hover:text-primary-500 transition-colors">Clear completed</button>
                )}
            </div>
            <div className="space-y-3">
                {transfers.map(t => <TransferItem key={t.id} transfer={t} onDismiss={onDismiss} />)}
            </div>
        </section>
    )
}
