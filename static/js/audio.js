// ── Audio track management & visualization ────────────────────────────────────

function setupTrackAudioEls() {
  audioTrackEls.forEach(a => { a.pause(); try { a.remove(); } catch {} });
  audioTrackEls = [];
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
  analyserNodes = []; gainNodes = []; vizCanvases = [];

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

function renderAudioTracks() {
  const bar = document.getElementById('audio-tracks-bar');
  if (!audioTracks.length) { bar.classList.add('hidden'); return; }
  bar.classList.remove('hidden');
  bar.innerHTML = '';
  vizCanvases = [];

  const chipRow = document.createElement('div');
  chipRow.className = 'audio-tracks-row';
  const lbl = document.createElement('span');
  lbl.className = 'audio-tracks-label';
  lbl.textContent = 'Audio';
  chipRow.appendChild(lbl);

  audioTracks.forEach(t => {
    const chip = document.createElement('div');
    chip.className = 'audio-chip' + (t.muted ? ' muted' : '');
    chip.title = `${t.codec} · ${t.channels}ch${t.layout ? ' · ' + t.layout : ''}\nClick to ${t.muted ? 'unmute' : 'mute'}`;
    chip.innerHTML = `<span class="audio-chip-icon">${t.muted ? '🔇' : '🔊'}</span>${t.label}`;
    chip.addEventListener('click', () => toggleAudioTrackMute(t.idx));
    chipRow.appendChild(chip);
  });
  bar.appendChild(chipRow);

  const vizWrapper = document.createElement('div');
  vizWrapper.className = 'audio-viz-rows';

  audioTracks.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'audio-viz-row';
    const rowLbl = document.createElement('span');
    rowLbl.className = 'audio-viz-label';
    rowLbl.textContent = t.label;
    rowLbl.style.color = t.muted ? 'rgba(255,80,80,0.5)' : 'var(--text-dim)';
    const cv = document.createElement('canvas');
    cv.className = 'audio-viz-canvas';
    cv.dataset.track = i;
    vizCanvases.push(cv);
    row.appendChild(rowLbl); row.appendChild(cv);
    vizWrapper.appendChild(row);
  });
  bar.appendChild(vizWrapper);
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
