const express  = require('express');
const multer   = require('multer');
const cors     = require('cors');
const { v4: uuidv4 } = require('uuid');
const { spawn }      = require('child_process');
const path  = require('path');
const fs    = require('fs');

// ── FFmpeg / FFprobe paths ─────────────────────────────────────────────────────
// In production Electron builds the binaries live in app.asar.unpacked, so we
// fix the path when needed.
function fixAsarPath(p) {
  if (p && p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    return p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
}

const ffmpegPath  = fixAsarPath(require('ffmpeg-static'));
const ffprobePath = fixAsarPath(require('ffprobe-static').path);

// ── In-memory job store ────────────────────────────────────────────────────────
const jobs = {};           // jobId -> { status, progressPath, outputFile, error }
const procs = {};          // jobId -> ChildProcess  (so we can kill on quit)

// ── Video info via ffprobe ─────────────────────────────────────────────────────
function getVideoInfo(filepath) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffprobePath, [
      '-v', 'quiet', '-print_format', 'json',
      '-show_streams', '-show_format', filepath
    ]);
    let stdout = '';
    proc.stdout.on('data', d => (stdout += d.toString()));
    proc.stderr.on('data', () => {});
    proc.on('close', code => {
      if (code !== 0) return reject(new Error('ffprobe failed'));
      try {
        const data = JSON.parse(stdout);
        const vs          = data.streams.find(s => s.codec_type === 'video');
        const audioStreams = data.streams.filter(s => s.codec_type === 'audio');
        const dur  = parseFloat(data.format.duration || 0);
        const [num, den] = (vs.r_frame_rate || '30/1').split('/');
        const audioInfo = audioStreams.map((s, i) => ({
          idx:      i,
          codec:    s.codec_name || 'audio',
          channels: s.channels  || 2,
          layout:   s.channel_layout || '',
          label:    (s.tags && (s.tags.title || s.tags.language)) || `Track ${i + 1}`
        }));
        resolve({ width: vs.width, height: vs.height, duration: dur, fps: num / den,
                  audioCount: audioStreams.length, audioInfo });
      } catch (e) { reject(e); }
    });
  });
}

