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
  const ow = document.querySelector('.output-canvas-wrap');
  const owW = ow.clientWidth - 20, owH = ow.clientHeight - 20;
  outScale = Math.min(owW / OUT_W, owH / OUT_H);
  outCanvas.width = Math.floor(OUT_W * outScale); outCanvas.height = Math.floor(OUT_H * outScale);
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
    if (!z.hudProbe) return;
    const px = z.hudProbe.x * srcScale, py = z.hudProbe.y * srcScale;
    ovCtx.beginPath();
    ovCtx.arc(px, py, 5, 0, Math.PI * 2);
    if (hudProbeMode) {
      ovCtx.fillStyle = z.color;
      ovCtx.fill();
    } else {
      ovCtx.strokeStyle = z.color;
      ovCtx.lineWidth = 1.5;
      ovCtx.stroke();
    }
    // Small label
    ovCtx.font = '9px JetBrains Mono,monospace';
    ovCtx.fillStyle = z.color;
    ovCtx.fillText('⊙', px + 7, py + 3);
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
    if (hudProbeMode && z.hudProbe && z._hudVisible === false) return;
    const dx = z.dst.x * outScale, dy = z.dst.y * outScale, dw = z.dst.w * outScale, dh = z.dst.h * outScale;
    const isSelected = selectedZoneId === z.id;
    outCtx.save();
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
      // HUD probe sampling
      if (hudProbeMode) {
        const probeZones = zones.filter(z => z.hudProbe);
        if (probeZones.length > 0) {
          probeZones.forEach(z => {
            const sx = Math.round(z.hudProbe.x * srcScale);
            const sy = Math.round(z.hudProbe.y * srcScale);
            if (sx >= 0 && sx < srcCanvas.width && sy >= 0 && sy < srcCanvas.height) {
              const pd = srcCtx.getImageData(sx, sy, 1, 1).data;
              const brightness = (pd[0] + pd[1] + pd[2]) / 3;
              z._hudVisible = brightness >= z.hudProbe.threshold;
            } else {
              z._hudVisible = true;
            }
          });
        }
      }
    }
    drawOverlay(); drawOutput(); updateTL(); drawAudioViz();
    animFrame = requestAnimationFrame(loop);
  })();
}
