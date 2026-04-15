// ── Captions module - Whisper transcription + style + canvas rendering ─────────

// Persistent cache so the hint survives panel re-renders
let _captionHintCache = '';

// ── Caption canvas rendering ───────────────────────────────────────────────────
function drawCaptionsOnCanvas() {
  if (!captionStyle.enabled || !captionTracks.length || !videoEl) return;
  const t = videoEl.currentTime;

  // Draw every active segment across all tracks simultaneously
  for (const track of captionTracks) {
    // Resolve track style: track.style overrides global captionStyle
    const cs = Object.assign({}, captionStyle, track.style || {});

    for (const seg of track.segments) {
      if (t < seg.start || t >= seg.end) continue;

      // Per-segment style override on top of track style
      const scs = seg.styleOverride ? Object.assign({}, cs, seg.styleOverride) : cs;
      _drawOneSeg(seg, scs, t);
    }
  }
}

// ── Animation easing ─────────────────────────────────────────────────────────
const ANIM_DUR = 0.15; // seconds for in/out transitions

function _animAlpha(cs, seg, t) {
  if (!cs.animStyle || cs.animStyle === 'none') return 1;
  const segDur  = seg.end - seg.start;
  const elapsed = t - seg.start;
  const fadeIn  = Math.min(1, elapsed / ANIM_DUR);
  const fadeOut = Math.min(1, (seg.end - t) / Math.min(ANIM_DUR, segDur * 0.3));
  return cs.animStyle === 'fade' ? Math.min(fadeIn, fadeOut) : 1;
}

function _animScale(cs, seg, t) {
  if (cs.animStyle !== 'pop') return 1;
  const elapsed = t - seg.start;
  if (elapsed >= ANIM_DUR) return 1;
  // Overshoot spring: scale 0 → 1.12 → 1
  const p = elapsed / ANIM_DUR;
  return p < 0.7 ? p / 0.7 * 1.12 : 1.12 - (p - 0.7) / 0.3 * 0.12;
}

