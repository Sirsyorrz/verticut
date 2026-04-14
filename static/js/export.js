// ── Export & playback ─────────────────────────────────────────────────────────

function togglePlay() {
  if (!videoEl) return;
  if (videoEl.paused) {
    const end = trimEnd ?? videoEl.duration;
    if (videoEl.currentTime >= end - 0.05) videoEl.currentTime = trimStart;
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    videoEl.play(); document.getElementById('play-btn').textContent = '⏸';
  } else {
    videoEl.pause(); document.getElementById('play-btn').textContent = '▶';
  }
}

function getExportW()   { return Math.max(1, parseInt(document.getElementById('out-w').value) || 1080); }
function getExportH()   { return Math.max(1, parseInt(document.getElementById('out-h').value) || 1920); }
function getExportFPS() { return Math.max(1, parseInt(document.getElementById('out-fps').value) || 60); }

async function exportVideo() {
  if (!filename) return toast('Load a video first');
  if (!zones.length) return toast('Draw at least one zone first');
  const expW = getExportW(), expH = getExportH(), expFPS = getExportFPS();

  const saveResult = await window.electronAPI.showSaveDialog({
    title: 'Save exported video',
    defaultPath: `verticut_${expW}x${expH}_${expFPS}fps.mp4`,
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  });
  if (saveResult.canceled || !saveResult.filePath) return;
  const outputPath = saveResult.filePath;

  const scaleX = expW / OUT_W, scaleY = expH / OUT_H;
  const btn = document.getElementById('export-btn'), prog = document.getElementById('progress-wrap');
  const fill = document.getElementById('progress-fill'), pct = document.getElementById('progress-pct');
  const detail = document.getElementById('progress-detail'), timecode = document.getElementById('progress-timecode'), speedEl = document.getElementById('progress-speed');
  btn.disabled = true; prog.classList.add('show');
  fill.classList.add('indeterminate'); fill.style.width = '';
  pct.textContent = '0%'; detail.textContent = 'Sending to server…'; timecode.textContent = ''; speedEl.textContent = '';
  if (exportPollTimer) { clearInterval(exportPollTimer); exportPollTimer = null; }

  const mutedTrackIdxs = audioTracks.filter(t => t.muted).map(t => t.idx);
  const payload = {
    filename, output_path: outputPath, output_width: expW, output_height: expH, output_fps: expFPS,
    trim_start: trimStart > 0 ? trimStart : undefined,
    trim_end: trimEnd !== null ? trimEnd : undefined,
    muted_tracks: mutedTrackIdxs,
    // Caption burn-in — send all tracks with their individual styles
    caption_tracks: (captionStyle.enabled && captionTracks.some(t => t.segments.length))
                      ? captionTracks.filter(t => t.segments.length).map(t => ({
                          segments: t.segments,
                          style: Object.assign({}, captionStyle, t.style || {}),
                        }))
                      : undefined,
    caption_style:  captionStyle.enabled ? captionStyle : undefined,
    zones: zones.filter(z => !z.disabled).map(z => ({
      src_x: z.src.x, src_y: z.src.y, src_w: z.src.w, src_h: z.src.h,
      dst_x: Math.round(z.dst.x * scaleX), dst_y: Math.round(z.dst.y * scaleY),
      dst_w: Math.max(1, Math.round(z.dst.w * scaleX)), dst_h: Math.max(1, Math.round(z.dst.h * scaleY)),
      label: z.label, blur: z.blur || 0, feather: z.feather || 0,
      shape: z.shape || 'rect',
      // Polygon points normalized 0-1 relative to src bbox (future server-side use)
      ...(z.shape === 'polygon' && z.points && z.src.w > 0 && z.src.h > 0 ? {
        points: z.points.map(p => ({
          x: (p.x - z.src.x) / z.src.w,
          y: (p.y - z.src.y) / z.src.h
        }))
      } : {})
    }))
  };
  let jobId;
  try {
    const res = await fetch(`${API}/process`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const data = await res.json();
    if (data.error) { resetExportUI(btn, prog); return toast('Error: ' + data.error); }
    jobId = data.job_id;
  } catch (e) { resetExportUI(btn, prog); return toast('Could not reach server — is it running?'); }

  const startTime = Date.now(), totalMs = (videoInfo.duration || 0) * 1000;
  detail.textContent = `Encoding at ${expW}×${expH} · ${expFPS}fps…`;

  exportPollTimer = setInterval(async () => {
    let pd;
    try { pd = await (await fetch(`${API}/progress/${jobId}`)).json(); }
    catch (e) { detail.textContent = `Encoding… ${((Date.now() - startTime) / 1000).toFixed(0)}s`; return; }
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
    if (pd.status === 'done') {
      clearInterval(exportPollTimer); exportPollTimer = null;
      fill.classList.remove('indeterminate'); fill.style.width = '100%';
      pct.textContent = '100%'; detail.textContent = `Done — ${elapsed}s`;
      timecode.textContent = ''; speedEl.textContent = '';
      setTimeout(() => { resetExportUI(btn, prog); toast('Export complete!'); }, 2500);
    } else if (pd.status === 'error') {
      clearInterval(exportPollTimer); exportPollTimer = null;
      resetExportUI(btn, prog); toast('FFmpeg error — check terminal'); console.error(pd.error);
    } else {
      if (totalMs > 0 && pd.out_time_ms > 0) {
        const p = Math.min(98, (pd.out_time_ms / totalMs) * 100);
        fill.classList.remove('indeterminate'); fill.style.width = p.toFixed(1) + '%'; pct.textContent = p.toFixed(0) + '%';
        timecode.textContent = fmt(pd.out_time_ms / 1000) + ' / ' + fmt(videoInfo.duration);
      } else { pct.textContent = '…'; }
      detail.textContent = `${elapsed}s elapsed`;
      speedEl.textContent = pd.speed && pd.speed !== 'N/A' ? pd.speed + ' speed' : '';
    }
  }, 500);
}

function resetExportUI(btn, prog) {
  btn.disabled = false; prog.classList.remove('show');
  document.getElementById('progress-fill').classList.remove('indeterminate');
  document.getElementById('progress-fill').style.width = '0%';
}
