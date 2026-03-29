// ── Zone management ───────────────────────────────────────────────────────────
let _renderedZoneIds = new Set();

function zonesAtPixel(vx, vy) {
  return zones.filter(z => vx >= z.src.x && vx <= z.src.x + z.src.w && vy >= z.src.y && vy <= z.src.y + z.src.h);
}

function startSetProbe(id) {
  settingProbeForZone = id;
  const z = zones.find(z => z.id === id);
  toast(`Alt+Click on source canvas to set probe pixel for "${z ? z.label : 'zone'}"`);
}

function removeProbe(id, idx) {
  const z = zones.find(z => z.id === id);
  if (!z || !z.hudProbes) return;
  if (idx !== undefined) {
    z.hudProbes.splice(idx, 1);
  } else {
    z.hudProbes = [];
  }
  if (!z.hudProbes.length) { delete z.hudProbes; delete z._hudOpacity; }
  renderZonesList();
}

function setProbeThreshold(id, idx, val) {
  const z = zones.find(z => z.id === id);
  if (z && z.hudProbes && z.hudProbes[idx]) z.hudProbes[idx].threshold = val;
}

function selectZone(id) {
  if (selectedZoneId === id) return;
  const oldCard = selectedZoneId ? document.querySelector(`.zone-card[data-zone-id="${selectedZoneId}"]`) : null;
  selectedZoneId = id;
  const newCard = id ? document.querySelector(`.zone-card[data-zone-id="${id}"]`) : null;
  if (oldCard) oldCard.classList.remove('active');
  if (newCard) newCard.classList.add('active');
}

function refreshZoneCard(z) {
  const card = document.querySelector(`.zone-card[data-zone-id="${z.id}"]`);
  if (!card) return;
  card.classList.toggle('disabled-zone', !!z.disabled);
  card.classList.toggle('active', selectedZoneId === z.id);
  const toggleBtn = card.querySelector('.zone-toggle-btn');
  if (toggleBtn) {
    toggleBtn.classList.toggle('off', !!z.disabled);
    toggleBtn.innerHTML = z.disabled ? '👁︎ off' : '👁︎ on';
    toggleBtn.title = z.disabled ? 'Enable crop' : 'Disable crop';
  }
  refreshSrcInputs(z);
  refreshZoneDst(z);
}

function addAutoGameplayZone() {
  const targetAspect = 9 / 16;
  let cropW, cropH;
  if (videoInfo.width / videoInfo.height > targetAspect) {
    cropH = videoInfo.height; cropW = Math.round(cropH * targetAspect);
  } else {
    cropW = videoInfo.width; cropH = Math.round(cropW / targetAspect);
  }
  const srcX = Math.round((videoInfo.width - cropW) / 2);
  const srcY = Math.round((videoInfo.height - cropH) / 2);
  const id = Date.now().toString(), color = COLORS[colorIdx % COLORS.length]; colorIdx++;
  zones.push({ id, label: 'Gameplay', color, arLocked: true,
    src: { x: srcX, y: srcY, w: cropW, h: cropH },
    dst: { x: 0, y: 0, w: OUT_W, h: OUT_H }
  });
  selectedZoneId = id; newZoneId = id; renderZonesList();
}

function addZone(vx, vy, vw, vh) {
  pushUndo();
  const names = ['Gameplay','HUD','Health Bar','Minimap','Scoreboard','Cam','Chat','Zone 8'];
  const id = Date.now().toString(), color = COLORS[colorIdx % COLORS.length]; colorIdx++;
  const label = names[zones.length] || `Zone ${zones.length + 1}`;
  const aspect = vw / vh, dstW = OUT_W, dstH = Math.min(Math.round(OUT_W / aspect), OUT_H);
  const dstY = Math.round((OUT_H - dstH) / 2);
  zones.push({ id, label, color, disabled: false, blur: 0, arLocked: true, src: { x: vx, y: vy, w: vw, h: vh }, dst: { x: 0, y: dstY, w: dstW, h: dstH } });
  selectedZoneId = id; newZoneId = id; renderZonesList();
  toast(`"${label}" added — drag to reposition`);
}

