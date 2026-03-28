// ── Mouse & keyboard interaction ──────────────────────────────────────────────

// ── Panel resize ──────────────────────────────────────────────────────────────
document.querySelectorAll('.resize-handle').forEach(handle => {
  handle.addEventListener('mousedown', e => {
    e.preventDefault();
    const panel = handle.nextElementSibling;
    panelResizing = { handle, panel, startX: e.clientX, startW: panel.offsetWidth };
    handle.classList.add('rh-active');
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  });
});

// ── Outlines toggle ───────────────────────────────────────────────────────────
function toggleOutlines() {
  showOutlines = !showOutlines;
  const btn = document.getElementById('outline-toggle-btn');
  btn.classList.toggle('off', !showOutlines);
  btn.textContent = showOutlines ? '⬡ outlines' : '⬢ outlines';
}

// ── Mode ──────────────────────────────────────────────────────────────────────
function setMode(m) {
  document.getElementById('btn-draw').classList.toggle('active', m === 'draw');
  document.getElementById('draw-badge').classList.toggle('show', m === 'draw');
}
function startDrawZone() { setMode('draw'); toast('Drag on the video to draw a new crop zone'); }

// ── Source canvas interaction ─────────────────────────────────────────────────
canvasCont.addEventListener('mousedown', e => {
  const r = canvasCont.getBoundingClientRect();
  const canvasX = e.clientX - r.left, canvasY = e.clientY - r.top;
  const vidX = canvasX / srcScale, vidY = canvasY / srcScale;
  const HP = 14;

  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    const sx = z.src.x * srcScale, sy = z.src.y * srcScale, sw = z.src.w * srcScale, sh = z.src.h * srcScale;
    const hit = hitHandle(zoneHandlePts(sx, sy, sw, sh), canvasX, canvasY, HP);
    if (hit) {
      pushUndo();
      srcResizing = true; srcResizeZone = z; srcResizeHandle = hit;
      srcResizeStartX = vidX; srcResizeStartY = vidY;
      srcResizeOrigX = z.src.x; srcResizeOrigY = z.src.y;
      srcResizeOrigW = z.src.w; srcResizeOrigH = z.src.h;
      selectZone(z.id); return;
    }
  }

  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i];
    const sx = z.src.x * srcScale, sy = z.src.y * srcScale, sw = z.src.w * srcScale, sh = z.src.h * srcScale;
    if (canvasX >= sx && canvasX <= sx + sw && canvasY >= sy && canvasY <= sy + sh) {
      pushUndo();
      srcDragging = true; srcDragZone = z;
      srcDragOffX = vidX - z.src.x; srcDragOffY = vidY - z.src.y;
      selectZone(z.id); return;
    }
  }

  if (document.getElementById('btn-draw').classList.contains('active')) {
    drawStartX = canvasX; drawStartY = canvasY; drawing = true;
    drawGuide.style.cssText = `display:block;left:${canvasX}px;top:${canvasY}px;width:0;height:0;position:absolute;z-index:10;border:2px dashed var(--accent);background:rgba(0,245,160,0.08);`;
  } else {
    selectZone(null);
  }
});

canvasCont.addEventListener('mousemove', e => {
  if (!drawing) return;
  const r = canvasCont.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
  const x = Math.min(drawStartX, cx), y = Math.min(drawStartY, cy), w = Math.abs(cx - drawStartX), h = Math.abs(cy - drawStartY);
  drawGuide.style.left = x + 'px'; drawGuide.style.top = y + 'px'; drawGuide.style.width = w + 'px'; drawGuide.style.height = h + 'px';
});

canvasCont.addEventListener('mouseup', e => {
  if (!drawing) return; drawing = false; drawGuide.style.display = 'none';
  const r = canvasCont.getBoundingClientRect(), cx = e.clientX - r.left, cy = e.clientY - r.top;
  const x = Math.min(drawStartX, cx), y = Math.min(drawStartY, cy), w = Math.abs(cx - drawStartX), h = Math.abs(cy - drawStartY);
  if (w < 15 || h < 15) return;
  addZone(Math.round(x / srcScale), Math.round(y / srcScale), Math.round(w / srcScale), Math.round(h / srcScale));
});

// ── Output canvas interaction ─────────────────────────────────────────────────
outCanvas.addEventListener('mousedown', e => {
  if (panelResizing) return;
  const r = outCanvas.getBoundingClientRect();
  const mx = (e.clientX - r.left) / outScale, my = (e.clientY - r.top) / outScale;
  const HP = 14;
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i], { x, y, w, h } = z.dst;
    const hpOut = HP / outScale;
    const hit = hitHandle(zoneHandlePts(x, y, w, h), mx, my, hpOut);
    if (hit) {
      pushUndo();
      outResizing = true; outResizeZone = z; outResizeHandle = hit;
      outResizeStartX = mx; outResizeStartY = my;
      outResizeOrigX = x; outResizeOrigY = y; outResizeOrigW = w; outResizeOrigH = h;
      selectZone(z.id); return;
    }
  }
  for (let i = zones.length - 1; i >= 0; i--) {
    const z = zones[i], { x, y, w, h } = z.dst;
    if (mx >= x && mx <= x + w && my >= y && my <= y + h) {
      pushUndo();
      outDragging = true; outDragZone = z; outDragOffX = mx - x; outDragOffY = my - y;
      selectZone(z.id); return;
    }
  }
  selectZone(null);
});

