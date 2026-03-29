// ── Canvas setup & rendering ──────────────────────────────────────────────────

function setupCanvases() {
  const wrap = document.getElementById('canvas-wrap');
  const maxW = wrap.clientWidth - 32, maxH = wrap.clientHeight - 32;
  srcScale = Math.min(maxW / videoInfo.width, maxH / videoInfo.height, 1);
  const cw = Math.floor(videoInfo.width * srcScale), ch = Math.floor(videoInfo.height * srcScale);
  srcCanvas.width = cw; srcCanvas.height = ch;
  ovCanvas.width = cw; ovCanvas.height = ch;
  ovCanvas.style.cssText = 'position:absolute;top:0;left:0;pointer-events:none;';
  canvasCont.style.width = cw + 'px'; canvasCont.style.height = ch + 'px';
  srcZoom = 1; srcPanX = 0; srcPanY = 0;
  canvasCont.style.transform = ''; canvasCont.style.transformOrigin = '';
  const ow = document.querySelector('.output-canvas-wrap');
  const owW = ow.clientWidth - 20, owH = ow.clientHeight - 20;
  outScale = Math.min(owW / OUT_W, owH / OUT_H);
  outCanvas.width = Math.floor(OUT_W * outScale); outCanvas.height = Math.floor(OUT_H * outScale);
  outZoom = 1; outPanX = 0; outPanY = 0;
  outCanvas.style.transform = ''; outCanvas.style.transformOrigin = '';
}

function drawOverlay() {
  ovCtx.clearRect(0, 0, ovCanvas.width, ovCanvas.height);
  if (zones.length === 0 && videoEl) {
    ovCtx.save();
    ovCtx.fillStyle = '#ffffff';
    ovCtx.globalAlpha = 0.25;
    ovCtx.font = '11px JetBrains Mono, monospace';
    ovCtx.textAlign = 'center';
    ovCtx.fillText('drag to draw a zone', ovCanvas.width / 2, ovCanvas.height / 2);
    ovCtx.textAlign = 'left';
    ovCtx.globalAlpha = 1;
    ovCtx.restore();
  }
  zones.forEach((z, i) => {
    const sx = z.src.x * srcScale, sy = z.src.y * srcScale, sw = z.src.w * srcScale, sh = z.src.h * srcScale;
    const isSelected = selectedZoneId === z.id;
    const alpha = z.disabled ? 0.35 : 1;
    ovCtx.globalAlpha = alpha;

    ovCtx.fillStyle = z.color + (isSelected ? '22' : '12');
    ovCtx.fillRect(sx, sy, sw, sh);

    ovCtx.strokeStyle = z.color; ovCtx.lineWidth = isSelected ? 2.5 : 1.5;
    ovCtx.setLineDash(isSelected ? [] : [5, 3]);
    ovCtx.strokeRect(sx, sy, sw, sh);
    ovCtx.setLineDash([]);

    const lbl = `${i + 1} ${z.label}`;
    ovCtx.font = 'bold 11px JetBrains Mono,monospace';
    const tw = ovCtx.measureText(lbl).width;
    ovCtx.fillStyle = z.color; ovCtx.fillRect(sx, sy, tw + 12, 19);
    ovCtx.fillStyle = '#000'; ovCtx.fillText(lbl, sx + 6, sy + 13);

    drawHandles(ovCtx, zoneHandlePts(sx, sy, sw, sh), z.color, isSelected ? 9 : 7);

    if (isSelected) {
      ovCtx.shadowColor = z.color; ovCtx.shadowBlur = 10;
      ovCtx.strokeStyle = z.color + '50'; ovCtx.lineWidth = 1;
      ovCtx.strokeRect(sx - 2, sy - 2, sw + 4, sh + 4);
      ovCtx.shadowBlur = 0;
    }
    ovCtx.globalAlpha = 1;
  });

  // Draw HUD probe points on source overlay
  zones.forEach(z => {
    if (!z.hudProbes || !z.hudProbes.length) return;
    z.hudProbes.forEach((p, pi) => {
      const px = p.x * srcScale, py = p.y * srcScale;
      // Color swatch dot
      ovCtx.beginPath();
      ovCtx.arc(px, py, 5, 0, Math.PI * 2);
      ovCtx.fillStyle = `rgb(${p.r},${p.g},${p.b})`;
      ovCtx.fill();
      // Zone-colored ring
      ovCtx.strokeStyle = z.color;
      ovCtx.lineWidth = hudProbeMode ? 2 : 1;
      ovCtx.stroke();
      // Index label
      ovCtx.font = '8px JetBrains Mono,monospace';
      ovCtx.fillStyle = z.color;
      ovCtx.fillText(`${pi + 1}`, px + 7, py + 3);
    });
  });

  // Draw selected pixel crosshair & info tooltip
  if (selectedPixel) {
    const cx = selectedPixel.x * srcScale, cy = selectedPixel.y * srcScale;
    ovCtx.save();
    ovCtx.strokeStyle = '#fff';
    ovCtx.lineWidth = 1;
    ovCtx.setLineDash([3, 3]);
    // Horizontal line
    ovCtx.beginPath(); ovCtx.moveTo(0, cy); ovCtx.lineTo(ovCanvas.width, cy); ovCtx.stroke();
    // Vertical line
    ovCtx.beginPath(); ovCtx.moveTo(cx, 0); ovCtx.lineTo(cx, ovCanvas.height); ovCtx.stroke();
    ovCtx.setLineDash([]);
    // Center dot
    ovCtx.beginPath(); ovCtx.arc(cx, cy, 4, 0, Math.PI * 2);
    ovCtx.fillStyle = `rgb(${selectedPixel.r},${selectedPixel.g},${selectedPixel.b})`;
    ovCtx.fill();
    ovCtx.strokeStyle = '#fff'; ovCtx.lineWidth = 1.5; ovCtx.stroke();
    // Info tooltip
    const label = `(${selectedPixel.x}, ${selectedPixel.y}) rgb(${selectedPixel.r},${selectedPixel.g},${selectedPixel.b})`;
    ovCtx.font = '10px JetBrains Mono,monospace';
    const tw = ovCtx.measureText(label).width;
    const tx = Math.min(cx + 10, ovCanvas.width - tw - 8);
    const ty = cy > 30 ? cy - 12 : cy + 20;
    ovCtx.fillStyle = 'rgba(0,0,0,0.75)';
    ovCtx.fillRect(tx - 4, ty - 11, tw + 8, 15);
    ovCtx.fillStyle = '#fff';
    ovCtx.fillText(label, tx, ty);
    ovCtx.restore();
  }
}

