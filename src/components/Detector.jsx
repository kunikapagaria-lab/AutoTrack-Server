import { useEffect, useRef, useState } from 'react';
import * as tf from '@tensorflow/tfjs';
import * as cocoSsd from '@tensorflow-models/coco-ssd';
import { PlayCircle, Upload, RefreshCw, Wifi, X } from 'lucide-react';

import { useShop } from '../context/ShopContext';

// ─── helpers ────────────────────────────────────────────────────────────────

const _API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

async function fetchPlate(imageDataUrl) {
  try {
    // Convert base64 data URL directly to blob — avoids fetch('data:...')
    // which is blocked in WebView2 (pywebview native window)
    let blob;
    if (imageDataUrl.startsWith('data:')) {
      const [header, b64] = imageDataUrl.split(',');
      const mime = header.match(/:(.*?);/)?.[1] || 'image/jpeg';
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      blob = new Blob([bytes], { type: mime });
    } else {
      blob = await (await fetch(imageDataUrl)).blob();
    }
    const fd = new FormData();
    fd.append('file', new File([blob], 'cap.jpg', { type: 'image/jpeg' }));
    const r = await fetch(`${_API}/detect-plate`, { method: 'POST', body: fd });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Converts relative /uploads/... paths to absolute. Full URLs and data: URIs pass through.
const toAbsUrl = (url) => {
  if (!url) return null;
  if (url.startsWith('http') || url.startsWith('data:')) return url;
  return `${_API}${url}`;
};

// Upload a base64 frame to the server, returns a hosted URL
async function uploadFrame(base64DataUrl) {
  try {
    const token = localStorage.getItem('autotrack_access_token') || '';
    const r = await fetch(`${_API}/upload-image`, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ image: base64DataUrl }),
    });
    if (!r.ok) return base64DataUrl; // fallback: base64 still displays correctly
    const { url } = await r.json();
    return toAbsUrl(url);
  } catch {
    return base64DataUrl;
  }
}

function captureFrame(source, isRTSP) {
  const c = document.createElement('canvas');
  c.width  = isRTSP ? source.naturalWidth  : source.videoWidth;
  c.height = isRTSP ? source.naturalHeight : source.videoHeight;
  c.getContext('2d').drawImage(source, 0, 0);
  return c.toDataURL('image/jpeg', 0.85);
}

function computeIoU(bbox1, bbox2) {
  const [x1, y1, w1, h1] = bbox1;
  const [x2, y2, w2, h2] = bbox2;
  const ix = Math.max(0, Math.min(x1 + w1, x2 + w2) - Math.max(x1, x2));
  const iy = Math.max(0, Math.min(y1 + h1, y2 + h2) - Math.max(y1, y2));
  const inter = ix * iy;
  const union = w1 * h1 + w2 * h2 - inter;
  return union > 0 ? inter / union : 0;
}

let _tid = 1;

// ─── component ──────────────────────────────────────────────────────────────

