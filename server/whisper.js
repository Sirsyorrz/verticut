// ── Whisper transcription + ASS subtitle generation ───────────────────────────
const { spawn, spawnSync } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const https  = require('https');
const os     = require('os');
const { v4: uuidv4 } = require('uuid');
const { ffmpegPath } = require('./ffmpeg');

// ── Build env with CUDA lib path guaranteed to be present ─────────────────────
function cudaEnv() {
  const cudaPaths = [
    '/opt/cuda/lib64',
    '/usr/local/cuda/lib64',
    '/usr/lib/cuda/lib64',
  ];
  const existing = (process.env.LD_LIBRARY_PATH || '').split(':').filter(Boolean);
  const merged   = [...new Set([...cudaPaths, ...existing])].join(':');

  // Preload tcmalloc to prevent glibc "double free or corruption" with CTranslate2
  const tcmalloc = '/usr/lib/libtcmalloc_minimal.so.4';
  const preload   = [tcmalloc, process.env.LD_PRELOAD].filter(Boolean).join(':');

  return { ...process.env, LD_LIBRARY_PATH: merged, LD_PRELOAD: preload };
}

// ── Locate the Purfview faster-whisper standalone exe ─────────────────────────
// whisperDir = userData/whisper (runtime download location)
function findWhisperExe(whisperDir) {
  // The bundled exe is a Windows binary — never attempt to run it on Linux/macOS
  if (process.platform !== 'win32') return null;

  const candidates = [
    whisperDir && path.join(whisperDir, 'faster-whisper.exe'), // flat extract (legacy)
    path.join(__dirname, '..', 'resources', 'whisper', 'faster-whisper.exe'), // dev fallback
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }

  // Check pointer file written when exe is inside a subfolder
  if (whisperDir) {
    const ptrFile = path.join(whisperDir, 'exe-path.txt');
    if (fs.existsSync(ptrFile)) {
      const ptr = fs.readFileSync(ptrFile, 'utf8').trim();
      if (fs.existsSync(ptr)) return ptr;
    }
  }

  return null;
}

// ── Inline Python script — fallback for dev / Linux ───────────────────────────
const FASTER_WHISPER_SCRIPT = `
import sys, json
from faster_whisper import WhisperModel

audio_path     = sys.argv[1]
model_name     = sys.argv[2]
language       = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != 'auto' else None
device         = sys.argv[4] if len(sys.argv) > 4 else 'cpu'
compute_type   = sys.argv[5] if len(sys.argv) > 5 else 'int8'
initial_prompt = sys.argv[6] if len(sys.argv) > 6 and sys.argv[6] else None
vad_silence_ms = int(sys.argv[7]) if len(sys.argv) > 7 else 300
temperature    = [float(t) for t in sys.argv[8].split(',')] if len(sys.argv) > 8 else 0
comp_threshold = float(sys.argv[9])  if len(sys.argv) > 9  else 2.4
no_speech_thr  = float(sys.argv[10]) if len(sys.argv) > 10 else 0.6

model = WhisperModel(model_name, device=device, compute_type=compute_type)

segments, info = model.transcribe(
    audio_path,
    word_timestamps=True,
    vad_filter=True,
    vad_parameters={"min_silence_duration_ms": vad_silence_ms},
    language=language,
    beam_size=5,
    temperature=temperature,
    condition_on_previous_text=False,
    compression_ratio_threshold=comp_threshold,
    no_speech_threshold=no_speech_thr,
    initial_prompt=initial_prompt,
)

result = []
for seg in segments:
    result.append({
        'start': seg.start,
        'end':   seg.end,
        'text':  seg.text.strip(),
        'words': [{'word': w.word.strip(), 'start': w.start, 'end': w.end} for w in (seg.words or [])],
    })

import sys
sys.stdout.write(json.dumps(result))
sys.stdout.flush()
import os
os._exit(0)
`;

// ── Detect a working Python + faster-whisper install ──────────────────────────
function findPython() {
  for (const cmd of ['python3', 'python']) {
    try {
      const r = spawnSync(cmd, ['--version'], { timeout: 5000, stdio: 'pipe' });
      if (!r.error && r.status === 0) return cmd;
    } catch {}
  }
  return null;
}

function hasFasterWhisperPython(python) {
  const r = spawnSync(python, ['-c', 'import faster_whisper'], { timeout: 8000, stdio: 'pipe' });
  return !r.error && r.status === 0;
}

