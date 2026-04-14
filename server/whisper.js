// ── Whisper transcription + ASS subtitle generation ───────────────────────────
const { spawn, spawnSync } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');
const { app } = require('electron').remote ?? require('@electron/remote') ?? {};
const { ffmpegPath } = require('./ffmpeg');

// ── Resolve the resources/ dir whether in asar or dev ─────────────────────────
function resourcesDir() {
  // In packaged app: process.resourcesPath is set by Electron
  if (process.resourcesPath) return process.resourcesPath;
  // Dev: two levels up from server/whisper.js → project root
  return path.resolve(__dirname, '..');
}

// ── Locate the Purfview faster-whisper standalone exe ─────────────────────────
function findWhisperExe() {
  const candidates = [
    path.join(resourcesDir(), 'whisper', 'faster-whisper.exe'), // packaged Windows
    path.join(resourcesDir(), 'whisper', 'faster-whisper'),      // packaged Linux
    path.join(__dirname, '..', 'resources', 'whisper', 'faster-whisper.exe'), // dev Windows
    path.join(__dirname, '..', 'resources', 'whisper', 'faster-whisper'),     // dev Linux
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// ── Inline Python script — fallback for dev / Linux ───────────────────────────
const FASTER_WHISPER_SCRIPT = `
import sys, json
from faster_whisper import WhisperModel

audio_path = sys.argv[1]
model_name = sys.argv[2]
language   = sys.argv[3] if len(sys.argv) > 3 and sys.argv[3] != 'auto' else None

model = WhisperModel(model_name, device='cuda', compute_type='float16')

segments, info = model.transcribe(
    audio_path,
    word_timestamps=True,
    vad_filter=True,
    vad_parameters={"min_silence_duration_ms": 500},
    language=language,
)

result = []
for seg in segments:
    result.append({
        'start': seg.start,
        'end':   seg.end,
        'text':  seg.text.strip(),
        'words': [{'word': w.word.strip(), 'start': w.start, 'end': w.end} for w in (seg.words or [])],
    })

print(json.dumps(result))
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

// ── Check NVIDIA GPU / CUDA is present on this machine ───────────────────────
function checkCuda() {
  // nvidia-smi is the most reliable cross-platform signal for an NVIDIA GPU
  for (const cmd of ['nvidia-smi', 'C:\\Windows\\System32\\nvidia-smi.exe']) {
    try {
      const r = spawnSync(cmd, [], { timeout: 6000, stdio: 'pipe' });
      if (!r.error && r.status === 0) return { available: true };
    } catch {}
  }
  return { available: false };
}

// ── Determine transcription backend ───────────────────────────────────────────
//   Returns { type: 'exe', exePath } | { type: 'python', python } | { type: 'none', hint } | { type: 'no-cuda' }
function checkWhisper() {
  // 1. Require NVIDIA GPU
  const cuda = checkCuda();
  if (!cuda.available) return { type: 'no-cuda' };

  // 2. Prefer the bundled standalone exe (ships with the Windows build)
  const exe = findWhisperExe();
  if (exe) return { type: 'exe', exePath: exe };

  // 3. Fall back to system Python + faster-whisper (dev / Linux)
  const python = findPython();
  if (python && hasFasterWhisperPython(python)) return { type: 'python', python };

  // 4. Nothing found
  return { type: 'none' };
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
async function transcribeVideo(filePath, model = 'base', language = null, outputsDir, trackIdx = 0) {
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
    const wc = checkWhisper();
    if (wc.type === 'no-cuda') throw new Error('NO_CUDA');
    if (wc.type === 'none')    throw new Error('NO_WHISPER');

    // ── 2a. Purfview standalone exe ──────────────────────────────────────────
    if (wc.type === 'exe') {
      const whisperOutDir = path.join(outputsDir, `whisper_${tmpId}`);
      fs.mkdirSync(whisperOutDir, { recursive: true });

      const args = [
        audioPath,
        '--model',                       model,
        '--output_format',               'json',
        '--output_dir',                  whisperOutDir,
        '--word_timestamps',             'True',
        '--vad_filter',                  'True',
        '--vad_min_silence_duration_ms', '500',
        '--device',                      'cuda',
        '--compute_type',                'float16',
      ];
      if (language && language !== 'auto') args.push('--language', language);

      await new Promise((resolve, reject) => {
        const proc = spawn(wc.exePath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
        let stderr = '';
        proc.stderr.on('data', d => { stderr += d.toString(); });
        proc.on('close', code => {
          if (code === 0) resolve();
          else reject(new Error(`faster-whisper exited ${code}: ${stderr.slice(-600)}`));
        });
        proc.on('error', e => reject(new Error(`Cannot start faster-whisper.exe: ${e.message}`)));
      });

      const baseName = path.basename(audioPath, path.extname(audioPath));
      const jsonFile  = path.join(whisperOutDir, `${baseName}.json`);
      if (!fs.existsSync(jsonFile)) throw new Error('faster-whisper produced no output JSON');

      const segments = parseExeJson(jsonFile);
      try { fs.rmSync(whisperOutDir, { recursive: true }); } catch {}
      return segments;
    }

    // ── 2b. Python fallback (dev / Linux) ────────────────────────────────────
    const scriptPath = path.join(outputsDir, `${tmpId}_fw.py`);
    fs.writeFileSync(scriptPath, FASTER_WHISPER_SCRIPT, 'utf8');

    const pyArgs = [scriptPath, audioPath, model];
    if (language && language !== 'auto') pyArgs.push(language);

    return await new Promise((resolve, reject) => {
      const proc = spawn(wc.python, pyArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      proc.stdout.on('data', d => { stdout += d.toString(); });
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        try { fs.unlinkSync(scriptPath); } catch {}
        if (code !== 0) return reject(new Error(`faster-whisper exited ${code}: ${stderr.slice(-600)}`));
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

module.exports = { checkWhisper, transcribeVideo, generateASSFile };
