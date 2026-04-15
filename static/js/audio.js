// ── Audio track management & visualization ────────────────────────────────────

function setupTrackAudioEls() {
  audioTrackEls.forEach(a => { a.pause(); try { a.remove(); } catch {} });
  audioTrackEls = [];
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
  analyserNodes = []; gainNodes = [];

  if (!videoEl || !audioTracks.length || !filename) return;

  videoEl.muted = true;

  try {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  } catch (e) {
    console.warn('Web Audio not available:', e);
    return;
  }

  audioTracks.forEach((t) => {
    const a = document.createElement('audio');
    a.src = `${API}/audio_track/${filename}/${t.idx}`;
    a.preload = 'auto';
    a.style.display = 'none';
    a.muted = t.muted;
    document.body.appendChild(a);
    audioTrackEls.push(a);

    try {
      const src  = audioCtx.createMediaElementSource(a);
      const gain = audioCtx.createGain();
      const an   = audioCtx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.75;
      gain.gain.value = t.muted ? 0 : 1;
      src.connect(gain);
      gain.connect(an);
      an.connect(audioCtx.destination);
      gainNodes.push(gain);
      analyserNodes.push(an);
    } catch (e) {
      gainNodes.push(null);
      analyserNodes.push(null);
      console.warn('Could not create Web Audio node for track', t.idx, e);
    }
  });

  videoEl.addEventListener('play',    syncTrackEls);
  videoEl.addEventListener('pause',   syncTrackEls);
  videoEl.addEventListener('seeked',  syncTrackEls);
  videoEl.addEventListener('ratechange', () => {
    audioTrackEls.forEach(a => { a.playbackRate = videoEl.playbackRate; });
  });
}

function syncTrackEls() {
  if (!videoEl) return;
  audioTrackEls.forEach((a, i) => {
    const t = audioTracks[i];
    const shouldPlay = !videoEl.paused && t && !t.muted;
    if (Math.abs(a.currentTime - videoEl.currentTime) > 0.15) {
      a.currentTime = videoEl.currentTime;
    }
    if (shouldPlay) {
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
      a.play().catch(() => {});
    } else {
      a.pause();
    }
  });
}

// ── Per-audio-track drag state ───────────────────────────────────────────────
let _audioBarDrag = null;
// { trackIdx, mode:'left'|'right', startX, origTrim, containerEl, barEl }

(function _initAudioBarDrag() {
  window.addEventListener('mousemove', e => {
    if (!_audioBarDrag || !videoEl || !videoEl.duration) return;
    const { trackIdx, mode, startX, origTrim, containerEl, barEl } = _audioBarDrag;
    const t = audioTracks[trackIdx];
    if (!t) return;

    const dur    = videoEl.duration;
    const rect   = containerEl.getBoundingClientRect();
    const deltaX = e.clientX - startX;
    const deltaFrac = deltaX / rect.width;
    const deltaTime = (deltaFrac / tlZoom) * dur;
    const MIN_DUR = 0.1;

    if (mode === 'left') {
      t.trimStart = Math.max(0, Math.min((t.trimEnd ?? dur) - MIN_DUR, origTrim + deltaTime));
    } else {
      t.trimEnd = Math.max((t.trimStart ?? 0) + MIN_DUR, Math.min(dur, origTrim + deltaTime));
    }
    if (typeof renderAudioLanes === 'function') renderAudioLanes();
  });

  window.addEventListener('mouseup', () => { _audioBarDrag = null; });
})();

function renderAudioTracks() {
  const bar = document.getElementById('audio-tracks-bar');
  if (typeof updateCaptionTrackSelector === 'function') updateCaptionTrackSelector();
  if (!audioTracks.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.innerHTML = '';
  vizCanvases = [];

  const TRACK_COLORS = [
    ['rgba(0,245,160,', '#00f5a0'],
    ['rgba(59,158,255,', '#3B9EFF'],
    ['rgba(255,214,10,', '#FFD60A'],
    ['rgba(255,107,53,', '#FF6B35'],
    ['rgba(199,125,255,', '#C77DFF'],
    ['rgba(255,77,109,',  '#FF4D6D'],
  ];

  audioTracks.forEach((t, i) => {
    const [rgba, hex] = TRACK_COLORS[i % TRACK_COLORS.length];

    const row = document.createElement('div');
    row.className = 'tl-row tl-row-audio';

    // Label column: color dot + track name (click to mute)
    const lbl = document.createElement('div');
    lbl.className = 'tl-row-label';
    const dot = document.createElement('span');
    dot.className = 'tl-lane-dot';
    dot.style.background = t.muted ? '#555' : hex;
    dot.style.flexShrink = '0';
    const muteBtn = document.createElement('span');
    muteBtn.className = 'tl-audio-mute-btn';
    muteBtn.textContent = t.label || ('Audio ' + (i + 1));
    muteBtn.style.opacity = t.muted ? '0.4' : '1';
    muteBtn.title = (t.codec || '') + ' ' + t.channels + 'ch — click to ' + (t.muted ? 'unmute' : 'mute');
    muteBtn.addEventListener('click', e => { e.stopPropagation(); toggleAudioTrackMute(t.idx); });
    lbl.appendChild(dot);
    lbl.appendChild(muteBtn);

    // Content column: relative container for the time-positioned bar
    const content = document.createElement('div');
    content.className = 'tl-row-content tl-audio-track-wrap';
    content.dataset.audioIdx = i;

    // Full-duration background
    const bg = document.createElement('div');
    bg.className = 'tl-video-bg';
    bg.style.background = rgba + '0.06)';
    bg.style.borderColor = rgba + '0.15)';

    // Active trim bar with handles
    const trackBar = document.createElement('div');
    trackBar.className = 'tl-audio-bar' + (t.muted ? ' muted' : '');
    trackBar.dataset.audioIdx = i;
    trackBar.style.background = rgba + (t.muted ? '0.12)' : '0.25)');
    trackBar.style.borderColor = rgba + (t.muted ? '0.2)' : '0.6)');
    trackBar.style.setProperty('--bar-color', rgba + '0.5)');

    // Left handle
    const hl = document.createElement('div');
    hl.className = 'tl-bar-handle tl-bar-handle-l';
    hl.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      _audioBarDrag = {
        trackIdx: i, mode: 'left', startX: e.clientX,
        origTrim: t.trimStart ?? 0,
        containerEl: content, barEl: trackBar
      };
    });

    // Body (click to toggle mute)
    const body = document.createElement('div');
    body.className = 'tl-bar-body';
    body.style.cursor = 'default';

    // Realtime viz canvas overlaid on bar
    const cv = document.createElement('canvas');
    cv.className = 'audio-viz-canvas';
    cv.dataset.track = i;
    vizCanvases.push(cv);
    body.appendChild(cv);

    // Right handle
    const hr = document.createElement('div');
    hr.className = 'tl-bar-handle tl-bar-handle-r';
    hr.addEventListener('mousedown', e => {
      e.preventDefault(); e.stopPropagation();
      _audioBarDrag = {
        trackIdx: i, mode: 'right', startX: e.clientX,
        origTrim: t.trimEnd ?? (videoEl ? videoEl.duration : 0),
        containerEl: content, barEl: trackBar
      };
    });

    trackBar.appendChild(hl);
    trackBar.appendChild(body);
    trackBar.appendChild(hr);
    content.appendChild(bg);
    content.appendChild(trackBar);
    row.appendChild(lbl);
    row.appendChild(content);
    bar.appendChild(row);
  });

  renderAudioLanes();
}