// ── Detect GPU type: nvidia, amd, or cpu ─────────────────────────────────────
function detectGpu() {
  // Check NVIDIA first via nvidia-smi
  for (const cmd of ['nvidia-smi', 'C:\\Windows\\System32\\nvidia-smi.exe']) {
    try {
      const r = spawnSync(cmd, [], { timeout: 6000, stdio: 'pipe' });
      if (!r.error && r.status === 0) return 'nvidia';
    } catch {}
  }

  // Check AMD via rocminfo (Linux) or wmic on Windows
  if (process.platform === 'win32') {
    try {
      const r = spawnSync('wmic', ['path', 'win32_VideoController', 'get', 'name'], { timeout: 6000, stdio: 'pipe' });
      if (!r.error && r.status === 0) {
        const out = (r.stdout || '').toString().toLowerCase();
        if (out.includes('amd') || out.includes('radeon')) return 'amd';
      }
    } catch {}
  } else {
    try {
      const r = spawnSync('rocminfo', [], { timeout: 6000, stdio: 'pipe' });
      if (!r.error && r.status === 0) return 'amd';
    } catch {}
  }

  return 'cpu';
}

// ── Map GPU type to faster-whisper device + compute_type ─────────────────────
function getDeviceArgs(gpu) {
  if (gpu === 'nvidia') return { device: 'cuda',  computeType: 'float16' };
  // AMD on Windows: ROCm isn't supported by faster-whisper; fall back to CPU
  // AMD on Linux:   ROCm may work but we stay safe with CPU
  return                       { device: 'cpu',   computeType: 'int8' };
}

// ── Determine transcription backend ───────────────────────────────────────────
//   Returns { type: 'exe', exePath, device, computeType }
//         | { type: 'python', python, device, computeType }
//         | { type: 'none' }
function checkWhisper(whisperDir) {
  const gpu        = detectGpu();
  const deviceArgs = getDeviceArgs(gpu);

  // 1. Prefer the downloaded/bundled standalone exe
  const exe = findWhisperExe(whisperDir);
  if (exe) return { type: 'exe', exePath: exe, gpu, ...deviceArgs };

  // 2. Fall back to system Python + faster-whisper (dev / Linux)
  const python = findPython();
  if (python && hasFasterWhisperPython(python)) return { type: 'python', python, gpu, ...deviceArgs };

  // 3. Not installed yet
  return { type: 'not-installed' };
}

// ── Parse JSON file produced by Purfview exe ──────────────────────────────────
function parseExeJson(jsonFile) {
  const raw = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
  // Purfview outputs { segments: [...] } — same shape as openai-whisper JSON
  return (raw.segments || []).map(s => ({
    start: s.start,
    end:   s.end,
    text:  (s.text || '').trim(),
    words: (s.words || []).map(w => ({
      word:  (w.word || '').trim(),
      start: w.start ?? s.start,
      end:   w.end   ?? s.end,
    })),
  }));
}

// ── Extract audio + transcribe, return segments ────────────────────────────────
// ── Per-mode transcription settings ─────────────────────────────────────────
// multiSpeaker = true when >1 track is being transcribed (back-and-forth convo)
function transcriptionSettings(multiSpeaker) {
  if (multiSpeaker) return {
    vad_min_silence_duration_ms: '500',  // longer gaps between speakers in conversation
    beam_size:                   '5',
    temperature:                 '0,0.2',  // small fallback for overlapping/unclear speech
    condition_on_previous_text:  'False',
    compression_ratio_threshold: '2.8',    // looser — overlapping voices look repetitive
    no_speech_threshold:         '0.5',    // looser — quieter speakers score lower
  };
  // Single speaker / solo commentary
  return {
    vad_min_silence_duration_ms: '300',
    beam_size:                   '5',
    temperature:                 '0',
    condition_on_previous_text:  'False',
    compression_ratio_threshold: '2.4',
    no_speech_threshold:         '0.6',
  };
}

