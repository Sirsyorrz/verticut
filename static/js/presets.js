// ── Preset management ─────────────────────────────────────────────────────────
const PRESET_KEY_V2 = 'verticut_presets_v2';
const PRESET_KEY_V3 = 'verticut_presets_v3';

// ── Storage helpers ───────────────────────────────────────────────────────────
function getGameGroups() {
  try { return JSON.parse(localStorage.getItem(PRESET_KEY_V3) || 'null'); } catch { return null; }
}
function storeGameGroups(groups) { localStorage.setItem(PRESET_KEY_V3, JSON.stringify(groups)); }

// ── One-time migration v2 → v3 ────────────────────────────────────────────────
function migratePresetsV2toV3() {
  if (getGameGroups() !== null) return;
  let v2 = [];
  try { v2 = JSON.parse(localStorage.getItem(PRESET_KEY_V2) || '[]'); } catch {}
  // Only create a group if there are actual v2 presets to migrate
  if (Array.isArray(v2) && v2.length > 0) {
    storeGameGroups([{
      id: Date.now().toString(),
      gameName: 'Default',
      presets: v2
    }]);
  } else {
    storeGameGroups([]);
  }
}

// ── Zone serialization ────────────────────────────────────────────────────────
function serializeZones() {
  return zones.map(z => ({
    label: z.label, color: z.color, blur: z.blur || 0, feather: z.feather || 0,
    shape: z.shape || 'rect', locked: z.locked || false,
    hudProbes: z.hudProbes ? z.hudProbes.map(p => ({...p})) : undefined,
    srcPct: { x: z.src.x / videoInfo.width, y: z.src.y / videoInfo.height, w: z.src.w / videoInfo.width, h: z.src.h / videoInfo.height },
    dstPct: { x: z.dst.x / OUT_W, y: z.dst.y / OUT_H, w: z.dst.w / OUT_W, h: z.dst.h / OUT_H },
    ...(z.shape === 'polygon' && z.points ? {
      pointsPct: z.points.map(p => ({ x: p.x / videoInfo.width, y: p.y / videoInfo.height }))
    } : {})
  }));
}

// ── Apply preset ──────────────────────────────────────────────────────────────
function applyPreset(preset) {
  if (!videoEl) return toast('Load a video first, then apply a preset');
  pushUndo();
  zones = preset.zones.map(pz => {
    const z = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      label: pz.label, color: pz.color, disabled: false,
      blur: pz.blur || 0, feather: pz.feather || 0,
      shape: pz.shape || 'rect', locked: pz.locked || false,
      arLocked: pz.shape === 'polygon' ? false : true,
      src: {
        x: Math.round(pz.srcPct.x * videoInfo.width), y: Math.round(pz.srcPct.y * videoInfo.height),
        w: Math.max(1, Math.round(pz.srcPct.w * videoInfo.width)), h: Math.max(1, Math.round(pz.srcPct.h * videoInfo.height))
      },
      dst: {
        x: Math.round(pz.dstPct.x * OUT_W), y: Math.round(pz.dstPct.y * OUT_H),
        w: Math.max(1, Math.round(pz.dstPct.w * OUT_W)), h: Math.max(1, Math.round(pz.dstPct.h * OUT_H))
      }
    };
    if (pz.hudProbes) z.hudProbes = pz.hudProbes.map(p => ({...p}));
    if (pz.shape === 'polygon' && pz.pointsPct) {
      z.points = pz.pointsPct.map(p => ({
        x: Math.round(p.x * videoInfo.width),
        y: Math.round(p.y * videoInfo.height)
      }));
      z.src = polygonBBox(z.points);
    }
    return z;
  });
  selectedZoneId = null; colorIdx = zones.length;
  renderZonesList();
  closePresetsMenu();
  toast(`Applied "${preset.name}" — ${preset.zones.length} zone${preset.zones.length !== 1 ? 's' : ''} loaded`);
}

function _applyById(gameId, presetId) {
  const groups = getGameGroups() || [];
  const g = groups.find(g => g.id === gameId);
  const p = g && g.presets.find(p => p.id === presetId);
  if (p) applyPreset(p);
}

function _applyDefault() {
  if (!videoEl) return toast('Load a video first, then apply a preset');
  pushUndo();
  zones = []; colorIdx = 0;
  addAutoGameplayZone();
  closePresetsMenu();
  toast('Default 9:16 layout applied');
}