function _drawOneSeg(seg, cs, t) {
  const cw  = outCanvas.width;
  const ch  = outCanvas.height;
  const scl = outScale;

  let displayText = cs.allCaps ? seg.text.toUpperCase() : seg.text;

  const fs      = Math.max(4, cs.fontSize * scl);
  const weight  = cs.fontWeight === 'black' ? '900' : cs.fontWeight;
  const fontStr = `${cs.fontItalic ? 'italic ' : ''}${weight} ${fs}px "${cs.fontFamily}", Arial, sans-serif`;

  // ── Animation transforms ─────────────────────────────────────────────────
  const alpha    = _animAlpha(cs, seg, t);
  const animScl  = _animScale(cs, seg, t);
  const cx       = (cs.positionX / 100) * cw;
  const cy       = (cs.positionY / 100) * ch;

  outCtx.save();

  // Apply fade alpha
  if (alpha < 1) outCtx.globalAlpha = alpha;

  // Apply pop scale around the text anchor point
  if (animScl !== 1) {
    outCtx.translate(cx, cy);
    outCtx.scale(animScl, animScl);
    outCtx.translate(-cx, -cy);
  }

  outCtx.font      = fontStr;
  outCtx.textAlign = cs.textAlign;

  // Apply letter-spacing (Chromium/Electron supports ctx.letterSpacing)
  const lsPx = (cs.letterSpacing || 0) * scl;
  if ('letterSpacing' in outCtx) {
    outCtx.letterSpacing = lsPx + 'px';
  }

  // Word-wrap (measure with spacing applied)
  const maxW     = (cs.maxWidth / 100) * cw;
  const rawWords = displayText.split(' ');
  const lines    = [];
  let line = '';
  for (const w of rawWords) {
    const test = line ? line + ' ' + w : w;
    if (outCtx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);

  const lineH  = fs * cs.lineHeight;
  const totalH = lines.length * lineH;

  const wordTimes = (cs.highlightEnabled && seg.words?.length) ? seg.words : [];

  // Background box
  if (cs.bgOpacity > 0) {
    const pad   = cs.bgPadding * scl;
    const maxLW = Math.max(...lines.map(l => outCtx.measureText(l).width));
    const bgW   = maxLW + pad * 2;
    const bgH   = totalH + pad * 2;
    const bgX   = cs.textAlign === 'center' ? cx - bgW / 2 :
                  cs.textAlign === 'right'  ? cx - bgW    : cx;
    const bgY   = cy - totalH / 2 - pad;
    const r     = cs.bgRadius * scl;
    const prevAlpha = outCtx.globalAlpha;
    outCtx.globalAlpha = cs.bgOpacity * alpha;
    outCtx.fillStyle   = cs.bgColor;
    if (r > 0 && outCtx.roundRect) {
      outCtx.beginPath(); outCtx.roundRect(bgX, bgY, bgW, bgH, r); outCtx.fill();
    } else { outCtx.fillRect(bgX, bgY, bgW, bgH); }
    outCtx.globalAlpha = prevAlpha;
  }

  // Draw lines
  lines.forEach((lineText, li) => {
    const lx = cx;
    const ly = cy - totalH / 2 + li * lineH + lineH / 2;
    if (cs.highlightEnabled && wordTimes.length) {
      _drawLineWithHighlight(lineText, lx, ly, fs, cs, t, wordTimes, scl);
    } else {
      _drawTextLine(lineText, lx, ly, cs, fs, scl, cs.textColor);
    }
  });

  outCtx.restore();
}

function _drawTextLine(text, x, y, cs, fs, scl, fillColor) {
  // Shadow
  if (cs.shadow) {
    outCtx.shadowColor   = cs.shadowColor || '#000';
    outCtx.shadowBlur    = 6  * scl;
    outCtx.shadowOffsetX = 2  * scl;
    outCtx.shadowOffsetY = 2  * scl;
  }

  const lsPx = (cs.letterSpacing || 0) * scl;
  const hasNativeLS = 'letterSpacing' in outCtx;

  // Stroke / outline
  if (cs.strokeWidth > 0) {
    outCtx.lineWidth   = cs.strokeWidth * scl * 2;
    outCtx.strokeStyle = cs.strokeColor;
    outCtx.lineJoin    = 'round';
    if (lsPx > 0 && !hasNativeLS) {
      _drawCharByChar(text, x, y, lsPx, 'stroke');
    } else {
      outCtx.strokeText(text, x, y);
    }
  }
  outCtx.shadowBlur = 0; outCtx.shadowOffsetX = 0; outCtx.shadowOffsetY = 0;
  outCtx.fillStyle  = fillColor;
  if (lsPx > 0 && !hasNativeLS) {
    _drawCharByChar(text, x, y, lsPx, 'fill');
  } else {
    outCtx.fillText(text, x, y);
  }
}

// Manual letter-spacing fallback: draw each character individually
function _drawCharByChar(text, x, y, lsPx, mode) {
  const align = outCtx.textAlign;
  // Measure total width with spacing to find the starting x for center/right align
  const chars = [...text]; // handle multi-byte correctly
  const charWidths = chars.map(c => outCtx.measureText(c).width);
  const totalW = charWidths.reduce((a, b) => a + b, 0) + lsPx * Math.max(0, chars.length - 1);
  let cx = align === 'center' ? x - totalW / 2 :
           align === 'right'  ? x - totalW     : x;
  const savedAlign = outCtx.textAlign;
  outCtx.textAlign = 'left';
  for (let i = 0; i < chars.length; i++) {
    if (mode === 'fill')   outCtx.fillText(chars[i], cx, y);
    else                   outCtx.strokeText(chars[i], cx, y);
    cx += charWidths[i] + lsPx;
  }
  outCtx.textAlign = savedAlign;
}

function _drawLineWithHighlight(lineText, lx, ly, fs, cs, t, wordTimes, scl) {
  // Measure each word's position within the line to render inline highlights
  const words   = lineText.split(' ');
  const align   = cs.textAlign;
  const lineW   = outCtx.measureText(lineText).width;
  let startX    = align === 'center' ? lx - lineW / 2 :
                  align === 'right'  ? lx - lineW     : lx;

  for (let wi = 0; wi < words.length; wi++) {
    const wText = words[wi] + (wi < words.length - 1 ? ' ' : '');
    const wW    = outCtx.measureText(wText).width;
    const wx    = startX + wW / 2;

    // Check if any word-time matches this word at current time
    const matchingWT = wordTimes.find(wt =>
      t >= wt.start && t < wt.end &&
      wt.word.replace(/[^a-zA-Z0-9]/g,'').toLowerCase() ===
      words[wi].replace(/[^a-zA-Z0-9]/g,'').toLowerCase()
    );

    const color = matchingWT ? cs.highlightColor : cs.textColor;
    outCtx.save();
    outCtx.textAlign = 'center';
    _drawTextLine(wText, wx, ly, cs, fs, scl, color);
    outCtx.restore();
    startX += wW;
  }
}

// ── Get segment at time ────────────────────────────────────────────────────────
function getSegmentAtTime(t) {
  const allSegs = captionTracks.flatMap(tr => tr.segments);
  return allSegs.find(c => t >= c.start && t < c.end) || null;
}

// ── Panel tab switching ────────────────────────────────────────────────────────
function switchPanelTab(tab) {
  const isZones = tab === 'zones';
  document.getElementById('panel-zones-content').style.display  = isZones ? 'contents' : 'none';
  document.getElementById('panel-captions-content').style.display = isZones ? 'none' : 'flex';
  document.getElementById('ptab-zones').classList.toggle('active', isZones);
  document.getElementById('ptab-captions').classList.toggle('active', !isZones);
}

// ── Generate captions (call server /transcribe) ────────────────────────────────

// ── Get checked tracks from the multi-select UI ───────────────────────────────
function getSelectedTracks() {
  const checks = document.querySelectorAll('.cc-track-check:checked');
  return Array.from(checks).map(cb => ({
    track_idx: +cb.dataset.idx,
    label:     document.getElementById(`cc-track-label-${cb.dataset.idx}`)?.value
               || `Track ${+cb.dataset.idx + 1}`,
  }));
}

// ── Generate captions (multi-track) ──────────────────────────────────────────
async function generateCaptions() {
  if (!filename) return toast('Load a video first');

  const selectedTracks = getSelectedTracks();
  if (!selectedTracks.length) return toast('Select at least one track to transcribe');

  // ── Hint nudge: warn (non-blocking) if hint field is empty ──────────────
  const hintEl = document.getElementById('cc-prompt');
  // Sync the live DOM value into the persistent cache before using it
  if (hintEl) _captionHintCache = hintEl.value;
  if (!_captionHintCache.trim()) {
    if (hintEl) hintEl.classList.add('cc-hint-warn');
    setTimeout(() => { if (hintEl) hintEl.classList.remove('cc-hint-warn'); }, 2500);
    toast('💡 Add a game name or keywords to the hint for better accuracy');
  }

  const model         = document.getElementById('cc-model').value;
  const language      = document.getElementById('cc-lang').value;
  const initialPrompt = _captionHintCache.trim() || null;
  const diarize       = document.getElementById('cc-diarize')?.checked || false;
  const numSpeakersEl = document.querySelector('.cc-speaker-count-btn.active');
  const numSpeakers   = numSpeakersEl?.dataset.count ? +numSpeakersEl.dataset.count : null;
  const btn      = document.getElementById('cc-generate-btn');

  btn.disabled = true;
  setCaptionStatus('running', 'Checking GPU\u2026');

  // Pre-flight whisper check
  let whisperCheck;
  try {
    whisperCheck = await (await fetch(`${API}/whisper_check`)).json();
    if (whisperCheck.type === 'not-installed') {
      setCaptionStatus('idle', '');
      btn.disabled = false;
      showWhisperDownloadPrompt();
      return;
    }
    // Show a notice if running on CPU (AMD or no GPU) - slower but still works
    if (whisperCheck.device === 'cpu') {
      const gpuLabel = whisperCheck.gpu === 'amd' ? 'AMD GPU detected \u2014 using CPU mode' : 'No GPU detected \u2014 using CPU mode';
      setCaptionStatus('running', `${gpuLabel} (slower, please wait\u2026)`);
    }
  } catch { setCaptionStatus('error', 'Could not reach server'); btn.disabled = false; return; }

  setCaptionStatus('running', `Starting transcription of ${selectedTracks.length} track(s)\u2026`);

  let jobId;
  try {
    const r = await fetch(`${API}/transcribe_multi`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, model, language: language || null, tracks: selectedTracks, initialPrompt, diarize, numSpeakers }),
    });
    const d = await r.json();
    if (d.error) { setCaptionStatus('error', d.error); btn.disabled = false; return; }
    jobId = d.job_id;
  } catch { setCaptionStatus('error', 'Server unreachable'); btn.disabled = false; return; }

  if (captionPollTimer) clearInterval(captionPollTimer);
  captionPollTimer = setInterval(async () => {
    let pd;
    try { pd = await (await fetch(`${API}/transcribe_status/${jobId}`)).json(); }
    catch { return; }

    // Show per-track progress
    if (pd.tracks) {
      const summary = pd.tracks.map(t => {
        if (t.status === 'done')  return `${t.label} \u2713`;
        if (t.status === 'error') return `${t.label} \u2717`;
        return `${t.label} \u29f3`;
      }).join('  \u00b7  ');
      setCaptionStatus('running', summary);
    }

    if (pd.status === 'done' || pd.status === 'error') {
      clearInterval(captionPollTimer); captionPollTimer = null;
      btn.disabled = false;

      if (!pd.tracks) { setCaptionStatus('error', pd.error || 'Transcription failed'); return; }

      // Merge results into captionTracks - replace same trackIdx, append new
      const prevLen = captionTracks.length;
      pd.tracks.forEach((t, i) => {
        if (t.status !== 'done' || !t.segments?.length) return;

        // ── Diarized: split into one track per detected speaker ──────────────
        if (Array.isArray(t.speakers) && t.speakers.length > 1) {
          // Remove any existing tracks from this audio track
          captionTracks = captionTracks.filter(ct => ct.audioTrackIdx !== t.trackIdx);

          const speakerPositions = [85, 15, 50, 30, 70];
          t.speakers.forEach((speaker, si) => {
            const segs = t.segments.filter(s => s.speaker === speaker);
            if (!segs.length) return;
            const colorIdx = captionTracks.length;
            const color    = CAPTION_TRACK_COLORS[colorIdx % CAPTION_TRACK_COLORS.length];
            captionTracks.push({
              label:         `Speaker ${si + 1}`,
              trackIdx:      captionTracks.length,
              audioTrackIdx: t.trackIdx,
              speaker,
              color,
              segments:      segs.map(s => ({ ...s })),
              style:         { positionY: speakerPositions[si % speakerPositions.length] },
            });
          });
          return;
        }

        // ── Normal: one caption track per audio track ────────────────────────
        const existing = captionTracks.findIndex(ct => ct.trackIdx === t.trackIdx);
        const colorIdx = existing >= 0 ? existing : captionTracks.length;
        const color    = CAPTION_TRACK_COLORS[colorIdx % CAPTION_TRACK_COLORS.length];
        const entry    = { label: t.label, trackIdx: t.trackIdx, color, segments: t.segments };
        if (existing >= 0) captionTracks[existing] = entry;
        else captionTracks.push(entry);
      });

      captionStyle.enabled = captionTracks.some(t => t.segments.length > 0);
      // Jump to first newly added track so user sees fresh results
      if (captionTracks.length > prevLen) activeCaptionTab = prevLen;
      else activeCaptionTab = Math.min(activeCaptionTab, Math.max(0, captionTracks.length - 1));

      const totalSegs = captionTracks.reduce((n, t) => n + t.segments.length, 0);
      const errCount  = pd.tracks.filter(t => t.status === 'error').length;
      if (errCount && errCount < pd.tracks.length)
        setCaptionStatus('done', `\u2713 ${totalSegs} segments (${errCount} track(s) failed)`);
      else if (errCount === pd.tracks.length)
        setCaptionStatus('error', pd.error || 'All tracks failed');
      else
        setCaptionStatus('done', `\u2713 ${totalSegs} segments across ${captionTracks.length} track(s)`);

      const tog = document.getElementById('cc-enabled-toggle');
      if (tog) tog.checked = captionStyle.enabled;
      updateCaptionToggleUI();
      renderSegmentsList(); renderCaptionLanes();
      toast(`Captions generated: ${totalSegs} segments`);
    }
  }, 1200);
}

