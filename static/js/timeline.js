// ── Timeline controls ─────────────────────────────────────────────────────────

// tlZoom and tlOffset are declared in state.js
// tlZoom: magnification (1 = full video, 40 = max zoom)
// tlOffset: visible window start as fraction of total duration

function tlClampOffset() {
  tlOffset = Math.max(0, Math.min(1 - 1 / tlZoom, tlOffset));
}

// Convert a time (seconds) → left% within the visible window
function tlTimeToLeft(t) {
  if (!videoEl || !videoEl.duration) return 0;
  return ((t / videoEl.duration) - tlOffset) * tlZoom * 100;
}

// Convert a clientX pixel → time (seconds) accounting for zoom/pan
function tlClientToTime(clientX) {
  if (!videoEl) return 0;
  const r   = tlTrack.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  return (tlOffset + frac / tlZoom) * videoEl.duration;
}

// Keep playhead visible while playing — pan if it would go off screen
function tlAutoScroll() {
  if (!videoEl || tlZoom <= 1) return;
  const frac = videoEl.currentTime / videoEl.duration;
  const visEnd = tlOffset + 1 / tlZoom;
  const margin = 0.05 / tlZoom; // 5% of visible window as edge margin
  if (frac > visEnd - margin) {
    tlOffset = frac - (1 / tlZoom) + margin;
    tlClampOffset();
  } else if (frac < tlOffset + margin) {
    tlOffset = frac - margin;
    tlClampOffset();
  }
}

function updateTL() {
  if (!videoEl || isNaN(videoEl.duration)) return;
  const dur = videoEl.duration;

  tlAutoScroll();

  const inPct   = tlTimeToLeft(trimStart);
  const outPct  = tlTimeToLeft(trimEnd ?? dur);
  const headPct = tlTimeToLeft(videoEl.currentTime);

  document.getElementById('tl-mask-l').style.cssText  = `left:0;width:${inPct}%`;
  document.getElementById('tl-mask-r').style.cssText  = `right:0;width:${100 - outPct}%`;
  document.getElementById('tl-active').style.cssText  = `left:${inPct}%;width:${outPct - inPct}%`;
  document.getElementById('tl-h-in').style.left       = inPct + '%';
  document.getElementById('tl-h-out').style.left      = outPct + '%';
  document.getElementById('tl-head').style.left       = headPct + '%';

  document.getElementById('tl-in-lbl').textContent   = fmt(trimStart);
  document.getElementById('tl-out-lbl').textContent  = fmt(trimEnd ?? dur);
  document.getElementById('tl-clip-dur').textContent = 'clip: ' + fmt((trimEnd ?? dur) - trimStart);
  document.getElementById('time-current').textContent = fmt(videoEl.currentTime);

  updateZoomUI();
}

function updateZoomUI() {
  const zoomEl = document.getElementById('tl-zoom-label');
  const resetEl = document.getElementById('tl-zoom-reset');
  if (zoomEl)  zoomEl.textContent = tlZoom <= 1 ? '' : `${tlZoom.toFixed(1)}×`;
  if (resetEl) resetEl.style.display = tlZoom > 1 ? 'flex' : 'none';
}

// ── Zoom helpers ──────────────────────────────────────────────────────────────
function tlZoomAt(newZoom, cursorFrac) {
  // cursorFrac: 0-1 position within the visible window to zoom toward
  const oldZoom = tlZoom;
  tlZoom = Math.max(1, Math.min(40, newZoom));
  // Adjust offset so the point under the cursor stays fixed
  const cursorTime = (tlOffset + cursorFrac / oldZoom); // fraction of total duration
  tlOffset = cursorTime - cursorFrac / tlZoom;
  tlClampOffset();
  updateTL();
  renderCaptionLanes();
}

function tlZoomReset() {
  tlZoom = 1; tlOffset = 0;
  updateTL();
  renderCaptionLanes();
}

// ── Scroll wheel zoom ─────────────────────────────────────────────────────────
tlTrack.addEventListener('wheel', e => {
  if (!videoEl || !videoEl.duration) return;
  e.preventDefault();
  const r    = tlTrack.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); // cursor pos 0-1
  const delta = e.deltaY < 0 ? 1.18 : 1 / 1.18;
  tlZoomAt(tlZoom * delta, frac);
}, { passive: false });

// ── Mousedown: hit-test handles then seek ────────────────────────────────────
tlTrack.addEventListener('mousedown', e => {
  if (!videoEl || !videoEl.duration) return;
  e.preventDefault(); e.stopPropagation();
  const r   = tlTrack.getBoundingClientRect();
  const mx  = e.clientX - r.left;
  const dur = videoEl.duration;

  // Convert handle times to pixel positions within the current view
  const inX   = (tlTimeToLeft(trimStart)           / 100) * r.width;
  const outX  = (tlTimeToLeft(trimEnd ?? dur)       / 100) * r.width;
  const headX = (tlTimeToLeft(videoEl.currentTime)  / 100) * r.width;
  const HP = 12;

  if (Math.abs(mx - inX) <= HP)        tlDragging = 'in';
  else if (Math.abs(mx - outX) <= HP)  tlDragging = 'out';
  else if (Math.abs(mx - headX) <= HP) tlDragging = 'head';
  else {
    tlDragging = 'head';
    const t = tlClientToTime(e.clientX);
    videoEl.currentTime = Math.max(trimStart, Math.min(trimEnd ?? dur, t));
  }
});
