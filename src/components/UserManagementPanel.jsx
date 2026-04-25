import { useState, useEffect } from 'react';
import { X, UserCheck, UserX, RefreshCw, Users } from 'lucide-react';

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

export default function UserManagementPanel({ onClose, currentUserEmail }) {
  const [users,   setUsers]   = useState([]);
  const [loading, setLoading] = useState(true);

  const loadUsers = () => {
    setLoading(true);
    authFetch(`${API_URL}/admin/users`)
      .then(r => r.json())
      .then(data => setUsers(Array.isArray(data) ? data : []))
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  useEffect(() => { loadUsers(); }, []);

  const updateStatus = async (userId, status) => {
    try {
      const res = await authFetch(`${API_URL}/admin/users/${userId}/status`, {
        method: 'PATCH',
        body:   JSON.stringify({ status }),
      });
      if (!res.ok) {
        const d = await res.json();
        throw new Error(d.detail || 'Failed');
      }
      setUsers(prev => prev.map(u => u.id === userId ? { ...u, status } : u));
    } catch (err) {
      alert(err.message || 'Failed to update user status');
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
      zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px' }}>
      <div className="panel animate-scale-in"
        style={{ width: '100%', maxWidth: '720px', maxHeight: '80vh', borderRadius: '20px',
          overflow: 'hidden', border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column' }}>

        {/* Header */}
        <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Users size={18} color="var(--accent-color)" />
            <h3 style={{ fontWeight: 900, fontSize: '0.95rem', color: 'white', margin: 0 }}>
              User Management
            </h3>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)',
              background: 'rgba(255,255,255,0.05)', padding: '2px 10px', borderRadius: '9999px' }}>
              {users.length} user{users.length !== 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '8px' }}>
            <button onClick={loadUsers} className="btn" style={{ fontSize: '0.7rem', padding: '5px 10px' }}>
              <RefreshCw size={11} />
            </button>
            <button onClick={onClose}
              style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white',
                padding: '6px', borderRadius: '50%', cursor: 'pointer' }}>
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflow: 'auto', flex: 1 }}>
          {loading ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              Loading users…
            </div>
          ) : users.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>
              No users found.
            </div>
          ) : (
            <table className="workshop-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map(u => {
                  const isMe     = u.email === currentUserEmail;
                  const canManage = u.role === 'staff' && !isMe;
                  return (
                    <tr key={u.id}>
                      <td style={{ fontWeight: 700, color: 'white' }}>
                        {u.username}
                        {isMe && (
                          <span style={{ marginLeft: '8px', fontSize: '0.6rem', color: 'var(--text-secondary)',
                            background: 'rgba(255,255,255,0.05)', padding: '2px 7px', borderRadius: '9999px' }}>
                            You
                          </span>
                        )}
                      </td>
                      <td style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{u.email}</td>
                      <td>
                        <span style={{ textTransform: 'capitalize', fontWeight: 600, fontSize: '0.8rem',
                          color: u.role === 'admin' ? 'var(--accent-color)' : 'var(--text-secondary)' }}>
                          {u.role}
                        </span>
                      </td>
                      <td>
                        <span style={{
                          padding: '3px 10px', borderRadius: '9999px', fontSize: '0.65rem', fontWeight: 700,
                          background: u.status === 'active' ? 'rgba(16,185,129,0.1)' : u.status === 'inactive' ? 'rgba(239,68,68,0.1)' : 'rgba(245,158,11,0.1)',
                          color:      u.status === 'active' ? '#10b981'              : u.status === 'inactive' ? '#ef4444'              : '#f59e0b',
                        }}>
                          {u.status}
                        </span>
                      </td>
                      <td>
                        {canManage ? (
                          u.status === 'active' ? (
                            <button onClick={() => updateStatus(u.id, 'inactive')}
                              style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                                color: '#ef4444', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                                fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <UserX size={11} /> Deactivate
                            </button>
                          ) : u.status === 'inactive' ? (
                            <button onClick={() => updateStatus(u.id, 'active')}
                              style={{ background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.2)',
                                color: '#10b981', padding: '4px 10px', borderRadius: '6px', cursor: 'pointer',
                                fontSize: '0.65rem', fontWeight: 700, display: 'flex', alignItems: 'center', gap: '4px' }}>
                              <UserCheck size={11} /> Activate
                            </button>
                          ) : (
                            <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)' }}>Pending</span>
                          )
                        ) : (
                          <span style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.15)' }}>—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <div style={{ padding: '12px 1.5rem', borderTop: '1px solid var(--border-color)', flexShrink: 0,
          fontSize: '0.65rem', color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>
          Admins can deactivate staff accounts only. Contact super admin to manage admin accounts.
        </div>
      </div>
    </div>
  );
}
