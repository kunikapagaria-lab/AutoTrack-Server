import { createContext, useContext, useState, useEffect, useCallback } from 'react';

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

  const [vehicles,     setVehicles]     = useState([]);
  const [backendError, setBackendError] = useState(null);

  // feedSource is a device preference (not a secret) — stays in localStorage
  const [feedSource, setFeedSource_] = useState(
    () => localStorage.getItem('autotrack_feedSource') || 'rtsp'
  );

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

  // ── apiFetch — adds auth header, auto-refreshes on 401 ───────────────────────
  const doLogout = useCallback(() => {
    clearTokens();
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
      try {
        const refreshRes = await fetch(`${API_URL}/refresh`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ refresh_token: refreshToken }),
        });
        if (!refreshRes.ok) throw new Error('Refresh failed');
        const { access_token } = await refreshRes.json();
        storeTokens(access_token);
        res = await makeRequest(access_token);
      } catch {
        doLogout();
        throw new Error('Session expired. Please log in again.');
      }
    }

    return res;
  }, [doLogout]);

  // ── Load vehicles when user logs in ──────────────────────────────────────────
  const loadVehicles = useCallback(() => {
    if (!user) { setVehicles([]); return; }
    setBackendError(null);
    apiFetch(`${API_URL}/vehicles`)
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.json();
      })
      .then(data => setVehicles(Array.isArray(data) ? data : []))
      .catch(err => {
        console.error('Failed to load vehicles:', err);
        setBackendError(err.message || 'Could not reach the server. Is the backend running?');
      });
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadVehicles(); }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

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

  const logout = () => doLogout();

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
    }}>
      {children}
    </ShopContext.Provider>
  );
}

export function useShop() {
  return useContext(ShopContext);
}