// ── Main export ────────────────────────────────────────────────────────────────
function startServer(port, userDataPath) {
  return new Promise((resolve, reject) => {
    const uploadsDir = path.join(userDataPath, 'uploads');
    const outputsDir = path.join(userDataPath, 'outputs');
    fs.mkdirSync(uploadsDir, { recursive: true });
    fs.mkdirSync(outputsDir, { recursive: true });

    const app = express();
    app.use(cors());
    app.use(express.json({ limit: '10mb' }));
    app.use(express.static(path.join(__dirname, 'static')));

    // ── Multer upload storage ────────────────────────────────────────────────
    const storage = multer.diskStorage({
      destination: (req, file, cb) => cb(null, uploadsDir),
      filename:    (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase() || '.mp4';
        cb(null, `${uuidv4()}${ext}`);
      }
    });
    const upload = multer({ storage });

    // ── POST /upload ─────────────────────────────────────────────────────────
    app.post('/upload', upload.single('video'), async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'No video file' });
      try {
        const info = await getVideoInfo(req.file.path);
        res.json({
          filename:     req.file.filename,
          width:        info.width,
          height:       info.height,
          duration:     info.duration,
          fps:          info.fps,
          audio_tracks: info.audioInfo || []
        });
      } catch (e) {
        res.status(500).json({ error: e.message });
      }
    });

    // ── GET /video/:filename ─────────────────────────────────────────────────
    app.get('/video/:filename', (req, res) => {
      const fp = path.join(uploadsDir, req.params.filename);
      if (!fs.existsSync(fp)) return res.status(404).send('Not found');
      res.sendFile(fp);
    });

    // ── GET /audio_track/:filename/:idx ──────────────────────────────────────
    app.get('/audio_track/:filename/:idx', async (req, res) => {
      const fp  = path.join(uploadsDir, req.params.filename);
      const idx = parseInt(req.params.idx);
      if (isNaN(idx) || idx < 0) return res.status(400).send('Bad track index');
      if (!fs.existsSync(fp))    return res.status(404).send('Not found');

      const base      = path.basename(fp, path.extname(fp));
      const trackFile = `track_${base}_${idx}.mp3`;
      const trackPath = path.join(outputsDir, trackFile);

      if (!fs.existsSync(trackPath)) {
        try {
          await new Promise((resolve, reject) => {
            const proc = spawn(ffmpegPath, [
              '-i', fp,
              '-map', `0:a:${idx}`,
              '-c:a', 'libmp3lame', '-b:a', '128k',
              '-y', trackPath
            ]);
            proc.stderr.on('data', () => {});
            proc.on('close', code => code === 0 ? resolve() : reject(new Error(`FFmpeg exit ${code}`)));
          });
        } catch (e) {
          return res.status(500).send(e.message);
        }
      }
      res.sendFile(trackPath);
    });

    // ── POST /process ────────────────────────────────────────────────────────
    app.post('/process', async (req, res) => {
      const data = req.body;
      const { filename, zones,
              output_width  = 1080,
              output_height = 1920,
              output_fps    = 60    } = data;
      const trimStart   = data.trim_start    || 0;
      const trimEnd     = data.trim_end      || null;
      const mutedTracks = data.muted_tracks  || [];   // array of track indices to exclude

      const filepath = path.join(uploadsDir, filename);
      if (!fs.existsSync(filepath))
        return res.status(404).json({ error: 'Source video not found' });

      let info;
      try { info = await getVideoInfo(filepath); }
      catch (e) { return res.status(500).json({ error: e.message }); }

      const outDuration = trimEnd
        ? trimEnd - trimStart
        : (trimStart > 0 ? info.duration - trimStart : info.duration);

      const outId       = uuidv4();
      const outputFile  = `output_${outId}.mp4`;
      const outputPath  = path.join(outputsDir, outputFile);
      const progressPath = path.join(outputsDir, `progress_${outId}.txt`).replace(/\\/g, '/');

      // Validate zones
      for (let i = 0; i < zones.length; i++) {
        if (parseInt(zones[i].src_w) <= 0 || parseInt(zones[i].src_h) <= 0)
          return res.status(400).json({ error: `Zone ${i + 1} has zero source dimensions` });
        if (parseInt(zones[i].dst_w) <= 0 || parseInt(zones[i].dst_h) <= 0)
          return res.status(400).json({ error: `Zone ${i + 1} has zero destination dimensions` });
      }

      // Trim filter string
      let trimFilter = '';
      if (trimEnd)          trimFilter = `trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS,`;
      else if (trimStart > 0) trimFilter = `trim=start=${trimStart},setpts=PTS-STARTPTS,`;

      // Padding for out-of-bounds SRC crops (letterboxing)
      const vidW  = info.width, vidH = info.height;
      const padL  = Math.max(0, -Math.min(...zones.map(z => parseInt(z.src_x))));
      const padT  = Math.max(0, -Math.min(...zones.map(z => parseInt(z.src_y))));
      const padR  = Math.max(0, Math.max(...zones.map(z => parseInt(z.src_x) + parseInt(z.src_w))) - vidW);
      const padB  = Math.max(0, Math.max(...zones.map(z => parseInt(z.src_y) + parseInt(z.src_h))) - vidH);
      const padW  = vidW + padL + padR;
      const padH  = vidH + padT + padB;
      const padFilter = (padL || padT || padR || padB)
        ? `pad=${padW}:${padH}:${padL}:${padT},`
        : '';

      // Build filter_complex
      const filterParts = [];
      filterParts.push(`color=black:s=${output_width}x${output_height}:r=${output_fps}[canvas]`);

      for (let i = 0; i < zones.length; i++) {
        const z  = zones[i];
        const sx = parseInt(z.src_x) + padL;
        const sy = parseInt(z.src_y) + padT;
        const sw = parseInt(z.src_w), sh = parseInt(z.src_h);
        const dw = parseInt(z.dst_w), dh = parseInt(z.dst_h);
        const blurSigma = parseFloat(z.blur) || 0;
        const blurFilter = blurSigma > 0 ? `,gblur=sigma=${blurSigma}` : '';
        filterParts.push(
          `[0:v]${trimFilter}${padFilter}crop=${sw}:${sh}:${sx}:${sy},scale=${dw}:${dh}${blurFilter}[z${i}]`
        );
      }

      let prev = 'canvas';
      for (let i = 0; i < zones.length; i++) {
        const dx  = parseInt(zones[i].dst_x);
        const dy  = parseInt(zones[i].dst_y);
        const nxt = i < zones.length - 1 ? `ov${i}` : 'out';
        filterParts.push(`[${prev}][z${i}]overlay=${dx}:${dy}:shortest=1[${nxt}]`);
        prev = nxt;
      }

      // ── Audio: trim + merge active (non-muted) tracks into one ───────────
      const audioCount  = info.audioCount || 0;
      // Build list of track indices that are NOT muted
      const activeTracks = [];
      for (let ai = 0; ai < audioCount; ai++) {
        if (!mutedTracks.includes(ai)) activeTracks.push(ai);
      }
      let audioFilterStr = '';
      let audioMapArg    = null;

      if (activeTracks.length > 0) {
        // Build per-track atrim filter string (empty if no trim needed)
        let aTrim = '';
        if (trimEnd)          aTrim = `atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS`;
        else if (trimStart>0) aTrim = `atrim=start=${trimStart},asetpts=PTS-STARTPTS`;

        if (activeTracks.length === 1 && !aTrim) {
          // Single active track, no trim — map directly
          audioMapArg = `0:a:${activeTracks[0]}`;
        } else if (activeTracks.length === 1) {
          // Single active track with trim
          const ai = activeTracks[0];
          audioFilterStr = `;[0:a:${ai}]${aTrim}[aout]`;
          audioMapArg = '[aout]';
        } else {
          // Multiple active tracks — trim each if needed, then amix into one
          const labels = [];
          for (const ai of activeTracks) {
            if (aTrim) {
              audioFilterStr += `;[0:a:${ai}]${aTrim}[at${ai}]`;
              labels.push(`[at${ai}]`);
            } else {
              labels.push(`[0:a:${ai}]`);
            }
          }
          audioFilterStr += `;${labels.join('')}amix=inputs=${activeTracks.length}:duration=longest:normalize=0[aout]`;
          audioMapArg = '[aout]';
        }
      }

      const fullFilterComplex = filterParts.join(';') + audioFilterStr;
      const cmd = [
        '-i', filepath,
        '-filter_complex', fullFilterComplex,
        '-map', '[out]',
        ...(audioMapArg ? ['-map', audioMapArg] : []),
        '-c:v', 'libx264', '-crf', '18', '-preset', 'fast',
        ...(audioMapArg ? ['-c:a', 'aac', '-b:a', '192k'] : []),
        '-r', String(output_fps),
        '-t', String(outDuration),
        '-progress', progressPath,
        '-stats_period', '0.5',
        '-loglevel', 'error',
        '-y', outputPath
      ];

      const jobId = uuidv4();
      jobs[jobId] = { status: 'running', progressPath, outputFile, error: null };

      const proc = spawn(ffmpegPath, cmd);
      procs[jobId] = proc;

      let stderrBuf = '';
      proc.stderr.on('data', d => { stderrBuf += d.toString(); });
      proc.on('close', code => {
        delete procs[jobId];
        if (code === 0) {
          jobs[jobId].status = 'done';
        } else {
          jobs[jobId].status = 'error';
          jobs[jobId].error  = stderrBuf || `FFmpeg exited with code ${code}`;
        }
        try { fs.unlinkSync(progressPath); } catch {}
      });

      res.json({ job_id: jobId, output_file: outputFile });
    });

    // ── GET /progress/:jobId ─────────────────────────────────────────────────
    app.get('/progress/:jobId', (req, res) => {
      const job = jobs[req.params.jobId];
      if (!job) return res.status(404).json({ error: 'Job not found' });

      if (job.status === 'done')
        return res.json({ status: 'done', output_file: job.outputFile, download_url: `/download/${job.outputFile}` });

      if (job.status === 'error')
        return res.json({ status: 'error', error: job.error });

      let outTimeMs = 0, speed = '', fps = '';
      try {
        const lines = fs.readFileSync(job.progressPath, 'utf8').split('\n');
        for (const line of lines) {
          if (line.startsWith('out_time_ms=')) {
            const v = line.split('=')[1];
            if (v && v !== 'N/A') outTimeMs = parseInt(v) || 0;
          } else if (line.startsWith('speed=')) {
            speed = line.split('=')[1].trim();
          } else if (line.startsWith('fps=')) {
            fps = line.split('=')[1].trim();
          }
        }
      } catch {}

      res.json({ status: 'running', out_time_ms: outTimeMs, speed, fps });
    });

    // ── GET /download/:filename ──────────────────────────────────────────────
    app.get('/download/:filename', (req, res) => {
      const fp = path.join(outputsDir, req.params.filename);
      if (!fs.existsSync(fp)) return res.status(404).send('Not found');
      res.download(fp);
    });

    // ── Start listening ──────────────────────────────────────────────────────
    const server = app.listen(port, '127.0.0.1', () => {
      console.log(`VertiCut server on port ${port}`);
      resolve();
    });
    server.on('error', reject);
  });
}

// Kill any running FFmpeg jobs when the process exits
process.on('exit', () => {
  Object.values(procs).forEach(p => { try { p.kill(); } catch {} });
});

module.exports = { startServer };
