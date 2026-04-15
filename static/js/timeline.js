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

// Allow double-clicking the resize bar to reset to auto-height
document.addEventListener('DOMContentLoaded', () => {
  const _rb = document.getElementById('tl-resize-bar');
  const _sc = document.getElementById('timeline-section');
  if (_rb && _sc) {
    _rb.addEventListener('dblclick', () => {
      _sc.dataset.manualHeight = '';
      updateTimelineHeight();
    });
  }
});

// tl-track is hidden (display:none) — no events fire on it.
// Wheel zoom is wired to tl-tracks-area in DOMContentLoaded below.

// ── Timeline auto-height based on track count ────────────────────────────────
const TL_VIDEO_ROW_H   = 56;  // px — video row
const TL_AUDIO_ROW_H   = 32;  // px — per audio track row
const TL_CAPTION_ROW_H = 30;  // px — per caption lane
const TL_RESIZE_BAR_H  = 4;   // px — drag handle
const TL_BASE_PAD      = 8;   // px — top/bottom breathing room inside tl-body

function updateTimelineHeight() {
  const section = document.getElementById('timeline-section');
  if (!section) return;
  // Don't override a user-manual resize that set an explicit style height
  // We detect manual override by checking the data attribute we set on drag.
  if (section.dataset.manualHeight === '1') return;

  const audioRowCount   = document.querySelectorAll('.tl-row-audio').length;
  const captionRowCount = document.querySelectorAll('.tl-caption-lane').length;

  const bodyH = TL_BASE_PAD
    + TL_VIDEO_ROW_H
    + audioRowCount   * TL_AUDIO_ROW_H
    + captionRowCount * TL_CAPTION_ROW_H;

  const totalH = TL_RESIZE_BAR_H + bodyH;
  const clamped = Math.max(80, Math.min(520, totalH));
  section.style.height = clamped + 'px';
}

// ── Timeline section vertical resize ─────────────────────────────────────────
let _tlSectionResizing  = false;
let _tlSectionResizeStartY = 0;
let _tlSectionResizeStartH = 0;

// ── Middle-mouse pan state ────────────────────────────────────────────────────
let _tlMmPanning    = false;
let _tlMmPanStartX  = 0;
let _tlMmPanStartOff = 0;

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
      const newH = Math.max(80, Math.min(520, _tlSectionResizeStartH + delta));
      section.style.height = newH + 'px';
      section.dataset.manualHeight = '1'; // user has taken manual control
    });
    window.addEventListener('mouseup', () => {
      if (_tlSectionResizing) {
        _tlSectionResizing = false;
        resizeBar.classList.remove('active');
      }
    });
  }

  // ── Middle-mouse pan ───────────────────────────────────────────────────────
  if (tracksArea) {
    // prevent the default middle-click scroll/autoscroll behaviour
    tracksArea.addEventListener('mousedown', e => {
      if (e.button !== 1) return;
      if (!videoEl || !videoEl.duration || tlZoom <= 1) return;
      e.preventDefault();
      _tlMmPanning     = true;
      _tlMmPanStartX   = e.clientX;
      _tlMmPanStartOff = tlOffset;
      tracksArea.classList.add('tl-panning');
    });

    // also swallow the middle-click context menu that some OSes show
    tracksArea.addEventListener('auxclick', e => {
      if (e.button === 1) e.preventDefault();
    });
  }

  window.addEventListener('mousemove', e => {
    if (!_tlMmPanning || !videoEl || !videoEl.duration) return;
    const r       = (document.getElementById('tl-video-wrap') || tracksArea).getBoundingClientRect();
    const deltaX  = e.clientX - _tlMmPanStartX;
    const deltaFrac = deltaX / r.width;        // positive = dragged right = earlier in timeline
    tlOffset = _tlMmPanStartOff - deltaFrac / tlZoom;
    tlClampOffset();
    updateTL();
    renderCaptionLanes();
    if (typeof renderAudioLanes === 'function') renderAudioLanes();
  });

  window.addEventListener('mouseup', e => {
    if (e.button === 1 && _tlMmPanning) {
      _tlMmPanning = false;
      const ta = document.getElementById('tl-tracks-area');
      if (ta) ta.classList.remove('tl-panning');
    }
  });
});