// ── Whisper download prompt + polling ───────────────────────────────────────────────
let _whisperDlPollTimer = null;

function showWhisperDownloadPrompt() {
  const el = document.getElementById('whisper-download-modal');
  if (el) el.style.display = 'flex';
}

async function startWhisperDownload() {
  const modal   = document.getElementById('whisper-download-modal');
  const dlBtn   = document.getElementById('whisper-dl-btn');
  const dlStatus = document.getElementById('whisper-dl-status');
  const dlBar   = document.getElementById('whisper-dl-bar');

  if (dlBtn)    dlBtn.disabled = true;
  if (dlStatus) dlStatus.textContent = 'Starting download...';

  try {
    await fetch(`${API}/whisper_download`, { method: 'POST' });
  } catch {
    if (dlStatus) dlStatus.textContent = 'Could not reach server';
    if (dlBtn)    dlBtn.disabled = false;
    return;
  }

  if (_whisperDlPollTimer) clearInterval(_whisperDlPollTimer);
  _whisperDlPollTimer = setInterval(async () => {
    let s;
    try { s = await (await fetch(`${API}/whisper_download_status`)).json(); } catch { return; }

    if (dlStatus) dlStatus.textContent = s.message || '';
    if (dlBar)    dlBar.style.width    = (s.pct || 0) + '%';

    if (s.state === 'done') {
      clearInterval(_whisperDlPollTimer); _whisperDlPollTimer = null;
      if (modal) modal.style.display = 'none';
      toast('✅ Captions ready! Click Generate to transcribe.');
    } else if (s.state === 'error') {
      clearInterval(_whisperDlPollTimer); _whisperDlPollTimer = null;
      if (dlStatus) dlStatus.textContent = '\u274c ' + s.message;
      if (dlBtn)    dlBtn.disabled = false;
    }
  }, 800);
}

// ── (Collapse zone removed — no-ops kept for safety) ────────────────────────
function toggleGenerateZone() {}
function applyGenerateZoneState() {}
function updateCollapseChips() {}

// ── Diarize UI helpers ───────────────────────────────────────────────────
function onDiarizeToggle() {
  const on   = document.getElementById('cc-diarize')?.checked;
  const opts = document.getElementById('cc-diarize-opts');
  if (opts) opts.style.display = on ? 'block' : 'none';
}