function removeZone(id) {
  pushUndo();
  zones = zones.filter(z => z.id !== id);
  if (selectedZoneId === id) selectedZoneId = null;
  renderZonesList();
}

function toggleZoneDisabled(id) {
  pushUndo();
  const z = zones.find(z => z.id === id);
  if (!z) return;
  z.disabled = !z.disabled;
  refreshZoneCard(z);
}

function renameZone(id, val) { pushUndo(); const z = zones.find(z => z.id === id); if (z) z.label = val; }

function toggleArLock(id) {
  const z = zones.find(z => z.id === id); if (!z) return;
  z.arLocked = !z.arLocked;
  renderZonesList();
}

function setZoneBlur(id, val) {
  const z = zones.find(z => z.id === id); if (!z) return;
  z.blur = val;
  const lbl = document.getElementById(`blur-val-${id}`);
  if (lbl) lbl.textContent = val > 0 ? val + 'px' : 'off';
}

function copyZone() {
  const z = zones.find(z => z.id === selectedZoneId);
  if (!z) return toast('Select a zone first');
  copiedZone = JSON.parse(JSON.stringify(z));
  toast(`"${z.label}" copied — Ctrl+V to paste`);
}

function pasteZone() {
  if (!copiedZone) return toast('Nothing copied yet');
  pushUndo();
  const newId = Date.now().toString() + Math.random().toString(36).slice(2);
  const nz    = JSON.parse(JSON.stringify(copiedZone));
  nz.id       = newId;
  nz.label    = copiedZone.label + ' copy';
  nz.color    = COLORS[colorIdx % COLORS.length]; colorIdx++;
  nz.disabled = false;
  nz.dst.x = Math.min(nz.dst.x + 24, OUT_W - nz.dst.w);
  nz.dst.y = Math.min(nz.dst.y + 24, OUT_H - nz.dst.h);
  zones.push(nz);
  selectedZoneId = newId;
  newZoneId = newId;
  renderZonesList();
  toast(`"${nz.label}" pasted`);
}

// ── Scale / center / reset ────────────────────────────────────────────────────
function setSrcScale(id, pct) {
  const z = zones.find(z => z.id === id); if (!z) return;
  const newW = Math.round(videoInfo.width * pct / 100);
  const newH = Math.round(newW * z.src.h / z.src.w);
  const cx = z.src.x + z.src.w / 2, cy = z.src.y + z.src.h / 2;
  z.src.w = newW; z.src.h = newH;
  z.src.x = Math.round(cx - newW / 2);
  z.src.y = Math.round(cy - newH / 2);
  const valEl = document.getElementById('src-scale-val-' + id);
  if (valEl) valEl.textContent = pct + '%';
  refreshSrcInputs(z);
}

function setDstScale(id, pct) {
  const z = zones.find(z => z.id === id); if (!z) return;
  const newW = Math.round(OUT_W * pct / 100);
  const newH = Math.round(newW * z.dst.h / z.dst.w);
  const cx = z.dst.x + z.dst.w / 2, cy = z.dst.y + z.dst.h / 2;
  z.dst.x = Math.round(cx - newW / 2);
  z.dst.y = Math.round(cy - newH / 2);
  z.dst.w = newW; z.dst.h = newH;
  const valEl = document.getElementById('dst-scale-val-' + id);
  if (valEl) valEl.textContent = pct + '%';
  refreshZoneDst(z);
}

function centerSrc(id) {
  const z = zones.find(z => z.id === id); if (!z) return;
  pushUndo();
  z.src.x = Math.max(0, Math.round((videoInfo.width - z.src.w) / 2));
  z.src.y = Math.max(0, Math.round((videoInfo.height - z.src.h) / 2));
  refreshSrcInputs(z); toast('SRC crop centered in video frame');
}

function centerDst(id) {
  const z = zones.find(z => z.id === id); if (!z) return;
  pushUndo();
  z.dst.x = Math.max(0, Math.round((OUT_W - z.dst.w) / 2));
  z.dst.y = Math.max(0, Math.round((OUT_H - z.dst.h) / 2));
  refreshZoneDst(z); toast('DST crop centered in output frame');
}