// ── Merge diarization dump with whisper segments ─────────────────────────────
// Dump format (one line per speaker turn): SPEAKER_XX  startSec  endSec
function mergeDiarization(segments, dumpPath) {
  if (!fs.existsSync(dumpPath)) return segments;
  const dump = fs.readFileSync(dumpPath, 'utf8').trim().split('\n')
    .filter(Boolean)
    .map(line => {
      const parts = line.trim().split(/\s+/);
      return { speaker: parts[0], start: +parts[1], end: +parts[2] };
    })
    .filter(d => d.speaker && !isNaN(d.start) && !isNaN(d.end));

  return segments.map(seg => {
    const mid = (seg.start + seg.end) / 2;
    const match = dump.find(d => mid >= d.start && mid <= d.end)
      // fallback: nearest speaker window if midpoint falls in a gap
      ?? dump.reduce((best, d) => {
        const dist = Math.min(Math.abs(mid - d.start), Math.abs(mid - d.end));
        const bestDist = best ? Math.min(Math.abs(mid - best.start), Math.abs(mid - best.end)) : Infinity;
        return dist < bestDist ? d : best;
      }, null);
    return { ...seg, speaker: match?.speaker ?? 'SPEAKER_00' };
  });
}

async function transcribeVideo(filePath, model = 'base', language = null, outputsDir, trackIdx = 0, whisperDir = null, initialPrompt = null, multiSpeaker = false, diarize = false, numSpeakers = null) {
  const tmpId     = uuidv4();
  const audioPath = path.join(outputsDir, `${tmpId}_audio.wav`);

  try {
    // 1. Extract audio track → mono 16 kHz WAV
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-i', filePath,
        '-map', `0:a:${trackIdx}`,
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
        '-y', audioPath,
      ]);
      let err = '';
      proc.stderr.on('data', d => { err += d; });
      proc.on('close', code =>
        code === 0 ? resolve() : reject(new Error(`Audio extraction failed (exit ${code}): ${err.slice(-300)}`))
      );
    });

    // 2. Detect backend
    const wc = checkWhisper(whisperDir);
    if (wc.type === 'not-installed') throw new Error('NO_WHISPER');

    // ── 2a. Purfview standalone exe ──────────────────────────────────────────
    if (wc.type === 'exe') {
      const whisperOutDir = path.join(outputsDir, `whisper_${tmpId}`);
      fs.mkdirSync(whisperOutDir, { recursive: true });

      const s = transcriptionSettings(multiSpeaker);
      const args = [
        audioPath,
        '--model',                        model,
        '--output_format',                'json',
        '--output_dir',                   whisperOutDir,
        '--word_timestamps',              'True',
        '--vad_filter',                   'True',
        '--vad_min_silence_duration_ms',  s.vad_min_silence_duration_ms,
        '--device',                       wc.device,
        '--compute_type',                 wc.computeType,
        '--beam_size',                    s.beam_size,
        '--temperature',                  s.temperature,
        '--condition_on_previous_text',   s.condition_on_previous_text,
        '--compression_ratio_threshold',  s.compression_ratio_threshold,
        '--no_speech_threshold',          s.no_speech_threshold,
      ];
      if (language && language !== 'auto') args.push('--language', language);
      if (initialPrompt) args.push('--initial_prompt', initialPrompt);
      if (diarize) {
        // pyannote_v3.1 requires CUDA; pyannote_v3.0 works on CPU
        const diarizeModel = wc.device === 'cuda' ? 'pyannote_v3.1' : 'pyannote_v3.0';
        args.push('--diarize', diarizeModel, '--diarize_dump');
        if (numSpeakers) {
          args.push('--min_speakers', String(numSpeakers), '--max_speakers', String(numSpeakers));
        }
      }

      await new Promise((resolve, reject) => {
        const proc = spawn(wc.exePath, args, { stdio: ['ignore', 'pipe', 'pipe'], env: cudaEnv() });
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`faster-whisper exited ${code}: ${stderr.slice(-600)}`));
        });
        proc.on('error', e => reject(new Error(`Cannot start faster-whisper.exe: ${e.message}`)));
      });

      // Find output files — Purfview uses the input file's basename, not necessarily ours
      const allFiles  = fs.readdirSync(whisperOutDir);
      const jsonName  = allFiles.find(f => f.endsWith('.json'));
      const dumpName  = allFiles.find(f => f.endsWith('.dump'));
      if (!jsonName) throw new Error('faster-whisper produced no output JSON');

      const jsonFile = path.join(whisperOutDir, jsonName);
      const dumpFile = dumpName ? path.join(whisperOutDir, dumpName) : null;

      let segments = parseExeJson(jsonFile);

      if (diarize) {
        if (dumpFile) segments = mergeDiarization(segments, dumpFile);
        const speakers = [...new Set(segments.map(s => s.speaker).filter(Boolean))].sort();
        try { fs.rmSync(whisperOutDir, { recursive: true }); } catch {}
        return { segments, speakers: speakers.length > 1 ? speakers : [] };
      }

      try { fs.rmSync(whisperOutDir, { recursive: true }); } catch {}
      return segments;
    }

    // ── 2b. Python fallback (dev / Linux) ────────────────────────────────────
    const scriptPath = path.join(outputsDir, `${tmpId}_fw.py`);
    fs.writeFileSync(scriptPath, FASTER_WHISPER_SCRIPT, 'utf8');

    const s = transcriptionSettings(multiSpeaker);
    const pyArgs = [
      scriptPath, audioPath, model, language || 'auto',
      wc.device, wc.computeType, initialPrompt || '',
      s.vad_min_silence_duration_ms, s.temperature,
      s.compression_ratio_threshold, s.no_speech_threshold,
    ];

    return await new Promise((resolve, reject) => {
      const proc = spawn(wc.python, pyArgs, { stdio: ['ignore', 'pipe', 'pipe'], env: cudaEnv() });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', (code, signal) => {
        try { fs.unlinkSync(scriptPath); } catch {}
        if (code !== 0 || signal) {
          const detail = stderr.slice(-1000) || '(no stderr)';
          return reject(new Error(`faster-whisper exited code=${code} signal=${signal}\n${detail}`));
        }
        try { resolve(JSON.parse(stdout)); }
        catch (e) { reject(new Error(`Failed to parse faster-whisper output: ${e.message}`)); }
      });
      proc.on('error', e => reject(new Error(`Cannot start Python: ${e.message}`)));
    });

  } finally {
    try { fs.unlinkSync(audioPath); } catch {}
  }
}