function drawOutput() {
  outCtx.fillStyle = '#111'; outCtx.fillRect(0, 0, outCanvas.width, outCanvas.height);
  outCtx.strokeStyle = '#ffffff08'; outCtx.lineWidth = .5;
  for (let x = 0; x < outCanvas.width; x += outCanvas.width / 3) { outCtx.beginPath(); outCtx.moveTo(x, 0); outCtx.lineTo(x, outCanvas.height); outCtx.stroke(); }
  for (let y = 0; y < outCanvas.height; y += outCanvas.height / 3) { outCtx.beginPath(); outCtx.moveTo(0, y); outCtx.lineTo(outCanvas.width, y); outCtx.stroke(); }

  if (!videoEl || videoEl.readyState < 2) {
    outCtx.fillStyle = '#ffffff18'; outCtx.font = '10px monospace'; outCtx.textAlign = 'center';
    outCtx.fillText('9:16 Output Preview', outCanvas.width / 2, outCanvas.height / 2);
    outCtx.textAlign = 'left'; return;
  }

  zones.forEach((z, i) => {
    if (z.disabled) return;
    const probeOpacity = (hudProbeMode && z.hudProbes && z.hudProbes.length && z._hudOpacity !== undefined) ? z._hudOpacity : 1;
    if (probeOpacity <= 0) return;
    const dx = z.dst.x * outScale, dy = z.dst.y * outScale, dw = z.dst.w * outScale, dh = z.dst.h * outScale;
    const isSelected = selectedZoneId === z.id;
    outCtx.save();
    if (probeOpacity < 1) outCtx.globalAlpha = probeOpacity;
    if (z.blur > 0) outCtx.filter = `blur(${z.blur}px)`;
    outCtx.drawImage(videoEl, z.src.x, z.src.y, z.src.w, z.src.h, dx, dy, dw, dh);
    outCtx.restore();
    if (showOutlines) {
      outCtx.strokeStyle = z.color; outCtx.lineWidth = isSelected ? 2 : 1;
      outCtx.setLineDash(isSelected ? [] : [4, 3]);
      outCtx.strokeRect(dx, dy, dw, dh); outCtx.setLineDash([]);
      outCtx.font = 'bold 9px monospace';
      const lbl = `${i + 1} ${z.label}`, tw = outCtx.measureText(lbl).width;
      outCtx.fillStyle = z.color + 'cc'; outCtx.fillRect(dx + 2, dy + 2, tw + 7, 13);
      outCtx.fillStyle = '#000'; outCtx.fillText(lbl, dx + 5, dy + 12);
      drawHandles(outCtx, zoneHandlePts(dx, dy, dw, dh), z.color, isSelected ? 9 : 7);
      if (isSelected) {
        outCtx.shadowColor = z.color; outCtx.shadowBlur = 8;
        outCtx.strokeStyle = z.color + '50'; outCtx.lineWidth = 1;
        outCtx.strokeRect(dx - 2, dy - 2, dw + 4, dh + 4); outCtx.shadowBlur = 0;
      }
    }
  });

  if (activeSnapLines) {
    outCtx.save();
    outCtx.strokeStyle = '#ffffff'; outCtx.lineWidth = 1;
    outCtx.setLineDash([4, 4]);
    activeSnapLines.x.forEach(lx => {
      const px = lx * outScale;
      outCtx.beginPath(); outCtx.moveTo(px, 0); outCtx.lineTo(px, outCanvas.height); outCtx.stroke();
    });
    activeSnapLines.y.forEach(ly => {
      const py = ly * outScale;
      outCtx.beginPath(); outCtx.moveTo(0, py); outCtx.lineTo(outCanvas.width, py); outCtx.stroke();
    });
    outCtx.setLineDash([]);
    outCtx.restore();
  }
}

