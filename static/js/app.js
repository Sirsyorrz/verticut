// ── Application initialization & file handling ────────────────────────────────

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetToStart() {
  if (videoEl) { videoEl.pause(); videoEl.remove(); videoEl = null; }
  filename = null; videoInfo = { width: 1, height: 1, duration: 0 };
  zones = []; selectedZoneId = null; colorIdx = 0;
  trimStart = 0; trimEnd = null; tlDragging = null;
  undoStack = [];
  lastExportedFile = null;
  document.getElementById('play-btn').textContent = '▶';
  document.getElementById('file-input').value = '';
  resetExportUI(document.getElementById('export-btn'), document.getElementById('progress-wrap'));
  renderZonesList();
}

// ── Upload / file handling ────────────────────────────────────────────────────
const dz = document.getElementById('drop-zone');
document.getElementById('file-input').addEventListener('change', e => { if (e.target.files[0]) handleFile(e.target.files[0]); });
dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('drag-over'); });
dz.addEventListener('dragleave', () => dz.classList.remove('drag-over'));
dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('drag-over'); if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]); });

async function handleFile(file) {
  toast('Uploading…');
  const form = new FormData(); form.append('video', file);
  const res = await fetch(`${API}/upload`, { method: 'POST', body: form });
  const data = await res.json();
  if (data.error) return toast('Error: ' + data.error);
  filename = data.filename; videoInfo = data;
  if (videoEl) { videoEl.pause(); videoEl.remove(); }
  videoEl = document.createElement('video');
  videoEl.src = `${API}/video/${data.filename}`;
  videoEl.crossOrigin = 'anonymous'; videoEl.preload = 'auto'; videoEl.style.display = 'none';
  document.body.appendChild(videoEl);
  videoEl.addEventListener('timeupdate', () => {
    if (trimEnd !== null && videoEl.currentTime >= trimEnd) {
      videoEl.pause(); videoEl.currentTime = trimEnd;
      document.getElementById('play-btn').textContent = '▶';
    }
  });
  videoEl.addEventListener('loadedmetadata', () => {
    trimStart = 0; trimEnd = null;
    setupCanvases();
    document.getElementById('time-total').textContent = fmt(videoEl.duration);
    document.getElementById('file-info-label').textContent = `${data.width}×${data.height} · ${fmt(data.duration)}`;
    startLoop();
    addAutoGameplayZone();
    audioTracks = (data.audio_tracks || []).map(t => ({ ...t, muted: false }));
    setupTrackAudioEls();
    renderAudioTracks();
    toast('Auto-added centered 9:16 crop — draw more zones or adjust as needed');
  });
  dz.style.display = 'none';
  document.getElementById('editor-area').style.display = 'flex';
  document.getElementById('header-res').style.display = 'flex';
  document.getElementById('outline-toggle-btn').style.display = '';
  document.getElementById('new-video-btn').style.display = '';
renderPresetsList();
