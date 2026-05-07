import { useState } from 'react';
import { ShopProvider, useShop } from './context/ShopContext';
import Detector from './components/Detector';
import DualCameraDetector from './components/DualCameraDetector';
import WorkshopBoard from './components/WorkshopBoard';
import ErrorBoundary from './components/ErrorBoundary';
import AuthPortal from './components/AuthPortal';
import FeedConfigModal from './components/FeedConfigModal';
import AdminCloudView from './components/AdminCloudView';
import BranchSettings from './components/BranchSettings';
import UserManagementPanel from './components/UserManagementPanel';
import {
  ShieldCheck, LayoutDashboard, Car, LogOut, ArrowRight, User, Lock, Search,
  Download, Wrench, RefreshCw, CheckCircle, Clock, Settings, Briefcase, Users
} from 'lucide-react';
import './index.css';

function MainApp() {
  const { user, logout, vehicles, feedSource } = useShop();
  const [view,       setView]       = useState('dashboard'); // 'dashboard', 'board'
  const [dualCamera, setDualCamera] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [showProfileMenu, setShowProfileMenu] = useState(false);
  const [showSettings,        setShowSettings]        = useState(false);
  const [showBranchSettings,  setShowBranchSettings]  = useState(false);
  const [showUserManagement,  setShowUserManagement]  = useState(false);

  const getInitials = (name) => {
    if (!name) return 'AW';
    const parts = name.trim().split(/\s+/);
    if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  };

  const handleExportByRange = (days) => {
    const now = new Date();
    const filteredVehicles = days 
      ? vehicles.filter(v => new Date(v.timestamp) >= new Date(now.getTime() - (days * 24 * 60 * 60 * 1000)))
      : vehicles;
    
    if (filteredVehicles.length === 0) {
      alert(`No records found for the requested period.`);
      return;
    }

    const headers = ['ID', 'License Plate Number', 'Status', 'Current Timestamp', 'Activity Flow'];
    const rows = filteredVehicles.map(v => {
      const historyArr = v.history || [{ status: 'ENTERED', timestamp: v.timestamp }];
      const historyStr = historyArr
        .map(h => {
          const time = new Date(h.timestamp).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true });
          const date = new Date(h.timestamp).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
          return `${h.status} (${date} ${time})`;
        })
        .join(' >> ');

      return [
        v.id, 
        v.licensePlate || 'PENDING', 
        v.status || 'ENTERED', 
        new Date(v.timestamp).toLocaleString('en-GB', { 
          year: 'numeric', month: '2-digit', day: '2-digit', 
          hour: '2-digit', minute: '2-digit', second: '2-digit', 
          hour12: true 
        }).replace(',', ''),
        `"${historyStr}"`
      ];
    });
    
    const csvContent = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `Workshop_${!days ? 'Full' : days === 1 ? 'Daily' : days === 7 ? 'Weekly' : 'Monthly'}_Report_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
  };

  if (!user) {
    return <AuthPortal />;
  }

  // Superadmin on the cloud server sees only the branch management view
  if (user.role === 'superadmin') {
    return <AdminCloudView onLogout={logout} />;
  }

  return (
    <div className="app-container">
      <header>
        <div style={{ display: 'flex', alignItems: 'center', gap: '3rem', flex: 1 }}>
          <h1 style={{ 
            fontSize: '1.5rem', 
            fontWeight: '900', 
            letterSpacing: '0.2em', 
            color: 'var(--accent-color)',
            margin: 0
          }}>
            AUTOTRACK
          </h1>
          

        </div>

        <nav style={{ padding: 0 }}>
          <button
            onClick={() => setView('dashboard')}
            className={`nav-item ${view === 'dashboard' ? 'active' : ''}`}
          >
            Gate Monitor
          </button>
          <button
            onClick={() => setView('board')}
            className={`nav-item ${view === 'board' ? 'active' : ''}`}
          >
            Workshop Board
          </button>
          {view === 'dashboard' && (
            <button
              onClick={() => setDualCamera(d => !d)}
              style={{
                display: 'flex', alignItems: 'center', gap: '6px',
                padding: '5px 14px', fontSize: '0.72rem', fontWeight: 700,
                background: dualCamera ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.05)',
                color: dualCamera ? '#a855f7' : 'var(--text-secondary)',
                border: `1px solid ${dualCamera ? 'rgba(168,85,247,0.4)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap', transition: 'all 0.2s',
              }}
            >
              {dualCamera ? '⊛ Dual Cam' : '⊙ Single Cam'}
            </button>
          )}
        </nav>

        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', borderLeft: '1px solid var(--border-color)', paddingLeft: '2rem', position: 'relative' }}>
          {user?.role === 'admin' && (
            <button onClick={() => handleExportByRange(null)} className="btn" style={{ padding: '0.5rem 1rem', fontSize: '0.75rem', borderRadius: '0.5rem' }}>
              <Download size={14} /> Full Report
            </button>
          )}
          
          <div style={{ position: 'relative' }}>
            <div style={{ 
              width: '40px', 
              height: '40px', 
              borderRadius: '50%', 
              background: 'linear-gradient(135deg, #d35400, #e67e22)', 
              color: 'white', 
              display: 'flex', 
              alignItems: 'center', 
              justifyContent: 'center', 
              fontWeight: '900',
              fontSize: '0.85rem',
              cursor: 'pointer',
              border: `2px solid ${showProfileMenu ? 'var(--accent-color)' : 'transparent'}`,
              transition: 'all 0.2s ease',
              boxShadow: '0 4px 12px rgba(211, 84, 0, 0.3)'
            }}
            title={user?.name || "Profile"}
            onClick={() => setShowProfileMenu(!showProfileMenu)}
            >
              {getInitials(user?.name)}
            </div>

            {showProfileMenu && (
              <div 
                className="animate-fade-in"
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 12px)',
                  right: 0,
                  width: '180px',
                  background: '#1a1c22',
                  border: '1px solid var(--border-color)',
                  borderRadius: '12px',
                  boxShadow: '0 10px 25px rgba(0,0,0,0.5)',
                  zIndex: 100,
                  overflow: 'hidden',
                  backdropFilter: 'blur(12px)'
                }}
              >
                <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'white', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <User size={12} color="var(--accent-color)" /> {user?.username || user?.name}
                  </div>
                  <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '4px', textTransform: 'capitalize', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Briefcase size={12} /> {user?.role || 'staff'}
                  </div>
                  <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '4px' }}>
                    {user?.email}
                  </div>
                </div>
                
                <div style={{ padding: '6px' }}>
                  <button
                    className="menu-item"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 12px',
                      background: 'none',
                      border: 'none',
                      color: 'var(--text-secondary)',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      borderRadius: '6px',
                      textAlign: 'left',
                      transition: 'all 0.2s'
                    }}
                    onClick={() => {
                      setShowSettings(true);
                      setShowProfileMenu(false);
                    }}
                  >
                    <Settings size={14} /> Settings
                  </button>
                  {user?.role === 'admin' && (
                    <button
                      className="menu-item"
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 12px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        borderRadius: '6px',
                        textAlign: 'left',
                        transition: 'all 0.2s'
                      }}
                      onClick={() => {
                        setShowBranchSettings(true);
                        setShowProfileMenu(false);
                      }}
                    >
                      <ArrowRight size={14} /> Branch Sync
                    </button>
                  )}
                  {user?.role === 'admin' && (
                    <button
                      className="menu-item"
                      style={{
                        width: '100%',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '10px',
                        padding: '10px 12px',
                        background: 'none',
                        border: 'none',
                        color: 'var(--text-secondary)',
                        fontSize: '0.8rem',
                        fontWeight: 600,
                        cursor: 'pointer',
                        borderRadius: '6px',
                        textAlign: 'left',
                        transition: 'all 0.2s'
                      }}
                      onClick={() => {
                        setShowUserManagement(true);
                        setShowProfileMenu(false);
                      }}
                    >
                      <Users size={14} /> Manage Users
                    </button>
                  )}
                  
                  <button 
                    className="menu-item logout"
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 12px',
                      background: 'none',
                      border: 'none',
                      color: '#ff4d4d',
                      fontSize: '0.8rem',
                      fontWeight: 600,
                      cursor: 'pointer',
                      borderRadius: '6px',
                      textAlign: 'left',
                      transition: 'all 0.2s'
                    }}
                    onClick={logout}
                  >
                    <LogOut size={14} /> Logout
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </header>

      <main className="main-content">
        {view === 'dashboard' ? (
          <div className="dashboard-grid">
            <div style={{ marginBottom: '1.5rem' }}>
              <ErrorBoundary label="Gate Monitor">
                {dualCamera ? <DualCameraDetector /> : <Detector />}
              </ErrorBoundary>
            </div>

            {/* Today's Overview */}
            <section>
              <h2 className="table-title" style={{ marginBottom: '1.5rem', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Today's Overview</h2>
              <div className="overview-row">
                <div className="stat-card">
                  <div>
                    <div className="label">Total Today</div>
                    <div className="value stat-total">{vehicles.length}</div>
                  </div>
                  <div className="stat-icon-box"><Car size={20} color="#00d2ff" /></div>
                </div>
                <div className="stat-card">
                  <div>
                    <div className="label">Inside Workshop</div>
                    <div className="value stat-workshop">{vehicles.filter(v => v.status === 'ENTERED').length}</div>
                  </div>
                  <div className="stat-icon-box"><Wrench size={20} color="#10b981" /></div>
                </div>
                <div className="stat-card">
                  <div>
                    <div className="label">Temp Out</div>
                    <div className="value stat-temp-out">{vehicles.filter(v => v.status === 'TEMP_OUT').length}</div>
                  </div>
                  <div className="stat-icon-box"><RefreshCw size={20} color="#f472b6" /></div>
                </div>
                <div className="stat-card">
                  <div>
                    <div className="label">Delivered</div>
                    <div className="value stat-delivered">{vehicles.filter(v => v.status === 'EXITED').length}</div>
                  </div>
                  <div className="stat-icon-box"><CheckCircle size={20} color="#a855f7" /></div>
                </div>
                <div className="stat-card">
                  <div>
                    <div className="label">Waiting List</div>
                    <div className="value stat-waiting">{vehicles.filter(v => v.status === 'WAITING').length}</div>
                  </div>
                  <div className="stat-icon-box"><Clock size={20} color="#94a3b8" /></div>
                </div>
              </div>
            </section>

            {/* Live Vehicle Status */}
            <section className="panel table-section">
              <div className="table-header">
                <h2 className="table-title">Live Vehicle Status</h2>
                <div className="live-badge">
                  <div className="pulse-dot"></div>
                  Live
                </div>
              </div>
              <table className="workshop-table">
                <thead>
                  <tr>
                    <th>License Plate</th>
                    <th>Vehicle ID</th>
                    <th>Entry Time</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {vehicles.filter(v => 
                    (v.licensePlate && v.licensePlate.toLowerCase().includes(searchTerm.toLowerCase())) ||
                    v.id.toLowerCase().includes(searchTerm.toLowerCase())
                  ).slice(0, 10).map(v => (
                    <tr key={v.id} className="animate-fade-in">
                      <td className="table-ve-id" style={{ letterSpacing: '0.05em', fontWeight: 800 }}>{v.licensePlate || 'PENDING'}</td>
                      <td style={{ fontWeight: 600 }}>{v.id}</td>
                      <td style={{ color: 'var(--text-secondary)' }}>
                        {new Date(v.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' })}, {new Date(v.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td>
                        <div className="table-status-pill" style={{ 
                          color: v.status === 'WAITING' ? 'var(--yellow-accent)' : 
                                 v.status === 'ENTERED' ? 'var(--green-accent)' : 
                                 v.status === 'TEMP_OUT' ? 'var(--orange-accent)' : 'var(--blue-accent)'
                        }}>
                          <div className="dot" style={{ 
                            background: v.status === 'WAITING' ? 'var(--yellow-accent)' : 
                                       v.status === 'ENTERED' ? 'var(--green-accent)' : 
                                       v.status === 'TEMP_OUT' ? 'var(--orange-accent)' : 'var(--blue-accent)'
                          }}></div>
                          {v.status || 'ENTERED'}
                        </div>
                      </td>
                    </tr>
                  ))}
                  {vehicles.length === 0 && (
                    <tr>
                      <td colSpan="4" style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-secondary)' }}>No vehicles currently in the system</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </section>

            {/* Reports & Exports Section */}
            <section style={{ marginTop: '1rem' }}>
              <h2 className="table-title" style={{ marginBottom: '1.5rem', fontSize: '1.1rem' }}>Reports & Exports</h2>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1.5rem' }}>
                <ReportCard 
                  title="Daily Vehicle Report" 
                  description="All vehicle entries, exits, service status, and delivery records for today."
                  icon={LayoutDashboard}
                  onDownload={() => handleExportByRange(1)}
                  color="#10b981"
                  showDownload={user?.role === 'admin'}
                />
                <ReportCard 
                  title="Weekly Vehicle Report" 
                  description="Complete movement history with timestamps and status updates for the last 7 days."
                  icon={RefreshCw}
                  onDownload={() => handleExportByRange(7)}
                  color="#3b82f6"
                  showDownload={user?.role === 'admin'}
                />
                <ReportCard 
                  title="Monthly Vehicle Report" 
                  description="Consolidated monthly analytics of vehicle throughput and workshop performance."
                  icon={Wrench}
                  onDownload={() => handleExportByRange(30)}
                  color="var(--accent-color)"
                  showDownload={user?.role === 'admin'}
                />
              </div>
            </section>
          </div>
        ) : (
          <ErrorBoundary label="Workshop Board">
            <WorkshopBoard searchTerm={searchTerm} />
          </ErrorBoundary>
        )}
      </main>

      {/* First-launch feed setup — can't be dismissed until a source is chosen */}
      <FeedConfigModal isOpen={!feedSource} onClose={null} />

      {/* Settings modal — opened from profile menu */}
      <FeedConfigModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

      {/* Branch sync settings — admin only */}
      {showBranchSettings && <BranchSettings onClose={() => setShowBranchSettings(false)} />}

      {/* User management — admin only */}
      {showUserManagement && (
        <UserManagementPanel
          currentUserEmail={user?.email}
          onClose={() => setShowUserManagement(false)}
        />
      )}

    </div>
  );
}

function ReportCard({ title, description, icon: Icon, onDownload, color, showDownload }) {
  return (
    <div className="report-card panel">
      <div className="report-card-header">
        <div className="report-icon-box" style={{ background: `${color}20`, color }}>
          <Icon size={24} />
        </div>
        <h3 style={{ fontSize: '1.1rem', fontWeight: '800', marginBottom: '0.75rem', color: 'white' }}>{title}</h3>
        <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', lineHeight: '1.5', minHeight: '3em' }}>{description}</p>
      </div>
      
      <div className="report-visualization">
        {[30, 45, 25, 60, 40, 50, 80].map((h, i) => (
          <div key={i} className="vis-bar" style={{ height: `${h}%`, background: i === 6 ? color : 'rgba(255,255,255,0.05)' }}></div>
        ))}
      </div>
      <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)', fontWeight: 700, textTransform: 'uppercase', marginBottom: '1.5rem' }}>
        Last 7 days
      </div>

      <div className="report-card-footer">
        <div style={{ textAlign: 'left' }}>
          <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: 600 }}>{new Date().toLocaleDateString('en-GB', { month: 'short', day: '2-digit' })}</div>
          <div style={{ fontSize: '0.8rem', fontWeight: 800, color: '#6b7280' }}>{new Date().getFullYear()}</div>
        </div>
        {showDownload ? (
          <button onClick={onDownload} className="btn-download" style={{ border: `1px solid ${color}40`, color }}>
            <Download size={14} /> Download CSV
          </button>
        ) : (
          <div style={{ fontSize: '0.65rem', color: 'rgba(255,255,255,0.15)', fontWeight: 600, fontStyle: 'italic' }}>
            Download restricted
          </div>
        )}
      </div>
    </div>
  );
}


function App() {
  return (
    <ShopProvider>
      <MainApp />
    </ShopProvider>
  );
}


export default App;
