import { useState, useEffect } from 'react';
import { X, Cloud, CheckCircle, AlertCircle } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export default function BranchSettings({ onClose }) {
  const [branchName,  setBranchName]  = useState('');
  const [cloudUrl,    setCloudUrl]    = useState('');
  const [cloudApiKey, setCloudApiKey] = useState('');
  const [configured,  setConfigured]  = useState(false);
  const [saving,      setSaving]      = useState(false);
  const [msg,         setMsg]         = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('autotrack_access_token') || '';
    fetch(`${API_URL}/config/branch`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(d => {
        setBranchName(d.branch_name || '');
        setCloudUrl(d.cloud_url    || '');
        setConfigured(d.configured || false);
      })
      .catch(() => {});
  }, []);

  const save = async () => {
    if (!branchName.trim() || !cloudUrl.trim() || !cloudApiKey.trim()) {
      setMsg({ type: 'error', text: 'All three fields are required.' });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const token = localStorage.getItem('autotrack_access_token') || '';
      const res = await fetch(`${API_URL}/config/branch`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({
          branch_name:   branchName.trim(),
          cloud_url:     cloudUrl.trim(),
          cloud_api_key: cloudApiKey.trim(),
        }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Save failed');
      }
      setMsg({ type: 'ok', text: 'Saved. Sync will start within 5 seconds.' });
      setCloudApiKey('');
      setConfigured(true);
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0,
        background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
        zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        className="panel animate-scale-in"
        style={{ width: '100%', maxWidth: '480px', borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-color)' }}
      >
        {/* header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Cloud size={18} color="var(--accent-color)" />
            <h3 style={{ fontSize: '0.95rem', fontWeight: 900, color: 'white' }}>Cloud Sync Settings</h3>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {configured
              ? <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}><CheckCircle size={11} /> Configured</span>
              : <span style={{ fontSize: '0.65rem', fontWeight: 700, color: '#94a3b8' }}>Not configured</span>
            }
            <button onClick={onClose} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '6px', borderRadius: '50%', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* fields */}
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Field label="Branch Name" value={branchName} onChange={setBranchName} placeholder="e.g. Main Workshop" />
          <Field label="Cloud Server URL" value={cloudUrl} onChange={setCloudUrl} placeholder="https://your-cloud-server.com" />
          <Field
            label="Branch API Key"
            value={cloudApiKey}
            onChange={setCloudApiKey}
            placeholder="bk_xxxxxxxx…"
            type="password"
            hint={configured ? 'Leave blank to keep the existing key' : 'Paste the API key from the cloud server'}
          />

          {msg && (
            <div style={{
              padding: '10px 14px', borderRadius: '8px', fontSize: '0.78rem', fontWeight: 600,
              background: msg.type === 'ok' ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
              color:      msg.type === 'ok' ? '#10b981'              : '#ef4444',
              border: `1px solid ${msg.type === 'ok' ? 'rgba(16,185,129,0.3)' : 'rgba(239,68,68,0.3)'}`,
              display: 'flex', alignItems: 'center', gap: '8px',
            }}>
              {msg.type === 'ok' ? <CheckCircle size={14} /> : <AlertCircle size={14} />}
              {msg.text}
            </div>
          )}
        </div>

        {/* footer */}
        <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '8px' }}>
          <button onClick={onClose} className="btn" style={{ flex: 1, padding: '10px' }}>Cancel</button>
          <button onClick={save} disabled={saving} className="btn primary" style={{ flex: 2, padding: '10px' }}>
            {saving ? 'Saving…' : 'Save & Activate Sync'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', hint }) {
  return (
    <div>
      <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '6px' }}>
        {label}
      </div>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          width: '100%', boxSizing: 'border-box', padding: '10px 14px',
          background: 'rgba(255,255,255,0.05)', color: 'white',
          border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
          fontSize: '0.85rem', outline: 'none',
        }}
      />
      {hint && <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '4px' }}>{hint}</div>}
    </div>
  );
}
