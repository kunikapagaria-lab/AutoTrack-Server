import { Component } from 'react';
import { RefreshCw } from 'lucide-react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div style={{
        padding: '2rem', borderRadius: '12px',
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        gap: '12px', textAlign: 'center',
      }}>
        <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#ef4444' }}>
          {this.props.label || 'This section'} encountered an error
        </div>
        <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', fontFamily: 'monospace' }}>
          {this.state.error?.message || 'Unknown error'}
        </div>
        <button
          onClick={() => this.setState({ hasError: false, error: null })}
          style={{
            display: 'flex', alignItems: 'center', gap: '6px',
            padding: '7px 16px', borderRadius: '7px', border: '1px solid rgba(239,68,68,0.4)',
            background: 'transparent', color: '#ef4444', cursor: 'pointer',
            fontSize: '0.78rem', fontWeight: 700,
          }}
        >
          <RefreshCw size={13} /> Try Again
        </button>
      </div>
    );
  }
}