// Reposition all audio bars using current zoom/offset and per-track trim
function renderAudioLanes() {
  if (!videoEl || !videoEl.duration) return;
  const dur = videoEl.duration;
  document.querySelectorAll('.tl-audio-bar').forEach(bar => {
    const i = parseInt(bar.dataset.audioIdx ?? 0);
    const t = audioTracks[i];
    if (!t) return;
    const tStart   = t.trimStart ?? 0;
    const tEnd     = t.trimEnd   ?? dur;
    const leftPct  = Math.max(0,   tlTimeToLeft(tStart));
    const rightPct = Math.min(100, tlTimeToLeft(tEnd));
    const widthPct = Math.max(0,   rightPct - leftPct);
    bar.style.left  = leftPct  + '%';
    bar.style.width = widthPct + '%';
  });
}
function toggleAudioTrackMute(idx) {
  const t = audioTracks.find(t => t.idx === idx);
  if (!t) return;
  t.muted = !t.muted;
  const i = audioTracks.indexOf(t);
  if (audioTrackEls[i]) audioTrackEls[i].muted = t.muted;
  if (gainNodes[i])     gainNodes[i].gain.value = t.muted ? 0 : 1;
  if (!t.muted && videoEl && !videoEl.paused) {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    if (audioTrackEls[i]) {
      audioTrackEls[i].currentTime = videoEl.currentTime;
      audioTrackEls[i].play().catch(() => {});
    }
  }
  if (t.muted && audioTrackEls[i]) audioTrackEls[i].pause();
  renderAudioTracks();
  toast(t.muted ? `"${t.label}" muted` : `"${t.label}" unmuted`);
}

function applyAudioTrackMuting() {
  audioTracks.forEach((t, i) => {
    if (audioTrackEls[i]) audioTrackEls[i].muted = t.muted;
    if (gainNodes[i])     gainNodes[i].gain.value = t.muted ? 0 : 1;
  });
}

function drawAudioViz() {
  if (!audioCtx || !analyserNodes.length || !vizCanvases.length) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();

  const isPlaying = videoEl && !videoEl.paused;

  vizCanvases.forEach((cv, i) => {
    if (!cv.isConnected) return;
    const an = analyserNodes[i];
    if (!an) return;

    const dpr = window.devicePixelRatio || 1;
    const w = cv.clientWidth, h = cv.clientHeight;
    if (w < 4 || h < 4) return;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width  = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    const ctx2 = cv.getContext('2d');
    ctx2.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx2.clearRect(0, 0, w, h);

    const t = audioTracks[i];
    const isMuted = t && t.muted;
    const barColor  = isMuted ? 'rgba(255,80,80,0.45)' : 'rgba(0,245,160,0.75)';
    const glowColor = isMuted ? 'rgba(255,80,80,0.1)'  : 'rgba(0,245,160,0.08)';

    const buf = new Uint8Array(an.frequencyBinCount);
    if (isPlaying && !isMuted) {
      an.getByteFrequencyData(buf);
    } else {
      buf.fill(0);
    }

    ctx2.fillStyle = glowColor;
    ctx2.fillRect(0, 0, w, h);

    const barW = w / buf.length;
    for (let b = 0; b < buf.length; b++) {
      const barH = (buf[b] / 255) * h;
      ctx2.fillStyle = barColor;
      ctx2.fillRect(b * barW, h - barH, Math.max(1, barW - 1), barH);
    }

    if (!isPlaying || isMuted) {
      ctx2.fillStyle = isMuted ? 'rgba(255,80,80,0.3)' : 'rgba(0,245,160,0.18)';
      ctx2.fillRect(0, Math.floor(h / 2) - 1, w, 2);
    }
  });
}
