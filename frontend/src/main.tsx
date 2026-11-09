import { Component, StrictMode, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

function StartupReady() {
  useEffect(() => {
    window.dispatchEvent(new Event('qltc-startup-ready'))
  }, [])
  return null
}

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    window.dispatchEvent(new Event('qltc-startup-failed'))
  }

  render() {
    if (this.state.failed) {
      return (
        <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16, padding: 24, background: '#0E1314', color: '#F2F5F5', textAlign: 'center' }}>
          <strong style={{ color: '#E99191', fontSize: 18 }}>Không thể tải ứng dụng QLTC</strong>
          <p style={{ color: '#BFD0D3', maxWidth: 320 }}>Hãy kiểm tra kết nối mạng rồi thử lại. Nếu vẫn gặp lỗi, hãy cập nhật ứng dụng.</p>
          <button type="button" onClick={() => window.location.reload()} style={{ padding: '12px 20px', borderRadius: 12, background: '#8CC7AE', color: '#0E1314', fontWeight: 700, border: 0 }}>Thử tải lại</button>
        </main>
      )
    }
    return this.props.children
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
      <StartupReady />
    </AppErrorBoundary>
  </StrictMode>,
)
