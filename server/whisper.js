// ── Whisper transcription + ASS subtitle generation ───────────────────────────
const { spawn, spawnSync } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const { v4: uuidv4 } = require('uuid');
const { ffmpegPath } = require('./ffmpeg');

// ── Check if whisper CLI is available ─────────────────────────────────────────
function checkWhisper() {
  const attempts = [
    { cmd: 'whisper',  args: ['--help'] },
    { cmd: 'python',   args: ['-m', 'whisper', '--help'] },
    { cmd: 'python3',  args: ['-m', 'whisper', '--help'] },
  ];
  for (const a of attempts) {
    try {
      const r = spawnSync(a.cmd, a.args, { timeout: 8000, stdio: 'pipe' });
      if (r.error) continue;
      const out = (r.stdout || '').toString() + (r.stderr || '').toString();
      // Confirm it's actually the whisper transcription tool
      if (out.includes('transcribe') || out.includes('--model') || out.includes('audio')) {
        return { available: true, cmd: a.cmd, extraArgs: a.args.slice(0, a.args.length - 1) };
      }
    } catch {}
  }
  return { available: false };
}

// ── Extract audio + run Whisper, return segments ───────────────────────────────
async function transcribeVideo(filePath, model = 'base', language = null, outputsDir, trackIdx = 0) {
  const tmpId        = uuidv4();
  const audioPath    = path.join(outputsDir, `${tmpId}_audio.wav`);
  const whisperOutDir = path.join(outputsDir, `whisper_${tmpId}`);
  fs.mkdirSync(whisperOutDir, { recursive: true });

  try {
    // 1. Extract the selected audio track as mono 16kHz WAV (Whisper's native format)
    await new Promise((resolve, reject) => {
      const proc = spawn(ffmpegPath, [
        '-i', filePath,
        '-map', `0:a:${trackIdx}`,
        '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
        '-y', audioPath
      ]);
      let err = '';
      proc.stderr.on('data', d => { err += d; });
      proc.on('close', code => code === 0 ? resolve() : reject(new Error(`Audio extraction failed (exit ${code}): ${err.slice(-300)}`)));
    });

    // 2. Determine whisper command
    const wc = checkWhisper();
    if (!wc.available) throw new Error('Whisper is not installed.\nRun: pip install openai-whisper');

    const whisperArgs = [
      audioPath,
      '--model', model,
      '--output_format', 'json',
      '--output_dir', whisperOutDir,
      '--word_timestamps', 'True',
    ];
    if (language && language !== 'auto') whisperArgs.push('--language', language);

    const finalCmd  = wc.cmd;
    const finalArgs = wc.extraArgs.length ? [...wc.extraArgs, ...whisperArgs] : whisperArgs;

    await new Promise((resolve, reject) => {
      const proc = spawn(finalCmd, finalArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => { stderr += d.toString(); });
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Whisper exited ${code}: ${stderr.slice(-600)}`));
      });
      proc.on('error', e => reject(new Error(`Cannot start Whisper: ${e.message}`)));
    });

    // 3. Parse result
    const baseName = path.basename(audioPath, path.extname(audioPath));
    const jsonFile  = path.join(whisperOutDir, `${baseName}.json`);
    if (!fs.existsSync(jsonFile)) throw new Error('Whisper produced no output JSON');

    const raw = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
    return (raw.segments || []).map(s => ({
      start: s.start,
      end:   s.end,
      text:  s.text.trim(),
      words: (s.words || []).map(w => ({
        word:  (w.word || '').trim(),
        start: w.start ?? s.start,
        end:   w.end   ?? s.end,
      })),
    }));
  } finally {
    try { fs.unlinkSync(audioPath); }      catch {}
    try { fs.rmSync(whisperOutDir, { recursive: true }); } catch {}
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

  // Background: if bgOpacity > 0 use opaque box (BorderStyle 3), else outline (BorderStyle 1)
  const hasBg       = (style.bgOpacity || 0) > 0.05;
  const borderStyle = hasBg ? 3 : 1;
  const backColor   = hasBg ? cssToASS(style.bgColor, style.bgOpacity) : '&H00000000';
  const outline     = hasBg ? 0 : Math.max(0, Math.round(style.strokeWidth || 0));
  const shadow      = (!hasBg && style.shadow) ? 2 : 0;

  // Alignment: ASS numpad scheme — 2=bottom-center, 1=bottom-left, 3=bottom-right
  const assAlign = style.textAlign === 'left' ? 1 : style.textAlign === 'right' ? 3 : 2;

  // Position (% → absolute in PlayRes space)
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
    // Escape ASS special chars
    text = text.replace(/\\/g, '').replace(/\{/g, '').replace(/\n/g, '\\N');

    // Override position per-line so it ignores margin settings
    const tag = `{\\an5\\pos(${posX},${posY})}`;
    ass += `Dialogue: 0,${toASSTime(cs)},${toASSTime(ce)},Default,,0,0,0,,${tag}${text}\n`;
  }

  fs.writeFileSync(outputPath, ass, 'utf8');
}

module.exports = { checkWhisper, transcribeVideo, generateASSFile };