function setSpeakerCount(btn) {
  document.querySelectorAll('.cc-speaker-count-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

function setCaptionStatus(state, msg) {
  const el = document.getElementById('cc-status');
  if (el) { el.textContent = msg; el.className = 'cc-status-text cc-status-' + state; }
  // Update generate button state indicator
  const btn = document.getElementById('cc-generate-btn');
  if (btn) btn.dataset.state = state;
}

// ── Captions panel HTML ────────────────────────────────────────────────────────
function renderCaptionsPanel() {
  const panel = document.getElementById('panel-captions-content');
  if (!panel) return;

  panel.innerHTML = `
    <!-- ═══ GENERATE DOCK ═══════════════════════════════════════════════ -->
    <div class="cc-gen-dock" id="cc-gen-dock">


      <!-- ── Settings ──────────────────────────────────────────────────── -->
      <div class="cc-dock-settings">
        <div class="cc-row">
          <div class="cc-field" style="flex:2">
            <label class="cc-label">Model</label>
            <select class="cc-select" id="cc-model">
              <option value="tiny">tiny — ~1 GB VRAM — fastest</option>
              <option value="base">base — ~1 GB VRAM — fast</option>
              <option value="small">small — ~2 GB VRAM</option>
              <option value="medium">medium — ~5 GB VRAM</option>
              <option value="large-v3-turbo" selected>large-v3-turbo — ~6 GB VRAM ★ recommended</option>
              <option value="distil-large-v3">distil-large-v3 — ~6 GB VRAM — fast+accurate</option>
              <option value="large-v2">large-v2 — ~10 GB VRAM</option>
              <option value="large-v3">large-v3 — ~10 GB VRAM — best accuracy</option>
            </select>
          </div>
          <div class="cc-field" style="flex:1">
            <label class="cc-label">Lang</label>
            <select class="cc-select" id="cc-lang">
              <option value="auto">auto</option>
              <option value="en">EN</option>
              <option value="es">ES</option>
              <option value="fr">FR</option>
              <option value="de">DE</option>
              <option value="it">IT</option>
              <option value="pt">PT</option>
              <option value="ru">RU</option>
              <option value="ja">JA</option>
              <option value="ko">KO</option>
              <option value="zh">ZH</option>
            </select>
          </div>
        </div>
        <div class="cc-field">
          <label class="cc-label" title="Seed Whisper with game-specific words for better accuracy">
            Hint <span style="opacity:0.35;font-weight:400;font-size:0.56rem">(optional — game name, keywords)</span>
          </label>
          <input class="cc-input" id="cc-prompt" type="text"
            placeholder="e.g. Warzone, loadout, gulag, killstreak…"
            value="${escapeHtml(_captionHintCache)}"
            oninput="_captionHintCache=this.value">
        </div>
        <div class="cc-field">
          <label class="cc-label">Tracks</label>
          <div class="cc-track-picker" id="cc-track-picker">
            <div class="cc-track-picker-row">
              <label class="cc-track-check-wrap">
                <input type="checkbox" class="cc-track-check" data-idx="0" checked>
                <span class="cc-track-dot" style="background:var(--accent)"></span>
              </label>
              <input class="cc-track-label-input" id="cc-track-label-0" value="Track 1" placeholder="Label…">
            </div>
          </div>
        </div>
        <div class="cc-diarize-section" id="cc-diarize-section">
          <label class="cc-diarize-toggle-row">
            <input type="checkbox" id="cc-diarize" onchange="onDiarizeToggle()">
            <span class="cc-diarize-toggle-label">
              <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor"><circle cx="3" cy="5.5" r="2"/><circle cx="8" cy="5.5" r="2"/><line x1="5" y1="5.5" x2="6" y2="5.5" stroke="currentColor" stroke-width="1.2"/></svg>
              Detect multiple speakers
            </span>
          </label>
          <div class="cc-diarize-opts" id="cc-diarize-opts" style="display:none">
            <label class="cc-label" style="margin-bottom:5px">Speakers</label>
            <div class="cc-speaker-count-group">
              <button class="cc-speaker-count-btn active" data-count="" onclick="setSpeakerCount(this)">auto</button>
              <button class="cc-speaker-count-btn" data-count="2" onclick="setSpeakerCount(this)">2</button>
              <button class="cc-speaker-count-btn" data-count="3" onclick="setSpeakerCount(this)">3</button>
              <button class="cc-speaker-count-btn" data-count="4" onclick="setSpeakerCount(this)">4</button>
              <button class="cc-speaker-count-btn" data-count="5" onclick="setSpeakerCount(this)">5</button>
            </div>
            <p class="cc-diarize-hint">Each speaker gets its own caption track, colour &amp; position.</p>
          </div>
        </div>
      </div><!-- /cc-dock-settings -->

      <!-- ── Generate button + status ──────────────────────────────────── -->
      <div class="cc-dock-footer">
        <div class="cc-status-text cc-status-idle" id="cc-status">Ready — click Generate.</div>
        <button class="cc-generate-btn" id="cc-generate-btn" onclick="generateCaptions()">
          <svg width="10" height="10" viewBox="0 0 12 12" fill="currentColor"><polygon points="2,1 11,6 2,11"/></svg>
          Generate
        </button>
      </div>

    </div><!-- /cc-gen-dock -->

    <!-- ═══ STYLE SECTION ═══════════════════════════════════════════════ -->
    <div class="cc-style-body" id="cc-style-body">

      <!-- Style header bar -->
      <div class="cc-style-header">
        <div class="cc-style-header-left">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M1 8h2l4.5-5.5L6 1 1 6.5V8zm7.2-6.2a.7.7 0 0 0 0-1L7.2.8a.7.7 0 0 0-1 0l-.7.7 1.5 1.5.7-.7z"/></svg>
          <span class="cc-style-title">STYLE</span>
          <span class="cc-track-style-badge" id="cc-track-style-badge"></span>
        </div>
        <div class="cc-style-header-right">
          <button class="cc-icon-btn" onclick="resetActiveTrackStyle()" title="Reset track to defaults">reset</button>
          <label class="cc-toggle-wrap">
            <input type="checkbox" id="cc-enabled-toggle" onchange="onCaptionToggle(this.checked)">
            <span class="cc-toggle-track"></span>
            <span class="cc-toggle-label" id="cc-toggle-label">OFF</span>
          </label>
        </div>
      </div>

      <!-- Style groups -->
      <div class="cc-style-content">

        <div class="cc-style-group">
          <div class="cc-style-group-label">Typography</div>
          <div class="cc-field">
            <label class="cc-label">Font</label>
            <select class="cc-select" id="cc-font-family" onchange="updateCaptionStyle('fontFamily',this.value)">
              <option value="Arial">Arial</option>
              <option value="Arial Black">Arial Black</option>
              <option value="Impact">Impact</option>
              <option value="Verdana">Verdana</option>
              <option value="Tahoma">Tahoma</option>
              <option value="Calibri">Calibri</option>
              <option value="Segoe UI">Segoe UI</option>
              <option value="Georgia">Georgia</option>
              <option value="Times New Roman">Times New Roman</option>
              <option value="Trebuchet MS">Trebuchet MS</option>
              <option value="Comic Sans MS">Comic Sans MS</option>
              <option value="Courier New">Courier New</option>
            </select>
          </div>
          <div class="cc-slider-row">
            <span class="cc-slider-label">Size</span>
            <input type="range" class="cc-slider" id="cc-font-size" min="20" max="180" step="1" value="72"
                   oninput="updateCaptionStyle('fontSize',+this.value);document.getElementById('cc-font-size-val').textContent=this.value+'px'">
            <span class="cc-slider-val" id="cc-font-size-val">72px</span>
          </div>
          <div class="cc-row" style="gap:5px">
            <button class="cc-chip" id="cc-w-normal" onclick="setCaptionWeight('normal')">Normal</button>
            <button class="cc-chip active" id="cc-w-bold" onclick="setCaptionWeight('bold')">Bold</button>
            <button class="cc-chip" id="cc-w-black" onclick="setCaptionWeight('black')">Black</button>
            <button class="cc-chip" id="cc-italic-btn" onclick="toggleCaptionItalic()"><em>I</em></button>
            <button class="cc-chip" id="cc-caps-btn" onclick="toggleCaptionCaps()">TT</button>
          </div>
        </div>

        <div class="cc-style-group">
          <div class="cc-style-group-label">Colors</div>
          <div class="cc-color-grid">
            <div class="cc-color-row">
              <span class="cc-color-label">Text</span>
              <label class="cc-color-swatch">
                <input type="color" id="cc-text-color" value="#ffffff" oninput="updateCaptionStyle('textColor',this.value)">
              </label>
              <span class="cc-color-hex" id="cc-text-color-hex">#FFFFFF</span>
            </div>
            <div class="cc-color-row">
              <span class="cc-color-label">Outline</span>
              <label class="cc-color-swatch">
                <input type="color" id="cc-stroke-color" value="#000000" oninput="updateCaptionStyle('strokeColor',this.value);document.getElementById('cc-stroke-color-hex').textContent=this.value.toUpperCase()">
              </label>
              <span class="cc-color-hex" id="cc-stroke-color-hex">#000000</span>
              <input type="range" class="cc-slider" style="flex:1" id="cc-stroke-width" min="0" max="16" step="0.5" value="4"
                     oninput="updateCaptionStyle('strokeWidth',+this.value);document.getElementById('cc-stroke-w-val').textContent=this.value+'px'">
              <span class="cc-slider-val" id="cc-stroke-w-val">4px</span>
            </div>
            <div class="cc-color-row">
              <span class="cc-color-label">Bg</span>
              <label class="cc-color-swatch">
                <input type="color" id="cc-bg-color" value="#000000" oninput="updateCaptionStyle('bgColor',this.value)">
              </label>
              <input type="range" class="cc-slider" style="flex:1" id="cc-bg-opacity" min="0" max="1" step="0.01" value="0"
                     oninput="updateCaptionStyle('bgOpacity',+this.value);document.getElementById('cc-bg-op-val').textContent=Math.round(this.value*100)+'%'">
              <span class="cc-slider-val" id="cc-bg-op-val">0%</span>
            </div>
            <div class="cc-color-row" id="cc-bg-radius-row" style="opacity:0.4">
              <span class="cc-color-label">Radius</span>
              <input type="range" class="cc-slider" style="flex:1;margin-left:0" id="cc-bg-radius" min="0" max="40" step="1" value="8"
                     oninput="updateCaptionStyle('bgRadius',+this.value);document.getElementById('cc-bg-r-val').textContent=this.value+'px'">
              <span class="cc-slider-val" id="cc-bg-r-val">8px</span>
            </div>
            <div class="cc-color-row" id="cc-bg-pad-row" style="opacity:0.4">
              <span class="cc-color-label">Padding</span>
              <input type="range" class="cc-slider" style="flex:1;margin-left:0" id="cc-bg-pad" min="0" max="60" step="1" value="14"
                     oninput="updateCaptionStyle('bgPadding',+this.value);document.getElementById('cc-bg-p-val').textContent=this.value+'px'">
              <span class="cc-slider-val" id="cc-bg-p-val">14px</span>
            </div>
          </div>
        </div>

        <div class="cc-style-group">
          <div class="cc-style-group-label">Position &amp; Layout</div>
          <div class="cc-slider-row">
            <span class="cc-slider-label">X</span>
            <input type="range" class="cc-slider" id="cc-pos-x" min="0" max="100" step="0.5" value="50"
                   oninput="updateCaptionStyle('positionX',+this.value);document.getElementById('cc-pos-x-val').textContent=Math.round(this.value)+'%'">
            <span class="cc-slider-val" id="cc-pos-x-val">50%</span>
          </div>
          <div class="cc-slider-row">
            <span class="cc-slider-label">Y</span>
            <input type="range" class="cc-slider" id="cc-pos-y" min="0" max="100" step="0.5" value="85"
                   oninput="updateCaptionStyle('positionY',+this.value);document.getElementById('cc-pos-y-val').textContent=Math.round(this.value)+'%'">
            <span class="cc-slider-val" id="cc-pos-y-val">85%</span>
          </div>
          <div class="cc-row" style="gap:4px">
            <span class="cc-slider-label">Align</span>
            <button class="cc-chip" id="cc-align-left" onclick="updateCaptionStyle('textAlign','left')" title="Left">&#9664;</button>
            <button class="cc-chip active" id="cc-align-center" onclick="updateCaptionStyle('textAlign','center')" title="Center">&#9646;</button>
            <button class="cc-chip" id="cc-align-right" onclick="updateCaptionStyle('textAlign','right')" title="Right">&#9654;</button>
          </div>
          <div class="cc-slider-row">
            <span class="cc-slider-label">Width</span>
            <input type="range" class="cc-slider" id="cc-max-width" min="20" max="100" step="1" value="85"
                   oninput="updateCaptionStyle('maxWidth',+this.value);document.getElementById('cc-max-w-val').textContent=this.value+'%'">
            <span class="cc-slider-val" id="cc-max-w-val">85%</span>
          </div>
          <div class="cc-slider-row">
            <span class="cc-slider-label">Line H</span>
            <input type="range" class="cc-slider" id="cc-line-height" min="0.9" max="2.5" step="0.05" value="1.25"
                   oninput="updateCaptionStyle('lineHeight',+this.value);document.getElementById('cc-lh-val').textContent=(+this.value).toFixed(2)">
            <span class="cc-slider-val" id="cc-lh-val">1.25</span>
          </div>
          <div class="cc-slider-row">
            <span class="cc-slider-label">Spacing</span>
            <input type="range" class="cc-slider" id="cc-letter-spacing" min="0" max="20" step="0.5" value="0"
                   oninput="updateCaptionStyle('letterSpacing',+this.value);document.getElementById('cc-ls-val').textContent=this.value+'px'">
            <span class="cc-slider-val" id="cc-ls-val">0px</span>
          </div>
        </div>

        <div class="cc-style-group">
          <div class="cc-style-group-label">Effects</div>
          <div class="cc-effects-row">
            <label class="cc-inline-toggle">
              <input type="checkbox" id="cc-shadow-toggle" checked onchange="updateCaptionStyle('shadow',this.checked)">
              <span class="cc-inline-track"></span>
              <span class="cc-effects-label">Shadow</span>
            </label>
            <label class="cc-color-swatch">
              <input type="color" id="cc-shadow-color" value="#000000" oninput="updateCaptionStyle('shadowColor',this.value)">
            </label>
          </div>
          <div class="cc-effects-row">
            <label class="cc-inline-toggle">
              <input type="checkbox" id="cc-highlight-toggle" onchange="toggleWordHighlight(this.checked)">
              <span class="cc-inline-track"></span>
              <span class="cc-effects-label">Word highlight</span>
            </label>
            <label class="cc-color-swatch">
              <input type="color" id="cc-highlight-color" value="#FFD60A" oninput="updateCaptionStyle('highlightColor',this.value)">
            </label>
          </div>
          <div class="cc-effects-row">
            <span class="cc-effects-label" style="min-width:72px">Animation</span>
            <select class="cc-select" id="cc-anim" style="flex:1" onchange="updateCaptionStyle('animStyle',this.value)">
              <option value="none">None</option>
              <option value="pop">Pop</option>
              <option value="fade">Fade</option>
            </select>
          </div>
        </div>

      </div><!-- /cc-style-content -->
    </div><!-- /cc-style-body -->

    <!-- ═══ SEGMENTS ZONE ═══════════════════════════════════════════════ -->
    <div class="cc-segments-zone">
      <div class="cc-segments-header">
        <span class="cc-segs-title">SEGMENTS</span>
        <div class="cc-segs-actions">
          <button class="cc-icon-btn" onclick="addManualSegment()" title="Add segment manually">+ add</button>
          <button class="cc-icon-btn" onclick="clearCaptions()" title="Clear all">✕ clear</button>
        </div>
      </div>
      <div class="cc-track-tabs" id="cc-track-tabs"></div>
      <div class="cc-segments-list" id="cc-segments-list">
        <div class="cc-empty-state">Generate captions or click “+ add” to create segments.</div>
      </div>
    </div><!-- /cc-segments-zone -->
  `;

  // Sync controls to current state
  syncCaptionControls();
}

// ── Sync all UI controls to captionStyle ──────────────────────────────────────
function syncCaptionControls() {
  const cs = resolvedTrackStyle();
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val; };
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  const setChecked = (id, val) => { const el = document.getElementById(id); if (el) el.checked = val; };

  set('cc-font-family',   cs.fontFamily);
  set('cc-font-size',     cs.fontSize);
  setText('cc-font-size-val', cs.fontSize + 'px');

  set('cc-text-color',    cs.textColor);
  setText('cc-text-color-hex', cs.textColor.toUpperCase());
  set('cc-stroke-color',  cs.strokeColor);
  setText('cc-stroke-color-hex', cs.strokeColor.toUpperCase());
  set('cc-stroke-width',  cs.strokeWidth);
  setText('cc-stroke-w-val', cs.strokeWidth + 'px');
  set('cc-bg-color',      cs.bgColor);
  set('cc-bg-opacity',    cs.bgOpacity);
  setText('cc-bg-op-val', Math.round(cs.bgOpacity * 100) + '%');
  set('cc-bg-radius',     cs.bgRadius);
  setText('cc-bg-r-val',  cs.bgRadius + 'px');
  set('cc-bg-pad',        cs.bgPadding);
  setText('cc-bg-p-val',  cs.bgPadding + 'px');

  set('cc-pos-x', cs.positionX);
  setText('cc-pos-x-val', Math.round(cs.positionX) + '%');
  set('cc-pos-y', cs.positionY);
  setText('cc-pos-y-val', Math.round(cs.positionY) + '%');
  set('cc-max-width', cs.maxWidth);
  setText('cc-max-w-val', cs.maxWidth + '%');
  set('cc-line-height', cs.lineHeight);
  setText('cc-lh-val', cs.lineHeight.toFixed(2));
  set('cc-letter-spacing', cs.letterSpacing);
  setText('cc-ls-val', cs.letterSpacing + 'px');

  setChecked('cc-shadow-toggle',    cs.shadow);
  set('cc-shadow-color', cs.shadowColor || '#000000');
  setChecked('cc-highlight-toggle', cs.highlightEnabled);
  set('cc-highlight-color', cs.highlightColor);
  set('cc-anim', cs.animStyle);
  setChecked('cc-enabled-toggle', cs.enabled);

  updateCaptionToggleUI();
  updateWeightChips();
  updateAlignChips();
  updateFlagChips();
  updateBgRowOpacity();
}

function updateCaptionToggleUI() {
  const lbl = document.getElementById('cc-toggle-label');
  if (lbl) lbl.textContent = captionStyle.enabled ? 'ON' : 'OFF';
  const lbl2 = document.getElementById('ptab-captions');
  if (lbl2) lbl2.querySelector('.cc-badge') && (lbl2.querySelector('.cc-badge').style.display = captionStyle.enabled ? 'inline' : 'none');
}

// ── Active track style accessor ──────────────────────────────────────────────
// Returns the style object to read/write for current track.
// Falls back to global captionStyle if no tracks yet (for global settings like enabled).
function activeTrackStyle() {
  const track = captionTracks[activeCaptionTab];
  if (!track) return captionStyle;
  if (!track.style) track.style = defaultCaptionStyle();
  return track.style;
}

// Resolved style: global defaults merged with active track overrides
function resolvedTrackStyle() {
  return Object.assign({}, captionStyle, activeTrackStyle());
}

function onCaptionToggle(val) {
  captionStyle.enabled = val;
  updateCaptionToggleUI();
}

function resetActiveTrackStyle() {
  const track = captionTracks[activeCaptionTab];
  if (track) { track.style = defaultCaptionStyle(); }
  syncCaptionControls();
  updateTrackStyleBadge();
}

function updateTrackStyleBadge() {
  const el = document.getElementById('cc-track-style-badge');
  if (!el) return;
  const track = captionTracks[activeCaptionTab];
  if (track && track.style) {
    el.textContent = track.label || `Track ${activeCaptionTab + 1}`;
    el.style.display = 'inline';
  } else {
    el.textContent = '';
    el.style.display = 'none';
  }
}

function updateCaptionStyle(key, value) {
  // Always update the global captionStyle so it acts as a living default
  // (new tracks inherit from it, and it's used when no tracks exist yet)
  if (key !== 'enabled') captionStyle[key] = value;

  // Also update the active track's per-track style if one exists
  const track = captionTracks[activeCaptionTab];
  if (track) {
    if (!track.style) track.style = defaultCaptionStyle();
    track.style[key] = value;
  }

  updateTrackStyleBadge();
  if (key === 'textColor') {
    const el = document.getElementById('cc-text-color-hex');
    if (el) el.textContent = value.toUpperCase();
  }
  if (key === 'bgOpacity') updateBgRowOpacity();
  if (key === 'textAlign') updateAlignChips();
}

function updateBgRowOpacity() {
  const hasBg = resolvedTrackStyle().bgOpacity > 0;
  ['cc-bg-radius-row','cc-bg-pad-row'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.opacity = hasBg ? '1' : '0.4';
  });
}

