import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { Camera, Upload, PlayCircle, RefreshCw, X } from 'lucide-react';

const _API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

const BURST_FRAMES   = 5;
const BURST_DURATION = 1500;
const FRAME_INTERVAL = BURST_DURATION / (BURST_FRAMES - 1); // 375ms

async function fetchPlate(imageDataUrl) {
  try {
    const blob = await (await fetch(imageDataUrl)).blob();
    const fd   = new FormData();
    fd.append('file', new File([blob], 'cap.jpg', { type: 'image/jpeg' }));
    const r = await fetch(`${_API}/detect-plate`, { method: 'POST', body: fd });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function captureFrame(source, isRTSP) {
  const c = document.createElement('canvas');
  c.width  = isRTSP ? source.naturalWidth  : source.videoWidth;
  c.height = isRTSP ? source.naturalHeight : source.videoHeight;
  c.getContext('2d').drawImage(source, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

const toAbsUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${_API}${url}`;
};

// ─── component ───────────────────────────────────────────────────────────────

const LowCameraFeed = forwardRef(function LowCameraFeed({ onPlateResult }, ref) {
  const videoRef     = useRef(null);
  const imageRef     = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef    = useRef(null);

  const [isReady,   setIsReady]   = useState(false);
  const [isRTSP,    setIsRTSP]    = useState(false);
  const [isLooping, setIsLooping] = useState(false);
  const [status,    setStatus]    = useState('idle');
  const [lastPlate, setLastPlate] = useState(null);
  const [error,     setError]     = useState(null);

  // Internal burst queue — handles multiple cars in sequence
  const burstQueue    = useRef([]);
  const processingRef = useRef(false);
  const isReadyRef    = useRef(false);
  const isRTSPRef     = useRef(false);

  useEffect(() => { isReadyRef.current = isReady; }, [isReady]);
  useEffect(() => { isRTSPRef.current  = isRTSP;  }, [isRTSP]);

  const processQueue = useCallback(async () => {
    if (processingRef.current || burstQueue.current.length === 0) return;
    processingRef.current = true;

    while (burstQueue.current.length > 0) {
      const burstStartTime = burstQueue.current.shift();
      const source = isRTSPRef.current ? imageRef.current : videoRef.current;

      if (!source || !isReadyRef.current) {
        onPlateResult({ plateText: null, confidence: 0, plateImageUrl: null, burstStartTime, detectionLog: [] });
        continue;
      }

      const ready = isRTSPRef.current
        ? (source.complete && source.naturalWidth > 0)
        : (source.readyState >= 2 && source.videoWidth > 0);

      if (!ready) {
        onPlateResult({ plateText: null, confidence: 0, plateImageUrl: null, burstStartTime, detectionLog: [] });
        continue;
      }

      setStatus('scanning');

      // Capture burst
      const frames = [];
      for (let i = 0; i < BURST_FRAMES; i++) {
        try { frames.push(captureFrame(source, isRTSPRef.current)); } catch {}
        if (i < BURST_FRAMES - 1) await new Promise(r => setTimeout(r, FRAME_INTERVAL));
      }

      // OCR each frame sequentially, keep best result
      let best = null;
      const log = [];
      for (const frame of frames) {
        const result = await fetchPlate(frame);
        if (result) log.push(result);
        if (result?.found) {
          const conf = result.ocr_confidence || 0;
          if (!best || conf > (best.ocr_confidence || 0)) best = result;
          if (conf > 0.90) break; // early exit on very high confidence
        }
      }

      const found = best?.found && best?.plate_text;
      setStatus(found ? 'done' : 'error');
      setLastPlate(found ? best.plate_text.toUpperCase() : null);

      onPlateResult({
        plateText:     found ? best.plate_text.toUpperCase() : null,
        confidence:    best?.ocr_confidence || 0,
        plateImageUrl: toAbsUrl(best?.plate_url) || null,
        burstStartTime,
        detectionLog:  log,
      });

      // Brief pause between queued bursts to let the UI breathe
      if (burstQueue.current.length > 0) await new Promise(r => setTimeout(r, 200));
    }

    processingRef.current = false;
    setTimeout(() => setStatus('idle'), 3000);
  }, [onPlateResult]);

  // Public method exposed to parent via ref
  const runBurst = useCallback((burstStartTime) => {
    burstQueue.current.push(burstStartTime);
    processQueue();
  }, [processQueue]);

  useImperativeHandle(ref, () => ({ runBurst }), [runBurst]);

  // ── source controls ──
  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return;
    if (!file.type.startsWith('video/')) { setError('Please select a valid video file'); return; }
    videoRef.current.src = URL.createObjectURL(file);
    videoRef.current.onloadedmetadata = () => { setIsReady(true); setIsRTSP(false); videoRef.current.play(); };
  }

  function startRTSP() { stopWebcam(); setIsReady(true); setIsRTSP(true); }

  async function startWebcam() {
    try {
      const devices  = await navigator.mediaDevices.enumerateDevices();
      const cams     = devices.filter(d => d.kind === 'videoinput');
      const deviceId = cams.length > 1 ? cams[1].deviceId : cams[0]?.deviceId;
      const s = await navigator.mediaDevices.getUserMedia({
        video: { deviceId: deviceId ? { exact: deviceId } : undefined, width: 1280, height: 720 },
      });
      streamRef.current = s;
      videoRef.current.srcObject = s;
      videoRef.current.onloadedmetadata = () => { setIsReady(true); setIsRTSP(false); videoRef.current.play(); };
    } catch { setError('Failed to access low camera'); }
  }

  function stopWebcam() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }

  function stopAll() {
    stopWebcam();
    burstQueue.current = [];
    setIsReady(false); setIsRTSP(false); setStatus('idle'); setLastPlate(null); setError(null);
    if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = ''; }
  }

  const statusColor = status === 'scanning' ? '#facc15'
    : status === 'done'  ? '#10b981'
    : status === 'error' ? '#ef4444'
    : 'var(--text-secondary)';

  const statusLabel = status === 'scanning' ? 'Scanning plate…'
    : status === 'done'  ? `Plate: ${lastPlate}`
    : status === 'error' ? 'No plate found'
    : isReady            ? 'Ready'
    : 'Offline';

  return (
    <div className="detector-section panel">
      <div className="card-top-border" style={{ backgroundColor: '#a855f7' }} />

      <div className="camera-controls" style={{ flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>
          <Camera size={18} color="#a855f7" />
          Low Camera — Plate Reader
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, flexWrap: 'wrap' }}>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="video/*" style={{ display: 'none' }} />
          {!isReady ? (
            <>
              <button onClick={() => fileInputRef.current.click()} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(0,210,255,0.12)', color: 'var(--accent-color)', border: '1px solid rgba(0,210,255,0.3)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <Upload size={12} /> Upload Video
              </button>
              <button onClick={startRTSP} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(59,130,246,0.12)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <PlayCircle size={12} /> Live RTSP
              </button>
              <button onClick={startWebcam} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(168,85,247,0.12)', color: '#a855f7', border: '1px solid rgba(168,85,247,0.3)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
                <RefreshCw size={12} /> Webcam
              </button>
            </>
          ) : (
            <button onClick={stopAll} style={{ display: 'flex', alignItems: 'center', gap: '5px', padding: '5px 12px', fontSize: '0.72rem', fontWeight: 700, background: 'rgba(239,68,68,0.12)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' }}>
              <X size={12} /> Stop
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {!isRTSP && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
              <input type="checkbox" checked={isLooping} onChange={e => { setIsLooping(e.target.checked); if (videoRef.current) videoRef.current.loop = e.target.checked; }} style={{ accentColor: '#a855f7' }} />
              Loop
            </label>
          )}
          <div className="live-indicator" style={{ fontSize: '0.72rem', color: statusColor }}>
            {status === 'scanning' && <div className="pulse-dot" style={{ background: '#facc15' }} />}
            {statusLabel}
          </div>
          {error && <span style={{ fontSize: '0.7rem', color: '#ef4444' }}>{error}</span>}
        </div>
      </div>

      <div className="video-container" style={{ position: 'relative' }}>
        {!isReady && (
          <div className="monitoring-overlay animate-fade-in">
            <div className="monitoring-content">
              <Camera size={40} className="monitoring-icon" style={{ color: '#a855f7' }} />
              <h3 style={{ fontSize: '1rem', marginBottom: '6px' }}>Low Camera — Offline</h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                Position this camera close to the plate zone for best OCR results.
              </p>
            </div>
          </div>
        )}

        <video ref={videoRef} playsInline muted loop={isLooping}
          style={{ display: (isReady && !isRTSP) ? 'block' : 'none', width: '100%', borderRadius: '12px' }} />
        <img ref={imageRef}
          src={isRTSP ? `${_API}/video-feed-low` : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}
          alt="Low cam RTSP" crossOrigin="anonymous"
          style={{ display: (isReady && isRTSP) ? 'block' : 'none', width: '100%', height: 'auto', background: '#000', borderRadius: '12px' }}
        />

        {status === 'scanning' && (
          <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(250,204,21,0.15)', border: '1px solid rgba(250,204,21,0.4)', borderRadius: '8px', padding: '6px 12px', fontSize: '0.72rem', fontWeight: 800, color: '#facc15', letterSpacing: '0.05em' }}>
            ◆ SCANNING PLATE… ({burstQueue.current.length > 0 ? `+${burstQueue.current.length} queued` : '1 of 5 frames'})
          </div>
        )}
        {status === 'done' && lastPlate && (
          <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(16,185,129,0.15)', border: '1px solid rgba(16,185,129,0.4)', borderRadius: '8px', padding: '6px 12px', fontSize: '0.82rem', fontWeight: 900, color: '#10b981', letterSpacing: '0.1em' }}>
            ✓ {lastPlate}
          </div>
        )}
        {status === 'error' && (
          <div style={{ position: 'absolute', top: 10, left: 10, background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: '8px', padding: '6px 12px', fontSize: '0.72rem', fontWeight: 800, color: '#ef4444' }}>
            ✗ No plate detected
          </div>
        )}
      </div>
    </div>
  );
});

export default LowCameraFeed;