export default function Detector() {
  const videoRef     = useRef(null);
  const canvasRef    = useRef(null);
  const imageRef     = useRef(null);
  const fileInputRef = useRef(null);
  const streamRef    = useRef(null);
  const requestRef   = useRef(null);

  const trackersRef = useRef([]);

  const line1Ref = useRef({ left: 0.35, right: 0.35 });
  const line2Ref = useRef({ left: 0.65, right: 0.65 });
  const dragging = useRef(null);
  const dragPart = useRef(null);

  const [model,          setModel]         = useState(null);
  const [error,          setError]         = useState(null);
  const [isMonitoring,   setIsMonitoring]  = useState(false);
  const [isRTSP,         setIsRTSP]        = useState(false);
  const [isLooping,      setIsLooping]     = useState(false);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);

  const {
    addVehicle, vehicles, updateVehicle, updateVehicleStatus, removeVehicle,
    feedSource,
  } = useShop();

  const vehiclesRef = useRef(vehicles);
  useEffect(() => { vehiclesRef.current = vehicles; }, [vehicles]);

  // ── load model ──
  useEffect(() => {
    let alive = true;
    tf.ready()
      .then(() => cocoSsd.load({ base: 'lite_mobilenet_v2' }))
      .then(m  => { if (alive) setModel(m); })
      .catch(() => { if (alive) setError('Failed to load AI model'); });
    return () => {
      alive = false;
      if (requestRef.current) cancelAnimationFrame(requestRef.current);
    };
  }, []);

  // ── auto-start from saved feed preference ──
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (!model || !feedSource || autoStartedRef.current || isMonitoring) return;
    autoStartedRef.current = true;
    if (feedSource === 'rtsp') startRTSP();
    else if (feedSource === 'webcam') startWebcam();
  }, [model]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── draggable lines ──
  function toCanvasCoords(e) {
    const c = canvasRef.current;
    const r = c.getBoundingClientRect();
    return [
      (e.clientX - r.left) * (c.width / r.width),
      (e.clientY - r.top)  * (c.height / r.height),
    ];
  }

  function getLineYAtX(lineObj, x, width, height) {
    const fracX = Math.max(0, Math.min(1, x / width));
    return height * (lineObj.left * (1 - fracX) + lineObj.right * fracX);
  }

  function onMouseDown(e) {
    const c = canvasRef.current; if (!c) return;
    const [x, y] = toCanvasCoords(e);
    const l1Y = getLineYAtX(line1Ref.current, x, c.width, c.height);
    const l2Y = getLineYAtX(line2Ref.current, x, c.width, c.height);
    let target = null;
    if (Math.abs(y - l1Y) < 35) target = 1;
    else if (Math.abs(y - l2Y) < 35) target = 2;
    if (target) {
      dragging.current = target;
      if (x < c.width * 0.25) dragPart.current = 'left';
      else if (x > c.width * 0.75) dragPart.current = 'right';
      else dragPart.current = 'mid';
      e.preventDefault();
    }
  }

  function onMouseMove(e) {
    const c = canvasRef.current; if (!c) return;
    const [x, y] = toCanvasCoords(e);
    if (dragging.current) {
      const targetObj = dragging.current === 1 ? line1Ref.current : line2Ref.current;
      const fracY = Math.max(0.02, Math.min(0.98, y / c.height));
      if (dragPart.current === 'left') {
        targetObj.left = fracY;
      } else if (dragPart.current === 'right') {
        targetObj.right = fracY;
      } else {
        const currYFrac = targetObj.left * (1 - x / c.width) + targetObj.right * (x / c.width);
        const delta = fracY - currYFrac;
        targetObj.left  = Math.max(0.02, Math.min(0.98, targetObj.left  + delta));
        targetObj.right = Math.max(0.02, Math.min(0.98, targetObj.right + delta));
      }
    } else {
      const l1Y = getLineYAtX(line1Ref.current, x, c.width, c.height);
      const l2Y = getLineYAtX(line2Ref.current, x, c.width, c.height);
      c.style.cursor = (Math.abs(y - l1Y) < 35 || Math.abs(y - l2Y) < 35) ? 'pointer' : 'default';
    }
  }
  function onMouseUp() { dragging.current = null; }

  // ── source controls ──
  function handleFileChange(e) {
    const file = e.target.files[0]; if (!file) return;
    if (!file.type.startsWith('video/')) { setError('Please select a valid video file'); return; }
    const url = URL.createObjectURL(file);
    videoRef.current.src = url;
    videoRef.current.onloadedmetadata = () => { setIsMonitoring(true); setIsRTSP(false); setIsVideoPlaying(false); };
  }
  function startRTSP() { stopWebcam(); setIsMonitoring(true); setIsRTSP(true); setIsVideoPlaying(true); }
  async function startWebcam() {
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 } });
      streamRef.current = s;
      videoRef.current.srcObject = s;
      videoRef.current.onloadedmetadata = () => { setIsMonitoring(true); setIsRTSP(false); setIsVideoPlaying(true); videoRef.current.play(); };
    } catch { setError('Failed to access camera'); }
  }
  function stopWebcam() {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }
  function toggleMonitoring() {
    if (isMonitoring) {
      setIsMonitoring(false); setIsRTSP(false); setIsVideoPlaying(false); stopWebcam();
      if (videoRef.current) { videoRef.current.pause(); videoRef.current.src = ''; }
    } else fileInputRef.current.click();
  }

  // ── detection loop ──
  useEffect(() => {
    if (!isMonitoring || !model) return;
    const source = isRTSP ? imageRef.current : videoRef.current;
    const canvas = canvasRef.current;
    if (!source || !canvas) return;
    const ctx = canvas.getContext('2d');
    let busy = false;

    trackersRef.current = [];

    function getSideOfLine(x, y, lineObj, canvasWidth, canvasHeight) {
      const ly1 = canvasHeight * lineObj.left;
      const ly2 = canvasHeight * lineObj.right;
      return (canvasWidth * (y - ly1) - (ly2 - ly1) * x) > 0;
    }

    function drawLine(lineObj, color, tag, lbl) {
      const y1 = canvas.height * lineObj.left;
      const y2 = canvas.height * lineObj.right;
      ctx.save();
      ctx.setLineDash([18, 8]); ctx.strokeStyle = color; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(0, y1); ctx.lineTo(canvas.width, y2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(28, y1 + (y2 - y1) * (28 / canvas.width), 14, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(tag, 28, y1 + (y2 - y1) * (28 / canvas.width) + 4);
      ctx.fillStyle = color;
      ctx.beginPath(); ctx.arc(canvas.width - 28, y2 - (y2 - y1) * (28 / canvas.width), 10, 0, Math.PI * 2); ctx.fill();
      const midY = (y1 + y2) / 2;
      ctx.font = 'bold 12px sans-serif'; ctx.textAlign = 'center';
      const tw = ctx.measureText(lbl).width + 30;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.beginPath(); ctx.roundRect(canvas.width / 2 - tw / 2, midY - 12, tw, 24, 12); ctx.fill();
      ctx.fillStyle = color; ctx.fillText(lbl, canvas.width / 2, midY + 4);
      ctx.restore();
    }

    async function tick() {
      if (busy) { if (isMonitoring) requestRef.current = requestAnimationFrame(tick); return; }
      busy = true;
      try {
        const ready = isRTSP
          ? (source.complete && source.naturalWidth > 0)
          : (source.readyState >= 2 && source.videoWidth > 0);
        if (!ready) { busy = false; if (isMonitoring) requestRef.current = requestAnimationFrame(tick); return; }

        canvas.width  = isRTSP ? source.naturalWidth  : source.videoWidth;
        canvas.height = isRTSP ? source.naturalHeight : source.videoHeight;

        const preds = await model.detect(source, 30, 0.40);
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawLine(line1Ref.current, '#10b981', 'L1', '▼  LINE 1 — ENTERING');
        drawLine(line2Ref.current, '#f5a623', 'L2', '▲  LINE 2 — EXITING');

        const cars = preds
          .filter(p => p.class !== 'person')
          .map(p => ({
            ...p,
            rawClass: p.class,
            label: 'Car',
            area: p.bbox[2] * p.bbox[3],
            cx: p.bbox[0] + p.bbox[2] / 2,
            cy: p.bbox[1] + p.bbox[3] / 2,
          }))
          .filter(p => p.area > canvas.width * canvas.height * 0.005);

        const nextTrackers = [];
        const matchedIds   = new Set();

        for (const car of cars) {
          let best = null, bestIoU = -1, bestDist = Infinity;
          for (const t of trackersRef.current) {
            const iou  = t.bbox ? computeIoU(car.bbox, t.bbox) : 0;
            const dist = Math.hypot(car.cx - t.cx, car.cy - t.cy);
            if (iou > bestIoU || (iou === bestIoU && dist < bestDist)) {
              bestIoU = iou; bestDist = dist; best = t;
            }
          }
          if (bestIoU < 0.2 && bestDist >= 120) best = null;

          const t = best
            ? { ...best, prevCx: best.cx, prevCy: best.cy, cx: car.cx, cy: car.cy, bbox: car.bbox, lostFrames: 0 }
            : {
                id: `t${_tid++}`,
                cx: car.cx, cy: car.cy, prevCx: null, prevCy: null,
                bbox: car.bbox,
                l1Crossed: false, l2Crossed: false,
                firstLine: null,
                triggered: false,
                frameBuffer: [],
                capturedIntervals: new Set(),
                frames: 0,
                lostFrames: 0,
              };
          t.frames++;
          matchedIds.add(t.id);

          // ── line crossing ──
          if (t.prevCy !== null && !t.triggered) {
            const curL1 = getSideOfLine(car.cx, car.cy, line1Ref.current, canvas.width, canvas.height);
            const preL1 = getSideOfLine(t.prevCx, t.prevCy, line1Ref.current, canvas.width, canvas.height);
            const curL2 = getSideOfLine(car.cx, car.cy, line2Ref.current, canvas.width, canvas.height);
            const preL2 = getSideOfLine(t.prevCx, t.prevCy, line2Ref.current, canvas.width, canvas.height);

            if (!t.l1Crossed && curL1 !== preL1) {
              t.l1Crossed = true;
              if (t.firstLine === null) t.firstLine = 1;
            }
            if (!t.l2Crossed && curL2 !== preL2) {
              t.l2Crossed = true;
              if (t.firstLine === null) t.firstLine = 2;
            }
          }

          // ── multi-frame capture ──
          if ((t.l1Crossed || t.l2Crossed) && !t.triggered) {
            const l1Y  = getLineYAtX(line1Ref.current, car.cx, canvas.width, canvas.height);
            const l2Y  = getLineYAtX(line2Ref.current, car.cx, canvas.width, canvas.height);
            const range    = Math.abs(l2Y - l1Y);
            const progress = range > 0 ? (Math.abs(car.cy - l1Y) / range) : 0;
            [0.1, 0.3, 0.5, 0.7, 0.9].forEach(interval => {
              if (!t.capturedIntervals.has(interval) && Math.abs(progress - interval) < 0.08) {
                try {
                  t.frameBuffer.push(captureFrame(source, isRTSP));
                  t.capturedIntervals.add(interval);
                } catch {}
              }
            });
          }

          // ── trigger: both lines crossed → upload image, add to WAITING, scan in background ──
          if (t.l1Crossed && t.l2Crossed && !t.triggered && car.score > 0.20) {
            t.triggered = true;

            const direction = t.firstLine === 1 ? 'INGRESS' : 'EGRESS';
            const pendingId = `VEH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
            const rawFrame  = t.frameBuffer[Math.floor(t.frameBuffer.length / 2)]
              || t.frameBuffer[0]
              || (() => { try { return captureFrame(source, isRTSP); } catch { return ''; } })();

            // Upload vehicle frame to server (async), get a stable URL
            const imageUrl = await uploadFrame(rawFrame);
            console.log('[DETECT]', direction, 'imageUrl:', imageUrl ? imageUrl.slice(0, 60) : 'EMPTY', 'rawFrame:', rawFrame ? rawFrame.slice(0, 30) : 'EMPTY');

            // Add to WAITING column with scanning state
            addVehicle({
              id: pendingId,
              status: 'WAITING',
              pendingDirection: direction,
              plateStatus: 'scanning',
              scanAttempt: 1,
              totalAttempts: t.frameBuffer.length || 1,
              imageUrl,
              type: car.label,
              confidence: car.score,
              timestamp: new Date().toISOString(),
              licensePlate: '',
              plateImageUrl: null,
              direction,
            });

            // Scan frames sequentially; auto-resolve when plate found
            const validateSequential = async (index) => {
              const currentUrl = t.frameBuffer[index] || rawFrame;
              // scanAttempt is UI-only, no need to persist to database
              updateVehicle(pendingId, { scanAttempt: index + 1 }, false);

              const pr = await fetchPlate(currentUrl);
              const isStrong = pr && pr.found && (pr.ocr_confidence > 0.85 || (pr.plate_text && pr.plate_text.length >= 8));

              if (isStrong || index >= t.frameBuffer.length - 1) {
                if (!pr || pr.error || !pr.found) {
                  // No plate found — stay in WAITING with notification
                  updateVehicle(pendingId, { plateStatus: 'not_found', detectionLog: pr?.detection_log || [] });
                  return;
                }

                const plateText = (pr.plate_text || '').toUpperCase();

                if (direction === 'INGRESS') {
                  // Check if this is a known vehicle re-entering
                  const existing = vehiclesRef.current.find(v =>
                    v.id !== pendingId &&
                    !v.pendingDirection &&
                    v.licensePlate?.toUpperCase() === plateText &&
                    (v.status === 'TEMP_OUT' || v.status === 'WAITING')
                  );
                  if (existing) {
                    // Re-entry: restore existing vehicle, discard placeholder
                    updateVehicleStatus(existing.id, 'ENTERED', imageUrl);
                    removeVehicle(pendingId);
                  } else {
                    // New vehicle: promote placeholder from WAITING → ENTERED
                    updateVehicle(pendingId, {
                      licensePlate:    plateText,
                      plateImageUrl:   toAbsUrl(pr.plate_url),
                      plateStatus:     'found',
                      pendingDirection: null,
                      detectionLog:    pr.detection_log || [],
                    });
                    updateVehicleStatus(pendingId, 'ENTERED', imageUrl);
                  }
                } else {
                  // EGRESS: find the matching ENTERED vehicle
                  const entered = vehiclesRef.current.find(v =>
                    v.id !== pendingId &&
                    v.licensePlate?.toUpperCase() === plateText &&
                    v.status === 'ENTERED'
                  );
                  if (entered) {
                    // Known exit: mark TEMP_OUT, discard placeholder
                    console.log('[DETECT] EGRESS → TEMP_OUT for', entered.id, 'imageUrl:', imageUrl ? imageUrl.slice(0, 60) : 'EMPTY');
                    updateVehicleStatus(entered.id, 'TEMP_OUT', imageUrl);
                    removeVehicle(pendingId);
                  } else {
                    // Plate found but no matching ENTERED vehicle — leave in WAITING for manual resolve
                    updateVehicle(pendingId, {
                      licensePlate:  plateText,
                      plateImageUrl: toAbsUrl(pr.plate_url),
                      plateStatus:   'not_found',
                      detectionLog:  pr.detection_log || [],
                    });
                  }
                }
              } else {
                validateSequential(index + 1);
              }
            };

            validateSequential(0);
          }

          // ── draw bounding box once a line is crossed ──
          if (t.l1Crossed || t.l2Crossed) {
            const [bx, by, bw, bh] = car.bbox;
            const boxColor = (t.l1Crossed && t.l2Crossed) ? '#a855f7' : '#00d2ff';
            ctx.strokeStyle = boxColor; ctx.lineWidth = 4;
            ctx.strokeRect(bx, by, bw, bh);

            const txt = `${car.label} ${Math.round(car.score * 100)}%`;
            ctx.font = 'bold 15px sans-serif';
            const tw = ctx.measureText(txt).width + 12;
            ctx.fillStyle = boxColor; ctx.fillRect(bx, by > 22 ? by - 22 : by + bh, tw, 20);
            ctx.fillStyle = '#000'; ctx.fillText(txt, bx + 6, (by > 22 ? by - 22 : by + bh) + 14);

            const prog = (t.l1Crossed && t.l2Crossed) ? '✓ CAPTURED'
              : t.l1Crossed ? 'L1 ✓  →  L2...' : 'L2 ✓  →  L1...';
            ctx.font = 'bold 11px sans-serif';
            const pw = ctx.measureText(prog).width + 12;
            ctx.fillStyle = 'rgba(168,85,247,0.9)'; ctx.fillRect(bx, by + bh + 2, pw, 18);
            ctx.fillStyle = '#fff'; ctx.fillText(prog, bx + 6, by + bh + 14);
          }

          nextTrackers.push(t);
        }

        for (const oldT of trackersRef.current) {
          if (!matchedIds.has(oldT.id)) {
            oldT.lostFrames = (oldT.lostFrames || 0) + 1;
            if (oldT.lostFrames < 15) nextTrackers.push(oldT);
          }
        }

        trackersRef.current = nextTrackers;
      } catch (e) { console.error('Detection error:', e); }
      busy = false;
      if (isMonitoring) requestRef.current = requestAnimationFrame(tick);
    }

    tick();
    return () => { if (requestRef.current) cancelAnimationFrame(requestRef.current); };
  }, [isMonitoring, isRTSP, model]);

  // ── render ──
  return (
    <div className="detector-section panel">
      <div className="card-top-border" style={{ backgroundColor: 'var(--accent-color)' }} />

      {/* ── header ── */}
      <div className="camera-controls" style={{ flexWrap: 'wrap', gap: '10px' }}>
        <h2 style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', fontWeight: 900, letterSpacing: '0.05em', textTransform: 'uppercase', flexShrink: 0 }}>
          <PlayCircle size={18} color="var(--accent-color)" />
          Stream Analysis
        </h2>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flex: 1, flexWrap: 'wrap' }}>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="video/*" style={{ display: 'none' }} />
          {!isMonitoring ? (
            feedSource === 'upload' ? (
              <button
                onClick={toggleMonitoring}
                disabled={!model}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '5px 12px', fontSize: '0.72rem', fontWeight: 700,
                  background: model ? 'rgba(0,210,255,0.12)' : 'rgba(255,255,255,0.05)',
                  color: model ? 'var(--accent-color)' : 'var(--text-secondary)',
                  border: `1px solid ${model ? 'rgba(0,210,255,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '6px', cursor: model ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
                }}
              >
                <Upload size={12} /> {model ? 'Select Video' : 'Loading…'}
              </button>
            ) : feedSource === 'rtsp' ? (
              <button
                onClick={startRTSP}
                disabled={!model}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '5px 12px', fontSize: '0.72rem', fontWeight: 700,
                  background: model ? 'rgba(59,130,246,0.12)' : 'rgba(255,255,255,0.05)',
                  color: model ? '#3b82f6' : 'var(--text-secondary)',
                  border: `1px solid ${model ? 'rgba(59,130,246,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '6px', cursor: model ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
                }}
              >
                <Wifi size={12} /> {model ? 'Reconnect RTSP' : 'Initializing…'}
              </button>
            ) : (
              <button
                onClick={startWebcam}
                disabled={!model}
                style={{
                  display: 'flex', alignItems: 'center', gap: '5px',
                  padding: '5px 12px', fontSize: '0.72rem', fontWeight: 700,
                  background: model ? 'rgba(16,185,129,0.12)' : 'rgba(255,255,255,0.05)',
                  color: model ? '#10b981' : 'var(--text-secondary)',
                  border: `1px solid ${model ? 'rgba(16,185,129,0.3)' : 'rgba(255,255,255,0.1)'}`,
                  borderRadius: '6px', cursor: model ? 'pointer' : 'not-allowed', whiteSpace: 'nowrap',
                }}
              >
                <RefreshCw size={12} /> {model ? 'Reconnect Webcam' : 'Initializing…'}
              </button>
            )
          ) : (
            <button
              onClick={toggleMonitoring}
              style={{
                display: 'flex', alignItems: 'center', gap: '5px',
                padding: '5px 12px', fontSize: '0.72rem', fontWeight: 700,
                background: 'rgba(239,68,68,0.12)', color: '#ef4444',
                border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              <X size={12} /> Stop
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '0.72rem', cursor: 'pointer', color: 'var(--text-secondary)', fontWeight: 600, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={isLooping} onChange={e => setIsLooping(e.target.checked)} style={{ accentColor: 'var(--accent-color)' }} />
            Loop
          </label>
          {error
            ? <div className="status-pill" style={{ color: 'var(--danger-color)', background: 'rgba(239,68,68,0.1)', borderColor: 'rgba(239,68,68,0.2)', fontSize: '0.7rem' }}><div className="dot" />{error}</div>
            : <div className="live-indicator" style={{ fontSize: '0.72rem' }}>{isMonitoring && <div className="pulse-dot" />}{isMonitoring ? 'Live' : model ? 'Ready' : 'Loading AI…'}</div>
          }
        </div>
      </div>

      {/* ── video area ── */}
      <div className="video-container" style={{ position: 'relative' }}>
        {!isMonitoring && (
          <div className="monitoring-overlay animate-fade-in">
            <div className="monitoring-content">
              <Upload size={40} className="monitoring-icon" />
              <h3 style={{ fontSize: '1rem', marginBottom: '6px' }}>Ready to Process</h3>
              <p style={{ fontSize: '0.82rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                {feedSource === 'upload'
                  ? 'Click "Select Video" above to load a video file.'
                  : `Source: ${feedSource === 'rtsp' ? 'RTSP' : 'Webcam'} — auto-connecting. Use "Reconnect" if the stream drops.`}
              </p>
              <p style={{ marginTop: '6px', fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center' }}>
                Change source in Settings → Feed Settings.
              </p>
            </div>
          </div>
        )}

        <video ref={videoRef} playsInline muted loop={isLooping}
          style={{ display: (isMonitoring && !isRTSP) ? 'block' : 'none' }} />
        <img ref={imageRef}
          src={isRTSP ? `${_API}/video-feed` : 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7'}
          alt="RTSP" crossOrigin="anonymous"
          style={{ display: (isMonitoring && isRTSP) ? 'block' : 'none', width: '100%', height: 'auto', background: '#000', borderRadius: '12px' }}
        />

        <canvas ref={canvasRef} className="overlay"
          style={{ display: isMonitoring ? 'block' : 'none', pointerEvents: 'auto' }}
          onMouseDown={onMouseDown} onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}    onMouseLeave={onMouseUp}
        />

        {isMonitoring && !isRTSP && !isVideoPlaying && (
          <div style={{
            position: 'absolute', top: 15, left: '50%', transform: 'translateX(-50%)',
            background: 'rgba(0,0,0,0.9)', padding: '10px 16px', borderRadius: '10px', zIndex: 20,
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px',
            border: '1px dashed var(--accent-color)', width: 'auto', maxWidth: '280px',
          }}>
            <div style={{ color: 'white', fontWeight: 900, fontSize: '0.72rem', letterSpacing: '0.05em' }}>
              CALIBRATION MODE
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.65rem', textAlign: 'center', lineHeight: 1.3 }}>
              Drag the tripwire lines on camera to align with entry/exit points.
            </div>
            <button
              onClick={() => { if (videoRef.current) videoRef.current.play(); setIsVideoPlaying(true); }}
              style={{ padding: '5px 16px', background: 'var(--accent-color)', color: '#000', fontWeight: 800, borderRadius: '4px', border: 'none', cursor: 'pointer', marginTop: '4px', fontSize: '0.7rem' }}
            >
              Start Analysis ▶
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