function setCaptionWeight(w) {
  activeTrackStyle().fontWeight = w;
  updateWeightChips();
}
function updateWeightChips() {
  const cs = resolvedTrackStyle();
  ['normal','bold','black'].forEach(w => {
    const el = document.getElementById('cc-w-' + w);
    if (el) el.classList.toggle('active', cs.fontWeight === w);
  });
}

function toggleCaptionItalic() {
  const ts = activeTrackStyle();
  ts.fontItalic = !ts.fontItalic;
  const el = document.getElementById('cc-italic-btn');
  if (el) el.classList.toggle('active', ts.fontItalic);
}
function toggleCaptionCaps() {
  const ts = activeTrackStyle();
  ts.allCaps = !ts.allCaps;
  const el = document.getElementById('cc-caps-btn');
  if (el) el.classList.toggle('active', ts.allCaps);
}
function toggleWordHighlight(val) {
  activeTrackStyle().highlightEnabled = val;
}
function updateAlignChips() {
  const cs = resolvedTrackStyle();
  ['left','center','right'].forEach(a => {
    const el = document.getElementById('cc-align-' + a);
    if (el) el.classList.toggle('active', cs.textAlign === a);
  });
}
function updateFlagChips() {
  const cs = resolvedTrackStyle();
  const iEl = document.getElementById('cc-italic-btn');
  if (iEl) iEl.classList.toggle('active', cs.fontItalic);
  const cEl = document.getElementById('cc-caps-btn');
  if (cEl) cEl.classList.toggle('active', cs.allCaps);
}