function resetZoneDefaults(id) {
  const z = zones.find(z => z.id === id); if (!z) return;
  pushUndo();
  const targetAspect = 9 / 16;
  let cropW, cropH;
  if (videoInfo.width / videoInfo.height > targetAspect) {
    cropH = videoInfo.height; cropW = Math.round(cropH * targetAspect);
  } else {
    cropW = videoInfo.width; cropH = Math.round(cropW / targetAspect);
  }
  z.src.x = Math.round((videoInfo.width - cropW) / 2);
  z.src.y = Math.round((videoInfo.height - cropH) / 2);
  z.src.w = cropW; z.src.h = cropH;
  z.dst.x = 0; z.dst.y = 0; z.dst.w = OUT_W; z.dst.h = OUT_H;
  refreshZoneCard(z); toast('Zone reset to centered 9:16 default');
}

// ── SRC / DST input handlers ──────────────────────────────────────────────────
function setSrc(id, prop, rawVal) {
  pushUndo();
  const z = zones.find(z => z.id === id); if (!z) return;
  const v = Math.round(+rawVal);
  if (prop === 'x')      z.src.x = Math.max(0, Math.min(videoInfo.width - 1, v));
  else if (prop === 'y') z.src.y = Math.max(0, Math.min(videoInfo.height - 1, v));
  else if (prop === 'w') {
    const oldAspect = z.src.w / z.src.h;
    z.src.w = Math.max(1, Math.min(videoInfo.width - z.src.x, v));
    if (z.arLocked) {
      z.src.h = Math.max(1, Math.min(videoInfo.height - z.src.y, Math.round(z.src.w / oldAspect)));
      const hEl = document.getElementById('srch-' + id);
      if (hEl && document.activeElement !== hEl) hEl.value = z.src.h;
      // Propagate to dst
      const newAspect = z.src.w / z.src.h;
      z.dst.h = Math.round(z.dst.w / newAspect);
      refreshZoneDst(z);
    }
  } else if (prop === 'h') {
    const oldAspect = z.src.w / z.src.h;
    z.src.h = Math.max(1, Math.min(videoInfo.height - z.src.y, v));
    if (z.arLocked) {
      z.src.w = Math.max(1, Math.min(videoInfo.width - z.src.x, Math.round(z.src.h * oldAspect)));
      const wEl = document.getElementById('srcw-' + id);
      if (wEl && document.activeElement !== wEl) wEl.value = z.src.w;
      // Propagate to dst
      const newAspect = z.src.w / z.src.h;
      z.dst.h = Math.round(z.dst.w / newAspect);
      refreshZoneDst(z);
    }
  }
}

function setDst(id, prop, rawVal) {
  pushUndo();
  const z = zones.find(z => z.id === id); if (!z) return;
  const v = Math.max(1, Math.round(+rawVal));
  if (prop === 'w') {
    const oldAspect = z.dst.w / z.dst.h;
    z.dst.w = v;
    if (z.arLocked) {
      z.dst.h = Math.max(1, Math.round(z.dst.w / oldAspect));
      const hEl = document.getElementById('dsth-' + id);
      if (hEl && document.activeElement !== hEl) hEl.value = z.dst.h;
    }
  } else if (prop === 'h') {
    const oldAspect = z.dst.w / z.dst.h;
    z.dst.h = v;
    if (z.arLocked) {
      z.dst.w = Math.max(1, Math.round(z.dst.h * oldAspect));
      const wEl = document.getElementById('dstw-' + id);
      if (wEl && document.activeElement !== wEl) wEl.value = z.dst.w;
    }
  }
}

// ── Refresh helpers ───────────────────────────────────────────────────────────
function refreshZonePos(z) {
  const el = document.getElementById('dst-pos-' + z.id);
  if (el) el.textContent = `${z.dst.x}, ${z.dst.y}`;
}

