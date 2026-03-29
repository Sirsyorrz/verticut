// ── Preset management ─────────────────────────────────────────────────────────
const PRESET_KEY = 'verticut_presets_v2';

function getPresets() { try { return JSON.parse(localStorage.getItem(PRESET_KEY) || '[]'); } catch { return []; } }
function storePresets(list) { localStorage.setItem(PRESET_KEY, JSON.stringify(list)); }

function openSavePreset() {
  if (!zones.length) return toast('Add at least one zone first');
  const input = document.getElementById('preset-name-input');
  input.value = `Layout ${getPresets().length + 1}`;
  document.getElementById('preset-modal').classList.add('show');
  setTimeout(() => { input.select(); input.focus(); }, 80);
}

function closePresetModal() { document.getElementById('preset-modal').classList.remove('show'); }

function confirmSavePreset() {
  const name = document.getElementById('preset-name-input').value.trim(); if (!name) return;
  closePresetModal();
  const preset = { id: Date.now().toString(), name, createdAt: Date.now(),
    zones: zones.map(z => ({
      label: z.label, color: z.color, blur: z.blur || 0, feather: z.feather || 0,
      shape: z.shape || 'rect',
      hudProbes: z.hudProbes ? z.hudProbes.map(p => ({...p})) : undefined,
      srcPct: { x: z.src.x / videoInfo.width, y: z.src.y / videoInfo.height, w: z.src.w / videoInfo.width, h: z.src.h / videoInfo.height },
      dstPct: { x: z.dst.x / OUT_W, y: z.dst.y / OUT_H, w: z.dst.w / OUT_W, h: z.dst.h / OUT_H },
      ...(z.shape === 'polygon' && z.points ? {
        pointsPct: z.points.map(p => ({ x: p.x / videoInfo.width, y: p.y / videoInfo.height }))
      } : {})
    }))
  };
  const list = getPresets(); list.push(preset); storePresets(list);
  renderPresetsList(); toast(`Preset "${name}" saved`);
}

function applyPreset(preset) {
  if (!videoEl) return toast('Load a video first, then apply a preset');
  pushUndo();
  zones = preset.zones.map(pz => {
    const z = {
      id: Date.now().toString() + Math.random().toString(36).slice(2),
      label: pz.label, color: pz.color, disabled: false, blur: pz.blur || 0, feather: pz.feather || 0,
      shape: pz.shape || 'rect',
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
      z.src = polygonBBox(z.points); // recalculate to match current video resolution
    }
    return z;
  });
  selectedZoneId = null; colorIdx = zones.length;
  renderZonesList(); toast(`Applied "${preset.name}" — ${preset.zones.length} zone${preset.zones.length !== 1 ? 's' : ''} loaded`);
}

function deletePreset(id) { storePresets(getPresets().filter(p => p.id !== id)); renderPresetsList(); toast('Preset deleted'); }

function updatePreset(id) {
  if (!zones.length) return toast('Add zones first');
  const list = getPresets();
  const idx = list.findIndex(p => p.id === id); if (idx === -1) return;
  list[idx].zones = zones.map(z => ({
    label: z.label, color: z.color, blur: z.blur || 0, feather: z.feather || 0,
    shape: z.shape || 'rect',
    hudProbes: z.hudProbes ? z.hudProbes.map(p => ({...p})) : undefined,
    srcPct: { x: z.src.x / videoInfo.width, y: z.src.y / videoInfo.height, w: z.src.w / videoInfo.width, h: z.src.h / videoInfo.height },
    dstPct: { x: z.dst.x / OUT_W, y: z.dst.y / OUT_H, w: z.dst.w / OUT_W, h: z.dst.h / OUT_H },
    ...(z.shape === 'polygon' && z.points ? {
      pointsPct: z.points.map(p => ({ x: p.x / videoInfo.width, y: p.y / videoInfo.height }))
    } : {})
  }));
  list[idx].updatedAt = Date.now();
  storePresets(list);
  renderPresetsList();
  toast(`"${list[idx].name}" updated`);
}

// ── Export / Import ───────────────────────────────────────────────────────────
function exportPreset(id) {
  const preset = getPresets().find(p => p.id === id);
  if (!preset) return toast('Preset not found');
  const slug = preset.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `verticut-preset-${slug}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Exported "${preset.name}"`);
}

function exportAllPresets() {
  const presets = getPresets();
  if (!presets.length) return toast('No presets to export');
  const blob = new Blob([JSON.stringify(presets, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `verticut-presets-${new Date().toISOString().slice(0,10)}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  toast(`Exported ${presets.length} preset${presets.length !== 1 ? 's' : ''}`);
}

function importPresets() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json';
  input.addEventListener('change', () => {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        let raw = JSON.parse(reader.result);
        // Accept both a single preset object and an array of presets
        const imported = Array.isArray(raw) ? raw : [raw];
        // Validate basic shape
        for (const p of imported) {
          if (!p.name || !Array.isArray(p.zones)) throw new Error('invalid preset format');
        }
        // Merge: skip duplicates by id, append new ones
        const existing = getPresets();
        const existingIds = new Set(existing.map(p => p.id));
        let added = 0;
        for (const p of imported) {
          if (!existingIds.has(p.id)) {
            existing.push(p);
            added++;
          }
        }
        storePresets(existing);
        renderPresetsList();
        toast(added > 0
          ? `Imported ${added} new preset${added !== 1 ? 's' : ''}${imported.length - added > 0 ? ` (${imported.length - added} already existed)` : ''}`
          : `All ${imported.length} preset${imported.length !== 1 ? 's' : ''} already exist`
        );
      } catch (e) {
        toast('Invalid preset file: ' + e.message);
      }
    };
    reader.readAsText(file);
  });
  input.click();
}

function renderPresetsList() {
  const list = document.getElementById('presets-list');
  const presets = getPresets(); list.innerHTML = '';

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
  list.appendChild(defCard);

  if (!presets.length) return;
  presets.slice().reverse().forEach(p => {
    const d = new Date(p.updatedAt || p.createdAt), card = document.createElement('div');
    card.className = 'preset-card';
    card.innerHTML = `<div class="preset-info"><div class="preset-name">${escHtml(p.name)}</div><div class="preset-meta">${d.getMonth() + 1}/${d.getDate()} · ${p.zones.length} zone${p.zones.length !== 1 ? 's' : ''}</div></div><button class="preset-btn apply-btn">Apply</button><button class="preset-btn exp-btn" title="Export this preset">⤓</button><button class="preset-btn upd-btn" title="Overwrite with current layout">↺</button><button class="preset-btn del del-btn">✕</button>`;
    card.querySelector('.apply-btn').addEventListener('click', () => applyPreset(p));
    card.querySelector('.exp-btn').addEventListener('click', () => exportPreset(p.id));
    card.querySelector('.upd-btn').addEventListener('click', () => updatePreset(p.id));
    card.querySelector('.del-btn').addEventListener('click', () => deletePreset(p.id));
    list.appendChild(card);
  });
}