// ── Track tabs render ────────────────────────────────────────────────────────
function renderTrackTabs() {
  const el = document.getElementById('cc-track-tabs');
  if (!el) return;
  if (!captionTracks.length) { el.innerHTML = ''; return; }
  el.innerHTML = captionTracks.map((t, i) => `
    <button class="cc-track-tab ${i === activeCaptionTab ? 'active' : ''}"
            style="--tab-color:${t.color}"
            onclick="setActiveCaptionTab(${i})">
      <span class="cc-track-tab-dot" style="background:${t.color}"></span>
      ${escapeHtml(t.label)}
      <span class="cc-track-tab-count">${t.segments.length}</span>
    </button>
  `).join('');
}

function setActiveCaptionTab(i) {
  activeCaptionTab = i;
  renderTrackTabs();
  renderSegmentsList(); renderCaptionLanes();
  syncCaptionControls();
  updateTrackStyleBadge();
}

// ── Segments list render ──────────────────────────────────────────────────────
// ── Caption lanes on timeline ──────────────────────────────────────────────────
let _laneTooltipEl = null;

// ── Caption lane drag / resize state ─────────────────────────────────────────
let _tlSegDrag = null;
// { trackIdx, segIdx, mode:'move'|'left'|'right',
//   startX, origStart, origEnd, containerEl, segEl, moved }

(function _initCapSegDrag() {
  window.addEventListener('mousemove', e => {
    if (!_tlSegDrag || !videoEl) return;
    const { trackIdx, segIdx, mode, startX, origStart, origEnd, containerEl, segEl } = _tlSegDrag;
    const track = captionTracks[trackIdx];
    if (!track) return;
    const seg = track.segments[segIdx];
    if (!seg) return;

    _tlSegDrag.moved = true;
    segEl.classList.add('dragging');
    if (_laneTooltipEl) _laneTooltipEl.style.display = 'none';

    const dur = videoEl.duration;
    const rect = containerEl.getBoundingClientRect();
    const deltaX    = e.clientX - startX;
    const deltaFrac = deltaX / rect.width;
    const deltaTime = (deltaFrac / tlZoom) * dur;
    const MIN_DUR   = 0.05;

    if (mode === 'move') {
      const segDur = origEnd - origStart;
      let ns = Math.max(0, origStart + deltaTime);
      let ne = ns + segDur;
      if (ne > dur) { ne = dur; ns = Math.max(0, dur - segDur); }
      seg.start = ns; seg.end = ne;
    } else if (mode === 'left') {
      seg.start = Math.max(0, Math.min(origStart + deltaTime, origEnd - MIN_DUR));
    } else {
      seg.end   = Math.max(origStart + MIN_DUR, Math.min(origEnd + deltaTime, dur));
    }

    // Update DOM directly — no full re-render during drag
    const leftPct  = tlTimeToLeft(seg.start);
    const widthPct = Math.max(0.3, tlTimeToLeft(seg.end) - leftPct);
    segEl.style.left  = leftPct + '%';
    segEl.style.width = widthPct + '%';

    // Live seek to segment start
    if (videoEl) videoEl.currentTime = seg.start;
  });

  window.addEventListener('mouseup', () => {
    if (!_tlSegDrag) return;
    const { trackIdx } = _tlSegDrag;
    const track = captionTracks[trackIdx];
    if (track) track.segments.sort((a, b) => a.start - b.start);
    _tlSegDrag = null;
    renderCaptionLanes();
    renderSegmentsList();
  });
})();

