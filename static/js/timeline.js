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

// Convert a clientX pixel → time (seconds) using the video wrap as reference
function tlClientToTime(clientX) {
  if (!videoEl) return 0;
  const wrap = document.getElementById('tl-video-wrap') ||
               document.getElementById('tl-tracks-area');
  if (!wrap) return 0;
  const r    = wrap.getBoundingClientRect();
  const frac = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
  return (tlOffset + frac / tlZoom) * videoEl.duration;
}

// Keep playhead visible while playing — pan if it goes off screen
function tlAutoScroll() {
  if (!videoEl || tlZoom <= 1) return;
  const frac   = videoEl.currentTime / videoEl.duration;
  const visEnd = tlOffset + 1 / tlZoom;
  const margin = 0.05 / tlZoom;
  if (frac > visEnd - margin) {
    tlOffset = frac - (1 / tlZoom) + margin;
    tlClampOffset();
  } else if (frac < tlOffset + margin) {
    tlOffset = frac - margin;
    tlClampOffset();
  }
}

// ── Render the video trim bar ─────────────────────────────────────────────────
function renderVideoBar() {
  const wrap = document.getElementById('tl-video-wrap');
  const bar  = document.getElementById('tl-video-bar');
  if (!wrap || !bar || !videoEl || !videoEl.duration) return;
  const dur      = videoEl.duration;
  const leftPct  = Math.max(0,   tlTimeToLeft(trimStart));
  const rightPct = Math.min(100, tlTimeToLeft(trimEnd ?? dur));
  const widthPct = Math.max(0,   rightPct - leftPct);
  bar.style.left  = leftPct  + '%';
  bar.style.width = widthPct + '%';
}

// ── Main timeline update (called every animation frame) ───────────────────────
function updateTL() {
  if (!videoEl || isNaN(videoEl.duration)) return;

  tlAutoScroll();

  const headPct = tlTimeToLeft(videoEl.currentTime);

  // Full-height scrub line across all rows
  const tracksArea = document.getElementById('tl-tracks-area');
  if (tracksArea) tracksArea.style.setProperty('--tl-head-pct', headPct);

  // Video bar
  renderVideoBar();

  // Audio lanes (reposition bars on every frame — cheap CSS set)
  if (typeof renderAudioLanes === 'function') renderAudioLanes();

  // Info labels
  const dur = videoEl.duration;
  document.getElementById('tl-in-lbl').textContent    = fmt(trimStart);
  document.getElementById('tl-out-lbl').textContent   = fmt(trimEnd ?? dur);
  document.getElementById('tl-clip-dur').textContent  = 'clip: ' + fmt((trimEnd ?? dur) - trimStart);
  document.getElementById('time-current').textContent = fmt(videoEl.currentTime);

  updateZoomUI();
}

function updateZoomUI() {
  const zoomEl  = document.getElementById('tl-zoom-label');
  const resetEl = document.getElementById('tl-zoom-reset');
  if (zoomEl)  zoomEl.textContent  = tlZoom <= 1 ? '' : tlZoom.toFixed(1) + '\u00d7';
  if (resetEl) resetEl.style.display = tlZoom > 1 ? 'flex' : 'none';
}

// ── Zoom helpers ──────────────────────────────────────────────────────────────
function tlZoomAt(newZoom, cursorFrac) {
  const oldZoom   = tlZoom;
  tlZoom          = Math.max(1, Math.min(40, newZoom));
  const cursorTime = tlOffset + cursorFrac / oldZoom;
  tlOffset        = cursorTime - cursorFrac / tlZoom;
  tlClampOffset();
  updateTL();
  renderCaptionLanes();
  if (typeof renderAudioLanes === 'function') renderAudioLanes();
}

function tlZoomReset() {
  tlZoom = 1; tlOffset = 0;
  updateTL();
  renderCaptionLanes();
  if (typeof renderAudioLanes === 'function') renderAudioLanes();
}

// tl-track is hidden (display:none) — no events fire on it.
// Wheel zoom is wired to tl-tracks-area in DOMContentLoaded below.

// ── Timeline section vertical resize ─────────────────────────────────────────
let _tlSectionResizing  = false;
let _tlSectionResizeStartY = 0;
let _tlSectionResizeStartH = 0;

// ── All new event wiring — runs after DOM is ready ────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const tracksArea  = document.getElementById('tl-tracks-area');
  const videoWrap   = document.getElementById('tl-video-wrap');
  const videoBg     = document.getElementById('tl-video-bg');
  const videoBar    = document.getElementById('tl-video-bar');
  const barBody     = document.getElementById('tl-bar-body');
  const handleIn    = document.getElementById('tl-h-in');
  const handleOut   = document.getElementById('tl-h-out');
  const resizeBar   = document.getElementById('tl-resize-bar');
  const section     = document.getElementById('timeline-section');

  // ── Zoom on the whole tracks area (scroll anywhere) ───────────────────────
  if (tracksArea) {
    tracksArea.addEventListener('wheel', e => {
      if (!videoEl || !videoEl.duration) return;
      e.preventDefault();
      const r    = (videoWrap || tracksArea).getBoundingClientRect();
      const frac = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      const delta = e.deltaY < 0 ? 1.18 : 1 / 1.18;
      tlZoomAt(tlZoom * delta, frac);
    }, { passive: false });
  }

  // ── Video in-handle ───────────────────────────────────────────────────────
  if (handleIn) {
    handleIn.addEventListener('mousedown', e => {
      if (!videoEl) return;
      e.preventDefault(); e.stopPropagation();
      tlDragging = 'in';
    });
  }

  // ── Video out-handle ──────────────────────────────────────────────────────
  if (handleOut) {
    handleOut.addEventListener('mousedown', e => {
      if (!videoEl) return;
      e.preventDefault(); e.stopPropagation();
      tlDragging = 'out';
    });
  }

  // ── Video background: click/drag to seek ─────────────────────────────────
  if (videoBg) {
    videoBg.addEventListener('mousedown', e => {
      if (!videoEl || !videoEl.duration) return;
      e.preventDefault();
      tlDragging = 'head';
      const t = tlClientToTime(e.clientX);
      videoEl.currentTime = Math.max(trimStart, Math.min(trimEnd ?? videoEl.duration, t));
    });
  }

  // ── Video bar body: seek within clip ─────────────────────────────────────
  if (barBody) {
    barBody.addEventListener('mousedown', e => {
      if (!videoEl || !videoEl.duration) return;
      e.preventDefault(); e.stopPropagation();
      tlDragging = 'head';
      const t = tlClientToTime(e.clientX);
      videoEl.currentTime = Math.max(trimStart, Math.min(trimEnd ?? videoEl.duration, t));
    });
  }

  // ── Timeline section vertical resize ─────────────────────────────────────
  if (resizeBar && section) {
    resizeBar.addEventListener('mousedown', e => {
      _tlSectionResizing    = true;
      _tlSectionResizeStartY = e.clientY;
      _tlSectionResizeStartH = section.getBoundingClientRect().height;
      resizeBar.classList.add('active');
      e.preventDefault();
    });
    window.addEventListener('mousemove', e => {
      if (!_tlSectionResizing) return;
      const delta = _tlSectionResizeStartY - e.clientY;
      section.style.height = Math.max(80, Math.min(480, _tlSectionResizeStartH + delta)) + 'px';
    });
    window.addEventListener('mouseup', () => {
      if (_tlSectionResizing) {
        _tlSectionResizing = false;
        resizeBar.classList.remove('active');
      }
    });
  }
});
