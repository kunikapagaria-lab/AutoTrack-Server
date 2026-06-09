import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const ShopContext = createContext();
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// ── Token helpers (kept outside component — no re-render needed) ───────────────
const getAccessToken  = () => localStorage.getItem('autotrack_access_token');
const getRefreshToken = () => localStorage.getItem('autotrack_refresh_token');

const storeTokens = (access, refresh = null) => {
  localStorage.setItem('autotrack_access_token', access);
  if (refresh) localStorage.setItem('autotrack_refresh_token', refresh);
};

const clearTokens = () => {
  localStorage.removeItem('autotrack_access_token');
  localStorage.removeItem('autotrack_refresh_token');
};

export function ShopProvider({ children }) {
  const [user, setUser] = useState(() => {
    const saved = localStorage.getItem('autosense_user');
    return saved ? JSON.parse(saved) : null;
  });

  // true while we are validating the stored session on startup
  const [sessionChecked, setSessionChecked] = useState(false);
  const sessionCheckDone = useRef(false);

  const [vehicles,     setVehicles]     = useState(() => {
    try {
      const cached = localStorage.getItem('autotrack_vehicles');
      return cached ? JSON.parse(cached) : [];
    } catch { return []; }
  });
  const [backendError, setBackendError] = useState(null);

  // feedSource is a device preference (not a secret) — stays in localStorage
  const [feedSource, setFeedSource_] = useState(
    () => localStorage.getItem('autotrack_feedSource') || 'rtsp'
  );

  // Detection lines lock — when true, lines are invisible and not draggable
  const [linesLocked, setLinesLocked_] = useState(
    () => localStorage.getItem('autotrack_lines_locked') !== 'false'
  );
  const setLinesLocked = (val) => {
    localStorage.setItem('autotrack_lines_locked', String(val));
    setLinesLocked_(val);
  };

  const setFeedConfig = (source) => {
    localStorage.setItem('autotrack_feedSource', source);
    setFeedSource_(source);
    // Clean up any previously stored RTSP URL from localStorage
    localStorage.removeItem('autotrack_rtspUrl');
  };

  // RTSP URL lives on the backend only — this sends it there (admin only)
  const saveRtspConfig = async (rtspUrl) => {
    try {
      const res = await apiFetch(`${API_URL}/config/rtsp`, {
        method: 'POST',
        body:   JSON.stringify({ rtsp_url: rtspUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to save RTSP config');
      }
      return await res.json();
    } catch (err) {
      throw err;
    }
  };

  // feedSource2 — source preference for the low/plate camera
  const [feedSource2, setFeedSource2_] = useState(
    () => localStorage.getItem('autotrack_feedSource2') || 'rtsp'
  );

  const setFeedConfig2 = (source) => {
    localStorage.setItem('autotrack_feedSource2', source);
    setFeedSource2_(source);
  };

  const saveRtspConfigLow = async (rtspUrl) => {
    try {
      const res = await apiFetch(`${API_URL}/config/rtsp-low`, {
        method: 'POST',
        body:   JSON.stringify({ rtsp_url: rtspUrl }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Failed to save low camera RTSP config');
      }
      return await res.json();
    } catch (err) {
      throw err;
    }
  };

  // ── Persist user session ──────────────────────────────────────────────────────
  useEffect(() => {
    if (user) localStorage.setItem('autosense_user', JSON.stringify(user));
    else       localStorage.removeItem('autosense_user');
  }, [user]);

  // ── Startup session validation — silently refresh access token on load ────────
  useEffect(() => {
    if (sessionCheckDone.current) return;
    sessionCheckDone.current = true;

    const storedUser   = localStorage.getItem('autosense_user');
    const refreshToken = getRefreshToken();

    // If the page is reloading (refresh), cancel the pending auto-logout the
    // beforeunload handler already sent. sessionStorage survives a refresh but
    // is wiped on tab close, so the flag is only present here on refresh.
    const wasRefreshing = sessionStorage.getItem('_autotrackRefreshing');
    sessionStorage.removeItem('_autotrackRefreshing');
    if (wasRefreshing) {
      const token = getAccessToken();
      if (token) {
        fetch(`${API_URL}/cancel-auto-logout`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    }

    if (!storedUser || !refreshToken) {
      setSessionChecked(true);
      return;
    }

    // Try to get a fresh access token. Failure due to network → keep session.
    // Failure due to server rejection (4xx) → clear session (tokens truly expired).
    fetch(`${API_URL}/refresh`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ refresh_token: refreshToken }),
    })
      .then(res => {
        if (res.ok) {
          return res.json().then(data => storeTokens(data.access_token));
        }
        if (res.status >= 400 && res.status < 500) {
          clearTokens();
          localStorage.removeItem('autosense_user');
          setUser(null);
        }
        // 5xx / network handled in catch — keep session
      })
      .catch(() => { /* network unreachable — keep user logged in */ })
      .finally(() => setSessionChecked(true));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── apiFetch — adds auth header, auto-refreshes on 401 ───────────────────────
  const doLogout = useCallback((recordEvent = false) => {
    if (recordEvent) {
      // Fire-and-forget — don't wait, don't block UI
      const token = getAccessToken();
      if (token) {
        fetch(`${API_URL}/logout`, {
          method:  'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    }
    clearTokens();
    localStorage.removeItem('autotrack_vehicles');
    setUser(null);
    setVehicles([]);
  }, []);

  const apiFetch = useCallback(async (url, options = {}, timeoutMs = 60000) => {
    // Each call gets its own AbortController so retries aren't affected
    const makeRequest = async (token) => {
      const controller = new AbortController();
      const timerId = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          ...options,
          signal: controller.signal,
          headers: {
            ...options.headers,
            'Authorization': `Bearer ${token}`,
            ...(options.body ? { 'Content-Type': 'application/json' } : {}),
          },
        });
        clearTimeout(timerId);
        return res;
      } catch (err) {
        clearTimeout(timerId);
        if (err.name === 'AbortError') throw new Error('Request timed out — check your connection.');
        throw err;
      }
    };

    let res = await makeRequest(getAccessToken() || '');

    // Token expired — try to refresh once then retry
    if (res.status === 401) {
      const refreshToken = getRefreshToken();
      if (!refreshToken) { doLogout(); throw new Error('Session expired'); }

      // Keep network errors separate from auth rejections.
      // Only doLogout() when the server explicitly rejects the token (4xx);
      // a network error means the backend is temporarily unreachable — the
      // session is still valid, so we should NOT log the user out.
      let refreshRes;
      try {
        refreshRes = await fetch(`${API_URL}/refresh`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ refresh_token: refreshToken }),
        });
      } catch {
        throw new Error('Could not reach the server. Please check your connection.');
      }
      if (!refreshRes.ok) {
        doLogout();
        throw new Error('Session expired. Please log in again.');
      }
      const { access_token } = await refreshRes.json();
      storeTokens(access_token);
      res = await makeRequest(access_token);
    }

    return res;
  }, [doLogout]);

  // ── Load vehicles when user logs in ──────────────────────────────────────────

  // Heal states left corrupted when the app is closed mid-scan or when the old
  // backend bug (exclude_none) prevented null from being written to the DB.
  // Returns { normalized, patches } — patches maps vehicle id → backend payload.
  const normalizeVehicles = (raw) => {
    const normalized = [];
    const patches    = {};

    for (const v of raw) {
      const n = { ...v };

      // Scan was running when the app closed; it will never resume.
      if (n.plateStatus === 'scanning') {
        n.plateStatus      = 'not_found';
        patches[n.id]      = { ...patches[n.id], plate_status: 'not_found' };
      }

      // pendingDirection must stay set ONLY when the vehicle genuinely still
      // needs manual plate entry (WAITING + not_found or duplicate).
      // Every other combination means the detection was already resolved but
      // the DB clear failed — fix it now.
      const genuinelyPending =
        n.status === 'WAITING' &&
        (n.plateStatus === 'not_found' || n.plateStatus === 'duplicate');

      if (n.pendingDirection && !genuinelyPending) {
        n.pendingDirection = null;
        patches[n.id]      = { ...patches[n.id], pending_direction: null };
      }

      normalized.push(n);
    }

    return { normalized, patches };
  };

  const loadVehicles = useCallback(() => {
    if (!user) { setVehicles([]); return; }
    setBackendError(null);
    apiFetch(`${API_URL}/vehicles`)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then(data => {
        const { normalized, patches } = normalizeVehicles(Array.isArray(data) ? data : []);
        setVehicles(normalized);
        // Write corrections back so they don't reappear on the next load
        Object.entries(patches).forEach(([id, update]) => {
          apiFetch(`${API_URL}/vehicles/${id}`, {
            method: 'PATCH',
            body:   JSON.stringify(update),
          }).catch(() => {});
        });
      })
      .catch(err => {
        console.error('Failed to load vehicles:', err);
        setBackendError(err.message || 'Could not reach the server. Is the backend running?');
      });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadVehicles(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cache vehicles in localStorage so the list appears instantly on refresh
  // with no empty-state flash. Backend fetch overwrites with authoritative data.
  useEffect(() => {
    if (user) localStorage.setItem('autotrack_vehicles', JSON.stringify(vehicles));
  }, [vehicles, user]);

  // Re-sync from backend whenever the browser tab becomes visible again
  useEffect(() => {
    if (!user) return;
    const onVisible = () => { if (!document.hidden) loadVehicles(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [user, loadVehicles]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auth ──────────────────────────────────────────────────────────────────────
  const login = async (email, password) => {
    try {
      const res = await fetch(`${API_URL}/login`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Login failed');
      }
      const { access_token, refresh_token, user: userData } = await res.json();
      storeTokens(access_token, refresh_token);
      localStorage.setItem('autotrack_last_email', email.toLowerCase().trim());
      setUser(userData);
      return true;
    } catch (err) {
      alert(err.message);
      return false;
    }
  };

  const signup = async (userData) => {
    try {
      const res = await fetch(`${API_URL}/register`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(userData),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Registration failed');
      }
      const data = await res.json();
      // Admin accounts go into pending state — do not auto-login
      if (data.pending) {
        return { pending: true, message: data.message };
      }
      return await login(userData.email, userData.password);
    } catch (err) {
      alert(err.message);
      return false;
    }
  };

  const logout = () => doLogout(true);

  // ── Auto-logout on tab close (not on refresh) ─────────────────────────────────
  // beforeunload fires for both close and refresh, so we always send /auto-logout
  // and set a sessionStorage flag. On refresh the flag survives and the startup
  // session check calls /cancel-auto-logout. On close the flag is wiped with
  // sessionStorage, so no cancel fires and the pending logout is confirmed after 10 s.
  useEffect(() => {
    if (!user) return;
    const handleUnload = () => {
      const token = getAccessToken();
      if (!token) return;
      sessionStorage.setItem('_autotrackRefreshing', '1');
      fetch(`${API_URL}/auto-logout`, {
        method:   'POST',
        headers:  { Authorization: `Bearer ${token}` },
        keepalive: true,
      }).catch(() => {});
    };
    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [user]);


  // ── Vehicle CRUD — optimistic UI + background server sync ────────────────────
  const addVehicle = (vehicleData) => {
    const status     = vehicleData.status || 'ENTERED';
    const newVehicle = {
      ...vehicleData,
      status,
      history:  [{ status, timestamp: new Date().toISOString() }],
      tenantId: user?.id || 'default',
    };
    setVehicles(prev => [newVehicle, ...prev]);

    apiFetch(`${API_URL}/vehicles`, {
      method: 'POST',
      body:   JSON.stringify({
        id:                newVehicle.id,
        license_plate:     newVehicle.licensePlate     || null,
        status:            newVehicle.status,
        image_url:         newVehicle.imageUrl         || null,
        plate_image_url:   newVehicle.plateImageUrl    || null,
        history:           newVehicle.history,
        timestamp:         newVehicle.timestamp,
        tenant_id:         newVehicle.tenantId,
        pending_direction: newVehicle.pendingDirection || null,
        plate_status:      newVehicle.plateStatus      || null,
        confidence:        newVehicle.confidence != null ? String(newVehicle.confidence) : null,
        direction:         newVehicle.direction        || null,
        detection_log:     newVehicle.detectionLog     || null,
      }),
    }).catch(err => console.error('Failed to save vehicle:', err));
  };

  const updateVehicleStatus = (id, newStatus, imageUrl = null) => {
    const timestamp    = new Date().toISOString();
    const historyEntry = imageUrl
      ? { status: newStatus, timestamp, imageUrl }
      : { status: newStatus, timestamp };
    console.log('[STATUS]', id, '→', newStatus, '| imageUrl:', imageUrl ? imageUrl.slice(0, 60) : 'NONE', '| entry keys:', Object.keys(historyEntry));
    setVehicles(prev => prev.map(v =>
      v.id === id
        ? { ...v, status: newStatus, history: [...(v.history || []), historyEntry], lastUpdate: timestamp }
        : v
    ));
    const vehicle    = vehicles.find(v => v.id === id);
    const newHistory = [...(vehicle?.history || []), historyEntry];
    apiFetch(`${API_URL}/vehicles/${id}`, {
      method: 'PATCH',
      body:   JSON.stringify({ status: newStatus, history: newHistory, last_update: timestamp }),
    }).catch(err => console.error('Failed to update status:', err));
  };

  // persist = false for transient UI-only changes (e.g. scanAttempt counter)
  const updateVehicle = (id, updates, persist = true) => {
    setVehicles(prev => prev.map(v => v.id === id ? { ...v, ...updates } : v));
    if (!persist) return;

    const backendUpdates = {};
    if (updates.licensePlate     !== undefined) backendUpdates.license_plate     = updates.licensePlate     ?? null;
    if (updates.plateStatus      !== undefined) backendUpdates.plate_status      = updates.plateStatus      ?? null;
    if (updates.pendingDirection !== undefined) backendUpdates.pending_direction = updates.pendingDirection ?? null;
    if (updates.plateImageUrl    !== undefined) backendUpdates.plate_image_url   = updates.plateImageUrl    ?? null;
    if (updates.imageUrl         !== undefined) backendUpdates.image_url         = updates.imageUrl         ?? null;
    if (updates.detectionLog     !== undefined) backendUpdates.detection_log     = updates.detectionLog     ?? null;
    if (updates.status           !== undefined) backendUpdates.status            = updates.status;

    if (Object.keys(backendUpdates).length === 0) return;

    apiFetch(`${API_URL}/vehicles/${id}`, {
      method: 'PATCH',
      body:   JSON.stringify(backendUpdates),
    }).catch(err => console.error('Failed to update vehicle:', err));
  };

  const removeVehicle = (id) => {
    setVehicles(prev => prev.filter(v => v.id !== id));
    apiFetch(`${API_URL}/vehicles/${id}`, { method: 'DELETE' })
      .catch(err => console.error('Failed to delete vehicle:', err));
  };

  return (
    <ShopContext.Provider value={{
      user,
      sessionChecked,
      login,
      signup,
      logout,
      vehicles,
      backendError,
      retryLoadVehicles: loadVehicles,
      addVehicle,
      updateVehicleStatus,
      updateVehicle,
      removeVehicle,
      feedSource,
      setFeedConfig,
      saveRtspConfig,
      feedSource2,
      setFeedConfig2,
      saveRtspConfigLow,
      linesLocked,
      setLinesLocked,
    }}>
      {children}
    </ShopContext.Provider>
  );
}

export function useShop() {
  return useContext(ShopContext);
}