function renderCaptionLanes() {
  // Don't destroy DOM during an active drag — the drag handler updates in place
  if (_tlSegDrag) return;

  const container = document.getElementById('tl-caption-lanes');
  if (!container) return;
  container.innerHTML = '';
  if (!captionTracks.length || !videoEl || !videoEl.duration) {
    if (typeof updateTimelineHeight === 'function') updateTimelineHeight();
    return;
  }

  captionTracks.forEach((track, ti) => {
    if (!track.segments?.length) return;

    const lane = document.createElement('div');
    lane.className = 'tl-caption-lane';

    // Label column
    const label = document.createElement('div');
    label.className = 'tl-lane-label';
    const dot = document.createElement('span');
    dot.className = 'tl-lane-dot';
    dot.style.background = track.color;
    dot.style.flexShrink = '0';
    const lname = document.createElement('span');
    lname.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap';
    lname.textContent = track.label;
    label.appendChild(dot);
    label.appendChild(lname);
    lane.appendChild(label);

    // Track bar (time-positioned segments live here)
    const bar = document.createElement('div');
    bar.className = 'tl-lane-track';

    track.segments.forEach((seg, si) => {
      const leftPct  = tlTimeToLeft(seg.start);
      const rightPct = tlTimeToLeft(seg.end);
      const widthPct = Math.max(0.3, rightPct - leftPct);
      if (leftPct > 100 || rightPct < 0) return;

      const el = document.createElement('div');
      el.className = 'tl-caption-seg';
      el.style.left       = leftPct + '%';
      el.style.width      = widthPct + '%';
      el.style.background = track.color;

      // ── Left resize handle ──────────────────────────────────────────────
      const handleL = document.createElement('div');
      handleL.className = 'tl-seg-handle tl-seg-handle-l';
      handleL.addEventListener('mousedown', e => {
        if (e.button !== 0) return;  // left-button only — don't block middle-pan
        e.stopPropagation(); e.preventDefault();
        _tlSegDrag = { trackIdx: ti, segIdx: si, mode: 'left',
          startX: e.clientX, origStart: seg.start, origEnd: seg.end,
          containerEl: bar, segEl: el, moved: false };
      });

      // ── Right resize handle ─────────────────────────────────────────────
      const handleR = document.createElement('div');
      handleR.className = 'tl-seg-handle tl-seg-handle-r';
      handleR.addEventListener('mousedown', e => {
        if (e.button !== 0) return;  // left-button only
        e.stopPropagation(); e.preventDefault();
        _tlSegDrag = { trackIdx: ti, segIdx: si, mode: 'right',
          startX: e.clientX, origStart: seg.start, origEnd: seg.end,
          containerEl: bar, segEl: el, moved: false };
      });

      // ── Body (grab to move) ─────────────────────────────────────────────
      const body = document.createElement('div');
      body.className = 'tl-seg-body';
      const segLabel = document.createElement('span');
      segLabel.className = 'tl-seg-label';
      segLabel.textContent = seg.text?.trim().slice(0, 40) || '';
      body.appendChild(segLabel);

      // Move drag on body
      body.addEventListener('mousedown', e => {
        if (e.button !== 0) return;  // left-button only
        e.stopPropagation(); e.preventDefault();
        _tlSegDrag = { trackIdx: ti, segIdx: si, mode: 'move',
          startX: e.clientX, origStart: seg.start, origEnd: seg.end,
          containerEl: bar, segEl: el, moved: false };
      });

      // Click to seek AND scroll the segments panel to this segment
      // Capture start/end times now — the index `si` can shift after a sort.
      const _segStart = seg.start;
      const _segEnd   = seg.end;
      el.addEventListener('click', e => {
        if (_tlSegDrag?.moved) return;
        e.stopPropagation();
        if (videoEl) videoEl.currentTime = _segStart;

        // 1. Make sure the Captions panel tab is visible (user might be on Zones).
        switchPanelTab('captions');

        // 2. Switch to the correct caption track tab.
        if (activeCaptionTab !== ti) setActiveCaptionTab(ti);

        // 3. Find the segment row by matching start time (index may have shifted
        //    due to sort triggered by the preceding mouseup handler).
        setTimeout(() => {
          const track = captionTracks[ti];
          if (!track) return;
          const realIdx = track.segments.findIndex(
            s => s.start === _segStart && s.end === _segEnd
          );
          if (realIdx < 0) return;
          // Re-render list if it doesn't already match (tab switch may have done it)
          const existing = document.getElementById('cc-seg-' + realIdx);
          if (!existing) renderSegmentsList();
          setTimeout(() => {
            const segEl = document.getElementById('cc-seg-' + realIdx);
            if (!segEl) return;
            // Scroll the segments list container, not the whole page
            const listEl = document.getElementById('cc-segments-list');
            if (listEl) {
              const elTop    = segEl.offsetTop;
              const elBot    = elTop + segEl.offsetHeight;
              const listH    = listEl.clientHeight;
              const scrollT  = listEl.scrollTop;
              if (elTop < scrollT || elBot > scrollT + listH) {
                listEl.scrollTo({ top: elTop - 8, behavior: 'smooth' });
              }
            }
            segEl.classList.remove('cc-seg-flash');
            void segEl.offsetWidth;
            segEl.classList.add('cc-seg-flash');
            segEl.addEventListener('animationend', () => segEl.classList.remove('cc-seg-flash'), { once: true });
            
            const ta = segEl.querySelector('.cc-seg-text');
            if (ta) ta.focus();
          }, 30);
        }, 20);
      });

      // Tooltip
      el.addEventListener('mouseenter', e => {
        if (_tlSegDrag) return;
        if (!_laneTooltipEl) {
          _laneTooltipEl = document.createElement('div');
          _laneTooltipEl.className = 'tl-caption-seg-tooltip';
          document.body.appendChild(_laneTooltipEl);
        }
        const text = seg.text?.trim() || '';
        _laneTooltipEl.textContent =
          fmt(seg.start) + ' - ' + fmt(seg.end) + '  ' +
          (text.length > 60 ? text.slice(0, 57) + '...' : text);
        _laneTooltipEl.style.display = 'block';
        _positionLaneTooltip(e);
      });
      el.addEventListener('mousemove', e => { if (!_tlSegDrag) _positionLaneTooltip(e); });
      el.addEventListener('mouseleave', () => {
        if (_laneTooltipEl) _laneTooltipEl.style.display = 'none';
      });

      el.appendChild(handleL);
      el.appendChild(body);
      el.appendChild(handleR);
      bar.appendChild(el);
    });

    lane.appendChild(bar);
    container.appendChild(lane);
  });

  // Auto-resize timeline to fit all lanes
  if (typeof updateTimelineHeight === 'function') updateTimelineHeight();
}
function renderSegmentsList() {
  renderTrackTabs();
  const container = document.getElementById('cc-segments-list');
  if (!container) return;

  const track = captionTracks[activeCaptionTab];
  const segs  = track?.segments || [];
  const color = track?.color || 'var(--accent)';

  if (!segs.length) {
    container.innerHTML = '<div class="cc-empty-state">No segments yet. Generate captions or click \u201c+ add\u201d.</div>';
    return;
  }

  container.innerHTML = segs.map((seg, i) => {
    const hasOverride = !!seg.styleOverride;
    const ov = seg.styleOverride || {};
    const trackStyle = Object.assign({}, captionStyle, track?.style || {});

    // Mini inline color/position override controls shown when expanded
    const overridePanel = hasOverride ? `
      <div class="cc-seg-override">
        <div class="cc-seg-override-row">
          <span class="cc-seg-ov-label">Text</span>
          <label class="cc-color-swatch cc-swatch-sm">
            <input type="color" value="${ov.textColor || trackStyle.textColor}"
                   oninput="setSegmentOverride(${i},'textColor',this.value)">
          </label>
          <span class="cc-seg-ov-label" style="margin-left:8px">Outline</span>
          <label class="cc-color-swatch cc-swatch-sm">
            <input type="color" value="${ov.strokeColor || trackStyle.strokeColor}"
                   oninput="setSegmentOverride(${i},'strokeColor',this.value)">
          </label>
        </div>
        <div class="cc-seg-override-row">
          <span class="cc-seg-ov-label">Pos Y</span>
          <input type="range" class="cc-slider" min="0" max="100" step="0.5"
                 value="${ov.positionY ?? trackStyle.positionY}"
                 oninput="setSegmentOverride(${i},'positionY',+this.value);this.nextElementSibling.textContent=Math.round(this.value)+'%'">
          <span class="cc-slider-val">${Math.round(ov.positionY ?? trackStyle.positionY)}%</span>
        </div>
        <div class="cc-seg-override-row">
          <span class="cc-seg-ov-label">Pos X</span>
          <input type="range" class="cc-slider" min="0" max="100" step="0.5"
                 value="${ov.positionX ?? trackStyle.positionX}"
                 oninput="setSegmentOverride(${i},'positionX',+this.value);this.nextElementSibling.textContent=Math.round(this.value)+'%'">
          <span class="cc-slider-val">${Math.round(ov.positionX ?? trackStyle.positionX)}%</span>
        </div>
        <div class="cc-seg-override-row">
          <span class="cc-seg-ov-label">Size</span>
          <input type="range" class="cc-slider" min="20" max="180" step="1"
                 value="${ov.fontSize ?? trackStyle.fontSize}"
                 oninput="setSegmentOverride(${i},'fontSize',+this.value);this.nextElementSibling.textContent=this.value+'px'">
          <span class="cc-slider-val">${ov.fontSize ?? trackStyle.fontSize}px</span>
        </div>
        <button class="cc-seg-reset-ov" onclick="clearSegmentOverride(${i})">Remove overrides</button>
      </div>` : '';

    return `
    <div class="cc-segment ${hasOverride ? 'cc-seg-has-override' : ''}" id="cc-seg-${i}" style="--seg-color:${color}">
      <div class="cc-seg-times">
        <input class="cc-time-input" value="${fmtCapTime(seg.start)}"
               onchange="updateSegmentTime(${i},'start',this.value)" title="Start time">
        <span class="cc-seg-arrow">\u2192</span>
        <input class="cc-time-input" value="${fmtCapTime(seg.end)}"
               onchange="updateSegmentTime(${i},'end',this.value)" title="End time">
        <button class="cc-seg-override-btn ${hasOverride ? 'active' : ''}"
                onclick="toggleSegmentOverride(${i})" title="Customize this segment">\u270e</button>
        <button class="cc-seg-del" onclick="deleteSegment(${i})" title="Delete">\u2715</button>
      </div>
      <textarea class="cc-seg-text" rows="2"
                onchange="updateSegmentText(${i},this.value)"
                oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"
      >${escapeHtml(seg.text)}</textarea>
      ${overridePanel}
    </div>`;
  }).join('');
}

