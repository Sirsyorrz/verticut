// ── Resize handle helpers ─────────────────────────────────────────────────────
const HANDLE_IDS     = ['tl','tc','tr','ml','mr','bl','bc','br'];
const HANDLE_CURSORS = { tl:'nw-resize', tc:'n-resize', tr:'ne-resize', ml:'w-resize', mr:'e-resize', bl:'sw-resize', bc:'s-resize', br:'se-resize' };

function zoneHandlePts(x, y, w, h) {
  return {
    tl:[x,y], tc:[x+w/2,y], tr:[x+w,y],
    ml:[x,y+h/2], mr:[x+w,y+h/2],
    bl:[x,y+h], bc:[x+w/2,y+h], br:[x+w,y+h]
  };
}

function drawHandles(ctx, pts, color, hs) {
  ctx.fillStyle = color;
  Object.values(pts).forEach(([cx, cy]) => ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs));
}

function hitHandle(pts, cx, cy, HP) {
  for (const id of HANDLE_IDS) {
    const [hx, hy] = pts[id];
    if (Math.abs(cx - hx) <= HP && Math.abs(cy - hy) <= HP) return id;
  }
  return null;
}

function applyResize(ox, oy, ow, oh, handle, dx, dy, shiftKey, minW, minH, maxW, maxH) {
  let x = ox, y = oy, w = ow, h = oh;
  const aspect = ow / oh;
  const isCorner = handle === 'tl' || handle === 'tr' || handle === 'bl' || handle === 'br';
  if (isCorner && !shiftKey) {
    let gx = dx, gy = dy;
    if (handle === 'tl')      { gx = -dx; gy = -dy; }
    else if (handle === 'tr') { gy = -dy; }
    else if (handle === 'bl') { gx = -dx; }
    const useX = Math.abs(gx / ow) >= Math.abs(gy / oh);
    w = Math.max(minW, useX ? ow + gx : Math.round((Math.max(minH, oh + gy)) * aspect));
    h = Math.max(minH, Math.round(w / aspect));
    if (handle === 'tl')      { x = ox + ow - w; y = oy + oh - h; }
    else if (handle === 'tr') { y = oy + oh - h; }
    else if (handle === 'bl') { x = ox + ow - w; }
  } else {
    switch (handle) {
      case 'tl': w = Math.max(minW, ow - dx); x = ox + ow - w; h = Math.max(minH, oh - dy); y = oy + oh - h; break;
      case 'tc': h = Math.max(minH, oh - dy); y = oy + oh - h; break;
      case 'tr': w = Math.max(minW, ow + dx); h = Math.max(minH, oh - dy); y = oy + oh - h; break;
      case 'ml': w = Math.max(minW, ow - dx); x = ox + ow - w; break;
      case 'mr': w = Math.max(minW, ow + dx); break;
      case 'bl': w = Math.max(minW, ow - dx); x = ox + ow - w; h = Math.max(minH, oh + dy); break;
      case 'bc': h = Math.max(minH, oh + dy); break;
      case 'br': w = Math.max(minW, ow + dx); h = Math.max(minH, oh + dy); break;
    }
  }
  return { x: Math.round(x), y: Math.round(y), w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
}

// ── Snap helpers ──────────────────────────────────────────────────────────────
function applySrcSnap(z) {
  const w = z.src.w, h = z.src.h;
  let sx = z.src.x, sy = z.src.y;
  const snapX = [0, videoInfo.width];
  const snapY = [0, videoInfo.height];
  zones.forEach(oz => {
    if (oz.id === z.id) return;
    snapX.push(oz.src.x, oz.src.x + oz.src.w);
    snapY.push(oz.src.y, oz.src.y + oz.src.h);
  });

  let bestXVal = null, bestXDist = SNAP_DIST, snapFromRight = false;
  snapX.forEach(s => {
    const dL = Math.abs(sx - s);
    const dR = Math.abs(sx + w - s);
    if (dL < bestXDist) { bestXDist = dL; bestXVal = s; snapFromRight = false; }
    if (dR < bestXDist) { bestXDist = dR; bestXVal = s; snapFromRight = true; }
  });

  let bestYVal = null, bestYDist = SNAP_DIST, snapFromBottom = false;
  snapY.forEach(s => {
    const dT = Math.abs(sy - s);
    const dB = Math.abs(sy + h - s);
    if (dT < bestYDist) { bestYDist = dT; bestYVal = s; snapFromBottom = false; }
    if (dB < bestYDist) { bestYDist = dB; bestYVal = s; snapFromBottom = true; }
  });

  if (bestXVal !== null) sx = snapFromRight ? bestXVal - w : bestXVal;
  if (bestYVal !== null) sy = snapFromBottom ? bestYVal - h : bestYVal;
  z.src.x = Math.max(0, Math.min(videoInfo.width - w, sx));
  z.src.y = Math.max(0, Math.min(videoInfo.height - h, sy));
}

function applyDstSnap(z) {
  const w = z.dst.w, h = z.dst.h;
  let sx = z.dst.x, sy = z.dst.y;
  const snapX = [0, OUT_W];
  const snapY = [0, OUT_H];
  zones.forEach(oz => {
    if (oz.id === z.id) return;
    snapX.push(oz.dst.x, oz.dst.x + oz.dst.w);
    snapY.push(oz.dst.y, oz.dst.y + oz.dst.h);
  });

  let bestXVal = null, bestXDist = SNAP_DIST, snapFromRight = false;
  snapX.forEach(s => {
    const dL = Math.abs(sx - s);
    const dR = Math.abs(sx + w - s);
    if (dL < bestXDist) { bestXDist = dL; bestXVal = s; snapFromRight = false; }
    if (dR < bestXDist) { bestXDist = dR; bestXVal = s; snapFromRight = true; }
  });

  let bestYVal = null, bestYDist = SNAP_DIST, snapFromBottom = false;
  snapY.forEach(s => {
    const dT = Math.abs(sy - s);
    const dB = Math.abs(sy + h - s);
    if (dT < bestYDist) { bestYDist = dT; bestYVal = s; snapFromBottom = false; }
    if (dB < bestYDist) { bestYDist = dB; bestYVal = s; snapFromBottom = true; }
  });

  const lines = { x: [], y: [] };
  if (bestXVal !== null) {
    sx = snapFromRight ? bestXVal - w : bestXVal;
    lines.x.push(bestXVal);
  }
  if (bestYVal !== null) {
    sy = snapFromBottom ? bestYVal - h : bestYVal;
    lines.y.push(bestYVal);
  }
  z.dst.x = sx; z.dst.y = sy;
  activeSnapLines = (lines.x.length || lines.y.length) ? lines : null;
}
