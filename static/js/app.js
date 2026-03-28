// ── Application initialization & file handling ────────────────────────────────

// ── Reset ─────────────────────────────────────────────────────────────────────
function resetToStart() {
  if (videoEl) { videoEl.pause(); videoEl.remove(); videoEl = null; }
  filename = null; videoInfo = { width: 1, height: 1, duration: 0 };
  zones = []; selectedZoneId = null; colorIdx = 0;
  trimStart = 0; trimEnd = null; tlDragging = null;
  undoStack = [];
  lastExportedFile = null;
  audioTracks = [];
  audioTrackEls.forEach(a => { a.pause(); try { a.remove(); } catch {} });
  audioTrackEls = [];
  if (audioCtx) { try { audioCtx.close(); } catch {} audioCtx = null; }
  analyserNodes = []; gainNodes = []; vizCanvases = [];
  renderAudioTracks();
  if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
  if (exportPollTimer) { clearInterval(exportPollTimer); exportPollTimer = null; }
  document.getElementById('editor-area').style.display = 'none';
  document.getElementById('drop-zone').style.display = 'flex';
  document.getElementById('file-info-label').textContent = '';
  document.getElementById('header-res').style.display = 'none';
  document.getElementById('outline-toggle-btn').style.display = 'none';
  document.getElementById('new-video-btn').style.display = 'none';
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
}

// ── Preset modal event listeners ──────────────────────────────────────────────
document.getElementById('preset-name-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') confirmSavePreset(); if (e.key === 'Escape') closePresetModal();
});
document.getElementById('preset-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closePresetModal(); });

// ── SHARE / UPLOAD ────────────────────────────────────────────────────────────
let lastExportedFile  = null;
let credsModalPlatform = null;
let authPollTimer      = null;

async function refreshShareStatus() {
  try {
    const d = await (await fetch(`${API}/auth/status`)).json();
    // YouTube
    const ytDot = document.getElementById('yt-dot');
    const ytCon = document.getElementById('yt-connect-btn');
    const ytUp  = document.getElementById('yt-upload-btn');
    if (d.youtube_connected) {
      ytDot.className = 'share-dot on';
      ytCon.textContent = 'Disconnect'; ytCon.className = 'share-connect-btn off';
      ytCon.onclick = () => disconnectPlatform('youtube');
      ytUp.disabled = !lastExportedFile;
    } else {
      ytDot.className = 'share-dot';
      ytCon.textContent = 'Connect'; ytCon.className = 'share-connect-btn';
      ytCon.onclick = () => connectPlatform('youtube');
      ytUp.disabled = true;
    }
    // TikTok
    const ttDot = document.getElementById('tt-dot');
    const ttCon = document.getElementById('tt-connect-btn');
    const ttUp  = document.getElementById('tt-upload-btn');
    if (d.tiktok_connected) {
      ttDot.className = 'share-dot on';
      ttCon.textContent = 'Disconnect'; ttCon.className = 'share-connect-btn off';
      ttCon.onclick = () => disconnectPlatform('tiktok');
      ttUp.disabled = !lastExportedFile;
    } else {
      ttDot.className = 'share-dot';
      ttCon.textContent = 'Connect'; ttCon.className = 'share-connect-btn';
      ttCon.onclick = () => connectPlatform('tiktok');
      ttUp.disabled = true;
    }
  } catch {}
}

function connectPlatform(platform) { openCredsModal(platform); }

function openCredsModal(platform) {
  credsModalPlatform = platform;
  const isYT = platform === 'youtube';
  document.getElementById('creds-title').textContent = isYT ? 'Connect YouTube' : 'Connect TikTok';
  document.getElementById('creds-desc').innerHTML = isYT
    ? `Enter your Google OAuth 2.0 Client ID &amp; Secret.<br><a onclick="window.open('https://console.cloud.google.com/apis/credentials','_blank')">Get credentials at Google Cloud Console →</a>`
    : `Enter your TikTok App Client Key &amp; Client Secret.<br><a onclick="window.open('https://developers.tiktok.com/apps/','_blank')">Get credentials at TikTok for Developers →</a>`;
  document.getElementById('creds-id').value = '';
  document.getElementById('creds-secret').value = '';
  document.getElementById('creds-modal').classList.add('show');
  setTimeout(() => document.getElementById('creds-id').focus(), 80);
}
function closeCredsModal() {
  document.getElementById('creds-modal').classList.remove('show');
  credsModalPlatform = null;
}

async function saveCredsAndConnect() {
  const client_id     = document.getElementById('creds-id').value.trim();
  const client_secret = document.getElementById('creds-secret').value.trim();
  if (!client_id || !client_secret) return toast('Enter both Client ID and Secret');
  const platform = credsModalPlatform;
  closeCredsModal();
  await fetch(`${API}/auth/config`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform, client_id, client_secret }) });
  try {
    const r = await fetch(`${API}/auth/${platform}/start`);
    const d = await r.json();
    if (d.error) return toast('Error: ' + d.error);
    window.open(d.url, '_blank');
    toast(`Sign in to ${platform === 'youtube' ? 'Google' : 'TikTok'} in your browser, then return here`);
    if (authPollTimer) clearInterval(authPollTimer);
    authPollTimer = setInterval(async () => {
      try {
        const s = await (await fetch(`${API}/auth/status`)).json();
        if (s[platform + '_connected']) {
          clearInterval(authPollTimer); authPollTimer = null;
          refreshShareStatus();
          toast(`${platform === 'youtube' ? 'YouTube' : 'TikTok'} connected! ✓`);
        }
      } catch {}
    }, 2000);
  } catch (e) { toast('Auth error: ' + e.message); }
}

