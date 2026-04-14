// ── Captions module — Whisper transcription + style + canvas rendering ─────────

// ── Caption canvas rendering ───────────────────────────────────────────────────
function drawCaptionsOnCanvas() {
  if (!captionStyle.enabled || !captions.length || !videoEl) return;
  const t = videoEl.currentTime;

  // Find current segment
  const seg = captions.find(c => t >= c.start && t < c.end);
  if (!seg) return;

  const cs  = captionStyle;
  const cw  = outCanvas.width;
  const ch  = outCanvas.height;
  const scl = outScale; // canvas scale factor

  let displayText = cs.allCaps ? seg.text.toUpperCase() : seg.text;

  // Font
  const fs      = Math.max(4, cs.fontSize * scl);
  const weight  = cs.fontWeight === 'black' ? '900' : cs.fontWeight;
  const fontStr = `${cs.fontItalic ? 'italic ' : ''}${weight} ${fs}px "${cs.fontFamily}", Arial, sans-serif`;

  outCtx.save();
  outCtx.font      = fontStr;
  outCtx.textAlign = cs.textAlign;

  // Word-wrap
  const maxW   = (cs.maxWidth / 100) * cw;
  const rawWords = displayText.split(' ');
  const lines  = [];
  let line = '';
  for (const w of rawWords) {
    const test = line ? line + ' ' + w : w;
    if (outCtx.measureText(test).width > maxW && line) { lines.push(line); line = w; }
    else line = test;
  }
  if (line) lines.push(line);

  const lineH  = fs * cs.lineHeight;
  const totalH = lines.length * lineH;
  const cx     = (cs.positionX / 100) * cw;
  const cy     = (cs.positionY / 100) * ch;

  // Compute word-level data for highlight (per-line)
  let wordTimes = [];
  if (cs.highlightEnabled && seg.words && seg.words.length) {
    wordTimes = seg.words;
  }

  // ── Background box ──────────────────────────────────────────────────────────
  if (cs.bgOpacity > 0) {
    const pad    = cs.bgPadding * scl;
    const lineWidths = lines.map(l => outCtx.measureText(l).width);
    const maxLW  = Math.max(...lineWidths);
    const bgW    = maxLW + pad * 2;
    const bgH    = totalH + pad * 2;
    const bgX    = cs.textAlign === 'center' ? cx - bgW / 2 :
                   cs.textAlign === 'right'  ? cx - bgW    : cx;
    const bgY    = cy - totalH / 2 - pad;
    const r      = cs.bgRadius * scl;

    outCtx.globalAlpha = cs.bgOpacity;
    outCtx.fillStyle   = cs.bgColor;
    if (r > 0 && outCtx.roundRect) {
      outCtx.beginPath();
      outCtx.roundRect(bgX, bgY, bgW, bgH, r);
      outCtx.fill();
    } else {
      outCtx.fillRect(bgX, bgY, bgW, bgH);
    }
    outCtx.globalAlpha = 1;
  }

  // ── Draw lines ──────────────────────────────────────────────────────────────
  lines.forEach((lineText, li) => {
    const lx = cx;
    const ly = cy - totalH / 2 + li * lineH + lineH / 2;

    if (cs.highlightEnabled && wordTimes.length && cs.animStyle !== 'pop') {
      // Word-level highlight: render word-by-word
      _drawLineWithHighlight(lineText, lx, ly, fs, cs, t, wordTimes, scl);
    } else {
      // Normal render
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
  // Stroke / outline
  if (cs.strokeWidth > 0) {
    outCtx.lineWidth   = cs.strokeWidth * scl * 2;
    outCtx.strokeStyle = cs.strokeColor;
    outCtx.lineJoin    = 'round';
    outCtx.strokeText(text, x, y);
  }
  outCtx.shadowBlur = 0; outCtx.shadowOffsetX = 0; outCtx.shadowOffsetY = 0;
  outCtx.fillStyle  = fillColor;
  outCtx.fillText(text, x, y);
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
  return captions.find(c => t >= c.start && t < c.end) || null;
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
// ── Show the CUDA / no-GPU error modal ───────────────────────────────────────
function showCudaModal() {
  const el = document.getElementById('cuda-modal');
  if (el) el.style.display = 'flex';
}

async function generateCaptions() {
  if (!filename) return toast('Load a video first');
  const model    = document.getElementById('cc-model').value;
  const language = document.getElementById('cc-lang').value;
  const btn      = document.getElementById('cc-generate-btn');
  const status   = document.getElementById('cc-status');

  btn.disabled = true;
  setCaptionStatus('running', 'Checking GPU…');

  // ── Pre-flight: confirm NVIDIA GPU + faster-whisper are available ──────────
  try {
    const check = await (await fetch(`${API}/whisper_check`)).json();
    if (check.type === 'no-cuda') {
      setCaptionStatus('error', 'NVIDIA GPU required — see details');
      btn.disabled = false;
      showCudaModal();
      return;
    }
    if (check.type === 'none') {
      setCaptionStatus('error', 'faster-whisper not found — reinstall VertiCut');
      btn.disabled = false;
      return;
    }
  } catch {
    setCaptionStatus('error', 'Could not reach server'); btn.disabled = false; return;
  }

  setCaptionStatus('running', 'Starting Whisper…');

  let jobId;
  try {
    const r = await fetch(`${API}/transcribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename, model, language: language || null })
    });
    const d = await r.json();
    if (d.error) { setCaptionStatus('error', d.error); btn.disabled = false; return; }
    jobId = d.job_id;
  } catch (e) {
    setCaptionStatus('error', 'Server unreachable'); btn.disabled = false; return;
  }

  setCaptionStatus('running', `Running Whisper (${model})…`);

  if (captionPollTimer) clearInterval(captionPollTimer);
  captionPollTimer = setInterval(async () => {
    let pd;
    try { pd = await (await fetch(`${API}/transcribe_status/${jobId}`)).json(); }
    catch { return; }

    if (pd.status === 'done') {
      clearInterval(captionPollTimer); captionPollTimer = null;
      captions = pd.segments || [];
      captionStyle.enabled = captions.length > 0;
      setCaptionStatus('done', `✓ ${captions.length} segments`);
      btn.disabled = false;
      renderSegmentsList();
      // Auto-enable toggle
      const tog = document.getElementById('cc-enabled-toggle');
      if (tog) tog.checked = captionStyle.enabled;
      updateCaptionToggleUI();
      toast(`Captions generated: ${captions.length} segments`);
    } else if (pd.status === 'error') {
      clearInterval(captionPollTimer); captionPollTimer = null;
      setCaptionStatus('error', pd.error || 'Whisper failed');
      btn.disabled = false;
    }
    // else still running
  }, 1200);
}

function setCaptionStatus(state, msg) {
  const el = document.getElementById('cc-status');
  if (!el) return;
  el.textContent  = msg;
  el.className    = 'cc-status-text cc-status-' + state;
}

// ── Captions panel HTML ────────────────────────────────────────────────────────
function renderCaptionsPanel() {
  const panel = document.getElementById('panel-captions-content');
  if (!panel) return;

  panel.innerHTML = `
    <!-- ── Whisper Generate ─────────────────────────────────────── -->
    <div class="cc-section">
      <div class="cc-section-title">
        <svg width="11" height="11" viewBox="0 0 11 11" fill="currentColor"><polygon points="5.5,0.5 7,4 11,4.2 8.2,6.8 9.1,10.5 5.5,8.6 1.9,10.5 2.8,6.8 0,4.2 4,4"/></svg>
        WHISPER TRANSCRIPTION
      </div>
      <div class="cc-row">
        <div class="cc-field" style="flex:2">
          <label class="cc-label">Model</label>
          <select class="cc-select" id="cc-model">
            <option value="tiny">tiny — ~1 GB VRAM (fastest)</option>
            <option value="base" selected>base — ~1 GB VRAM</option>
            <option value="small">small — ~2 GB VRAM</option>
            <option value="medium">medium — ~5 GB VRAM</option>
            <option value="large-v2">large-v2 — ~10 GB VRAM</option>
            <option value="large-v3">large-v3 — ~10 GB VRAM (best)</option>
          </select>
        </div>
        <div class="cc-field" style="flex:1.4">
          <label class="cc-label">Language</label>
          <select class="cc-select" id="cc-lang">
            <option value="auto">auto</option>
            <option value="en">English</option>
            <option value="es">Spanish</option>
            <option value="fr">French</option>
            <option value="de">German</option>
            <option value="it">Italian</option>
            <option value="pt">Portuguese</option>
            <option value="ru">Russian</option>
            <option value="ja">Japanese</option>
            <option value="ko">Korean</option>
            <option value="zh">Chinese</option>
          </select>
        </div>
      </div>
      <div class="cc-field" style="width:100%">
        <label class="cc-label">Audio Track to Transcribe</label>
        <select class="cc-select" id="cc-track-select" onchange="captionTrackIdx=+this.value">
          <option value="0">Track 1 (default)</option>
        </select>
      </div>
      <button class="cc-generate-btn" id="cc-generate-btn" onclick="generateCaptions()">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8"><polygon points="2,1 11,6 2,11"/></svg>
        Generate Captions
      </button>
      <div class="cc-status-text" id="cc-status">Whisper must be installed: <code>pip install openai-whisper</code></div>
    </div>

    <!-- ── Style Controls ──────────────────────────────────────── -->
    <div class="cc-section">
      <div class="cc-section-title" style="justify-content:space-between">
        <span style="display:flex;align-items:center;gap:6px">
          <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor"><path d="M1 8h2l4.5-5.5L6 1 1 6.5V8zm7.2-6.2a.7.7 0 0 0 0-1L7.2.8a.7.7 0 0 0-1 0l-.7.7 1.5 1.5.7-.7z"/></svg>
          CAPTION STYLE
        </span>
        <label class="cc-toggle-wrap">
          <input type="checkbox" id="cc-enabled-toggle" onchange="onCaptionToggle(this.checked)">
          <span class="cc-toggle-track"></span>
          <span class="cc-toggle-label" id="cc-toggle-label">OFF</span>
        </label>
      </div>

      <!-- Typography -->
      <div class="cc-sub-label">Typography</div>
      <div class="cc-row">
        <div class="cc-field" style="flex:1">
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
      </div>
      <div class="cc-slider-row">
        <span class="cc-slider-label">Size</span>
        <input type="range" class="cc-slider" id="cc-font-size" min="20" max="180" step="1" value="72"
               oninput="updateCaptionStyle('fontSize',+this.value);document.getElementById('cc-font-size-val').textContent=this.value+'px'">
        <span class="cc-slider-val" id="cc-font-size-val">72px</span>
      </div>
      <div class="cc-row" style="gap:5px">
        <button class="cc-chip" id="cc-w-normal" onclick="setCaptionWeight('normal')">Normal</button>
        <button class="cc-chip active" id="cc-w-bold"   onclick="setCaptionWeight('bold')">Bold</button>
        <button class="cc-chip" id="cc-w-black"  onclick="setCaptionWeight('black')">Black</button>
        <button class="cc-chip" id="cc-italic-btn" onclick="toggleCaptionItalic()"><em>I</em></button>
        <button class="cc-chip" id="cc-caps-btn" onclick="toggleCaptionCaps()">TT</button>
      </div>

      <!-- Colors -->
      <div class="cc-sub-label">Colors</div>
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

      <!-- Position -->
      <div class="cc-sub-label">Position &amp; Layout</div>
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
      <div class="cc-row" style="gap:4px;margin-top:2px">
        <span class="cc-slider-label" style="min-width:42px">Align</span>
        <button class="cc-chip" id="cc-align-left"   onclick="updateCaptionStyle('textAlign','left')" title="Left">&#9664;</button>
        <button class="cc-chip active" id="cc-align-center" onclick="updateCaptionStyle('textAlign','center')" title="Center">&#9646;</button>
        <button class="cc-chip" id="cc-align-right"  onclick="updateCaptionStyle('textAlign','right')" title="Right">&#9654;</button>
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

      <!-- Effects -->
      <div class="cc-sub-label">Effects</div>
      <div class="cc-row" style="gap:8px;align-items:center">
        <label class="cc-inline-toggle">
          <input type="checkbox" id="cc-shadow-toggle" checked onchange="updateCaptionStyle('shadow',this.checked)">
          <span class="cc-inline-track"></span>
          <span style="font-size:0.68rem;color:var(--text-mid)">Shadow</span>
        </label>
        <label class="cc-color-swatch" style="margin-left:auto">
          <input type="color" id="cc-shadow-color" value="#000000" oninput="updateCaptionStyle('shadowColor',this.value)">
        </label>
      </div>
      <div class="cc-row" style="gap:8px;align-items:center;margin-top:6px">
        <label class="cc-inline-toggle">
          <input type="checkbox" id="cc-highlight-toggle" onchange="toggleWordHighlight(this.checked)">
          <span class="cc-inline-track"></span>
          <span style="font-size:0.68rem;color:var(--text-mid)">Word highlight</span>
        </label>
        <label class="cc-color-swatch" style="margin-left:auto" title="Highlight color">
          <input type="color" id="cc-highlight-color" value="#FFD60A" oninput="updateCaptionStyle('highlightColor',this.value)">
        </label>
      </div>
      <div class="cc-row" style="gap:8px;align-items:center;margin-top:6px">
        <span class="cc-slider-label" style="min-width:58px">Animation</span>
        <select class="cc-select" id="cc-anim" style="flex:1" onchange="updateCaptionStyle('animStyle',this.value)">
          <option value="none">None</option>
          <option value="pop">Pop</option>
          <option value="fade">Fade</option>
        </select>
      </div>
    </div>

    <!-- ── Segments List ────────────────────────────────────────── -->
    <div class="cc-section cc-segments-section">
      <div class="cc-section-title" style="justify-content:space-between">
        <span>SEGMENTS <span class="cc-seg-count" id="cc-seg-count"></span></span>
        <button class="cc-icon-btn" onclick="clearCaptions()" title="Clear all">✕ clear</button>
      </div>
      <div class="cc-segments-list" id="cc-segments-list">
        <div class="cc-empty-state">Generate captions to see segments here.</div>
      </div>
    </div>
  `;

  // Sync controls to current state
  syncCaptionControls();
}

// ── Sync all UI controls to captionStyle ──────────────────────────────────────
function syncCaptionControls() {
  const cs = captionStyle;
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

function onCaptionToggle(val) {
  captionStyle.enabled = val;
  updateCaptionToggleUI();
}

function updateCaptionStyle(key, value) {
  captionStyle[key] = value;
  // Specific UI sync side-effects
  if (key === 'textColor') {
    const el = document.getElementById('cc-text-color-hex');
    if (el) el.textContent = value.toUpperCase();
  }
  if (key === 'bgOpacity') updateBgRowOpacity();
  if (key === 'textAlign') updateAlignChips();
}

function updateBgRowOpacity() {
  const hasBg = captionStyle.bgOpacity > 0;
  ['cc-bg-radius-row','cc-bg-pad-row'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.opacity = hasBg ? '1' : '0.4';
  });
}

function setCaptionWeight(w) {
  captionStyle.fontWeight = w;
  updateWeightChips();
}
function updateWeightChips() {
  ['normal','bold','black'].forEach(w => {
    const el = document.getElementById('cc-w-' + w);
    if (el) el.classList.toggle('active', captionStyle.fontWeight === w);
  });
}

function toggleCaptionItalic() {
  captionStyle.fontItalic = !captionStyle.fontItalic;
  const el = document.getElementById('cc-italic-btn');
  if (el) el.classList.toggle('active', captionStyle.fontItalic);
}
function toggleCaptionCaps() {
  captionStyle.allCaps = !captionStyle.allCaps;
  const el = document.getElementById('cc-caps-btn');
  if (el) el.classList.toggle('active', captionStyle.allCaps);
}
function toggleWordHighlight(val) {
  captionStyle.highlightEnabled = val;
}
function updateAlignChips() {
  ['left','center','right'].forEach(a => {
    const el = document.getElementById('cc-align-' + a);
    if (el) el.classList.toggle('active', captionStyle.textAlign === a);
  });
}
function updateFlagChips() {
  const iEl = document.getElementById('cc-italic-btn');
  if (iEl) iEl.classList.toggle('active', captionStyle.fontItalic);
  const cEl = document.getElementById('cc-caps-btn');
  if (cEl) cEl.classList.toggle('active', captionStyle.allCaps);
}

// ── Segments list render ───────────────────────────────────────────────────────
function renderSegmentsList() {
  const container = document.getElementById('cc-segments-list');
  const countEl   = document.getElementById('cc-seg-count');
  if (!container) return;

  if (countEl) countEl.textContent = captions.length ? `(${captions.length})` : '';

  if (!captions.length) {
    container.innerHTML = '<div class="cc-empty-state">No segments yet. Generate captions above.</div>';
    return;
  }

  container.innerHTML = captions.map((seg, i) => `
    <div class="cc-segment" id="cc-seg-${i}">
      <div class="cc-seg-times">
        <input class="cc-time-input" value="${fmtCapTime(seg.start)}"
               onchange="updateSegmentTime(${i},'start',this.value)" title="Start time">
        <span class="cc-seg-arrow">→</span>
        <input class="cc-time-input" value="${fmtCapTime(seg.end)}"
               onchange="updateSegmentTime(${i},'end',this.value)" title="End time">
        <button class="cc-seg-del" onclick="deleteSegment(${i})" title="Delete">✕</button>
      </div>
      <textarea class="cc-seg-text" rows="2"
                onchange="updateSegmentText(${i},this.value)"
                oninput="this.style.height='auto';this.style.height=this.scrollHeight+'px'"
      >${escapeHtml(seg.text)}</textarea>
    </div>
  `).join('');
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
  if (!captions[i]) return;
  captions[i][key] = parseCapTime(val);
}
function updateSegmentText(i, val) {
  if (!captions[i]) return;
  captions[i].text = val;
}
function deleteSegment(i) {
  captions.splice(i, 1);
  renderSegmentsList();
}
function clearCaptions() {
  captions = [];
  captionStyle.enabled = false;
  const tog = document.getElementById('cc-enabled-toggle');
  if (tog) tog.checked = false;
  updateCaptionToggleUI();
  renderSegmentsList();
  setCaptionStatus('idle', 'Cleared.');
}

// ── Populate the track selector from loaded audioTracks ─────────────────────────
function updateCaptionTrackSelector() {
  const sel = document.getElementById('cc-track-select');
  if (!sel) return;
  const tracks = (typeof audioTracks !== 'undefined') ? audioTracks : [];
  if (!tracks.length) {
    sel.innerHTML = '<option value="0">Track 1 (default)</option>';
    captionTrackIdx = 0;
    return;
  }
  sel.innerHTML = tracks.map(t => {
    const label = t.label || `Track ${t.idx + 1}`;
    const detail = [t.codec, t.layout, t.channels ? `${t.channels}ch` : ''].filter(Boolean).join(' · ');
    return `<option value="${t.idx}">${label}${detail ? ' — ' + detail : ''}</option>`;
  }).join('');
  if (captionTrackIdx < tracks.length) sel.value = captionTrackIdx;
  else { captionTrackIdx = 0; sel.value = 0; }
}

// ── Initialize captions panel on load ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  renderCaptionsPanel();
});
