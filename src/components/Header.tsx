import { Zap, Moon, Sun, Wifi } from 'lucide-react'

interface HeaderProps {
    dark: boolean
    onToggleDark: () => void
    isConnected: boolean
}

export default function Header({ dark, onToggleDark, isConnected }: HeaderProps) {
    return (
        <header className="sticky top-0 z-50 w-full glass-header shadow-sm">
            <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">

                {/* Logo + Name */}
                <div className="flex items-center gap-3">
                    <div className="relative w-10 h-10 rounded-xl bg-gradient-to-br from-primary-500 via-primary-600 to-accent-500 flex items-center justify-center shadow-glow-sm group">
                        <Zap className="w-5 h-5 text-white fill-white transition-transform duration-300 group-hover:scale-110" />
                        <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-primary-400 to-accent-400 opacity-0 group-hover:opacity-100 transition-opacity duration-300 blur-md -z-10" />
                    </div>
                    <div className="flex flex-col leading-none">
                        <span className="text-lg font-extrabold tracking-tight font-display text-gradient">
                            FlashDrop
                        </span>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 font-medium tracking-widest uppercase mt-0.5">
                            File Transfer
                        </span>
                    </div>
                </div>

                {/* Right side: connection status + dark toggle */}
                <div className="flex items-center gap-2.5">
                    {/* Connection status */}
                    <div className="hidden sm:flex items-center gap-2 px-3.5 py-1.5 rounded-full border transition-all duration-300"
                        style={{
                            backgroundColor: isConnected
                                ? (dark ? 'rgba(16, 185, 129, 0.08)' : 'rgba(16, 185, 129, 0.06)')
                                : (dark ? 'rgba(244, 63, 94, 0.08)' : 'rgba(244, 63, 94, 0.06)'),
                            borderColor: isConnected
                                ? (dark ? 'rgba(16, 185, 129, 0.2)' : 'rgba(16, 185, 129, 0.15)')
                                : (dark ? 'rgba(244, 63, 94, 0.2)' : 'rgba(244, 63, 94, 0.15)'),
                        }}
                    >
                        <span className="relative flex h-2 w-2">
                            {isConnected && (
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            )}
                            <span className={`relative inline-flex rounded-full h-2 w-2 ${isConnected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                        </span>
                        <span className={`text-xs font-semibold ${isConnected
                            ? 'text-emerald-600 dark:text-emerald-400'
                            : 'text-rose-600 dark:text-rose-400'
                            }`}>{isConnected ? 'Connected' : 'Offline'}
                        </span>
                    </div>

                    {/* Mobile connection dot */}
                    <div className="sm:hidden flex items-center">
                        <span className="relative flex h-2.5 w-2.5">
                            {isConnected && (
                                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                            )}
                            <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isConnected ? 'bg-emerald-400' : 'bg-rose-400'}`} />
                        </span>
                    </div>

                    {/* Dark mode toggle */}
                    <button
                        id="dark-mode-toggle"
                        onClick={onToggleDark}
                        aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
                        title={dark ? 'Light mode' : 'Dark mode'}
                        className="btn-icon text-slate-500 dark:text-slate-400 hover:text-primary-500 dark:hover:text-primary-400 w-9 h-9 relative overflow-hidden"
                    >
                        <div className={`transition-all duration-500 ${dark ? 'rotate-0 scale-100' : 'rotate-90 scale-0 absolute'}`}>
                            <Sun className="w-5 h-5" />
                        </div>
                        <div className={`transition-all duration-500 ${dark ? '-rotate-90 scale-0 absolute' : 'rotate-0 scale-100'}`}>
                            <Moon className="w-5 h-5" />
                        </div>
                    </button>
                </div>

            </div>
        </header>
    )
}
