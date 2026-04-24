import { Smartphone, Monitor, Laptop, Tablet, Send, Wifi, WifiOff, Zap, Users } from 'lucide-react'
import { Device, FileEntry } from '../types'
import toast from 'react-hot-toast'
import clsx from 'clsx'

interface DeviceListProps {
    devices: Device[]
    files: FileEntry[]
    onSend: (device: Device) => void
}

function DeviceIcon({ type }: { type: Device['type'] }) {
    const cls = 'w-5 h-5'
    switch (type) {
        case 'iphone': return <Smartphone className={clsx(cls, 'text-slate-700 dark:text-slate-300')} />
        case 'mac': return <Laptop className={clsx(cls, 'text-slate-700 dark:text-slate-300')} />
        case 'windows': return <Monitor className={clsx(cls, 'text-primary-500')} />
        case 'tablet': return <Tablet className={clsx(cls, 'text-slate-700 dark:text-slate-300')} />
        case 'linux': return <Monitor className={clsx(cls, 'text-emerald-500')} />
        case 'android': return <Smartphone className={clsx(cls, 'text-emerald-500')} />
        default: return <Smartphone className={clsx(cls, 'text-slate-500 dark:text-slate-400')} />
    }
}

function deviceIconBg(type: Device['type']) {
    switch (type) {
        case 'iphone':
        case 'mac':
            return 'bg-slate-100 dark:bg-slate-800/40'
        case 'windows':
            return 'bg-primary-50 dark:bg-primary-900/20'
        case 'android':
        case 'linux':
            return 'bg-emerald-50 dark:bg-emerald-900/20'
        case 'tablet':
            return 'bg-violet-50 dark:bg-violet-900/20'
        default:
            return 'bg-slate-100 dark:bg-dark-surface'
    }
}

function DeviceCard({
    device, files, onSend
}: { device: Device; files: FileEntry[]; onSend: (d: Device) => void }) {
    const canSend = files.length > 0 && device.connected

    return (
        <div className={clsx(
            'card card-hover p-4 flex items-center gap-3 group',
            !device.connected && 'opacity-50'
        )}>
            {/* Device icon */}
            <div className={clsx(
                'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 transition-all duration-300',
                deviceIconBg(device.type),
                device.connected && 'group-hover:shadow-glow-sm'
            )}>
                <DeviceIcon type={device.type} />
            </div>

            {/* Device info */}
            <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm text-slate-800 dark:text-slate-100 truncate">{device.name}</p>
                <div className="flex items-center gap-1.5 mt-0.5">
                    {device.connected ? (
                        <>
                            <span className="relative flex h-1.5 w-1.5">
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
                            </span>
                            <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">Connected</span>
                        </>
                    ) : (
                        <>
                            <WifiOff className="w-3 h-3 text-slate-400 dark:text-slate-600" />
                            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Disconnected</span>
                        </>
                    )}
                </div>
            </div>

            {/* Send button */}
            <button
                id={`send-btn-${device.id}`}
                onClick={() => {
                    if (!canSend) {
                        toast.error(files.length === 0 ? 'Add files first' : `${device.name} is offline`)
                        return
                    }
                    onSend(device)
                }}
                disabled={!canSend}
                className={clsx(
                    'flex-shrink-0 inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-sm font-semibold transition-all duration-200',
                    canSend
                        ? 'bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 active:scale-95 text-white shadow-sm hover:shadow-glow-sm'
                        : 'bg-slate-100 dark:bg-dark-surface text-slate-400 dark:text-slate-600 cursor-not-allowed'
                )}
            >
                <Send className="w-3.5 h-3.5" />
                Send
            </button>
        </div>
    )
}

export default function DeviceList({ devices, files, onSend }: DeviceListProps) {
    const connected = devices.filter(d => d.connected)
    const offline = devices.filter(d => !d.connected)

    return (
        <section className="card p-5 sm:p-6 animate-slide-up">
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-base font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-emerald-500/10 to-cyan-500/10 dark:from-emerald-500/20 dark:to-cyan-500/20 flex items-center justify-center">
                        <Users className="w-3.5 h-3.5 text-emerald-500" />
                    </div>
                    Nearby Devices
                </h2>
                <span className={clsx(
                    'badge transition-all duration-300',
                    connected.length > 0
                        ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/30'
                        : 'bg-slate-100 dark:bg-dark-surface text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-dark-border'
                )}>
                    {connected.length > 0 ? (
                        <><Wifi className="w-3 h-3" /> {connected.length} online</>
                    ) : (
                        '0 online'
                    )}
                </span>
            </div>

            {devices.length === 0 ? (
                <div className="text-center py-10">
                    <div className="w-14 h-14 rounded-2xl bg-slate-50 dark:bg-dark-surface border border-slate-100 dark:border-dark-border flex items-center justify-center mx-auto mb-3 animate-float">
                        <Zap className="w-7 h-7 text-slate-300 dark:text-slate-600" />
                    </div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-400">Waiting for devices</p>
                    <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-[200px] mx-auto">
                        Scan the QR code on another device to connect instantly
                    </p>
                </div>
            ) : (
                <div className="space-y-2.5">
                    {[...connected, ...offline].map((d, i) => (
                        <div key={d.id} className="file-enter" style={{ animationDelay: `${i * 60}ms` }}>
                            <DeviceCard device={d} files={files} onSend={onSend} />
                        </div>
                    ))}
                </div>
            )}
        </section>
    )
}
