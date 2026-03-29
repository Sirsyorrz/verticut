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
  storeGameGroups([{
    id: Date.now().toString(),
    gameName: 'Default',
    presets: Array.isArray(v2) ? v2 : []
  }]);
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

// ── Modal open / close ────────────────────────────────────────────────────────
function openSavePreset() {
  if (!zones.length) return toast('Add at least one zone first');
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
  let gameId = document.getElementById('preset-game-select').value;
  if (!groups.length) {
    const ng = { id: Date.now().toString(), gameName: 'Default', presets: [] };
    groups.push(ng); gameId = ng.id;
  }
  let group = groups.find(g => g.id === gameId) || groups[0];
  closePresetModal();
  const preset = {
    id: Date.now().toString() + Math.random().toString(36).slice(2),
    name, createdAt: Date.now(), zones: serializeZones()
  };
  group.presets.push(preset);
  storeGameGroups(groups);
  renderPresetsList();
  toast(`"${name}" saved to ${group.gameName}`);
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
  toast(`Applied "${preset.name}" — ${preset.zones.length} zone${preset.zones.length !== 1 ? 's' : ''} loaded`);
}

// ── Game CRUD ─────────────────────────────────────────────────────────────────
function addGame(name) {
  if (!name || !name.trim()) return;
  const groups = getGameGroups() || [];
  groups.push({ id: Date.now().toString() + Math.random().toString(36).slice(2), gameName: name.trim(), presets: [] });
  storeGameGroups(groups);
  renderPresetsList();
  toast(`"${name.trim()}" added`);
}

function renameGame(gameId, newName) {
  if (!newName || !newName.trim()) return renderPresetsList();
  const groups = getGameGroups() || [];
  const g = groups.find(g => g.id === gameId);
  if (g) { g.gameName = newName.trim(); storeGameGroups(groups); renderPresetsList(); }
}

function deleteGame(gameId) {
  const groups = getGameGroups() || [];
  const g = groups.find(g => g.id === gameId);
  if (!g) return;
  if (g.presets.length > 0 && !confirm(`Delete "${g.gameName}" and its ${g.presets.length} preset(s)?`)) return;
  storeGameGroups(groups.filter(g => g.id !== gameId));
  renderPresetsList();
  toast('Game deleted');
}

// ── Preset CRUD ───────────────────────────────────────────────────────────────
function deletePreset(gameId, presetId) {
  const groups = getGameGroups() || [];
  const g = groups.find(g => g.id === gameId);
  if (g) { g.presets = g.presets.filter(p => p.id !== presetId); storeGameGroups(groups); }
  renderPresetsList();
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
  renderPresetsList();
  toast(`"${p.name}" updated`);
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

        // v3 array of game groups
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
          storeGameGroups(groups); renderPresetsList();
          toast(`Imported ${addedPresets} preset${addedPresets !== 1 ? 's' : ''}${addedGames > 0 ? ` (${addedGames} new game${addedGames !== 1 ? 's' : ''})` : ''}`);

        // v3 single game object
        } else if (!Array.isArray(raw) && raw.gameName !== undefined) {
          let tg = groups.find(g => g.gameName === raw.gameName);
          if (!tg) { tg = { id: Date.now().toString() + Math.random().toString(36).slice(2), gameName: raw.gameName, presets: [] }; groups.push(tg); }
          let added = 0;
          for (const p of (raw.presets || [])) {
            if (!existingIds.has(p.id)) { tg.presets.push(p); added++; }
          }
          storeGameGroups(groups); renderPresetsList();
          toast(`Imported ${added} preset${added !== 1 ? 's' : ''} into "${raw.gameName}"`);

        // v2 flat array or single preset
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
          storeGameGroups(groups); renderPresetsList();
          toast(added > 0 ? `Imported ${added} preset${added !== 1 ? 's' : ''} into "Default"` : 'All presets already exist');
        }
      } catch(e) { toast('Invalid preset file: ' + e.message); }
    };
    reader.readAsText(file);
  });
  input.click();
}

// ── Inline game rename ────────────────────────────────────────────────────────
function startRenameGame(gameId, el) {
  const current = el.textContent;
  const inp = document.createElement('input');
  inp.className = 'game-name-input';
  inp.value = current;
  inp.onclick = e => e.stopPropagation();
  inp.onblur = () => renameGame(gameId, inp.value || current);
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); renameGame(gameId, inp.value || current); }
    if (e.key === 'Escape') renderPresetsList();
  };
  el.replaceWith(inp);
  inp.focus(); inp.select();
}