async function disconnectPlatform(platform) {
  await fetch(`${API}/auth/disconnect/${platform}`, { method: 'DELETE' });
  refreshShareStatus();
  toast(`${platform === 'youtube' ? 'YouTube' : 'TikTok'} disconnected`);
}

async function uploadTo(platform) {
  if (!lastExportedFile) return toast('Export a video first');
  const title   = document.getElementById('share-title-input').value.trim() || 'VertiCut Export #Shorts';
  const statEl  = document.getElementById(platform === 'youtube' ? 'yt-status'     : 'tt-status');
  const upBtn   = document.getElementById(platform === 'youtube' ? 'yt-upload-btn' : 'tt-upload-btn');
  const origTxt = upBtn.textContent;
  upBtn.disabled = true; upBtn.textContent = 'Uploading…';
  statEl.textContent = `Sending to ${platform === 'youtube' ? 'YouTube' : 'TikTok'}…`;
  try {
    const res  = await fetch(`${API}/upload/${platform}`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: lastExportedFile, title }) });
    const data = await res.json();
    if (data.ok) {
      upBtn.textContent = '✓ Uploaded!';
      if (data.url) {
        statEl.innerHTML = `<a style="color:var(--accent);cursor:pointer" onclick="window.open('${data.url}','_blank')">View on ${platform === 'youtube' ? 'YouTube' : 'TikTok'} →</a>`;
      } else { statEl.textContent = 'Upload complete!'; }
      toast('Upload complete!');
      setTimeout(() => { upBtn.textContent = origTxt; upBtn.disabled = false; }, 5000);
    } else {
      upBtn.textContent = origTxt; upBtn.disabled = false;
      statEl.textContent = 'Error: ' + (data.error || 'Unknown');
      toast('Upload failed: ' + (data.error || 'Unknown'));
    }
  } catch (e) {
    upBtn.textContent = origTxt; upBtn.disabled = false;
    statEl.textContent = 'Network error';
    toast('Upload error: ' + e.message);
  }
}

document.getElementById('creds-modal').addEventListener('click', e => { if (e.target === e.currentTarget) closeCredsModal(); });
document.getElementById('creds-id').addEventListener('keydown',     e => { if (e.key === 'Enter') document.getElementById('creds-secret').focus(); });
document.getElementById('creds-secret').addEventListener('keydown', e => { if (e.key === 'Enter') saveCredsAndConnect(); });

refreshShareStatus();

// ── Init ──────────────────────────────────────────────────────────────────────
renderPresetsList();
