/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{js,ts,jsx,tsx}",
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'system-ui', 'sans-serif'],
                display: ['Outfit', 'Inter', 'system-ui', 'sans-serif'],
            },
            colors: {
                primary: {
                    50: '#eef2ff',
                    100: '#e0e7ff',
                    200: '#c7d2fe',
                    300: '#a5b4fc',
                    400: '#818cf8',
                    500: '#6366f1',
                    600: '#4f46e5',
                    700: '#4338ca',
                    800: '#3730a3',
                    900: '#312e81',
                    950: '#1e1b4b',
                },
                accent: {
                    300: '#67e8f9',
                    400: '#22d3ee',
                    500: '#06b6d4',
                    600: '#0891b2',
                    700: '#0e7490',
                },
                glow: {
                    indigo: '#6366f1',
                    cyan: '#06b6d4',
                    violet: '#8b5cf6',
                    emerald: '#10b981',
                    rose: '#f43f5e',
                },
                dark: {
                    bg: '#0a0b14',
                    surface: '#12131f',
                    card: '#1a1c2e',
                    border: '#252840',
                    muted: '#3a3f57',
                    hover: '#22243a',
                },
            },
            animation: {
                'fade-in': 'fadeIn 0.4s ease-out',
                'slide-up': 'slideUp 0.45s cubic-bezier(0.16,1,0.3,1)',
                'slide-down': 'slideDown 0.35s ease-out',
                'pulse-slow': 'pulse 3s infinite',
                'float': 'float 6s ease-in-out infinite',
                'glow': 'glow 2s ease-in-out infinite alternate',
                'shimmer': 'shimmer 2s linear infinite',
                'spin-slow': 'spin 8s linear infinite',
                'bounce-in': 'bounceIn 0.5s cubic-bezier(0.34,1.56,0.64,1)',
                'gradient-x': 'gradientX 3s ease infinite',
                'ripple-ring': 'rippleRing 1.5s ease-out infinite',
            },
            keyframes: {
                fadeIn: {
                    '0%': { opacity: '0', transform: 'scale(0.98)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                slideUp: {
                    '0%': { opacity: '0', transform: 'translateY(20px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                slideDown: {
                    '0%': { opacity: '0', transform: 'translateY(-10px)' },
                    '100%': { opacity: '1', transform: 'translateY(0)' },
                },
                float: {
                    '0%, 100%': { transform: 'translateY(0)' },
                    '50%': { transform: 'translateY(-8px)' },
                },
                glow: {
                    '0%': { boxShadow: '0 0 5px rgba(99,102,241,0.3), 0 0 20px rgba(99,102,241,0.1)' },
                    '100%': { boxShadow: '0 0 10px rgba(99,102,241,0.5), 0 0 40px rgba(99,102,241,0.2)' },
                },
                shimmer: {
                    '0%': { backgroundPosition: '-200% 0' },
                    '100%': { backgroundPosition: '200% 0' },
                },
                bounceIn: {
                    '0%': { opacity: '0', transform: 'scale(0.3)' },
                    '50%': { transform: 'scale(1.05)' },
                    '100%': { opacity: '1', transform: 'scale(1)' },
                },
                gradientX: {
                    '0%, 100%': { backgroundPosition: '0% 50%' },
                    '50%': { backgroundPosition: '100% 50%' },
                },
                rippleRing: {
                    '0%': { transform: 'scale(1)', opacity: '0.6' },
                    '100%': { transform: 'scale(2.5)', opacity: '0' },
                },
            },
            boxShadow: {
                'glow-sm': '0 0 10px rgba(99,102,241,0.25)',
                'glow-md': '0 0 20px rgba(99,102,241,0.3), 0 0 40px rgba(99,102,241,0.1)',
                'glow-lg': '0 0 30px rgba(99,102,241,0.4), 0 0 60px rgba(99,102,241,0.15)',
                'glow-cyan': '0 0 15px rgba(6,182,212,0.3), 0 0 30px rgba(6,182,212,0.1)',
                'card': '0 4px 24px -4px rgba(0,0,0,0.08), 0 1px 4px rgba(0,0,0,0.04)',
                'card-hover': '0 8px 32px -4px rgba(0,0,0,0.14), 0 2px 8px rgba(0,0,0,0.06)',
                'card-dark': '0 4px 24px -4px rgba(0,0,0,0.5), 0 0 1px rgba(99,102,241,0.1)',
                'inner-soft': 'inset 0 2px 8px rgba(0,0,0,0.04)',
            },
            backdropBlur: {
                xs: '2px',
            },
            backgroundImage: {
                'gradient-radial': 'radial-gradient(var(--tw-gradient-stops))',
                'mesh-gradient': 'radial-gradient(at 40% 20%, rgba(99,102,241,0.08) 0px, transparent 50%), radial-gradient(at 80% 80%, rgba(6,182,212,0.06) 0px, transparent 50%)',
                'mesh-gradient-dark': 'radial-gradient(at 40% 20%, rgba(99,102,241,0.12) 0px, transparent 50%), radial-gradient(at 80% 80%, rgba(6,182,212,0.08) 0px, transparent 50%)',
            },
        },
    },
    plugins: [],
}