function refreshZoneDst(z) {
  const wEl = document.getElementById('dstw-' + z.id), hEl = document.getElementById('dsth-' + z.id);
  if (wEl && document.activeElement !== wEl) wEl.value = z.dst.w;
  if (hEl && document.activeElement !== hEl) hEl.value = z.dst.h;
  const pct = Math.round(z.dst.w / OUT_W * 100);
  const slEl = document.getElementById('dst-scale-' + z.id), valEl = document.getElementById('dst-scale-val-' + z.id);
  if (slEl && document.activeElement !== slEl) slEl.value = pct;
  if (valEl) valEl.textContent = pct + '%';
  refreshZonePos(z);
}

function refreshSrcInputs(z) {
  const fields = [['srcx', z.src.x], ['srcy', z.src.y], ['srcw', z.src.w], ['srch', z.src.h]];
  fields.forEach(([pre, val]) => {
    const el = document.getElementById(`${pre}-${z.id}`);
    if (el && document.activeElement !== el) el.value = val;
  });
  const pct = Math.round(z.src.w / videoInfo.width * 100);
  const slEl = document.getElementById('src-scale-' + z.id), valEl = document.getElementById('src-scale-val-' + z.id);
  if (slEl && document.activeElement !== slEl) slEl.value = pct;
  if (valEl) valEl.textContent = pct + '%';
}

