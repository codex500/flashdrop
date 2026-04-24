import { useState, useEffect, useCallback } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { Smartphone, RefreshCw, Copy, CheckCheck, Link2, QrCode } from 'lucide-react'
import toast from 'react-hot-toast'
import axios from 'axios'
import clsx from 'clsx'
import { BACKEND_URL } from '../hooks/useFlashDrop'

interface QRSectionProps {
    sessionId: string
}

export default function QRSection({ sessionId }: QRSectionProps) {
    const [url, setUrl] = useState('')
    const [copied, setCopied] = useState(false)
    const [refreshing, setRefreshing] = useState(false)
    const [error, setError] = useState(false)

    const fetchQrData = useCallback(async () => {
        if (!sessionId) return
        try {
            setRefreshing(true)
            setError(false)
            const res = await axios.get(`${BACKEND_URL}/qr?sessionId=${sessionId}&baseUrl=${encodeURIComponent(window.location.origin)}`)
            setUrl(res.data.url)
        } catch (err) {
            console.error('Failed to fetch QR details:', err)
            setUrl(`${window.location.origin}/?session=${sessionId}`)
            setError(true)
        } finally {
            setTimeout(() => setRefreshing(false), 500)
        }
    }, [sessionId])

    useEffect(() => {
        fetchQrData()
    }, [fetchQrData])

    const handleRefresh = () => {
        fetchQrData()
        toast.success('QR code refreshed')
    }

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(url)
            setCopied(true)
            toast.success('Link copied!')
            setTimeout(() => setCopied(false), 2000)
        } catch {
            toast.error('Could not copy — please copy the URL manually')
        }
    }

    return (
        <section className="card p-5 animate-slide-up flex flex-col">
            {/* Title row */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-500/10 to-primary-500/10 dark:from-accent-500/20 dark:to-primary-500/20 flex items-center justify-center">
                        <QrCode className="w-3.5 h-3.5 text-accent-500" />
                    </div>
                    Connect Device
                </h2>
                <button
                    onClick={handleRefresh}
                    disabled={!sessionId || refreshing}
                    className="btn-icon text-slate-400 hover:text-primary-500 dark:hover:text-primary-400 disabled:opacity-50 w-8 h-8"
                    aria-label="Refresh QR code"
                >
                    <RefreshCw className={clsx('w-4 h-4 transition-transform duration-500', refreshing && 'animate-spin')} />
                </button>
            </div>

            {/* QR Code */}
            <div className="flex justify-center mb-4">
                <div className="relative p-4 bg-white rounded-2xl shadow-sm inline-block gradient-border">
                    <div className="min-h-[148px] min-w-[148px] flex items-center justify-center">
                        {url ? (
                            <QRCodeSVG
                                value={url}
                                size={148}
                                bgColor="#ffffff"
                                fgColor="#1e1b4b"
                                level="M"
                                includeMargin={false}
                            />
                        ) : (
                            <div className="w-10 h-10 border-3 border-slate-200 border-t-primary-500 rounded-full animate-spin" />
                        )}
                    </div>
                </div>
            </div>

            {/* Device Badge */}
            <div className="flex justify-center mb-3">
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-primary-50 dark:bg-primary-900/20 border border-primary-100 dark:border-primary-800/30">
                    <Smartphone className="w-3.5 h-3.5 text-primary-500" />
                    <span className="text-xs font-semibold text-primary-600 dark:text-primary-400">Any Device</span>
                </div>
            </div>

            {/* Steps */}
            <div className="space-y-2 mb-4">
                {[
                    { step: '1', text: 'Connect both devices to the same Wi-Fi' },
                    { step: '2', text: 'Scan QR code or open the link below' },
                    { step: '3', text: 'Drop files and hit Send!' },
                ].map(({ step, text }) => (
                    <div key={step} className="flex items-start gap-2.5">
                        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-gradient-to-br from-primary-500 to-accent-500 flex items-center justify-center text-[10px] font-bold text-white mt-0.5">
                            {step}
                        </span>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{text}</p>
                    </div>
                ))}
            </div>

            {/* URL copy row */}
            <div className="mt-auto space-y-2">
                <div className="flex items-center gap-2 bg-slate-50/80 dark:bg-dark-surface/60 rounded-xl border border-slate-200 dark:border-dark-border px-3 py-2.5 backdrop-blur-sm group hover:border-primary-200 dark:hover:border-primary-800/40 transition-colors">
                    <Link2 className="w-3.5 h-3.5 text-slate-400 dark:text-slate-500 flex-shrink-0" />
                    <span className="text-xs text-slate-600 dark:text-slate-300 font-mono truncate flex-1" title={url}>
                        {url || 'Connecting...'}
                    </span>
                    <button
                        onClick={handleCopy}
                        disabled={!url}
                        className="flex-shrink-0 p-1.5 rounded-lg hover:bg-white dark:hover:bg-dark-card transition-all disabled:opacity-50"
                        aria-label="Copy URL"
                    >
                        {copied
                            ? <CheckCheck className="w-4 h-4 text-emerald-500" />
                            : <Copy className="w-4 h-4 text-slate-400 dark:text-slate-500 group-hover:text-primary-500 transition-colors" />
                        }
                    </button>
                </div>

                {error && (
                    <p className="text-xs text-amber-500 dark:text-amber-400 flex items-center gap-1">
                        ⚠️ Using fallback URL — server QR endpoint unavailable
                    </p>
                )}
            </div>
        </section>
    )
}
