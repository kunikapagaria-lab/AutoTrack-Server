import { useState, useEffect } from 'react';
import WorkshopBoard from './WorkshopBoard';
import { Building2, Plus, RefreshCw, X, Copy, CheckCircle } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

function authFetch(url, options = {}) {
  const token = localStorage.getItem('autotrack_access_token') || '';
  return fetch(url, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
}

function timeSince(iso) {
  if (!iso) return 'Never';
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60000)    return 'Just now';
  if (diff < 3600000)  return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

export default function AdminCloudView({ onLogout }) {
  const [branches,        setBranches]        = useState([]);
  const [selectedBranch,  setSelectedBranch]  = useState(null);
  const [branchVehicles,  setBranchVehicles]  = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [showRegister,    setShowRegister]    = useState(false);
  const [newBranchName,   setNewBranchName]   = useState('');
  const [registering,     setRegistering]     = useState(false);
  const [newBranchResult, setNewBranchResult] = useState(null);
  const [copiedKey,       setCopiedKey]       = useState(false);

  const loadBranches = () => {
    setLoadingBranches(true);
    authFetch(`${API_URL}/branches`)
      .then(r => r.json())
      .then(data => setBranches(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingBranches(false));
  };

  useEffect(() => { loadBranches(); }, []);

  const selectBranch = (branch) => {
    setSelectedBranch(branch);
    setLoadingVehicles(true);
    authFetch(`${API_URL}/vehicles?branch_id=${branch.id}`)
      .then(r => r.json())
      .then(data => setBranchVehicles(Array.isArray(data) ? data : []))
      .catch(() => setBranchVehicles([]))
      .finally(() => setLoadingVehicles(false));
  };

  const registerBranch = async () => {
    if (!newBranchName.trim()) return;
    setRegistering(true);
    try {
      const res  = await authFetch(`${API_URL}/branches/register`, {
        method: 'POST',
        body:   JSON.stringify({ name: newBranchName.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed');
      setNewBranchResult(data);
      setNewBranchName('');
      loadBranches();
    } catch (err) {
      alert(err.message);
    } finally {
      setRegistering(false);
    }
  };

  const copyKey = (key) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  return (
    <div className="app-container">
      <header>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '0.2em', color: 'var(--accent-color)', margin: 0 }}>
          AUTOTRACK
        </h1>
        <div style={{ fontSize: '0.7rem', fontWeight: 700, color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '4px 12px', borderRadius: '9999px' }}>
          ADMIN CLOUD VIEW
        </div>
        <button onClick={onLogout} className="btn" style={{ fontSize: '0.75rem', padding: '6px 16px', marginLeft: 'auto' }}>
          Logout
        </button>
      </header>

      <main className="main-content">
        {!selectedBranch ? (
          /* ── Branch list ── */
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'white' }}>Branches</h2>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={loadBranches} className="btn" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
                  <RefreshCw size={12} /> Refresh
                </button>
                <button onClick={() => { setShowRegister(true); setNewBranchResult(null); }} className="btn primary" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
                  <Plus size={12} /> Register Branch
                </button>
              </div>
            </div>

            {loadingBranches ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Loading…</div>
            ) : branches.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
                No branches registered yet. Click "Register Branch" to add one.
              </div>
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
                {branches.map(branch => (
                  <div
                    key={branch.id}
                    className="panel"
                    onClick={() => selectBranch(branch)}
                    style={{ cursor: 'pointer', padding: '1.25rem', borderRadius: '14px', border: '1px solid var(--border-color)', transition: 'border-color 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--accent-color)'}
                    onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border-color)'}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                      <div style={{ width: '40px', height: '40px', borderRadius: '10px', background: 'rgba(211,84,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Building2 size={20} color="var(--accent-color)" />
                      </div>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: '0.95rem', color: 'white' }}>{branch.name}</div>
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                          Last synced: {timeSince(branch.lastSeen)}
                        </div>
                      </div>
                    </div>
                    <div style={{ fontSize: '0.6rem', color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>
                      {branch.id}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ── Register branch modal ── */}
            {showRegister && (
              <div
                onClick={() => { setShowRegister(false); setNewBranchResult(null); }}
                style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}
              >
                <div
                  onClick={e => e.stopPropagation()}
                  className="panel animate-scale-in"
                  style={{ width: '100%', maxWidth: '420px', borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-color)' }}
                >
                  <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontWeight: 900, fontSize: '0.95rem', color: 'white' }}>Register New Branch</h3>
                    <button onClick={() => { setShowRegister(false); setNewBranchResult(null); }} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '6px', borderRadius: '50%', cursor: 'pointer' }}>
                      <X size={16} />
                    </button>
                  </div>

                  <div style={{ padding: '1.5rem' }}>
                    {!newBranchResult ? (
                      <>
                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '6px' }}>Branch Name</div>
                        <input
                          type="text"
                          value={newBranchName}
                          onChange={e => setNewBranchName(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && registerBranch()}
                          placeholder="e.g. North Branch"
                          autoFocus
                          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px', background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px', fontSize: '0.9rem', outline: 'none' }}
                        />
                        <div style={{ marginTop: '1rem', display: 'flex', gap: '8px' }}>
                          <button onClick={() => setShowRegister(false)} className="btn" style={{ flex: 1, padding: '10px' }}>Cancel</button>
                          <button onClick={registerBranch} disabled={registering || !newBranchName.trim()} className="btn primary" style={{ flex: 2, padding: '10px' }}>
                            {registering ? 'Creating…' : 'Create Branch'}
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981', fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>
                            <CheckCircle size={16} /> Branch Created
                          </div>
                          <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                            Copy this API key now — it will not be shown again.
                          </div>
                        </div>

                        <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', marginBottom: '4px' }}>Branch API Key</div>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', marginBottom: '12px' }}>
                          <div style={{ flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px', fontSize: '0.72rem', fontFamily: 'monospace', color: 'white', wordBreak: 'break-all', border: '1px solid rgba(255,255,255,0.1)' }}>
                            {newBranchResult.api_key}
                          </div>
                          <button onClick={() => copyKey(newBranchResult.api_key)} className="btn primary" style={{ padding: '10px 14px', flexShrink: 0 }}>
                            {copiedKey ? <CheckCircle size={16} /> : <Copy size={16} />}
                          </button>
                        </div>

                        <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                          Branch ID: <code style={{ color: 'var(--accent-color)' }}>{newBranchResult.branch_id}</code>
                        </div>

                        <button onClick={() => { setShowRegister(false); setNewBranchResult(null); }} className="btn primary" style={{ width: '100%', padding: '10px' }}>
                          Done
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          /* ── Branch vehicle view ── */
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
              <button onClick={() => setSelectedBranch(null)} className="btn" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
                ← All Branches
              </button>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <Building2 size={16} color="var(--accent-color)" />
                <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'white' }}>{selectedBranch.name}</span>
              </div>
              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', background: 'rgba(255,255,255,0.05)', padding: '3px 10px', borderRadius: '9999px' }}>
                Read Only
              </div>
              <button onClick={() => selectBranch(selectedBranch)} className="btn" style={{ fontSize: '0.75rem', padding: '6px 14px', marginLeft: 'auto' }}>
                <RefreshCw size={12} /> Refresh
              </button>
            </div>

            {loadingVehicles ? (
              <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Loading vehicles…</div>
            ) : (
              <WorkshopBoard vehicles={branchVehicles} readOnly />
            )}
          </div>
        )}
      </main>
    </div>
  );
}