// ── CSS hex color → ASS color &HAABBGGRR ──────────────────────────────────────
function cssToASS(hex, alpha = 1) {
  const clean = (hex || '#000000').replace('#', '');
  const r = parseInt(clean.slice(0, 2), 16) || 0;
  const g = parseInt(clean.slice(2, 4), 16) || 0;
  const b = parseInt(clean.slice(4, 6), 16) || 0;
  const a = Math.round((1 - Math.max(0, Math.min(1, alpha))) * 255);
  const h = v => v.toString(16).padStart(2, '0').toUpperCase();
  return `&H${h(a)}${h(b)}${h(g)}${h(r)}`;
}

// ── Seconds → ASS time H:MM:SS.cc ─────────────────────────────────────────────
function toASSTime(sec) {
  const s = Math.max(0, sec);
  const h  = Math.floor(s / 3600);
  const m  = Math.floor((s % 3600) / 60);
  const ss = Math.floor(s % 60);
  const cs = Math.round((s % 1) * 100);
  return `${h}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}.${String(cs).padStart(2,'0')}`;
}

// ── Generate .ass subtitle file from caption segments + style ──────────────────
function generateASSFile(captions, style, outputPath, playResX = 1080, playResY = 1920, trimStart = 0, trimEnd = null) {
  const fontName   = (style.fontFamily || 'Arial').replace(/['"]/g, '').trim();
  const fontSize   = Math.max(8, Math.round(style.fontSize || 72));
  const bold       = ['bold','700','800','900','black','heavy'].includes(String(style.fontWeight).toLowerCase()) ? -1 : 0;
  const italic     = style.fontItalic ? -1 : 0;
  const spacing    = Math.max(0, Math.round(style.letterSpacing || 0));

  const primaryColor = cssToASS(style.textColor,   1);
  const outlineColor = cssToASS(style.strokeColor,  1);

  const hasBg       = (style.bgOpacity || 0) > 0.05;
  const borderStyle = hasBg ? 3 : 1;
  const backColor   = hasBg ? cssToASS(style.bgColor, style.bgOpacity) : '&H00000000';
  const outline     = hasBg ? 0 : Math.max(0, Math.round(style.strokeWidth || 0));
  const shadow      = (!hasBg && style.shadow) ? 2 : 0;

  const assAlign = style.textAlign === 'left' ? 1 : style.textAlign === 'right' ? 3 : 2;

  const posX = Math.round((style.positionX / 100) * playResX);
  const posY = Math.round((style.positionY / 100) * playResY);

  let ass = `[Script Info]
ScriptType: v4.00+
Collisions: Normal
PlayResX: ${playResX}
PlayResY: ${playResY}
Timer: 100.0000
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${fontName},${fontSize},${primaryColor},${primaryColor},${outlineColor},${backColor},${bold},${italic},0,0,100,100,${spacing},0,${borderStyle},${outline},${shadow},${assAlign},40,40,40,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const clipEnd = trimEnd !== null ? (trimEnd - trimStart) : Infinity;

  for (const seg of captions) {
    const ss = seg.start - trimStart;
    const se = seg.end   - trimStart;
    if (se <= 0 || ss >= clipEnd) continue;
    const cs = Math.max(0,      ss);
    const ce = Math.min(clipEnd, se);

    let text = (style.allCaps ? seg.text.toUpperCase() : seg.text).trim();
    text = text.replace(/\\/g, '').replace(/\{/g, '').replace(/\n/g, '\\N');

    const tag = `{\\an5\\pos(${posX},${posY})}`;
    ass += `Dialogue: 0,${toASSTime(cs)},${toASSTime(ce)},Default,,0,0,0,,${tag}${text}\n`;
  }

  fs.writeFileSync(outputPath, ass, 'utf8');
}

// ── Generate .ass with one named Style per track, all overlaid simultaneously ──────
function generateMultiTrackASSFile(tracks, outputPath, playResX = 1080, playResY = 1920, trimStart = 0, trimEnd = null) {
  const clipEnd = trimEnd !== null ? (trimEnd - trimStart) : Infinity;

  // Build style rows
  const styleRows = tracks.map((track, ti) => {
    const style    = track.style || {};
    // Strip quotes — ASS font names must not be quoted
    const fontName = (style.fontFamily || 'Arial').replace(/['"]/g, '').trim();
    const fontSize = Math.max(8, Math.round(style.fontSize || 72));
    // Map weight string to ASS bold flag (-1 = bold, 0 = normal)
    const fw       = String(style.fontWeight || 'bold').toLowerCase();
    const bold     = (fw === 'normal' || fw === '400') ? 0 : -1;
    const italic   = style.fontItalic ? -1 : 0;
    // Letter spacing in ASS is per-char spacing in pixels (integer)
    const spacing  = Math.max(0, Math.round(style.letterSpacing || 0));
    const primary  = cssToASS(style.textColor   || '#FFFFFF', 1);
    const outline  = cssToASS(style.strokeColor || '#000000', 1);
    const hasBg    = (style.bgOpacity || 0) > 0.05;
    const borderSt = hasBg ? 3 : 1;
    const back     = hasBg ? cssToASS(style.bgColor || '#000000', style.bgOpacity) : '&H00000000';
    const outlineW = hasBg ? 0 : Math.max(0, Math.round(style.strokeWidth || 4));
    const shadow   = (!hasBg && style.shadow !== false) ? 2 : 0;
    const assAlign = style.textAlign === 'left' ? 1 : style.textAlign === 'right' ? 3 : 2;
    return `Style: Track${ti},${fontName},${fontSize},${primary},${primary},${outline},${back},${bold},${italic},0,0,100,100,${spacing},0,${borderSt},${outlineW},${shadow},${assAlign},40,40,40,1`;
  }).join('\n');

  let ass = `[Script Info]
ScriptType: v4.00+
Collisions: Normal
PlayResX: ${playResX}
PlayResY: ${playResY}
Timer: 100.0000
WrapStyle: 0

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
${styleRows}

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  tracks.forEach((track, ti) => {
    const style  = track.style || {};
    const posX   = Math.round(((style.positionX ?? 50) / 100) * playResX);
    const posY   = Math.round(((style.positionY ?? 85) / 100) * playResY);
    const allCaps = style.allCaps || false;
    const styleName = `Track${ti}`;

    for (const seg of (track.segments || [])) {
      // Per-segment style override — write as inline ASS tags
      const ov    = seg.styleOverride || {};
      const fposX = ov.positionX != null ? Math.round((ov.positionX / 100) * playResX) : posX;
      const fposY = ov.positionY != null ? Math.round((ov.positionY / 100) * playResY) : posY;
      const fsize = ov.fontSize  != null ? Math.round(ov.fontSize) : null;
      const fclr  = ov.textColor ? cssToASS(ov.textColor, 1) : null;

      const ss = seg.start - trimStart;
      const se = seg.end   - trimStart;
      if (se <= 0 || ss >= clipEnd) continue;
      const cs2 = Math.max(0, ss);
      const ce2 = Math.min(clipEnd, se);

      let text = (allCaps ? seg.text.toUpperCase() : seg.text).trim();
      text = text.replace(/\\/g, '').replace(/\{/g, '').replace(/\n/g, '\\N');

      let inlineTags = `\\an5\\pos(${fposX},${fposY})`;
      if (fsize) inlineTags += `\\fs${fsize}`;
      if (fclr)  inlineTags += `\\1c${fclr}`;

      ass += `Dialogue: ${ti},${toASSTime(cs2)},${toASSTime(ce2)},${styleName},,0,0,0,,{${inlineTags}}${text}\n`;
    }
  });

  fs.writeFileSync(outputPath, ass, 'utf8');
}

// ── Runtime whisper download ───────────────────────────────────────────────────────────
const RELEASE_API = 'https://api.github.com/repos/Purfview/whisper-standalone-win/releases/tags/Faster-Whisper-XXL';

let _dlStatus = { state: 'idle', pct: 0, message: '' };

function getWhisperDownloadStatus() { return { ..._dlStatus }; }

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'verticut' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location).then(resolve).catch(reject);
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

async function downloadWhisper(whisperDir) {
  if (_dlStatus.state === 'downloading') return; // already in progress
  _dlStatus = { state: 'downloading', pct: 0, message: 'Fetching release info…' };

  try {
    fs.mkdirSync(whisperDir, { recursive: true });

    // 1. Fetch release metadata
    const apiRes = await httpsGet(RELEASE_API);
    let body = '';
    for await (const chunk of apiRes) body += chunk;
    const release = JSON.parse(body);

    // 2. Find the Windows .7z asset
    const asset = release.assets
      .filter(a => a.name.toLowerCase().includes('windows') && a.name.endsWith('.7z'))
      .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }))[0];

    if (!asset) throw new Error('No Windows .7z asset found in release');
    _dlStatus.message = `Downloading ${asset.name} (${(asset.size / 1e6).toFixed(0)} MB)…`;

    // 3. Download archive
    const archivePath = path.join(os.tmpdir(), asset.name);
    await new Promise(async (resolve, reject) => {
      const res = await httpsGet(asset.browser_download_url);
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));
      const total = parseInt(res.headers['content-length'] || '0', 10);
      let received = 0;
      const out = fs.createWriteStream(archivePath);
      res.on('data', chunk => {
        received += chunk.length;
        if (total) _dlStatus.pct = Math.floor((received / total) * 100);
      });
      res.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      res.on('error', reject);
    });

    // 4. Extract with 7zip-bin (already in node_modules from build scripts)
    _dlStatus = { state: 'downloading', pct: 100, message: 'Extracting…' };
    let path7za;
    try {
      // In a packaged app, 7zip-bin is unpacked from asar — resolve the real path
      path7za = require('7zip-bin').path7za;
      // electron-builder unpacks to app.asar.unpacked; fix path if still inside asar
      if (path7za.includes('app.asar') && !path7za.includes('app.asar.unpacked')) {
        path7za = path7za.replace('app.asar', 'app.asar.unpacked');
      }
    } catch {
      throw new Error('7zip-bin not available — cannot extract whisper archive');
    }
    // Use 'x' not 'e' — preserves subdirectory structure (_xxl_data/, etc.) required by the exe
    const result = spawnSync(path7za, ['x', archivePath, `-o${whisperDir}`, '-y'], { stdio: 'pipe' });
    if (result.status !== 0) throw new Error('7z extraction failed');

    // 5. Find the exe — do NOT move it, _xxl_data/ must stay alongside it
    const exePath = path.join(whisperDir, 'faster-whisper.exe');
    if (!fs.existsSync(exePath)) {
      // Search one level deep (archive may extract into a subfolder)
      let found = null;
      for (const entry of fs.readdirSync(whisperDir)) {
        const full = path.join(whisperDir, entry);
        if (fs.statSync(full).isDirectory()) {
          const sub = fs.readdirSync(full).find(f => f.toLowerCase().endsWith('.exe'));
          if (sub) { found = path.join(full, sub); break; }
        } else if (entry.toLowerCase().endsWith('.exe')) {
          found = full; break;
        }
      }
      if (!found) throw new Error('No .exe found after extraction');
      // Write a pointer file so findWhisperExe() can locate it regardless of subfolder name
      fs.writeFileSync(path.join(whisperDir, 'exe-path.txt'), found, 'utf8');
    }

    try { fs.unlinkSync(archivePath); } catch {}
    _dlStatus = { state: 'done', pct: 100, message: 'Captions ready!' };

  } catch (err) {
    _dlStatus = { state: 'error', pct: 0, message: err.message };
  }
}

module.exports = { checkWhisper, transcribeVideo, mergeDiarization, generateASSFile, generateMultiTrackASSFile, downloadWhisper, getWhisperDownloadStatus };
