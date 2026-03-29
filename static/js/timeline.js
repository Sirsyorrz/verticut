// ── Timeline controls ─────────────────────────────────────────────────────────

function tlTimeToLeft(t) {
  if (!videoEl || !videoEl.duration) return 0;
  return (t / videoEl.duration) * 100;
}

function tlClientToTime(clientX) {
  if (!videoEl) return 0;
  const r = tlTrack.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * videoEl.duration;
}

function updateTL() {
  if (!videoEl || isNaN(videoEl.duration)) return;
  const dur = videoEl.duration;
  const inPct  = tlTimeToLeft(trimStart);
  const outPct = tlTimeToLeft(trimEnd ?? dur);
  const headPct = tlTimeToLeft(videoEl.currentTime);

  document.getElementById('tl-mask-l').style.cssText  = `left:0;width:${inPct}%`;
  document.getElementById('tl-mask-r').style.cssText  = `right:0;width:${100 - outPct}%`;
  document.getElementById('tl-active').style.cssText  = `left:${inPct}%;width:${outPct - inPct}%`;
  document.getElementById('tl-h-in').style.left       = inPct + '%';
  document.getElementById('tl-h-out').style.left      = outPct + '%';
  document.getElementById('tl-head').style.left       = headPct + '%';

  document.getElementById('tl-in-lbl').textContent  = fmt(trimStart);
  document.getElementById('tl-out-lbl').textContent = fmt(trimEnd ?? dur);
  document.getElementById('tl-clip-dur').textContent = 'clip: ' + fmt((trimEnd ?? dur) - trimStart);
  document.getElementById('time-current').textContent = fmt(videoEl.currentTime);
}

tlTrack.addEventListener('mousedown', e => {
  if (!videoEl || !videoEl.duration) return;
  e.preventDefault(); e.stopPropagation();
  const r = tlTrack.getBoundingClientRect();
  const mx = e.clientX - r.left;
  const dur = videoEl.duration;
  const inX  = (trimStart / dur) * r.width;
  const outX = ((trimEnd ?? dur) / dur) * r.width;
  const headX = (videoEl.currentTime / dur) * r.width;
  const HP = 12;
  if (Math.abs(mx - inX) <= HP)       tlDragging = 'in';
  else if (Math.abs(mx - outX) <= HP) tlDragging = 'out';
  else if (Math.abs(mx - headX) <= HP) tlDragging = 'head';
  else {
    tlDragging = 'head';
    const t = tlClientToTime(e.clientX);
    videoEl.currentTime = Math.max(trimStart, Math.min(trimEnd ?? dur, t));
  }
});