// ── Per-segment style overrides ───────────────────────────────────────────────
function toggleSegmentOverride(i) {
  const segs = captionTracks[activeCaptionTab]?.segments;
  if (!segs?.[i]) return;
  if (segs[i].styleOverride) {
    delete segs[i].styleOverride;
  } else {
    segs[i].styleOverride = {}; // empty = inherits all from track
  }
  renderSegmentsList(); renderCaptionLanes();
}

function setSegmentOverride(i, key, value) {
  const segs = captionTracks[activeCaptionTab]?.segments;
  if (!segs?.[i]) return;
  if (!segs[i].styleOverride) segs[i].styleOverride = {};
  segs[i].styleOverride[key] = value;
}

function clearSegmentOverride(i) {
  const segs = captionTracks[activeCaptionTab]?.segments;
  if (segs?.[i]) delete segs[i].styleOverride;
  renderSegmentsList(); renderCaptionLanes();
}

// ── Manual segment add ────────────────────────────────────────────────────────
function addManualSegment() {
  if (!captionTracks.length) {
    captionTracks.push({
      label:    'Manual',
      trackIdx: -1,
      color:    CAPTION_TRACK_COLORS[0],
      segments: [],
    });
    activeCaptionTab = 0;
  }
  const startTime = (typeof currentTime !== 'undefined' ? currentTime : 0);
  const endTime   = startTime + 3;
  const track = captionTracks[activeCaptionTab];
  track.segments.push({ start: startTime, end: endTime, text: '', words: [] });
  track.segments.sort((a, b) => a.start - b.start);
  captionStyle.enabled = true;
  const tog = document.getElementById('cc-enabled-toggle');
  if (tog) tog.checked = true;
  updateCaptionToggleUI();
  renderSegmentsList(); renderCaptionLanes();
  setTimeout(() => {
    const newIdx = track.segments.findIndex(s => s.start === startTime && s.text === '');
    const ta = document.querySelector(`#cc-seg-${newIdx} .cc-seg-text`);
    if (ta) { ta.focus(); ta.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  }, 50);
}

function fmtCapTime(sec) {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(2);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2,'0')}.${String(Math.round((sec % 1)*100)).padStart(2,'0')}`;
}
function parseCapTime(str) {
  // Accepts m:ss.cc or ss.cc or seconds
  const parts = str.trim().split(':');
  if (parts.length === 2) {
    return parseFloat(parts[0]) * 60 + parseFloat(parts[1]);
  }
  return parseFloat(str) || 0;
}
function escapeHtml(s) {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function updateSegmentTime(i, key, val) {
  const segs = captionTracks[activeCaptionTab]?.segments;
  if (!segs || !segs[i]) return;
  segs[i][key] = parseCapTime(val);
}
function updateSegmentText(i, val) {
  const segs = captionTracks[activeCaptionTab]?.segments;
  if (!segs || !segs[i]) return;
  segs[i].text = val;
}
function deleteSegment(i) {
  const segs = captionTracks[activeCaptionTab]?.segments;
  if (!segs) return;
  segs.splice(i, 1);
  renderSegmentsList(); renderCaptionLanes();
}
function clearCaptions() {
  captionTracks = [];
  activeCaptionTab = 0;
  captionStyle.enabled = false;
  const tog = document.getElementById('cc-enabled-toggle');
  if (tog) tog.checked = false;
  updateCaptionToggleUI();
  renderSegmentsList(); renderCaptionLanes();
  setCaptionStatus('idle', 'Cleared.');
}

// ── Populate the track selector from loaded audioTracks ─────────────────────────
function updateCaptionTrackSelector() {
  const picker = document.getElementById('cc-track-picker');
  if (!picker) return;
  const tracks = (typeof audioTracks !== 'undefined') ? audioTracks : [];

  // Preserve any labels + checked states the user has already set
  const saved = {};
  picker.querySelectorAll('.cc-track-check').forEach(cb => {
    const idx = cb.dataset.idx;
    const labelEl = document.getElementById(`cc-track-label-${idx}`);
    saved[idx] = { checked: cb.checked, label: labelEl ? labelEl.value : null };
  });
  const hadEntries = Object.keys(saved).length > 0;

  if (!tracks.length) {
    // Only reset to default if picker was previously empty (fresh load / new video)
    if (!hadEntries) {
      picker.innerHTML = `
        <div class="cc-track-picker-row">
          <label class="cc-track-check-wrap">
            <input type="checkbox" class="cc-track-check" data-idx="0" checked>
            <span class="cc-track-dot" style="background:${CAPTION_TRACK_COLORS[0]}"></span>
          </label>
          <input class="cc-track-label-input" id="cc-track-label-0" value="Track 1" placeholder="Label...">
        </div>`;
    }
    return;
  }

  // Only rebuild if the track count changed (new video loaded)
  const currentCount = picker.querySelectorAll('.cc-track-check').length;
  if (hadEntries && currentCount === tracks.length) return; // same tracks - don't touch user edits

  // Full rebuild (new video with different track count)
  picker.innerHTML = tracks.map((t, i) => {
    const defaultLabel = `Track ${t.idx + 1}`;
    const prev  = saved[String(t.idx)];
    const label = prev?.label ?? defaultLabel;
    const chk   = prev ? (prev.checked ? 'checked' : '') : (i === 0 ? 'checked' : '');
    const detail = [t.codec, t.layout, t.channels ? `${t.channels}ch` : ''].filter(Boolean).join(' · ');
    const color  = CAPTION_TRACK_COLORS[i % CAPTION_TRACK_COLORS.length];
    return `
      <div class="cc-track-picker-row">
        <label class="cc-track-check-wrap" title="${detail}">
          <input type="checkbox" class="cc-track-check" data-idx="${t.idx}" ${chk}>
          <span class="cc-track-dot" style="background:${color}"></span>
        </label>
        <input class="cc-track-label-input" id="cc-track-label-${t.idx}"
               value="${label.replace(/"/g,'&quot;')}" placeholder="Label...">
        ${detail ? `<span class="cc-track-detail">${detail}</span>` : ''}
      </div>`;
  }).join('');
}

// ── Initialize captions panel on load ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderCaptionsPanel();
});