// ── Game CRUD ─────────────────────────────────────────────────────────────────
function addGame(name) {
  if (!name || !name.trim()) return;
  const groups = getGameGroups() || [];
  groups.push({ id: Date.now().toString() + Math.random().toString(36).slice(2), gameName: name.trim(), presets: [] });
  storeGameGroups(groups);
  renderPresetsDropdown();
  toast(`"${name.trim()}" added`);
}

function renameGame(gameId, newName) {
  if (!newName || !newName.trim()) return renderPresetsDropdown();
  const groups = getGameGroups() || [];
  const g = groups.find(g => g.id === gameId);
  if (g) { g.gameName = newName.trim(); storeGameGroups(groups); renderPresetsDropdown(); }
}

function deleteGame(gameId) {
  const groups = getGameGroups() || [];
  storeGameGroups(groups.filter(g => g.id !== gameId));
  _confirmAction = null;
  renderPresetsDropdown();
  toast('Game deleted');
}

// ── Preset CRUD ───────────────────────────────────────────────────────────────
function deletePreset(gameId, presetId) {
  const groups = getGameGroups() || [];
  const g = groups.find(g => g.id === gameId);
  if (g) { g.presets = g.presets.filter(p => p.id !== presetId); storeGameGroups(groups); }
  _confirmAction = null;
  renderPresetsDropdown();
  toast('Preset deleted');
}

function updatePreset(gameId, presetId) {
  if (!zones.length) return toast('Add zones first');
  const groups = getGameGroups() || [];
  const g = groups.find(g => g.id === gameId);
  if (!g) return;
  const p = g.presets.find(p => p.id === presetId);
  if (!p) return;
  p.zones = serializeZones();
  p.updatedAt = Date.now();
  storeGameGroups(groups);
  _confirmAction = null;
  renderPresetsDropdown();
  toast(`"${p.name}" updated`);
}

function movePreset(fromGameId, presetId, toGameId) {
  const groups = getGameGroups() || [];
  const fromG = groups.find(g => g.id === fromGameId);
  const toG = groups.find(g => g.id === toGameId);
  if (!fromG || !toG) return;
  const pIdx = fromG.presets.findIndex(p => p.id === presetId);
  if (pIdx === -1) return;
  const [preset] = fromG.presets.splice(pIdx, 1);
  toG.presets.push(preset);
  storeGameGroups(groups);
  _moveTarget = null;
  renderPresetsDropdown();
  toast(`Moved "${preset.name}" to "${toG.gameName}"`);
}

// ── Export / Import ───────────────────────────────────────────────────────────
function exportPreset(gameId, presetId) {
  const groups = getGameGroups() || [];
  const g = groups.find(g => g.id === gameId);
  const preset = g && g.presets.find(p => p.id === presetId);
  if (!preset) return toast('Preset not found');
  const slug = preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `verticut-preset-${slug}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  toast(`Exported "${preset.name}"`);
}

function exportGamePresets(gameId) {
  const groups = getGameGroups() || [];
  const g = groups.find(g => g.id === gameId);
  if (!g || !g.presets.length) return toast('No presets to export');
  const slug = g.gameName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const blob = new Blob([JSON.stringify(g, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `verticut-${slug}-presets.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  toast(`Exported ${g.presets.length} preset${g.presets.length !== 1 ? 's' : ''} from "${g.gameName}"`);
}