// ── Render loop ───────────────────────────────────────────────────────────────
function startLoop() {
  if (animFrame) cancelAnimationFrame(animFrame);
  (function loop() {
    if (videoEl && videoEl.readyState >= 2) {
      srcCtx.drawImage(videoEl, 0, 0, srcCanvas.width, srcCanvas.height);
      if (!isNaN(videoEl.duration)) {
        document.getElementById('time-current').textContent = fmt(videoEl.currentTime);
      }
      // HUD probe sampling — color-distance match, OR across probes, smooth fade
      if (hudProbeMode) {
        const PROBE_R = 2; // sample (2*R+1)² = 25 pixels
        const FADE_SPEED = 0.08;
        zones.forEach(z => {
          if (!z.hudProbes || !z.hudProbes.length) return;
          let anyMatch = false;
          for (const p of z.hudProbes) {
            const cx = Math.round(p.x * srcScale);
            const cy = Math.round(p.y * srcScale);
            const x0 = Math.max(0, cx - PROBE_R);
            const y0 = Math.max(0, cy - PROBE_R);
            const sz = PROBE_R * 2 + 1;
            const x1 = Math.min(srcCanvas.width, x0 + sz);
            const y1 = Math.min(srcCanvas.height, y0 + sz);
            const w = x1 - x0, h = y1 - y0;
            if (w <= 0 || h <= 0) continue;
            const pd = srcCtx.getImageData(x0, y0, w, h).data;
            const n = w * h;
            // Average color of the sampled region
            let sr = 0, sg = 0, sb = 0;
            for (let i = 0; i < n; i++) {
              const off = i * 4;
              sr += pd[off]; sg += pd[off + 1]; sb += pd[off + 2];
            }
            sr /= n; sg /= n; sb /= n;
            // Euclidean color distance to target
            const dist = Math.sqrt((sr - p.r) ** 2 + (sg - p.g) ** 2 + (sb - p.b) ** 2);
            if (dist <= p.threshold) { anyMatch = true; break; }
          }
          const target = anyMatch ? 1 : 0;
          const prev = z._hudOpacity ?? 1;
          z._hudOpacity = prev + (target - prev) * FADE_SPEED;
          if (z._hudOpacity > 0.99) z._hudOpacity = 1;
          if (z._hudOpacity < 0.01) z._hudOpacity = 0;
        });
      }
    }
    drawOverlay(); drawOutput(); updateTL(); drawAudioViz();
    animFrame = requestAnimationFrame(loop);
  })();
}