// ── Unified mousemove / mouseup ───────────────────────────────────────────────
window.addEventListener('mousemove', e => {
  // Timeline trim drag
  if (tlDragging && videoEl) {
    const t = tlClientToTime(e.clientX);
    const dur = videoEl.duration;
    if (tlDragging === 'head') {
      videoEl.currentTime = Math.max(trimStart, Math.min(trimEnd ?? dur, t));
    } else if (tlDragging === 'in') {
      trimStart = Math.max(0, Math.min((trimEnd ?? dur) - 0.1, t));
      if (videoEl.currentTime < trimStart) videoEl.currentTime = trimStart;
    } else if (tlDragging === 'out') {
      trimEnd = Math.max(trimStart + 0.1, Math.min(dur, t));
      if (videoEl.currentTime > trimEnd) videoEl.currentTime = trimEnd;
    }
    return;
  }

  // Panel resize
  if (panelResizing) {
    const dx = panelResizing.startX - e.clientX;
    const newW = Math.max(180, Math.min(window.innerWidth * 0.65, panelResizing.startW + dx));
    panelResizing.panel.style.width = newW + 'px'; return;
  }

  // Output canvas drag/resize
  if (outDragging || outResizing) {
    const r = outCanvas.getBoundingClientRect();
    const mx = (e.clientX - r.left) / outScale, my = (e.clientY - r.top) / outScale;
    if (outDragging && outDragZone) {
      outDragZone.dst.x = Math.round(mx - outDragOffX);
      outDragZone.dst.y = Math.round(my - outDragOffY);
      applyDstSnap(outDragZone);
      refreshZonePos(outDragZone);
    }
    if (outResizing && outResizeZone) {
      const z = outResizeZone, dx = mx - outResizeStartX, dy = my - outResizeStartY;
      const r = applyResize(outResizeOrigX, outResizeOrigY, outResizeOrigW, outResizeOrigH, outResizeHandle, dx, dy, e.shiftKey, 40, 40, OUT_W, OUT_H);
      z.dst.x = r.x; z.dst.y = r.y; z.dst.w = r.w; z.dst.h = r.h;
      refreshZoneDst(z);
    }
    return;
  }

  // Source canvas drag/resize
  if (srcDragging || srcResizing) {
    const r = canvasCont.getBoundingClientRect();
    const mx = (e.clientX - r.left) / srcScale, my = (e.clientY - r.top) / srcScale;
    if (srcDragging && srcDragZone) {
      const z = srcDragZone;
      z.src.x = Math.round(mx - srcDragOffX);
      z.src.y = Math.round(my - srcDragOffY);
      applySrcSnap(z);
      refreshSrcInputs(z);
    }
    if (srcResizing && srcResizeZone) {
      const z = srcResizeZone, dx = mx - srcResizeStartX, dy = my - srcResizeStartY;
      const r = applyResize(srcResizeOrigX, srcResizeOrigY, srcResizeOrigW, srcResizeOrigH, srcResizeHandle, dx, dy, e.shiftKey, 20, 20, videoInfo.width, videoInfo.height);
      z.src.x = r.x; z.src.y = r.y; z.src.w = r.w; z.src.h = r.h;
      refreshSrcInputs(z);
    }
    return;
  }

  // Hover cursor on source canvas
  if (videoEl && !drawing) {
    const r = canvasCont.getBoundingClientRect();
    if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const HP = 14;
      let cursor = document.getElementById('btn-draw').classList.contains('active') ? 'crosshair' : 'default';
      for (let i = zones.length - 1; i >= 0; i--) {
        const z = zones[i];
        const sx = z.src.x * srcScale, sy = z.src.y * srcScale, sw = z.src.w * srcScale, sh = z.src.h * srcScale;
        const hit = hitHandle(zoneHandlePts(sx, sy, sw, sh), cx, cy, HP);
        if (hit) { cursor = HANDLE_CURSORS[hit]; break; }
        if (cx >= sx && cx <= sx + sw && cy >= sy && cy <= sy + sh) { cursor = 'move'; break; }
      }
      canvasCont.style.cursor = cursor;
    }
  }
});

window.addEventListener('mouseup', () => {
  if (panelResizing) {
    panelResizing.handle.classList.remove('rh-active');
    panelResizing = null; document.body.style.cursor = ''; document.body.style.userSelect = '';
    if (videoEl) setupCanvases();
  }
  tlDragging = null;
  outDragging = false; outDragZone = null; outResizing = false; outResizeZone = null;
  srcDragging = false; srcDragZone = null; srcResizing = false; srcResizeZone = null;
  activeSnapLines = null;
  document.querySelectorAll('.zone-card[draggable]').forEach(c => c.removeAttribute('draggable'));
});

// ── Keyboard shortcuts ────────────────────────────────────────────────────────
document.addEventListener('keydown', e => {
  const tag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
  if (tag === 'input' || tag === 'textarea') return;
  if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); undo(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'c') { e.preventDefault(); copyZone(); }
  if ((e.ctrlKey || e.metaKey) && e.key === 'v') { e.preventDefault(); pasteZone(); }
});
