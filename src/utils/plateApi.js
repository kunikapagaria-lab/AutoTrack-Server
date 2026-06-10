const _API = import.meta.env.VITE_API_URL || 'http://localhost:8000';

// Sends a captured frame to the backend plate detector. cx/cy (if provided)
// hint which plate to pick when more than one is visible in the frame.
export async function fetchPlate(imageDataUrl, cx, cy) {
  try {
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
    if (cx != null) fd.append('cx', String(cx));
    if (cy != null) fd.append('cy', String(cy));
    const token = localStorage.getItem('autotrack_access_token') || '';
    const r = await fetch(`${_API}/detect-plate`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: fd,
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}
