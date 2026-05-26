import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import './animation.css';

// ─── ErrorBoundary ──────────────────────────────────────────────────────────

class DashboardErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { error: Error | null; info: string }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { error: null, info: '' };
  }

  static getDerivedStateFromError(error: Error) {
    return { error, info: error.message };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('[ModGuard WebView Error]', error, errorInfo.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          background: '#0D1117',
          color: '#F85149',
          fontFamily: 'monospace',
          fontSize: 13,
          padding: 24,
          textAlign: 'center',
          gap: 12,
        }}>
          <div style={{ fontSize: 32 }}>⚠</div>
          <div style={{ fontWeight: 500 }}>Dashboard Render Error</div>
          <div style={{ color: '#8B949E', fontSize: 11, maxWidth: 400, lineHeight: 1.5 }}>
            {this.state.info.slice(0, 200)}
          </div>
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: 8,
              padding: '8px 20px',
              borderRadius: 6,
              border: '1px solid #30363D',
              background: '#1C2128',
              color: '#E6EDF3',
              fontFamily: 'monospace',
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            Reload Dashboard
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Devvit WebView Bridge ─────────────────────────────────────────────────

function initWebViewBridge() {
  console.log('[ModGuard WebView] Initializing...');
  window.addEventListener('message', (event) => {
    try {
      const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      if (msg.type === 'devvit-message') {
        console.log('[ModGuard WebView] Devvit message:', msg);
      }
    } catch {
      // Not a JSON message — ignore
    }
  });
  // Signal to Devvit host that WebView is ready
  console.log('[ModGuard WebView] Ready');
}

initWebViewBridge();

// ─── Mount ──────────────────────────────────────────────────────────────────

const rootEl = document.getElementById('root');
if (!rootEl) {
  throw new Error('[ModGuard] Root element #root not found');
}

ReactDOM.createRoot(rootEl).render(
  <React.StrictMode>
    <DashboardErrorBoundary>
      <App />
    </DashboardErrorBoundary>
  </React.StrictMode>
);