import { useState, useEffect } from 'react';
import {
  Building2, Plus, RefreshCw, X, Copy, CheckCircle,
  Users, Clock, Download, Trash2, UserCheck, UserX, AlertCircle,
} from 'lucide-react';

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

const STATUS_COLORS = { WAITING: '#f59e0b', ENTERED: '#10b981', TEMP_OUT: '#f472b6', EXITED: '#3b82f6' };

function StatusBadge({ status }) {
  const color = STATUS_COLORS[status] || '#6b7280';
  return (
    <span style={{ padding: '3px 10px', borderRadius: '9999px', fontSize: '0.65rem', fontWeight: 700,
      background: `${color}20`, color, border: `1px solid ${color}40`, textTransform: 'uppercase' }}>
      {status}
    </span>
  );
}

function UserStatusBadge({ status }) {
  const map = { active: { bg: 'rgba(16,185,129,0.1)', color: '#10b981' }, inactive: { bg: 'rgba(239,68,68,0.1)', color: '#ef4444' }, pending: { bg: 'rgba(245,158,11,0.1)', color: '#f59e0b' } };
  const { bg, color } = map[status] || map.active;
  return (
    <span style={{ padding: '3px 10px', borderRadius: '9999px', fontSize: '0.65rem', fontWeight: 700, background: bg, color }}>
      {status}
    </span>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function AdminCloudView({ onLogout }) {
  const [tab,          setTab]          = useState('branches');
  const [pendingCount, setPendingCount] = useState(0);

  // Branches
  const [branches,        setBranches]        = useState([]);
  const [selectedBranch,  setSelectedBranch]  = useState(null);
  const [branchVehicles,  setBranchVehicles]  = useState([]);
  const [branchUsers,     setBranchUsers]     = useState([]);
  const [loadingBranches, setLoadingBranches] = useState(true);
  const [loadingVehicles, setLoadingVehicles] = useState(false);
  const [branchDetailTab, setBranchDetailTab] = useState('vehicles');

  // Register branch modal
  const [showRegister,    setShowRegister]    = useState(false);
  const [newBranchName,   setNewBranchName]   = useState('');
  const [registering,     setRegistering]     = useState(false);
  const [newBranchResult, setNewBranchResult] = useState(null);
  const [copiedKey,       setCopiedKey]       = useState(false);

  // Delete branch confirmation
  const [deletingBranch,       setDeletingBranch]       = useState(null);
  const [confirmDeleteBranch,  setConfirmDeleteBranch]  = useState(false);

  // Users tab
  const [allUsers,      setAllUsers]      = useState([]);
  const [loadingUsers,  setLoadingUsers]  = useState(false);

  // Pending tab
  const [pendingUsers,   setPendingUsers]   = useState([]);
  const [loadingPending, setLoadingPending] = useState(false);

  // Superadmins tab
  const [superadmins,        setSuperadmins]        = useState([]);
  const [loadingSuperadmins, setLoadingSuperadmins] = useState(false);

  // ── Data fetchers ───────────────────────────────────────────────────────────

  const fetchPendingCount = () => {
    authFetch(`${API_URL}/pending-approvals/count`)
      .then(r => r.json())
      .then(d => setPendingCount(d.count || 0))
      .catch(() => {});
  };

  const loadBranches = () => {
    setLoadingBranches(true);
    authFetch(`${API_URL}/branches`)
      .then(r => r.json())
      .then(data => setBranches(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingBranches(false));
  };

  const loadAllUsers = () => {
    setLoadingUsers(true);
    authFetch(`${API_URL}/users`)
      .then(r => r.json())
      .then(data => setAllUsers(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingUsers(false));
  };

  const loadPendingUsers = () => {
    setLoadingPending(true);
    authFetch(`${API_URL}/users`)
      .then(r => r.json())
      .then(data => {
        const list = Array.isArray(data) ? data.filter(u => u.status === 'pending') : [];
        setPendingUsers(list);
        setPendingCount(list.length);
      })
      .catch(() => {})
      .finally(() => setLoadingPending(false));
  };

  const loadSuperadmins = () => {
    setLoadingSuperadmins(true);
    authFetch(`${API_URL}/superadmins`)
      .then(r => r.json())
      .then(data => setSuperadmins(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoadingSuperadmins(false));
  };

  useEffect(() => { loadBranches(); fetchPendingCount(); }, []);
  useEffect(() => {
    if (tab === 'users')        loadAllUsers();
    if (tab === 'pending')      loadPendingUsers();
    if (tab === 'superadmins')  loadSuperadmins();
  }, [tab]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Branch actions ──────────────────────────────────────────────────────────

  const selectBranch = (branch) => {
    setSelectedBranch(branch);
    setBranchDetailTab('vehicles');
    setLoadingVehicles(true);
    authFetch(`${API_URL}/vehicles?branch_id=${branch.id}`)
      .then(r => r.json())
      .then(data => setBranchVehicles(Array.isArray(data) ? data : []))
      .catch(() => setBranchVehicles([]))
      .finally(() => setLoadingVehicles(false));
    authFetch(`${API_URL}/branches/${branch.id}/users`)
      .then(r => r.json())
      .then(data => setBranchUsers(Array.isArray(data) ? data : []))
      .catch(() => setBranchUsers([]));
  };

  const registerBranch = async () => {
    if (!newBranchName.trim()) return;
    setRegistering(true);
    try {
      const res  = await authFetch(`${API_URL}/branches/register`, { method: 'POST', body: JSON.stringify({ name: newBranchName.trim() }) });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Failed');
      setNewBranchResult(data);
      setNewBranchName('');
      loadBranches();
    } catch (err) { alert(err.message); }
    finally { setRegistering(false); }
  };

  const confirmAndDeleteBranch = async () => {
    if (!deletingBranch) return;
    try {
      const res = await authFetch(`${API_URL}/branches/${deletingBranch.id}`, { method: 'DELETE' });
      if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed'); }
      setDeletingBranch(null);
      setConfirmDeleteBranch(false);
      if (selectedBranch?.id === deletingBranch.id) setSelectedBranch(null);
      loadBranches();
    } catch (err) { alert(err.message); }
  };

  // ── Vehicle actions ─────────────────────────────────────────────────────────

  const updateVehicleStatus = async (vehicleId, status) => {
    try {
      const res = await authFetch(`${API_URL}/vehicles/${vehicleId}?branch_id=${selectedBranch.id}`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed');
      setBranchVehicles(prev => prev.map(v => v.id === vehicleId ? { ...v, status } : v));
    } catch { alert('Failed to update vehicle status'); }
  };

  const deleteVehicle = async (vehicleId) => {
    if (!window.confirm('Delete this vehicle record? This cannot be undone.')) return;
    try {
      const res = await authFetch(`${API_URL}/vehicles/${vehicleId}?branch_id=${selectedBranch.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed');
      setBranchVehicles(prev => prev.filter(v => v.id !== vehicleId));
    } catch { alert('Failed to delete vehicle'); }
  };

  // ── User actions ────────────────────────────────────────────────────────────

  const updateUserStatus = async (branchId, localUserId, status) => {
    try {
      const res = await authFetch(`${API_URL}/branches/${branchId}/users/${localUserId}/status`, {
        method: 'PATCH', body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error('Failed');
      setAllUsers(prev  => prev.map(u => u.branchId === branchId && u.localUserId === localUserId ? { ...u, status } : u));
      setBranchUsers(prev => prev.map(u => u.localUserId === localUserId ? { ...u, status } : u));
    } catch { alert('Failed to update user status'); }
  };

  const approveUser = async (branchId, localUserId, action) => {
    try {
      const res = await authFetch(`${API_URL}/users/approve`, {
        method: 'POST', body: JSON.stringify({ branch_id: branchId, local_user_id: localUserId, action }),
      });
      if (!res.ok) throw new Error('Failed');
      setPendingUsers(prev => prev.filter(u => !(u.branchId === branchId && u.localUserId === localUserId)));
      setPendingCount(prev => Math.max(0, prev - 1));
      if (tab === 'users') loadAllUsers();
    } catch { alert('Failed to process approval'); }
  };

  const addSuperadmin = async (username, email, password) => {
    const res  = await authFetch(`${API_URL}/superadmins`, {
      method: 'POST', body: JSON.stringify({ username, email, password }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.detail || 'Failed to create account');
    setSuperadmins(prev => [...prev, data]);
  };

  const deleteSuperadmin = async (id) => {
    const res = await authFetch(`${API_URL}/superadmins/${id}`, { method: 'DELETE' });
    if (!res.ok) { const d = await res.json(); throw new Error(d.detail || 'Failed'); }
    setSuperadmins(prev => prev.filter(u => u.id !== id));
  };

  const downloadConsolidatedCSV = () => {
    authFetch(`${API_URL}/vehicles/export`)
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href     = url;
        a.download = `consolidated_report_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
        URL.revokeObjectURL(url);
      });
  };

  const copyKey = (key) => {
    navigator.clipboard.writeText(key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <div className="app-container">
      <header>
        <h1 style={{ fontSize: '1.5rem', fontWeight: 900, letterSpacing: '0.2em', color: 'var(--accent-color)', margin: 0 }}>
          AUTOTRACK
        </h1>

        <nav style={{ padding: 0, display: 'flex', gap: '4px' }}>
          {[
            { id: 'branches',    label: 'Branches' },
            { id: 'users',       label: 'All Users' },
            { id: 'pending',     label: 'Pending Approvals', badge: pendingCount },
            { id: 'superadmins', label: 'Superadmins' },
          ].map(({ id, label, badge }) => (
            <button key={id} onClick={() => setTab(id)} className={`nav-item ${tab === id ? 'active' : ''}`}
              style={{ position: 'relative' }}>
              {label}
              {badge > 0 && (
                <span style={{ position: 'absolute', top: '2px', right: '2px', background: '#ef4444',
                  color: 'white', fontSize: '0.6rem', fontWeight: 900, padding: '1px 5px',
                  borderRadius: '9999px', minWidth: '16px', textAlign: 'center' }}>
                  {badge}
                </span>
              )}
            </button>
          ))}
        </nav>

        <div style={{ display: 'flex', gap: '8px', marginLeft: 'auto', alignItems: 'center' }}>
          <button onClick={downloadConsolidatedCSV} className="btn" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
            <Download size={12} /> Export All
          </button>
          <button onClick={onLogout} className="btn" style={{ fontSize: '0.75rem', padding: '6px 16px' }}>
            Logout
          </button>
        </div>
      </header>

      <main className="main-content">
        {tab === 'branches' && (
          selectedBranch
            ? <BranchDetailView
                branch={selectedBranch}
                vehicles={branchVehicles}
                users={branchUsers}
                detailTab={branchDetailTab}
                setDetailTab={setBranchDetailTab}
                loading={loadingVehicles}
                onBack={() => setSelectedBranch(null)}
                onRefresh={() => selectBranch(selectedBranch)}
                onUpdateVehicleStatus={updateVehicleStatus}
                onDeleteVehicle={deleteVehicle}
                onUpdateUserStatus={(uid, status) => updateUserStatus(selectedBranch.id, uid, status)}
              />
            : <BranchListView
                branches={branches}
                loading={loadingBranches}
                showRegister={showRegister}
                setShowRegister={setShowRegister}
                newBranchName={newBranchName}
                setNewBranchName={setNewBranchName}
                registering={registering}
                newBranchResult={newBranchResult}
                setNewBranchResult={setNewBranchResult}
                copiedKey={copiedKey}
                onSelectBranch={selectBranch}
                onRegisterBranch={registerBranch}
                onLoadBranches={loadBranches}
                onCopyKey={copyKey}
                onDeleteBranch={(b) => { setDeletingBranch(b); setConfirmDeleteBranch(true); }}
              />
        )}

        {tab === 'users' && (
          <UsersView users={allUsers} loading={loadingUsers} onUpdateStatus={updateUserStatus} onRefresh={loadAllUsers} />
        )}

        {tab === 'pending' && (
          <PendingView users={pendingUsers} loading={loadingPending} onApprove={approveUser} onRefresh={loadPendingUsers} />
        )}

        {tab === 'superadmins' && (
          <SuperadminsView
            superadmins={superadmins}
            loading={loadingSuperadmins}
            onAdd={addSuperadmin}
            onDelete={deleteSuperadmin}
            onRefresh={loadSuperadmins}
          />
        )}
      </main>

      {/* Delete branch confirmation */}
      {confirmDeleteBranch && deletingBranch && (
        <div onClick={() => { setConfirmDeleteBranch(false); setDeletingBranch(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', zIndex: 1000,
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} className="panel animate-scale-in"
            style={{ width: '100%', maxWidth: '420px', borderRadius: '20px',
              border: '1px solid rgba(239,68,68,0.3)', padding: '2rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1rem' }}>
              <div style={{ width: '40px', height: '40px', borderRadius: '50%', background: 'rgba(239,68,68,0.15)',
                display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <AlertCircle size={20} color="#ef4444" />
              </div>
              <h3 style={{ fontWeight: 900, color: 'white', fontSize: '1rem' }}>Delete Branch</h3>
            </div>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
              Are you sure you want to delete <strong style={{ color: 'white' }}>{deletingBranch.name}</strong>?
            </p>
            <p style={{ color: '#ef4444', fontSize: '0.8rem', marginBottom: '1.5rem' }}>
              This will permanently delete ALL vehicle history and user records for this branch from the cloud. This cannot be undone.
            </p>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => { setConfirmDeleteBranch(false); setDeletingBranch(null); }}
                className="btn" style={{ flex: 1, padding: '10px' }}>Cancel</button>
              <button onClick={confirmAndDeleteBranch}
                style={{ flex: 1, padding: '10px', background: '#ef4444', border: 'none',
                  color: 'white', fontWeight: 700, borderRadius: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                Delete Branch
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Branch list ───────────────────────────────────────────────────────────────

function BranchListView({ branches, loading, showRegister, setShowRegister, newBranchName, setNewBranchName,
  registering, newBranchResult, setNewBranchResult, copiedKey,
  onSelectBranch, onRegisterBranch, onLoadBranches, onCopyKey, onDeleteBranch }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'white' }}>Branches ({branches.length})</h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onLoadBranches} className="btn" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
            <RefreshCw size={12} /> Refresh
          </button>
          <button onClick={() => { setShowRegister(true); setNewBranchResult(null); }}
            className="btn primary" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
            <Plus size={12} /> Register Branch
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Loading…</div>
      ) : branches.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
          No branches registered yet. Click "Register Branch" to add one.
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '1rem' }}>
          {branches.map(branch => (
            <div key={branch.id} className="panel"
              style={{ padding: '1.25rem', borderRadius: '14px', border: '1px solid var(--border-color)', position: 'relative' }}>
              <div onClick={() => onSelectBranch(branch)} style={{ cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                  <div style={{ width: '40px', height: '40px', borderRadius: '10px',
                    background: 'rgba(211,84,0,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
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
              <button onClick={e => { e.stopPropagation(); onDeleteBranch(branch); }}
                style={{ position: 'absolute', top: '12px', right: '12px', background: 'rgba(239,68,68,0.1)',
                  border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444', padding: '5px 7px',
                  borderRadius: '6px', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Register branch modal */}
      {showRegister && (
        <div onClick={() => { setShowRegister(false); setNewBranchResult(null); }}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} className="panel animate-scale-in"
            style={{ width: '100%', maxWidth: '420px', borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontWeight: 900, fontSize: '0.95rem', color: 'white' }}>Register New Branch</h3>
              <button onClick={() => { setShowRegister(false); setNewBranchResult(null); }}
                style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white',
                  padding: '6px', borderRadius: '50%', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: '1.5rem' }}>
              {!newBranchResult ? (
                <>
                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)',
                    textTransform: 'uppercase', marginBottom: '6px' }}>Branch Name</div>
                  <input type="text" value={newBranchName} onChange={e => setNewBranchName(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && onRegisterBranch()} placeholder="e.g. North Branch" autoFocus
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px',
                      background: 'rgba(255,255,255,0.05)', color: 'white',
                      border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
                      fontSize: '0.9rem', outline: 'none' }} />
                  <div style={{ marginTop: '1rem', display: 'flex', gap: '8px' }}>
                    <button onClick={() => setShowRegister(false)} className="btn" style={{ flex: 1, padding: '10px' }}>Cancel</button>
                    <button onClick={onRegisterBranch} disabled={registering || !newBranchName.trim()}
                      className="btn primary" style={{ flex: 2, padding: '10px' }}>
                      {registering ? 'Creating…' : 'Create Branch'}
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <div style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)',
                    borderRadius: '10px', padding: '1rem', marginBottom: '1rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#10b981',
                      fontWeight: 700, fontSize: '0.85rem', marginBottom: '6px' }}>
                      <CheckCircle size={16} /> Branch Created
                    </div>
                    <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
                      Copy this API key now — it will not be shown again.
                    </div>
                  </div>
                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)',
                    textTransform: 'uppercase', marginBottom: '4px' }}>Branch API Key</div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'stretch', marginBottom: '12px' }}>
                    <div style={{ flex: 1, padding: '10px 14px', background: 'rgba(255,255,255,0.05)',
                      borderRadius: '8px', fontSize: '0.72rem', fontFamily: 'monospace', color: 'white',
                      wordBreak: 'break-all', border: '1px solid rgba(255,255,255,0.1)' }}>
                      {newBranchResult.api_key}
                    </div>
                    <button onClick={() => onCopyKey(newBranchResult.api_key)} className="btn primary"
                      style={{ padding: '10px 14px', flexShrink: 0 }}>
                      {copiedKey ? <CheckCircle size={16} /> : <Copy size={16} />}
                    </button>
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginBottom: '1rem' }}>
                    Branch ID: <code style={{ color: 'var(--accent-color)' }}>{newBranchResult.branch_id}</code>
                  </div>
                  <button onClick={() => { setShowRegister(false); setNewBranchResult(null); }}
                    className="btn primary" style={{ width: '100%', padding: '10px' }}>Done</button>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Branch detail ─────────────────────────────────────────────────────────────

function BranchDetailView({ branch, vehicles, users, detailTab, setDetailTab, loading,
  onBack, onRefresh, onUpdateVehicleStatus, onDeleteVehicle, onUpdateUserStatus }) {
  const STATUSES = ['WAITING', 'ENTERED', 'TEMP_OUT', 'EXITED'];
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <button onClick={onBack} className="btn" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
          ← All Branches
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Building2 size={16} color="var(--accent-color)" />
          <span style={{ fontWeight: 800, fontSize: '0.95rem', color: 'white' }}>{branch.name}</span>
        </div>
        <button onClick={onRefresh} className="btn" style={{ fontSize: '0.75rem', padding: '6px 14px', marginLeft: 'auto' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Sub-tabs */}
      <div style={{ display: 'flex', gap: '0', marginBottom: '1.5rem', borderBottom: '1px solid var(--border-color)' }}>
        {[{ id: 'vehicles', label: `Vehicles (${vehicles.length})` }, { id: 'users', label: `Users (${users.length})` }].map(t => (
          <button key={t.id} onClick={() => setDetailTab(t.id)}
            style={{ padding: '8px 18px', background: 'none', border: 'none', cursor: 'pointer', fontSize: '0.8rem', fontWeight: 700,
              color: detailTab === t.id ? 'var(--accent-color)' : 'var(--text-secondary)',
              borderBottom: detailTab === t.id ? '2px solid var(--accent-color)' : '2px solid transparent',
              marginBottom: '-1px' }}>
            {t.label}
          </button>
        ))}
      </div>

      {detailTab === 'vehicles' && (
        loading ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Loading vehicles…</div>
        ) : vehicles.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            No vehicles synced from this branch.
          </div>
        ) : (
          <div className="panel" style={{ overflow: 'hidden', borderRadius: '14px' }}>
            <table className="workshop-table">
              <thead>
                <tr>
                  <th>License Plate</th><th>Vehicle ID</th><th>Entry Time</th><th>Status</th><th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {vehicles.map(v => (
                  <tr key={v.id}>
                    <td style={{ fontWeight: 800, letterSpacing: '0.05em' }}>{v.licensePlate || 'PENDING'}</td>
                    <td style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: 'var(--text-secondary)' }}>{v.id}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>
                      {v.timestamp ? new Date(v.timestamp).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'}
                    </td>
                    <td>
                      <select value={v.status} onChange={e => onUpdateVehicleStatus(v.id, e.target.value)}
                        style={{ background: `${STATUS_COLORS[v.status] || '#6b7280'}20`,
                          color: STATUS_COLORS[v.status] || '#6b7280',
                          border: `1px solid ${STATUS_COLORS[v.status] || '#6b7280'}40`,
                          padding: '4px 8px', borderRadius: '6px', fontSize: '0.7rem',
                          fontWeight: 700, cursor: 'pointer', outline: 'none' }}>
                        {STATUSES.map(s => <option key={s} value={s} style={{ background: '#1a1c22', color: 'white' }}>{s}</option>)}
                      </select>
                    </td>
                    <td>
                      <button onClick={() => onDeleteVehicle(v.id)}
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                          color: '#ef4444', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer',
                          display: 'flex', alignItems: 'center' }}>
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}

      {detailTab === 'users' && (
        users.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
            No users synced from this branch yet.
          </div>
        ) : (
          <div className="panel" style={{ overflow: 'hidden', borderRadius: '14px' }}>
            <table className="workshop-table">
              <thead>
                <tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Actions</th></tr>
              </thead>
              <tbody>
                {users.map(u => (
                  <tr key={u.localUserId}>
                    <td style={{ fontWeight: 700, color: 'white' }}>{u.username}</td>
                    <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{u.email}</td>
                    <td>
                      <span style={{ textTransform: 'capitalize', fontWeight: 600, fontSize: '0.8rem',
                        color: u.role === 'admin' ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
                        {u.role}
                      </span>
                    </td>
                    <td><UserStatusBadge status={u.status} /></td>
                    <td>
                      {u.status === 'active' ? (
                        <button onClick={() => onUpdateUserStatus(u.localUserId, 'inactive')}
                          style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                            color: '#ef4444', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                            fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <UserX size={11} /> Deactivate
                        </button>
                      ) : u.status === 'inactive' ? (
                        <button onClick={() => onUpdateUserStatus(u.localUserId, 'active')}
                          style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
                            color: '#10b981', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                            fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                          <UserCheck size={11} /> Activate
                        </button>
                      ) : <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)' }}>Pending</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      )}
    </div>
  );
}

// ── All users view ────────────────────────────────────────────────────────────

function UsersView({ users, loading, onUpdateStatus, onRefresh }) {
  const [filterBranch, setFilterBranch] = useState('');
  const branches = [...new Set(users.map(u => u.branchName))].sort();
  const filtered  = filterBranch ? users.filter(u => u.branchName === filterBranch) : users;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'white' }}>
          All Users ({filtered.length}{filterBranch ? ` in ${filterBranch}` : ''})
        </h2>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {branches.length > 1 && (
            <select value={filterBranch} onChange={e => setFilterBranch(e.target.value)}
              style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border-color)',
                color: 'white', padding: '6px 12px', borderRadius: '8px', fontSize: '0.8rem',
                cursor: 'pointer', outline: 'none' }}>
              <option value="">All Branches</option>
              {branches.map(b => <option key={b} value={b}>{b}</option>)}
            </select>
          )}
          <button onClick={onRefresh} className="btn" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Loading…</div>
      ) : filtered.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
          No users found. Users appear here after their branch syncs to the cloud.
        </div>
      ) : (
        <div className="panel" style={{ overflow: 'hidden', borderRadius: '14px' }}>
          <table className="workshop-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Branch</th><th>Role</th><th>Status</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((u, i) => (
                <tr key={`${u.branchId}-${u.localUserId}-${i}`}>
                  <td style={{ fontWeight: 700, color: 'white' }}>{u.username}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{u.email}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{u.branchName}</td>
                  <td>
                    <span style={{ textTransform: 'capitalize', fontWeight: 600, fontSize: '0.8rem',
                      color: u.role === 'admin' ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
                      {u.role}
                    </span>
                  </td>
                  <td><UserStatusBadge status={u.status} /></td>
                  <td>
                    {u.status === 'active' ? (
                      <button onClick={() => onUpdateStatus(u.branchId, u.localUserId, 'inactive')}
                        style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                          color: '#ef4444', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                          fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <UserX size={11} /> Deactivate
                      </button>
                    ) : u.status === 'inactive' ? (
                      <button onClick={() => onUpdateStatus(u.branchId, u.localUserId, 'active')}
                        style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
                          color: '#10b981', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                          fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <UserCheck size={11} /> Activate
                      </button>
                    ) : <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)' }}>—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── Superadmins view ──────────────────────────────────────────────────────────

function SuperadminsView({ superadmins, loading, onAdd, onDelete, onRefresh }) {
  const [showForm,  setShowForm]  = useState(false);
  const [username,  setUsername]  = useState('');
  const [email,     setEmail]     = useState('');
  const [password,  setPassword]  = useState('');
  const [saving,    setSaving]    = useState(false);
  const [formError, setFormError] = useState('');

  const submit = async () => {
    setFormError('');
    if (!username.trim() || !email.trim() || !password) { setFormError('All fields are required'); return; }
    if (password.length < 8) { setFormError('Password must be at least 8 characters'); return; }
    setSaving(true);
    try {
      await onAdd(username.trim(), email.trim().toLowerCase(), password);
      setShowForm(false); setUsername(''); setEmail(''); setPassword('');
    } catch (err) { setFormError(err.message); }
    finally { setSaving(false); }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'white' }}>
          Superadmin Accounts ({superadmins.length})
        </h2>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button onClick={onRefresh} className="btn" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
            <RefreshCw size={12} /> Refresh
          </button>
          <button onClick={() => { setShowForm(true); setFormError(''); }}
            className="btn primary" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
            <Plus size={12} /> Add Superadmin
          </button>
        </div>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Loading…</div>
      ) : (
        <div className="panel" style={{ overflow: 'hidden', borderRadius: '14px' }}>
          <table className="workshop-table">
            <thead>
              <tr><th>Name</th><th>Email</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {superadmins.map(u => (
                <tr key={u.id}>
                  <td style={{ fontWeight: 700, color: 'white' }}>{u.username}</td>
                  <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{u.email}</td>
                  <td>
                    <button
                      onClick={() => { if (window.confirm(`Remove superadmin "${u.username}"?`)) onDelete(u.id).catch(err => alert(err.message)); }}
                      style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                        color: '#ef4444', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                        fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                      <Trash2 size={11} /> Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add superadmin modal */}
      {showForm && (
        <div onClick={() => setShowForm(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
          <div onClick={e => e.stopPropagation()} className="panel animate-scale-in"
            style={{ width: '100%', maxWidth: '420px', borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)',
              display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ fontWeight: 900, fontSize: '0.95rem', color: 'white' }}>Add Superadmin</h3>
              <button onClick={() => setShowForm(false)}
                style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '6px', borderRadius: '50%', cursor: 'pointer' }}>
                <X size={16} />
              </button>
            </div>
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {[
                { label: 'Name',     value: username, set: setUsername, type: 'text',     placeholder: 'Full name' },
                { label: 'Email',    value: email,    set: setEmail,    type: 'email',    placeholder: 'admin@example.com' },
                { label: 'Password', value: password, set: setPassword, type: 'password', placeholder: 'Min 8 characters' },
              ].map(({ label, value, set, type, placeholder }) => (
                <div key={label}>
                  <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)',
                    textTransform: 'uppercase', marginBottom: '6px' }}>{label}</div>
                  <input type={type} value={value} onChange={e => set(e.target.value)} placeholder={placeholder}
                    onKeyDown={e => e.key === 'Enter' && submit()}
                    style={{ width: '100%', boxSizing: 'border-box', padding: '10px 14px',
                      background: 'rgba(255,255,255,0.05)', color: 'white',
                      border: '1px solid rgba(255,255,255,0.12)', borderRadius: '8px',
                      fontSize: '0.9rem', outline: 'none' }} />
                </div>
              ))}
              {formError && (
                <div style={{ fontSize: '0.75rem', color: '#ef4444', background: 'rgba(239,68,68,0.08)',
                  border: '1px solid rgba(239,68,68,0.2)', padding: '8px 12px', borderRadius: '8px' }}>
                  {formError}
                </div>
              )}
              <div style={{ display: 'flex', gap: '8px', marginTop: '4px' }}>
                <button onClick={() => setShowForm(false)} className="btn" style={{ flex: 1, padding: '10px' }}>Cancel</button>
                <button onClick={submit} disabled={saving} className="btn primary" style={{ flex: 2, padding: '10px' }}>
                  {saving ? 'Creating…' : 'Create Account'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Pending approvals view ────────────────────────────────────────────────────

function PendingView({ users, loading, onApprove, onRefresh }) {
  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', fontWeight: 800, color: 'white' }}>
          Pending Approvals
          {users.length > 0 && (
            <span style={{ marginLeft: '8px', background: '#ef4444', color: 'white', fontSize: '0.7rem',
              fontWeight: 900, padding: '2px 8px', borderRadius: '9999px' }}>
              {users.length}
            </span>
          )}
        </h2>
        <button onClick={onRefresh} className="btn" style={{ fontSize: '0.75rem', padding: '6px 14px' }}>
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {loading ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>Loading…</div>
      ) : users.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
          <CheckCircle size={32} style={{ margin: '0 auto 1rem', display: 'block', color: '#10b981' }} />
          No pending approvals. All caught up.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {users.map((u, i) => (
            <div key={`${u.branchId}-${u.localUserId}-${i}`} className="panel"
              style={{ padding: '1.25rem', borderRadius: '14px', border: '1px solid rgba(245,158,11,0.3)',
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                gap: '1rem', flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{ width: '44px', height: '44px', borderRadius: '50%',
                  background: 'rgba(245,158,11,0.15)', display: 'flex', alignItems: 'center',
                  justifyContent: 'center', fontSize: '1.1rem', fontWeight: 900, color: '#f59e0b' }}>
                  {u.username?.[0]?.toUpperCase() || '?'}
                </div>
                <div>
                  <div style={{ fontWeight: 800, color: 'white', fontSize: '0.9rem' }}>{u.username}</div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>{u.email}</div>
                  <div style={{ fontSize: '0.7rem', color: '#f59e0b', marginTop: '2px' }}>
                    Admin request • {u.branchName}
                  </div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button onClick={() => onApprove(u.branchId, u.localUserId, 'reject')}
                  style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                    color: '#ef4444', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer',
                    fontSize: '0.75rem', fontWeight: 700 }}>
                  Reject
                </button>
                <button onClick={() => onApprove(u.branchId, u.localUserId, 'approve')}
                  style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
                    color: '#10b981', padding: '8px 18px', borderRadius: '8px', cursor: 'pointer',
                    fontSize: '0.75rem', fontWeight: 700 }}>
                  Approve
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