function exportAllPresets() {
  const groups = getGameGroups() || [];
  const total = groups.reduce((s, g) => s + g.presets.length, 0);
  if (!total) return toast('No presets to export');
  const blob = new Blob([JSON.stringify(groups, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `verticut-all-presets-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
  toast(`Exported ${total} preset${total !== 1 ? 's' : ''}`);
}

function importPresets() {
  const input = document.createElement('input');
  input.type = 'file'; input.accept = '.json';
  input.addEventListener('change', () => {
    const file = input.files[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const raw = JSON.parse(reader.result);
        const groups = getGameGroups() || [];
        const existingIds = new Set(groups.flatMap(g => g.presets.map(p => p.id)));

        if (Array.isArray(raw) && raw.length > 0 && raw[0].gameName !== undefined) {
          let addedGames = 0, addedPresets = 0;
          for (const ig of raw) {
            if (!ig.gameName || !Array.isArray(ig.presets)) continue;
            let tg = groups.find(g => g.gameName === ig.gameName);
            if (!tg) { tg = { id: Date.now().toString() + Math.random().toString(36).slice(2), gameName: ig.gameName, presets: [] }; groups.push(tg); addedGames++; }
            for (const p of ig.presets) {
              if (!existingIds.has(p.id)) { tg.presets.push(p); addedPresets++; existingIds.add(p.id); }
            }
          }
          storeGameGroups(groups); renderPresetsDropdown();
          toast(`Imported ${addedPresets} preset${addedPresets !== 1 ? 's' : ''}${addedGames > 0 ? ` (${addedGames} new game${addedGames !== 1 ? 's' : ''})` : ''}`);
        } else if (!Array.isArray(raw) && raw.gameName !== undefined) {
          let tg = groups.find(g => g.gameName === raw.gameName);
          if (!tg) { tg = { id: Date.now().toString() + Math.random().toString(36).slice(2), gameName: raw.gameName, presets: [] }; groups.push(tg); }
          let added = 0;
          for (const p of (raw.presets || [])) {
            if (!existingIds.has(p.id)) { tg.presets.push(p); added++; }
          }
          storeGameGroups(groups); renderPresetsDropdown();
          toast(`Imported ${added} preset${added !== 1 ? 's' : ''} into "${raw.gameName}"`);
        } else {
          const imported = Array.isArray(raw) ? raw : [raw];
          for (const p of imported) {
            if (!p.name || !Array.isArray(p.zones)) throw new Error('invalid preset format');
          }
          let dg = groups.find(g => g.gameName === 'Default');
          if (!dg) { dg = { id: Date.now().toString(), gameName: 'Default', presets: [] }; groups.push(dg); }
          let added = 0;
          for (const p of imported) {
            if (!existingIds.has(p.id)) { dg.presets.push(p); added++; }
          }
          storeGameGroups(groups); renderPresetsDropdown();
          toast(added > 0 ? `Imported ${added} preset${added !== 1 ? 's' : ''} into "Default"` : 'All presets already exist');
        }
      } catch(e) { toast('Invalid preset file: ' + e.message); }
    };
    reader.readAsText(file);
  });
  input.click();
}

// ── Save preset modal ─────────────────────────────────────────────────────────
function openSavePreset() {
  if (!zones.length) return toast('Add at least one zone first');
  const groups = getGameGroups() || [];
  if (!groups.length) return toast('Create a game first using the Presets menu');
  _populateSaveModal(null);
}

function openSavePresetForGame(gameId) {
  if (!zones.length) return toast('Add at least one zone first');
  _populateSaveModal(gameId);
}

function _populateSaveModal(preferGameId) {
  const groups = getGameGroups() || [];
  const select = document.getElementById('preset-game-select');
  select.innerHTML = groups.map(g =>
    `<option value="${escHtml(g.id)}"${g.id === preferGameId ? ' selected' : ''}>${escHtml(g.gameName)}</option>`
  ).join('');
  const gameRow = document.getElementById('preset-game-row');
  if (gameRow) gameRow.style.display = groups.length > 1 ? 'flex' : 'none';
  const allPresets = groups.flatMap(g => g.presets);
  document.getElementById('preset-name-input').value = `Layout ${allPresets.length + 1}`;
  document.getElementById('preset-modal').classList.add('show');
  setTimeout(() => { const inp = document.getElementById('preset-name-input'); inp.select(); inp.focus(); }, 80);
}

function closePresetModal() { document.getElementById('preset-modal').classList.remove('show'); }

function confirmSavePreset() {
  const name = document.getElementById('preset-name-input').value.trim();
  if (!name) return;
  const groups = getGameGroups() || [];
  if (!groups.length) { closePresetModal(); return toast('Create a game first using the Presets menu'); }
  let gameId = document.getElementById('preset-game-select').value;
  let group = groups.find(g => g.id === gameId) || groups[0];
  closePresetModal();
  const preset = {
    id: Date.now().toString() + Math.random().toString(36).slice(2),
    name, createdAt: Date.now(), zones: serializeZones()
  };
  group.presets.push(preset);
  storeGameGroups(groups);
  renderPresetsDropdown();
  toast(`"${name}" saved to ${group.gameName}`);
}

// ── Dropdown UI State ─────────────────────────────────────────────────────────
let _presetsOpen = false;
let _confirmAction = null;  // { type: 'delete'|'update'|'deleteGame', gameId, presetId }
let _moveTarget = null;     // { gameId, presetId } — showing "move to" list
const _collapsedGames = new Set();

function togglePresetsMenu() {
  _presetsOpen = !_presetsOpen;
  if (!_presetsOpen) { _confirmAction = null; _moveTarget = null; }
  renderPresetsDropdown();
  if (_presetsOpen) {
    setTimeout(() => document.addEventListener('mousedown', _presetsOutsideClick), 0);
  }
}

function closePresetsMenu() {
  _presetsOpen = false;
  _confirmAction = null;
  _moveTarget = null;
  renderPresetsDropdown();
  document.removeEventListener('mousedown', _presetsOutsideClick);
}

function _presetsOutsideClick(e) {
  const dd = document.getElementById('presets-dropdown');
  const btn = document.getElementById('presets-menu-btn');
  if (dd && !dd.contains(e.target) && btn && !btn.contains(e.target)) {
    closePresetsMenu();
  }
}

function toggleGameCollapse(gameId) {
  if (_collapsedGames.has(gameId)) _collapsedGames.delete(gameId);
  else _collapsedGames.add(gameId);
  renderPresetsDropdown();
}

function _requestConfirm(type, gameId, presetId) {
  if (_confirmAction && _confirmAction.type === type &&
      _confirmAction.gameId === gameId && _confirmAction.presetId === presetId) {
    if (type === 'delete') deletePreset(gameId, presetId);
    else if (type === 'update') updatePreset(gameId, presetId);
    else if (type === 'deleteGame') deleteGame(gameId);
    return;
  }
  _confirmAction = { type, gameId, presetId };
  _moveTarget = null;
  renderPresetsDropdown();
}

function _cancelConfirm() {
  _confirmAction = null;
  renderPresetsDropdown();
}

function _toggleMoveMenu(gameId, presetId) {
  if (_moveTarget && _moveTarget.gameId === gameId && _moveTarget.presetId === presetId) {
    _moveTarget = null;
  } else {
    _moveTarget = { gameId, presetId };
    _confirmAction = null;
  }
  renderPresetsDropdown();
}

// ── Inline new game input ─────────────────────────────────────────────────────
function _showNewGameInput() {
  const row = document.getElementById('pd-new-game-row');
  if (!row) return;
  row.innerHTML = `<input class="pd-inline-input" id="pd-new-game-input" placeholder="Game name…" maxlength="30">
    <button class="pd-sm-btn pd-sm-confirm" onclick="event.stopPropagation();_commitNewGame()">OK</button>
    <button class="pd-sm-btn" onclick="event.stopPropagation();renderPresetsDropdown()">Cancel</button>`;
  const inp = document.getElementById('pd-new-game-input');
  inp.focus();
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); _commitNewGame(); }
    if (e.key === 'Escape') renderPresetsDropdown();
  };
  inp.onclick = e => e.stopPropagation();
}

function _commitNewGame() {
  const inp = document.getElementById('pd-new-game-input');
  if (inp && inp.value.trim()) addGame(inp.value.trim());
  else renderPresetsDropdown();
}

// ── Inline rename game ────────────────────────────────────────────────────────
function _inlineRenameGame(gameId, el) {
  const current = el.textContent;
  const inp = document.createElement('input');
  inp.className = 'pd-inline-input';
  inp.value = current;
  inp.style.flex = '1';
  inp.onclick = e => e.stopPropagation();
  inp.onblur = () => renameGame(gameId, inp.value || current);
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); renameGame(gameId, inp.value || current); }
    if (e.key === 'Escape') renderPresetsDropdown();
  };
  el.replaceWith(inp);
  inp.focus(); inp.select();
}

// ── Render dropdown ───────────────────────────────────────────────────────────
function renderPresetsDropdown() {
  const dd = document.getElementById('presets-dropdown');
  const btn = document.getElementById('presets-menu-btn');
  if (!dd || !btn) return;
  const groups = getGameGroups() || [];
  const totalPresets = groups.reduce((s, g) => s + g.presets.length, 0);

  // Update trigger button badge
  const countEl = document.getElementById('presets-count');
  if (countEl) countEl.textContent = totalPresets > 0 ? totalPresets : '';

  if (!_presetsOpen) {
    dd.classList.remove('open');
    btn.classList.remove('open');
    dd.innerHTML = '';
    return;
  }

  dd.classList.add('open');
  btn.classList.add('open');

  let html = '';

  // ── Top actions ──
  html += '<div class="pd-section pd-top-actions">';
  html += '<button class="pd-action-btn pd-save-btn" onclick="event.stopPropagation();openSavePreset()">';
  html += '<svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><polygon points="5,0.5 6.4,3.6 9.8,3.9 7.2,6.2 8,9.5 5,7.8 2,9.5 2.8,6.2 0.2,3.9 3.6,3.6"/></svg>';
  html += ' Save Layout</button>';
  html += '<div class="pd-action-row">';
  html += '<button class="pd-action-btn" onclick="event.stopPropagation();exportAllPresets()">Export All</button>';
  html += '<button class="pd-action-btn" onclick="event.stopPropagation();importPresets()">Import</button>';
  html += '</div>';
  html += '</div>';

  // ── Default 9:16 (standalone, top-level) ──
  html += '<div class="pd-default-preset">';
  html += '<div class="pd-default-info"><span class="pd-default-name">Default 9:16</span><span class="pd-default-meta">full screen · built-in</span></div>';
  html += '<button class="pd-btn pd-btn-apply" onclick="event.stopPropagation();_applyDefault()">Apply</button>';
  html += '</div>';

  // ── New game row ──
  html += '<div class="pd-section pd-new-game-section" id="pd-new-game-row">';
  html += '<button class="pd-action-btn pd-new-game-btn" onclick="event.stopPropagation();_showNewGameInput()">+ New Game</button>';
  html += '</div>';

  // ── Game groups ──
  if (groups.length > 0) {
    html += '<div class="pd-games-list">';
    groups.forEach((group, gi) => {
      const isCollapsed = _collapsedGames.has(group.id);
      const isConfirmDeleteGame = _confirmAction && _confirmAction.type === 'deleteGame' && _confirmAction.gameId === group.id;

      html += `<div class="pd-game${isCollapsed ? ' collapsed' : ''}">`;

      // Game header row
      html += `<div class="pd-game-header" onclick="toggleGameCollapse('${group.id}')">`;
      html += `<span class="pd-arrow">${isCollapsed ? '\u25B8' : '\u25BE'}</span>`;
      html += `<span class="pd-game-name" ondblclick="event.stopPropagation();_inlineRenameGame('${group.id}',this)" title="Double-click to rename">${escHtml(group.gameName)}</span>`;
      html += `<span class="pd-badge">${group.presets.length}</span>`;
      html += `<button class="pd-icon-btn" title="Save layout here" onclick="event.stopPropagation();openSavePresetForGame('${group.id}')">+</button>`;
      html += `<button class="pd-icon-btn" title="Export game" onclick="event.stopPropagation();exportGamePresets('${group.id}')">`;
      html += '<svg width="9" height="9" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4.5 1v5M2 4l2.5 2.5L7 4M1 8h7"/></svg></button>';

      if (isConfirmDeleteGame) {
        html += `<button class="pd-icon-btn pd-confirm-active" onclick="event.stopPropagation();_requestConfirm('deleteGame','${group.id}',null)">Delete?</button>`;
        html += `<button class="pd-icon-btn" onclick="event.stopPropagation();_cancelConfirm()" title="Cancel">No</button>`;
      } else {
        html += `<button class="pd-icon-btn pd-icon-del" title="Delete game" onclick="event.stopPropagation();_requestConfirm('deleteGame','${group.id}',null)">`;
        html += '<svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" stroke-width="1.4" fill="none"><path d="M1 1l6 6M7 1l-6 6"/></svg></button>';
      }
      html += '</div>'; // end game header

      // Preset list (collapsible)
      if (!isCollapsed) {
        html += '<div class="pd-preset-list">';

        group.presets.slice().reverse().forEach(p => {
          const d = new Date(p.updatedAt || p.createdAt);
          const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
          const isConfirmDel = _confirmAction && _confirmAction.type === 'delete' && _confirmAction.gameId === group.id && _confirmAction.presetId === p.id;
          const isConfirmUpd = _confirmAction && _confirmAction.type === 'update' && _confirmAction.gameId === group.id && _confirmAction.presetId === p.id;
          const isMoving = _moveTarget && _moveTarget.gameId === group.id && _moveTarget.presetId === p.id;

          html += `<div class="pd-preset${isMoving ? ' pd-preset-moving' : ''}">`;
          html += '<div class="pd-preset-row">';
          html += `<div class="pd-preset-info"><span class="pd-preset-name">${escHtml(p.name)}</span><span class="pd-preset-meta">${dateStr} · ${p.zones.length}z</span></div>`;

          // Action buttons
          html += `<button class="pd-btn pd-btn-apply" onclick="event.stopPropagation();_applyById('${group.id}','${p.id}')" title="Apply preset">Apply</button>`;
          html += `<button class="pd-btn" onclick="event.stopPropagation();exportPreset('${group.id}','${p.id}')" title="Export">`;
          html += '<svg width="8" height="8" viewBox="0 0 9 9" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M4.5 1v5M2 4l2.5 2.5L7 4M1 8h7"/></svg></button>';

          // Update button (with confirm)
          if (isConfirmUpd) {
            html += `<button class="pd-btn pd-confirm-active" onclick="event.stopPropagation();_requestConfirm('update','${group.id}','${p.id}')">Overwrite?</button>`;
            html += `<button class="pd-btn" onclick="event.stopPropagation();_cancelConfirm()">No</button>`;
          } else {
            html += `<button class="pd-btn" onclick="event.stopPropagation();_requestConfirm('update','${group.id}','${p.id}')" title="Overwrite with current layout">`;
            html += '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.2"><path d="M1 4a3 3 0 0 1 5.2-2M7 4a3 3 0 0 1-5.2 2"/><path d="M6.5 0.5v2h-2M1.5 7.5v-2h2"/></svg></button>';
          }

          // Move button (only if multiple games)
          if (groups.length > 1) {
            html += `<button class="pd-btn${isMoving ? ' active' : ''}" onclick="event.stopPropagation();_toggleMoveMenu('${group.id}','${p.id}')" title="Move to another game">`;
            html += '<svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M1 4h6M5 1.5L7.5 4 5 6.5"/></svg></button>';
          }

          // Delete button (with confirm)
          if (isConfirmDel) {
            html += `<button class="pd-btn pd-confirm-del" onclick="event.stopPropagation();_requestConfirm('delete','${group.id}','${p.id}')">Delete?</button>`;
            html += `<button class="pd-btn" onclick="event.stopPropagation();_cancelConfirm()">No</button>`;
          } else {
            html += `<button class="pd-btn pd-btn-del" onclick="event.stopPropagation();_requestConfirm('delete','${group.id}','${p.id}')" title="Delete preset">`;
            html += '<svg width="8" height="8" viewBox="0 0 8 8" stroke="currentColor" stroke-width="1.4" fill="none"><path d="M1 1l6 6M7 1l-6 6"/></svg></button>';
          }

          html += '</div>'; // end pd-preset-row

          // Move-to sub-panel
          if (isMoving) {
            html += '<div class="pd-move-panel">';
            html += '<span class="pd-move-label">Move to:</span>';
            groups.filter(g => g.id !== group.id).forEach(tg => {
              html += `<button class="pd-move-target" onclick="event.stopPropagation();movePreset('${group.id}','${p.id}','${tg.id}')">${escHtml(tg.gameName)}</button>`;
            });
            html += '</div>';
          }

          html += '</div>'; // end pd-preset
        });

        html += '</div>'; // end pd-preset-list
      }

      html += '</div>'; // end pd-game
    });
    html += '</div>'; // end pd-games-list
  }

  dd.innerHTML = html;
}

// Alias for compatibility (called from app.js init)
function renderPresetsList() { renderPresetsDropdown(); }

// ── Bootstrap ─────────────────────────────────────────────────────────────────
migratePresetsV2toV3();

// One-time cleanup: remove auto-created empty "Default" game group
(function removeEmptyDefaultGame() {
  const groups = getGameGroups();
  if (!groups) return;
  const filtered = groups.filter(g => !(g.gameName === 'Default' && g.presets.length === 0));
  if (filtered.length !== groups.length) storeGameGroups(filtered);
})();
