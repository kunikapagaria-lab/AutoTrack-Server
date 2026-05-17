import { useState, useEffect } from 'react';
import { useShop } from '../context/ShopContext';
import { ArrowRight, Clock, MapPin, CheckCircle, X, Car, Shield, AlertCircle, RefreshCw } from 'lucide-react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Converts relative /uploads/... paths to absolute. Full URLs and data: URIs pass through.
const toAbsUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${API_URL}${url}`;
};

export default function WorkshopBoard({ searchTerm = '', readOnly = false, vehicles: externalVehicles = null }) {
  const { user, vehicles: contextVehicles, backendError, retryLoadVehicles, updateVehicleStatus, updateVehicle, removeVehicle } = useShop();
  const vehicles = externalVehicles !== null ? externalVehicles : contextVehicles;
  const [selectedVehicleId,  setSelectedVehicleId]  = useState(null);
  const selectedVehicle = selectedVehicleId ? (vehicles.find(v => v.id === selectedVehicleId) ?? null) : null;
  const [resolvingVehicle,   setResolvingVehicle]   = useState(null);
  const [resolveManualPlate, setResolveManualPlate] = useState('');
  const [lightboxUrl,        setLightboxUrl]        = useState(null);

  const filteredVehicles = vehicles.filter(v =>
    v.id.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.status || 'ENTERED').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (v.licensePlate || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  const columns = [
    { id: 'WAITING',  title: 'Waiting',            icon: <Clock size={16} /> },
    { id: 'ENTERED',  title: 'Entered / Workshop',  icon: <MapPin size={16} /> },
    { id: 'TEMP_OUT', title: 'Temp Out',             icon: <ArrowRight size={16} /> },
    { id: 'EXITED',   title: 'Exited',               icon: <CheckCircle size={16} /> },
  ];

  const colColor = (id) =>
    id === 'WAITING'  ? 'var(--yellow-accent)' :
    id === 'ENTERED'  ? 'var(--green-accent)'  :
    id === 'TEMP_OUT' ? 'var(--orange-accent)' : 'var(--blue-accent)';

  // Manual resolve: called from the modal when user types a plate and confirms
  const resolveManually = (vehicle, plate) => {
    // Strip anything that isn't A-Z or 0-9 before saving
    const plateUpper = plate.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
    if (!plateUpper) return;

    // vehicle.imageUrl is the frame captured at detection time — carry it into the status event
    const detectionPhoto = vehicle.imageUrl || null;

    if (vehicle.pendingDirection === 'INGRESS') {
      const existing = vehicles.find(v =>
        v.id !== vehicle.id &&
        !v.pendingDirection &&
        v.licensePlate?.toUpperCase() === plateUpper &&
        (v.status === 'TEMP_OUT' || v.status === 'WAITING')
      );
      if (existing) {
        // Re-entry of known vehicle
        updateVehicleStatus(existing.id, 'ENTERED', detectionPhoto);
        removeVehicle(vehicle.id);
      } else {
        // New vehicle entering manually — clear pending flag before promoting
        updateVehicle(vehicle.id, { licensePlate: plateUpper, pendingDirection: null, plateStatus: 'resolved' });
        updateVehicleStatus(vehicle.id, 'ENTERED', detectionPhoto);
      }
    } else {
      // EGRESS
      const entered = vehicles.find(v =>
        v.id !== vehicle.id &&
        v.licensePlate?.toUpperCase() === plateUpper &&
        v.status === 'ENTERED'
      );
      if (entered) {
        updateVehicleStatus(entered.id, 'TEMP_OUT', detectionPhoto);
        removeVehicle(vehicle.id);
      } else {
        // No ENTERED match — clear pending state, keep in WAITING for manual action
        updateVehicle(vehicle.id, { licensePlate: plateUpper, pendingDirection: null, plateStatus: 'resolved' });
      }
    }
    setResolvingVehicle(null);
  };

  return (
    <div>
    {backendError && (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '10px 16px', marginBottom: '1rem', borderRadius: '8px',
        background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
      }}>
        <span style={{ fontSize: '0.8rem', color: '#ef4444', fontWeight: 600 }}>
          ⚠ {backendError}
        </span>
        <button
          onClick={retryLoadVehicles}
          style={{
            display: 'flex', alignItems: 'center', gap: '5px',
            padding: '5px 12px', borderRadius: '6px', border: '1px solid rgba(239,68,68,0.4)',
            background: 'transparent', color: '#ef4444', cursor: 'pointer',
            fontSize: '0.75rem', fontWeight: 700,
          }}
        >
          <RefreshCw size={11} /> Retry
        </button>
      </div>
    )}
    <div className="kanban-board">
      {columns.map(col => (
        <div key={col.id} className="kanban-column">
          <div className="column-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <span style={{ color: colColor(col.id) }}>{col.icon}</span>
              <span className="column-title">{col.title}</span>
            </div>
            <div style={{
              fontSize: '0.7rem', fontWeight: '800',
              background: 'rgba(255,255,255,0.05)', padding: '2px 8px',
              borderRadius: '9999px', color: 'var(--text-secondary)',
            }}>
              {filteredVehicles.filter(v => (v.status === col.id || (!v.status && col.id === 'ENTERED'))).length}
            </div>
          </div>

          <div style={{ flex: 1, overflowY: 'auto' }}>
            {filteredVehicles
              .filter(v => v.status === col.id || (!v.status && col.id === 'ENTERED'))
              .map(vehicle => {
                const pending     = !!vehicle.pendingDirection;
                const scanning    = pending && vehicle.plateStatus === 'scanning';
                const needsResolve = pending && !scanning;
                const dirLabel    = vehicle.pendingDirection === 'INGRESS' ? 'ENTRY' : 'EXIT';
                const dirColor    = vehicle.pendingDirection === 'INGRESS' ? '#10b981' : '#a855f7';

                return (
                  <div
                    key={vehicle.id}
                    className="vehicle-card"
                    style={{
                      borderTopColor: colColor(col.id),
                      opacity: scanning ? 0.88 : 1,
                    }}
                  >
                    {/* ── card body (clickable) ── */}
                    <div
                      onClick={() => {
                        if (readOnly) { setSelectedVehicleId(vehicle.id); return; }
                        if (needsResolve) {
                          setResolvingVehicle(vehicle);
                          setResolveManualPlate(vehicle.licensePlate || '');
                        } else if (!scanning) {
                          setSelectedVehicleId(vehicle.id);
                        }
                      }}
                      style={{ cursor: scanning && !readOnly ? 'default' : 'pointer' }}
                      title={readOnly ? 'View Details' : needsResolve ? 'Click to resolve' : scanning ? 'Scanning plate…' : 'View Details'}
                    >
                      {/* header row */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: '12px' }}>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div className="card-ve-id" style={{ color: colColor(col.id) }}>
                            #{vehicle.id.split('-')[1]}
                          </div>
                          <div style={{ fontSize: '0.95rem', fontWeight: '900', color: 'white', marginTop: '2px', letterSpacing: '0.05em' }}>
                            {scanning ? (
                              <span style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--accent-color)', fontSize: '0.78rem' }}>
                                <RefreshCw size={11} style={{ animation: 'spin 1.5s linear infinite' }} />
                                Scanning…
                              </span>
                            ) : (
                              vehicle.licensePlate || 'PENDING'
                            )}
                          </div>
                        </div>

                        {/* pending direction badge */}
                        {pending ? (
                          <div style={{
                            display: 'flex', alignItems: 'center', gap: '4px',
                            padding: '3px 8px', borderRadius: '5px', fontSize: '0.65rem', fontWeight: 800,
                            background: `${dirColor}18`, color: dirColor,
                            border: `1px solid ${dirColor}50`, whiteSpace: 'nowrap', flexShrink: 0,
                          }}>
                            {needsResolve
                              ? <AlertCircle size={10} />
                              : <RefreshCw size={10} style={{ animation: 'spin 1.5s linear infinite' }} />
                            }
                            ({dirLabel})
                          </div>
                        ) : (
                          <div className="status-pill" style={{
                            color: colColor(col.id),
                            background: 'rgba(255,255,255,0.03)', padding: '2px 8px',
                          }}>
                            <div className="dot" />
                          </div>
                        )}
                      </div>

                      {/* vehicle image */}
                      {vehicle.imageUrl ? (
                        <div style={{
                          width: '100%', height: '110px', borderRadius: '10px', overflow: 'hidden',
                          marginBottom: '4px',
                          border: `1px solid ${needsResolve ? `${dirColor}40` : 'rgba(255,255,255,0.05)'}`,
                          background: 'rgba(0,0,0,0.2)', position: 'relative',
                        }}>
                          <img src={toAbsUrl(vehicle.imageUrl)} alt="Car" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />

                          {/* scanning overlay */}
                          {scanning && (
                            <div style={{
                              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                              alignItems: 'center', justifyContent: 'center',
                              background: 'rgba(0,0,0,0.55)', gap: '6px',
                            }}>
                              <RefreshCw size={22} color="var(--accent-color)" style={{ animation: 'spin 1.5s linear infinite' }} />
                              <span style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--accent-color)' }}>
                                SCANNING… ({vehicle.scanAttempt}/{vehicle.totalAttempts})
                              </span>
                            </div>
                          )}

                          {/* needs-resolve overlay */}
                          {needsResolve && (
                            <div style={{
                              position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                              alignItems: 'center', justifyContent: 'center',
                              background: 'rgba(0,0,0,0.55)', gap: '6px',
                            }}>
                              <AlertCircle size={22} color={dirColor} />
                              <span style={{ fontSize: '0.65rem', fontWeight: 800, color: dirColor }}>
                                TAP TO RESOLVE ({dirLabel})
                              </span>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div style={{
                          width: '100%', height: '110px', borderRadius: '10px',
                          background: 'rgba(255,255,255,0.02)', display: 'flex',
                          alignItems: 'center', justifyContent: 'center',
                          marginBottom: '4px', border: '1px dashed rgba(255,255,255,0.05)',
                        }}>
                          <Car size={24} color="rgba(255,255,255,0.1)" />
                        </div>
                      )}
                    </div>

                    {/* ── action buttons (hidden in read-only mode) ── */}
                    {!readOnly && (scanning ? (
                      <div style={{
                        marginTop: '16px', padding: '6px 10px', borderRadius: '6px',
                        background: 'rgba(0,210,255,0.06)', border: '1px solid rgba(0,210,255,0.15)',
                        fontSize: '0.65rem', color: 'var(--accent-color)', fontWeight: 700,
                        textAlign: 'center', letterSpacing: '0.05em',
                      }}>
                        PLATE SCAN IN PROGRESS
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: '6px', marginTop: '16px' }}>
                        {col.id !== 'WAITING' && (
                          <button onClick={() => updateVehicleStatus(vehicle.id, 'WAITING')}
                            className="btn" style={{ fontSize: '0.65rem', padding: '6px', flex: 1 }}>
                            Wait
                          </button>
                        )}
                        {col.id !== 'ENTERED' && (
                          <button onClick={() => {
                            // Look for a pending INGRESS placeholder for this plate — use its detection photo
                            const placeholder = vehicles.find(v =>
                              v.id !== vehicle.id &&
                              v.pendingDirection === 'INGRESS' &&
                              v.licensePlate?.toUpperCase() === vehicle.licensePlate?.toUpperCase() &&
                              v.imageUrl
                            );
                            updateVehicleStatus(vehicle.id, 'ENTERED', placeholder?.imageUrl || null);
                          }}
                            className="btn primary" style={{ fontSize: '0.65rem', padding: '6px', flex: 1 }}>
                            Workshop
                          </button>
                        )}
                        {col.id !== 'TEMP_OUT' && (
                          <button onClick={() => {
                            // Look for a pending EGRESS placeholder for this plate — use its detection photo
                            const placeholder = vehicles.find(v =>
                              v.id !== vehicle.id &&
                              v.pendingDirection === 'EGRESS' &&
                              v.licensePlate?.toUpperCase() === vehicle.licensePlate?.toUpperCase() &&
                              v.imageUrl
                            );
                            updateVehicleStatus(vehicle.id, 'TEMP_OUT', placeholder?.imageUrl || null);
                          }}
                            className="btn" style={{ fontSize: '0.65rem', padding: '6px', flex: 1 }}>
                            Out
                          </button>
                        )}
                        {col.id !== 'EXITED' && (
                          <button onClick={() => updateVehicleStatus(vehicle.id, 'EXITED')}
                            className="btn" style={{ fontSize: '0.65rem', padding: '6px', color: 'var(--danger-color)', borderColor: 'rgba(239,68,68,0.2)' }}>
                            Exit
                          </button>
                        )}
                      </div>
                    ))}

                    {/* timestamp + remove */}
                    <div style={{
                      marginTop: '12px', paddingTop: '12px',
                      borderTop: '1px solid rgba(255,255,255,0.03)',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      fontSize: '0.65rem', color: 'var(--text-secondary)', fontWeight: '600',
                    }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                        <Clock size={10} />
                        {new Date(vehicle.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {!readOnly && user?.role === 'admin' && (
                        <button
                          onClick={() => removeVehicle(vehicle.id)}
                          style={{ background: 'none', border: 'none', color: 'var(--danger-color)', cursor: 'pointer', fontSize: '0.6rem', opacity: 0.6 }}
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
          </div>
        </div>
      ))}

      {/* ── Vehicle Detail Modal ── */}
      {selectedVehicle && (
        <div
          onClick={() => { setSelectedVehicleId(null); setLightboxUrl(null); }}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(8px)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="panel animate-scale-in"
            style={{
              width: '100%', maxWidth: '600px', background: 'var(--panel-bg)',
              borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-color)',
              position: 'relative', boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
            }}
          >
            <div style={{ padding: '1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ fontSize: '1.1rem', fontWeight: '900', color: 'white' }}>Vehicle Details</h3>
                <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                  Registry Log: {selectedVehicle.id}
                </div>
              </div>
              <button onClick={() => { setSelectedVehicleId(null); setLightboxUrl(null); }} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '8px', borderRadius: '50%', cursor: 'pointer' }}>
                <X size={20} />
              </button>
            </div>

            <div style={{ padding: '1.5rem', maxHeight: '75vh', overflowY: 'auto' }}>
              {/* ── Photo collage ── */}
              {(() => {
                const PHOTO_STATUSES = new Set(['ENTERED', 'TEMP_OUT', 'EXITED']);
                const statusLabel = s =>
                  s === 'ENTERED'  ? 'Entry' :
                  s === 'TEMP_OUT' ? 'Temp Out' :
                  s === 'EXITED'   ? 'Exit' : s;
                const statusColor = s =>
                  s === 'ENTERED'  ? 'var(--green-accent)'  :
                  s === 'TEMP_OUT' ? 'var(--orange-accent)' :
                  s === 'EXITED'   ? 'var(--blue-accent)'   : 'var(--text-secondary)';

                // Build photo list: use per-event imageUrl when present.
                // For the first ENTERED event with no dedicated photo, fall back to
                // vehicle.imageUrl so old vehicles and manual-move vehicles always
                // show their detection photo in the collage.
                const photoEvents = [];
                let usedVehicleImg = false;
                for (const event of (selectedVehicle.history || [])) {
                  if (!PHOTO_STATUSES.has(event.status)) continue;
                  if (event.imageUrl) {
                    photoEvents.push(event);
                    if (event.status === 'ENTERED') usedVehicleImg = true;
                  } else if (
                    event.status === 'ENTERED' &&
                    !usedVehicleImg &&
                    selectedVehicle.imageUrl
                  ) {
                    photoEvents.push({ ...event, imageUrl: selectedVehicle.imageUrl });
                    usedVehicleImg = true;
                  }
                }

                // Fallback: no history events at all but vehicle has an imageUrl
                if (photoEvents.length === 0 && selectedVehicle.imageUrl) {
                  photoEvents.push({
                    status: 'ENTERED',
                    timestamp: selectedVehicle.timestamp,
                    imageUrl: selectedVehicle.imageUrl,
                  });
                }

                if (photoEvents.length === 0) {
                  return (
                    <div style={{ width: '100%', height: '200px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '1.5rem' }}>
                      <Car size={32} color="var(--text-secondary)" />
                    </div>
                  );
                }

                return (
                  <div style={{
                    display: 'grid',
                    gridTemplateColumns: photoEvents.length === 1 ? '1fr' : 'repeat(auto-fill, minmax(150px, 1fr))',
                    gap: '8px',
                    marginBottom: '1.5rem',
                  }}>
                    {photoEvents.map((event, idx) => (
                      <div
                        key={idx}
                        onClick={() => setLightboxUrl(toAbsUrl(event.imageUrl))}
                        style={{
                          position: 'relative', borderRadius: '10px', overflow: 'hidden',
                          aspectRatio: '16/9', cursor: 'pointer',
                          border: '1.5px solid var(--border-color)',
                          transition: 'transform 0.15s, border-color 0.15s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.02)'; e.currentTarget.style.borderColor = statusColor(event.status); }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.borderColor = 'var(--border-color)'; }}
                      >
                        <img
                          src={toAbsUrl(event.imageUrl)}
                          alt={statusLabel(event.status)}
                          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                        />
                        <div style={{
                          position: 'absolute', bottom: 0, left: 0, right: 0,
                          padding: '16px 8px 6px',
                          background: 'linear-gradient(transparent, rgba(0,0,0,0.75))',
                          display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end',
                        }}>
                          <span style={{ fontSize: '0.62rem', fontWeight: 800, color: statusColor(event.status), textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            {statusLabel(event.status)}
                          </span>
                          <span style={{ fontSize: '0.58rem', color: 'rgba(255,255,255,0.6)' }}>
                            {new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem', marginBottom: '1.5rem' }}>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px' }}>
                    <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '4px', fontWeight: '800' }}>Current Status</div>
                    <div style={{ fontWeight: '700', fontSize: '1rem', color: 'var(--accent-color)' }}>{selectedVehicle.status || 'ENTERED'}</div>
                  </div>
                </div>
                <div style={{ padding: '12px', background: 'rgba(255,255,255,0.03)', borderRadius: '10px' }}>
                  <div style={{ fontSize: '0.65rem', textTransform: 'uppercase', color: 'var(--text-secondary)', marginBottom: '12px', fontWeight: '800' }}>Activity History</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                    {(selectedVehicle.history || [{ status: 'ENTERED', timestamp: selectedVehicle.timestamp }]).map((event, idx) => (
                      <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px', position: 'relative' }}>
                        {idx !== (selectedVehicle.history?.length || 1) - 1 && (
                          <div style={{ position: 'absolute', left: '3.5px', top: '12px', bottom: '-12px', width: '1px', background: 'rgba(255,255,255,0.1)' }} />
                        )}
                        <div style={{
                          width: '8px', height: '8px', borderRadius: '50%', zIndex: 1,
                          background: event.status === 'ENTERED' ? 'var(--green-accent)' :
                                     event.status === 'TEMP_OUT' ? 'var(--orange-accent)' :
                                     event.status === 'EXITED'   ? 'var(--blue-accent)'   : 'var(--yellow-accent)',
                        }} />
                        <div style={{ flex: 1 }}>
                          <div style={{ fontWeight: '700', fontSize: '0.85rem', color: 'white' }}>
                            {event.status === 'ENTERED' ? 'Entry' : event.status === 'TEMP_OUT' ? 'Temp Out' : event.status === 'EXITED' ? 'Exit' : event.status}
                          </div>
                          <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)' }}>
                            {new Date(event.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div style={{ padding: '1.25rem', background: 'rgba(59,130,246,0.05)', borderRadius: '12px', border: '1px solid rgba(59,130,246,0.2)', marginBottom: '1.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '12px' }}>
                  <Shield size={18} color="#3b82f6" />
                  <span style={{ fontWeight: '900', fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>License Plate</span>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                  {selectedVehicle.plateImageUrl ? (
                    <img src={toAbsUrl(selectedVehicle.plateImageUrl)} alt="Plate Crop" style={{ height: '32px', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.1)' }} />
                  ) : (
                    <div style={{ width: '60px', height: '32px', background: 'rgba(0,0,0,0.2)', borderRadius: '4px' }} />
                  )}
                  <div style={{ flex: 1 }}>
                    <input
                      type="text"
                      value={selectedVehicle.licensePlate || ''}
                      readOnly={readOnly}
                      onChange={readOnly ? undefined : e => {
                        const newPlate = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
                        updateVehicle(selectedVehicle.id, { licensePlate: newPlate });
                      }}
                      placeholder="ENTER PLATE"
                      style={{
                        background: 'none', border: 'none', borderBottom: `2px solid rgba(59,130,246,${readOnly ? 0.1 : 0.3})`,
                        fontSize: '1.5rem', fontWeight: '900', letterSpacing: '0.15em', color: 'white',
                        outline: 'none', width: '100%', textShadow: '0 0 10px rgba(59,130,246,0.5)',
                        cursor: readOnly ? 'default' : 'text',
                      }}
                    />
                    <div style={{ fontSize: '0.6rem', color: 'rgba(59,130,246,0.6)', marginTop: '4px', fontWeight: '800' }}>
                      {readOnly ? 'READ ONLY' : 'CLICK TO EDIT PLATE NUMBER'}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', justifyContent: 'flex-end' }}>
              <button onClick={() => { setSelectedVehicleId(null); setLightboxUrl(null); }} className="btn primary" style={{ padding: '10px 24px' }}>
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Photo Lightbox ── */}
      {lightboxUrl && (
        <div
          onClick={() => setLightboxUrl(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 1100,
            background: 'rgba(0,0,0,0.94)', backdropFilter: 'blur(12px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          }}
        >
          <button
            onClick={() => setLightboxUrl(null)}
            style={{
              position: 'absolute', top: 20, right: 20,
              background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)',
              color: 'white', padding: '8px', borderRadius: '50%', cursor: 'pointer', zIndex: 1,
            }}
          >
            <X size={20} />
          </button>
          <img
            src={lightboxUrl}
            alt="Vehicle"
            onClick={e => e.stopPropagation()}
            style={{
              maxWidth: '100%', maxHeight: '90vh',
              borderRadius: '12px', objectFit: 'contain',
              boxShadow: '0 25px 60px rgba(0,0,0,0.8)',
            }}
          />
        </div>
      )}

      {/* ── Resolve Pending Modal ── */}
      {resolvingVehicle && (
        <div
          onClick={() => setResolvingVehicle(null)}
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
            zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '20px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            className="panel animate-scale-in"
            style={{
              width: '100%', maxWidth: '420px', background: 'var(--panel-bg)',
              borderRadius: '20px', overflow: 'hidden', border: '1px solid var(--border-color)',
              boxShadow: '0 25px 50px -12px rgba(0,0,0,0.6)',
            }}
          >
            {/* header */}
            <div style={{ padding: '1.25rem 1.5rem', borderBottom: '1px solid var(--border-color)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <AlertCircle size={18} color={resolvingVehicle.plateStatus === 'duplicate' ? '#f59e0b' : resolvingVehicle.pendingDirection === 'INGRESS' ? '#10b981' : '#a855f7'} />
                <div>
                  <h3 style={{ fontSize: '0.95rem', fontWeight: '900', color: 'white' }}>
                    {resolvingVehicle.plateStatus === 'duplicate' ? 'Duplicate Plate Detected' : 'Plate Not Detected'}
                  </h3>
                  <div style={{ fontSize: '0.7rem', fontWeight: 800, marginTop: '2px', color: resolvingVehicle.plateStatus === 'duplicate' ? '#f59e0b' : resolvingVehicle.pendingDirection === 'INGRESS' ? '#10b981' : '#a855f7' }}>
                    {resolvingVehicle.plateStatus === 'duplicate'
                      ? `▼ ENTRY — ${resolvingVehicle.licensePlate} already in workshop. Enter correct plate.`
                      : `${resolvingVehicle.pendingDirection === 'INGRESS' ? '▼ ENTRY' : '▲ EXIT'} — Manual Input Required`}
                  </div>
                </div>
              </div>
              <button onClick={() => setResolvingVehicle(null)} style={{ background: 'rgba(255,255,255,0.05)', border: 'none', color: 'white', padding: '8px', borderRadius: '50%', cursor: 'pointer' }}>
                <X size={18} />
              </button>
            </div>

            {/* vehicle image */}
            {resolvingVehicle.imageUrl && (
              <div style={{ padding: '1rem 1.5rem 0' }}>
                <div style={{ width: '100%', height: '140px', borderRadius: '10px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <img src={toAbsUrl(resolvingVehicle.imageUrl)} alt="Car" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              </div>
            )}

            {/* plate input */}
            <div style={{ padding: '1.25rem 1.5rem' }}>
              <div style={{ fontSize: '0.65rem', fontWeight: 800, color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '8px' }}>
                Enter License Plate
              </div>
              <input
                type="text"
                value={resolveManualPlate}
                onChange={e => setResolveManualPlate(e.target.value.toUpperCase())}
                placeholder="E.G. MH12AB1234"
                autoFocus
                onKeyDown={e => { if (e.key === 'Enter' && resolveManualPlate.trim()) resolveManually(resolvingVehicle, resolveManualPlate); }}
                style={{
                  width: '100%', padding: '12px 16px', boxSizing: 'border-box',
                  background: 'rgba(255,255,255,0.06)', color: 'white',
                  border: '1px solid rgba(255,255,255,0.15)', borderRadius: '10px',
                  fontSize: '1.4rem', fontWeight: '900', letterSpacing: '0.15em',
                  textTransform: 'uppercase', outline: 'none', textAlign: 'center',
                }}
              />
              <div style={{ fontSize: '0.65rem', color: 'var(--text-secondary)', marginTop: '6px', textAlign: 'center' }}>
                {resolvingVehicle.pendingDirection === 'INGRESS'
                  ? 'If plate matches a Temp Out vehicle, it will be moved back to Workshop.'
                  : 'If plate matches an Entered vehicle, it will be moved to Temp Out.'}
              </div>
            </div>

            {/* footer */}
            <div style={{ padding: '1rem 1.5rem', borderTop: '1px solid var(--border-color)', display: 'flex', gap: '8px' }}>
              <button onClick={() => setResolvingVehicle(null)} className="btn" style={{ flex: 1, padding: '10px' }}>
                Cancel
              </button>
              <button
                onClick={() => resolveManually(resolvingVehicle, resolveManualPlate)}
                disabled={!resolveManualPlate.trim()}
                style={{
                  flex: 2, padding: '10px', borderRadius: '8px', border: 'none',
                  cursor: resolveManualPlate.trim() ? 'pointer' : 'not-allowed',
                  background: resolveManualPlate.trim()
                    ? (resolvingVehicle.pendingDirection === 'INGRESS' ? '#10b981' : '#a855f7')
                    : 'rgba(255,255,255,0.08)',
                  color: resolveManualPlate.trim() ? 'white' : 'var(--text-secondary)',
                  fontWeight: 800, fontSize: '0.85rem', transition: 'all 0.2s',
                }}
              >
                Confirm {resolvingVehicle.pendingDirection === 'INGRESS' ? 'Entry' : 'Exit'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
