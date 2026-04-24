import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'react-hot-toast'
import App from './App.tsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
        <App />
        <Toaster
            position="top-right"
            toastOptions={{
                duration: 3500,
                style: {
                    borderRadius: '14px',
                    background: 'rgba(26, 28, 46, 0.95)',
                    color: '#f1f5f9',
                    fontSize: '13px',
                    fontWeight: '500',
                    backdropFilter: 'blur(12px)',
                    border: '1px solid rgba(99, 102, 241, 0.15)',
                    boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), 0 0 1px rgba(99, 102, 241, 0.1)',
                    padding: '12px 16px',
                    fontFamily: 'Inter, system-ui, sans-serif',
                },
                success: {
                    iconTheme: { primary: '#10b981', secondary: '#fff' },
                },
                error: {
                    iconTheme: { primary: '#f43f5e', secondary: '#fff' },
                },
            }}
        />
    </React.StrictMode>,
)
