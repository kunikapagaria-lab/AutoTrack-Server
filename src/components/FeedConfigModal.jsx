import { useState, useEffect } from 'react';
import { PlayCircle, RefreshCw, Upload, Wifi, X, CheckCircle, Camera } from 'lucide-react';
import { useShop } from '../context/ShopContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const OPTIONS = [
  { id: 'rtsp',   label: 'RTSP Camera',  desc: 'IP/network camera via RTSP stream', icon: Wifi,      color: '#3b82f6' },
  { id: 'webcam', label: 'USB / Webcam', desc: 'Local camera or USB device',         icon: RefreshCw, color: '#10b981' },
  { id: 'upload', label: 'Upload Video', desc: 'Test or replay with a video file',   icon: Upload,    color: '#00d2ff' },
];

function SourcePicker({ label, accentColor, selected, onSelect, isAdmin, rtspInput, onRtspInput, configured, maskedUrl, saveError }) {
  return (
    <div style={{ marginBottom: '1.25rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <Camera size={14} color={accentColor} />
        <span style={{ fontSize: '0.75rem', fontWeight: 800, color: accentColor, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          {label}
        </span>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: selected === 'rtsp' ? '1rem' : 0 }}>
        {OPTIONS.map(opt => {
          const active = selected === opt.id;
          return (
            <button
              key={opt.id}
              onClick={() => onSelect(opt.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '10px 14px', borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                background: active ? `${opt.color}18` : 'rgba(255,255,255,0.03)',
                border: `1.5px solid ${active ? opt.color : 'rgba(255,255,255,0.08)'}`,
                color: 'white', transition: 'all 0.15s', width: '100%',
              }}
            >
              <div style={{ width: 30, height: 30, borderRadius: 6, background: `${opt.color}22`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <opt.icon size={14} color={opt.color} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, fontSize: '0.83rem' }}>{opt.label}</div>
                <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', marginTop: 1 }}>{opt.desc}</div>
              </div>
              <div style={{ width: 8, height: 8, borderRadius: '50%', flexShrink: 0, background: active ? opt.color : 'rgba(255,255,255,0.1)', transition: 'background 0.15s' }} />
            </button>
          );
        })}
      </div>

      {selected === 'rtsp' && (
        <div style={{ marginTop: 8 }}>
          {configured && maskedUrl && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 10px', borderRadius: 7, marginBottom: 8,
              background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
            }}>
              <CheckCircle size={12} color="#10b981" />
              <div>
                <div style={{ fontSize: '0.68rem', color: '#10b981', fontWeight: 700 }}>Camera configured</div>
                <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontFamily: 'monospace', marginTop: 1 }}>{maskedUrl}</div>
              </div>
            </div>
          )}

          {isAdmin ? (
            <>
              <label style={{ display: 'block', fontSize: '0.72rem', color: 'var(--text-secondary)', fontWeight: 700, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                {configured ? 'Change Camera URL' : 'Camera URL'}
              </label>
              <input
                type="password"
                value={rtspInput}
                onChange={e => onRtspInput(e.target.value)}
                placeholder="rtsp://user:pass@192.168.1.100:554/stream"
                autoComplete="off"
                style={{
                  width: '100%', padding: '9px 11px', borderRadius: 7, fontSize: '0.78rem',
                  background: 'rgba(255,255,255,0.05)', color: 'white',
                  border: `1px solid ${rtspInput.trim() ? 'rgba(59,130,246,0.5)' : 'rgba(255,255,255,0.12)'}`,
                  outline: 'none', fontFamily: 'monospace', boxSizing: 'border-box',
                }}
              />
              {rtspInput.trim() && !rtspInput.trim().startsWith('rtsp://') && (
                <div style={{ fontSize: '0.68rem', color: '#f5a623', marginTop: 4 }}>URL must start with rtsp://</div>
              )}
              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: 4 }}>
                Credentials are stored securely on the server — never in the browser.
              </div>
            </>
          ) : (
            <div style={{ fontSize: '0.72rem', color: 'var(--text-secondary)', padding: '6px 0' }}>
              {configured ? 'Camera is configured. Contact an admin to change the URL.' : 'No camera configured. Contact an admin to set the RTSP URL.'}
            </div>
          )}

          {saveError && (
            <div style={{ fontSize: '0.7rem', color: '#ef4444', marginTop: 5 }}>{saveError}</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function FeedConfigModal({ isOpen, onClose }) {
  const { user, feedSource, setFeedConfig, saveRtspConfig, feedSource2, setFeedConfig2, saveRtspConfigLow } = useShop();
  const isAdmin = user?.role === 'admin';

  const [sel1,    setSel1]    = useState(feedSource  || 'rtsp');
  const [rtsp1,   setRtsp1]   = useState('');
  const [masked1, setMasked1] = useState('');
  const [conf1,   setConf1]   = useState(false);
  const [err1,    setErr1]    = useState('');

  const [sel2,    setSel2]    = useState(feedSource2 || 'rtsp');
  const [rtsp2,   setRtsp2]   = useState('');
  const [masked2, setMasked2] = useState('');
  const [conf2,   setConf2]   = useState(false);
  const [err2,    setErr2]    = useState('');

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!isOpen || !user) return;
    setSel1(feedSource  || 'rtsp');
    setSel2(feedSource2 || 'rtsp');
    fetch(`${API_URL}/config/feed`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('autotrack_access_token')}` },
    }).then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setConf1(d.configured); setMasked1(d.masked_url || ''); } })
      .catch(() => {});
    fetch(`${API_URL}/config/feed-low`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('autotrack_access_token')}` },
    }).then(r => r.ok ? r.json() : null)
      .then(d => { if (d) { setConf2(d.configured); setMasked2(d.masked_url || ''); } })
      .catch(() => {});
  }, [isOpen, user]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!isOpen) return null;

  const handleSave = async () => {
    setErr1(''); setErr2('');
    setSaving(true);
    try {
      if (sel1 === 'rtsp' && rtsp1.trim()) {
        if (!isAdmin) { setErr1('Only admins can change the camera URL.'); setSaving(false); return; }
        const r = await saveRtspConfig(rtsp1.trim());
        setMasked1(r.masked_url || ''); setConf1(true); setRtsp1('');
      }
      if (sel2 === 'rtsp' && rtsp2.trim()) {
        if (!isAdmin) { setErr2('Only admins can change the camera URL.'); setSaving(false); return; }
        const r = await saveRtspConfigLow(rtsp2.trim());
        setMasked2(r.masked_url || ''); setConf2(true); setRtsp2('');
      }
    } catch (err) {
      const msg = err.message || 'Failed to save camera URL.';
      if (sel1 === 'rtsp' && rtsp1.trim()) setErr1(msg);
      else setErr2(msg);
      setSaving(false);
      return;
    }
    setFeedConfig(sel1);
    setFeedConfig2(sel2);
    setSaving(false);
    onClose?.();
  };

  const canSave =
    (sel1 !== 'rtsp' || conf1 || rtsp1.trim().length > 0) &&
    (sel2 !== 'rtsp' || conf2 || rtsp2.trim().length > 0);

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 999,
      background: 'rgba(0,0,0,0.88)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      backdropFilter: 'blur(6px)',
    }}>
      <div className="panel" style={{ width: '100%', maxWidth: '520px', padding: '2rem', position: 'relative', maxHeight: '90vh', overflowY: 'auto' }}>

        {onClose && (
          <button
            onClick={onClose}
            style={{ position: 'absolute', top: 16, right: 16, background: 'none', border: 'none', color: 'var(--text-secondary)', cursor: 'pointer', padding: 4 }}
          >
            <X size={18} />
          </button>
        )}

        <div style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
            <PlayCircle size={18} color="var(--accent-color)" />
            <h2 style={{ fontSize: '1rem', fontWeight: 900, margin: 0, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
              Feed Settings
            </h2>
          </div>
          <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', margin: 0 }}>
            Configure the video input source for each camera independently.
          </p>
        </div>

        <SourcePicker
          label="Camera 1 — High / Tracking"
          accentColor="var(--accent-color)"
          selected={sel1}
          onSelect={setSel1}
          isAdmin={isAdmin}
          rtspInput={rtsp1}
          onRtspInput={setRtsp1}
          configured={conf1}
          maskedUrl={masked1}
          saveError={err1}
        />

        <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', marginBottom: '1.25rem' }} />

        <SourcePicker
          label="Camera 2 — Low / Plate Reader"
          accentColor="#a855f7"
          selected={sel2}
          onSelect={setSel2}
          isAdmin={isAdmin}
          rtspInput={rtsp2}
          onRtspInput={setRtsp2}
          configured={conf2}
          maskedUrl={masked2}
          saveError={err2}
        />

        <div style={{ display: 'flex', gap: 10 }}>
          <button
            onClick={handleSave}
            disabled={!canSave || saving}
            style={{
              flex: 1, padding: '11px', borderRadius: 8, border: 'none',
              cursor: canSave && !saving ? 'pointer' : 'not-allowed',
              background: 'var(--accent-color)', color: '#000', fontWeight: 800, fontSize: '0.88rem',
              opacity: canSave && !saving ? 1 : 0.4, transition: 'opacity 0.15s',
            }}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
          {onClose && (
            <button
              onClick={onClose}
              style={{
                padding: '11px 20px', borderRadius: 8,
                border: '1px solid rgba(255,255,255,0.1)', background: 'transparent',
                color: 'var(--text-secondary)', cursor: 'pointer', fontWeight: 600, fontSize: '0.88rem',
              }}
            >
              Cancel
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