// ── Add game inline UI ────────────────────────────────────────────────────────
function showAddGameInput(btn) {
  const row = btn.closest('.game-add-row');
  if (!row) return;
  const inp = document.createElement('input');
  inp.className = 'game-name-input';
  inp.placeholder = 'Game name…';
  inp.style.cssText = 'flex:1;margin-right:4px';
  const ok = document.createElement('button');
  ok.textContent = '✓'; ok.className = 'game-action-btn'; ok.style.color = 'var(--accent)'; ok.style.borderColor = 'var(--accent)';
  const cancel = document.createElement('button');
  cancel.textContent = '✕'; cancel.className = 'game-action-btn';
  ok.onclick = e => { e.stopPropagation(); inp.value.trim() ? addGame(inp.value) : renderPresetsList(); };
  cancel.onclick = e => { e.stopPropagation(); renderPresetsList(); };
  inp.onkeydown = e => {
    if (e.key === 'Enter') { e.preventDefault(); inp.value.trim() ? addGame(inp.value) : renderPresetsList(); }
    if (e.key === 'Escape') renderPresetsList();
  };
  row.innerHTML = '';
  row.appendChild(inp); row.appendChild(ok); row.appendChild(cancel);
  inp.focus();
}

// ── Collapse state ────────────────────────────────────────────────────────────
const _collapsedGames = new Set();

function toggleGameCollapse(gameId) {
  if (_collapsedGames.has(gameId)) _collapsedGames.delete(gameId);
  else _collapsedGames.add(gameId);
  renderPresetsList();
}

// ── Render ────────────────────────────────────────────────────────────────────
function renderPresetsList() {
  const list = document.getElementById('presets-list');
  list.innerHTML = '';
  const groups = getGameGroups() || [];

  // "New Game" row
  const addRow = document.createElement('div');
  addRow.className = 'game-add-row';
  const addBtn = document.createElement('button');
  addBtn.className = 'add-game-btn';
  addBtn.textContent = '＋ New Game';
  addBtn.onclick = e => { e.stopPropagation(); showAddGameInput(addBtn); };
  addRow.appendChild(addBtn);
  list.appendChild(addRow);

  groups.forEach((group, gi) => {
    const isCollapsed = _collapsedGames.has(group.id);
    const section = document.createElement('div');
    section.className = 'game-section';

    // Game header
    const header = document.createElement('div');
    header.className = 'game-section-header';
    header.onclick = () => toggleGameCollapse(group.id);
    header.innerHTML = `
      <span class="game-collapse-arrow">${isCollapsed ? '▶' : '▼'}</span>
      <span class="game-name-label" ondblclick="event.stopPropagation();startRenameGame('${group.id}',this)">${escHtml(group.gameName)}</span>
      <span class="game-preset-count">${group.presets.length}</span>
      <button class="game-action-btn" title="Save current layout as preset here" onclick="event.stopPropagation();openSavePresetForGame('${group.id}')">＋</button>
      <button class="game-action-btn" title="Export all presets in this game" onclick="event.stopPropagation();exportGamePresets('${group.id}')">⤓</button>
      <button class="game-action-btn del" title="Delete game" onclick="event.stopPropagation();deleteGame('${group.id}')">✕</button>
    `;
    section.appendChild(header);

    // Preset list (collapsible)
    const presetList = document.createElement('div');
    presetList.className = 'game-presets-list' + (isCollapsed ? ' collapsed' : '');

    // Built-in Default 9:16 only in the first group
    if (gi === 0) {
      const defCard = document.createElement('div');
      defCard.className = 'preset-card';
      defCard.style.cssText = 'border-color:rgba(0,245,160,0.3);';
      defCard.innerHTML = `<div class="preset-info"><div class="preset-name">Default 9:16</div><div class="preset-meta" style="color:rgba(0,245,160,0.6)">built-in · full screen crop</div></div><button class="preset-btn apply-btn">Apply</button>`;
      defCard.querySelector('.apply-btn').addEventListener('click', () => {
        if (!videoEl) return toast('Load a video first, then apply a preset');
        pushUndo();
        zones = []; colorIdx = 0;
        addAutoGameplayZone();
        toast('Default 9:16 layout applied');
      });
      presetList.appendChild(defCard);
    }

    group.presets.slice().reverse().forEach(p => {
      const d = new Date(p.updatedAt || p.createdAt);
      const card = document.createElement('div');
      card.className = 'preset-card';
      card.innerHTML = `<div class="preset-info"><div class="preset-name">${escHtml(p.name)}</div><div class="preset-meta">${d.getMonth() + 1}/${d.getDate()} · ${p.zones.length} zone${p.zones.length !== 1 ? 's' : ''}</div></div><button class="preset-btn apply-btn">Apply</button><button class="preset-btn exp-btn" title="Export this preset">⤓</button><button class="preset-btn upd-btn" title="Overwrite with current layout">↺</button><button class="preset-btn del del-btn">✕</button>`;
      card.querySelector('.apply-btn').addEventListener('click', () => applyPreset(p));
      card.querySelector('.exp-btn').addEventListener('click', () => exportPreset(group.id, p.id));
      card.querySelector('.upd-btn').addEventListener('click', () => updatePreset(group.id, p.id));
      card.querySelector('.del-btn').addEventListener('click', () => deletePreset(group.id, p.id));
      presetList.appendChild(card);
    });

    section.appendChild(presetList);
    list.appendChild(section);
  });
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────
migratePresetsV2toV3();