// ── Zone card rendering ───────────────────────────────────────────────────────
function renderZonesList() {
  const list = document.getElementById('zones-list'); list.innerHTML = '';
  if (!zones.length) {
    list.innerHTML = `<div style="font-size:.72rem;font-family:var(--font-mono);color:var(--text-dim);line-height:1.9;padding:4px">No zones yet.<br>Draw crop regions<br>on the video.</div>`;
    return;
  }
  zones.forEach((z, i) => {
    const card = document.createElement('div');
    const isNew = !_renderedZoneIds.has(z.id);
    card.className = 'zone-card' + (isNew ? ' zone-new' : '') + (selectedZoneId === z.id ? ' active' : '') + (z.disabled ? ' disabled-zone' : '');
    card.setAttribute('data-zone-id', z.id);
    card.onclick = () => { selectZone(z.id); };
    card.innerHTML = `
      <div class="zone-header">
        <div class="zone-drag-handle" title="Drag to reorder">⠿</div>
        <div class="zone-dot" style="background:${z.color}"></div>
        <input class="zone-name" value="${escHtml(z.label)}" onchange="renameZone('${z.id}',this.value)" onclick="event.stopPropagation()">
        <button class="zone-toggle-btn${z.disabled ? ' off' : ''}" title="${z.disabled ? 'Enable crop' : 'Disable crop'}" onclick="event.stopPropagation();toggleZoneDisabled('${z.id}')">
          ${z.disabled ? '👁︎ off' : '👁︎ on'}
        </button>
        <button class="zone-del" onclick="event.stopPropagation();removeZone('${z.id}')">✕</button>
      </div>
      <div class="scale-row" style="margin-top:4px">
        <span class="ci-label" style="color:var(--accent3)">SRC</span>
        <input type="range" class="scale-slider src-s" id="src-scale-${z.id}" min="10" max="500" step="1"
          value="${Math.round(z.src.w / videoInfo.width * 100)}"
          onmousedown="pushUndo()" oninput="setSrcScale('${z.id}',+this.value)" onclick="event.stopPropagation()">
        <span class="scale-pct" id="src-scale-val-${z.id}">${Math.round(z.src.w / videoInfo.width * 100)}%</span>
      </div>
      <div class="zone-actions">
        <button class="zone-action-btn" onclick="event.stopPropagation();centerSrc('${z.id}')">&#9635; center src</button>
        <button class="zone-action-btn" onclick="event.stopPropagation();resetZoneDefaults('${z.id}')" title="Reset to centered 9:16 default">&#8635; reset 9:16</button>
      </div>
      <div class="scale-row" style="margin-top:2px">
        <span class="ci-label" style="color:var(--accent)">DST</span>
        <input type="range" class="scale-slider dst-s" id="dst-scale-${z.id}" min="10" max="500" step="1"
          value="${Math.round(z.dst.w / OUT_W * 100)}"
          onmousedown="pushUndo()" oninput="setDstScale('${z.id}',+this.value)" onclick="event.stopPropagation()">
        <span class="scale-pct" id="dst-scale-val-${z.id}">${Math.round(z.dst.w / OUT_W * 100)}%</span>
      </div>
      <div class="zone-actions" style="margin-top:2px">
        <button class="zone-action-btn" onclick="event.stopPropagation();centerDst('${z.id}')">&#9635; center dst</button>
      </div>
      <div class="scale-row" style="margin-top:5px;border-top:1px solid var(--border);padding-top:5px">
        <span class="ci-label" style="color:#a78bfa">BLUR</span>
        <input type="range" class="scale-slider blur-s" id="blur-${z.id}" min="0" max="60" step="1"
          value="${z.blur || 0}"
          onmousedown="pushUndo()" oninput="setZoneBlur('${z.id}',+this.value)" onclick="event.stopPropagation()">
        <span class="scale-pct" id="blur-val-${z.id}" style="color:#a78bfa">${z.blur > 0 ? (z.blur + 'px') : 'off'}</span>
      </div>
      <div class="zone-actions" style="margin-top:3px;border-top:1px solid var(--border);padding-top:4px">
        <button class="zone-action-btn probe-set-btn" id="probe-btn-${z.id}" onclick="event.stopPropagation();startSetProbe('${z.id}')" title="Alt+Click source canvas to add probe point">⊙ add probe</button>
        ${(z.hudProbes && z.hudProbes.length) ? `<button class="zone-action-btn" onclick="event.stopPropagation();removeProbe('${z.id}')" title="Remove all probes" style="padding:0 4px;min-width:auto">✕ all</button>` : ''}
      </div>
      ${(z.hudProbes || []).map((p, pi) => `
      <div class="zone-actions" style="margin-top:2px;gap:3px;align-items:center">
        <span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:rgb(${p.r},${p.g},${p.b});flex-shrink:0" title="rgb(${p.r},${p.g},${p.b})"></span>
        <span style="font-size:.55rem;color:var(--text-dim);font-family:var(--font-mono);flex-shrink:0">(${p.x},${p.y})</span>
        <input type="range" class="scale-slider" style="flex:1;min-width:30px" min="5" max="200" step="1" value="${p.threshold}"
          oninput="setProbeThreshold('${z.id}',${pi},+this.value)" onclick="event.stopPropagation()" title="Max color distance — lower = stricter match">
        <span style="font-size:.55rem;color:var(--text-dim);min-width:16px">${p.threshold}</span>
        <button class="zone-action-btn" onclick="event.stopPropagation();removeProbe('${z.id}',${pi})" style="padding:0 3px;min-width:auto;font-size:.6rem" title="Remove this probe">✕</button>
      </div>`).join('')}
      </div>
    `;

    // Drag-to-reorder
    const handle = card.querySelector('.zone-drag-handle');
    handle.addEventListener('mousedown', e => {
      e.stopPropagation();
      card.setAttribute('draggable', 'true');
    });
    card.addEventListener('dragstart', e => {
      zoneDragSrcIdx = i;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => card.classList.add('dragging'), 0);
    });
    card.addEventListener('dragend', () => {
      card.removeAttribute('draggable');
      card.classList.remove('dragging');
      document.querySelectorAll('.zone-card').forEach(c => c.classList.remove('drag-over'));
    });
    card.addEventListener('dragover', e => {
      e.preventDefault(); e.dataTransfer.dropEffect = 'move';
      if (zoneDragSrcIdx !== null && zoneDragSrcIdx !== i) card.classList.add('drag-over');
    });
    card.addEventListener('dragleave', () => card.classList.remove('drag-over'));
    card.addEventListener('drop', e => {
      e.preventDefault(); card.classList.remove('drag-over');
      if (zoneDragSrcIdx === null || zoneDragSrcIdx === i) return;
      pushUndo();
      const moved = zones.splice(zoneDragSrcIdx, 1)[0];
      zones.splice(i, 0, moved);
      zoneDragSrcIdx = null;
      renderZonesList();
    });

    list.appendChild(card);
  });
  _renderedZoneIds = new Set(zones.map(z => z.id));
}
