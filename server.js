const express  = require('express');
const multer   = require('multer');
const cors     = require('cors');
const { v4: uuidv4 } = require('uuid');
const { spawn }      = require('child_process');
const crypto         = require('crypto');
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

    // ── PLATFORM CREDENTIALS & TOKENS ────────────────────────────────────────
    const credsFile = path.join(userDataPath, 'platform_creds.json');
    let platformCreds  = { youtube: null, tiktok: null };
    let platformTokens = { youtube: null, tiktok: null };
    try {
      const saved = JSON.parse(fs.readFileSync(credsFile, 'utf8'));
      platformCreds  = saved.creds  || platformCreds;
      platformTokens = saved.tokens || platformTokens;
    } catch {}
    function savePlatformData() {
      fs.writeFileSync(credsFile, JSON.stringify({ creds: platformCreds, tokens: platformTokens }, null, 2));
    }

    const oauthStates = new Map();
    const YT_REDIRECT = `http://127.0.0.1:${port}/auth/youtube/callback`;
    const TT_REDIRECT = `http://127.0.0.1:${port}/auth/tiktok/callback`;

    app.get('/auth/status', (req, res) => {
      res.json({
        youtube_configured: !!platformCreds.youtube,
        youtube_connected:  !!(platformCreds.youtube && platformTokens.youtube),
        tiktok_configured:  !!platformCreds.tiktok,
        tiktok_connected:   !!(platformCreds.tiktok  && platformTokens.tiktok),
      });
    });

    app.post('/auth/config', (req, res) => {
      const { platform, client_id, client_secret } = req.body;
      if (!['youtube','tiktok'].includes(platform)) return res.status(400).json({ error: 'Unknown platform' });
      platformCreds[platform] = { client_id, client_secret };
      savePlatformData();
      res.json({ ok: true });
    });

    app.delete('/auth/disconnect/:platform', (req, res) => {
      platformTokens[req.params.platform] = null;
      savePlatformData();
      res.json({ ok: true });
    });

    // ── YouTube OAuth ─────────────────────────────────────────────────────────
    app.get('/auth/youtube/start', (req, res) => {
      if (!platformCreds.youtube) return res.status(400).json({ error: 'YouTube credentials not configured' });
      const state = crypto.randomBytes(16).toString('hex');
      oauthStates.set(state, Date.now() + 600000);
      const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      url.searchParams.set('client_id',     platformCreds.youtube.client_id);
      url.searchParams.set('redirect_uri',  YT_REDIRECT);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope',         'https://www.googleapis.com/auth/youtube.upload');
      url.searchParams.set('access_type',   'offline');
      url.searchParams.set('prompt',        'consent');
      url.searchParams.set('state',         state);
      res.json({ url: url.toString() });
    });

    app.get('/auth/youtube/callback', async (req, res) => {
      const { code, state, error } = req.query;
      const dark = 'background:#0a0a0f;font-family:monospace;padding:40px';
      if (error) return res.send(`<body style="${dark};color:#ff4444"><h2>Auth failed: ${error}</h2></body>`);
      if (!oauthStates.has(state)) return res.send(`<body style="${dark};color:#ff4444"><h2>Invalid state — try again.</h2></body>`);
      oauthStates.delete(state);
      try {
        const r = await fetch('https://oauth2.googleapis.com/token', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ code, client_id: platformCreds.youtube.client_id,
            client_secret: platformCreds.youtube.client_secret, redirect_uri: YT_REDIRECT, grant_type: 'authorization_code' })
        });
        const t = await r.json();
        if (t.error) throw new Error(t.error_description || t.error);
        platformTokens.youtube = { access_token: t.access_token, refresh_token: t.refresh_token, expiry: Date.now() + (t.expires_in||3600)*1000 };
        savePlatformData();
        res.send(`<body style="${dark};color:#00f5a0"><h2>✓ YouTube connected!</h2><p>You can close this tab and return to VertiCut.</p></body>`);
      } catch (e) { res.send(`<body style="${dark};color:#ff4444"><h2>Error: ${e.message}</h2></body>`); }
    });

    async function getYTToken() {
      const t = platformTokens.youtube;
      if (!t) throw new Error('Not connected to YouTube');
      if (Date.now() < t.expiry - 60000) return t.access_token;
      const r = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_id: platformCreds.youtube.client_id,
          client_secret: platformCreds.youtube.client_secret, refresh_token: t.refresh_token, grant_type: 'refresh_token' })
      });
      const d = await r.json();
      if (d.error) throw new Error(d.error_description || d.error);
      platformTokens.youtube.access_token = d.access_token;
      platformTokens.youtube.expiry = Date.now() + (d.expires_in||3600)*1000;
      savePlatformData(); return d.access_token;
    }

    app.post('/upload/youtube', async (req, res) => {
      const { filename, title = 'VertiCut Export', description = '#Shorts', privacy = 'public' } = req.body;
      const fp = path.join(outputsDir, filename);
      if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
      if (!platformTokens.youtube) return res.status(401).json({ error: 'Not connected to YouTube' });
      try {
        const token = await getYTToken();
        const stat  = fs.statSync(fp);
        const initR = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
            'X-Upload-Content-Length': String(stat.size), 'X-Upload-Content-Type': 'video/mp4' },
          body: JSON.stringify({
            snippet: { title, description, tags: ['shorts','gaming'], categoryId: '20' },
            status:  { privacyStatus: privacy, selfDeclaredMadeForKids: false }
          })
        });
        if (!initR.ok) return res.status(500).json({ error: `YouTube API ${initR.status}: ${await initR.text()}` });
        const uploadUrl = initR.headers.get('location');
        const buf = fs.readFileSync(fp);
        const upR = await fetch(uploadUrl, {
          method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(stat.size) }, body: buf
        });
        const upD = await upR.json();
        if (!upR.ok || !upD.id) return res.status(500).json({ error: 'Upload failed', details: upD });
        res.json({ ok: true, video_id: upD.id, url: `https://www.youtube.com/shorts/${upD.id}` });
      } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── TikTok OAuth ──────────────────────────────────────────────────────────
    app.get('/auth/tiktok/start', (req, res) => {
      if (!platformCreds.tiktok) return res.status(400).json({ error: 'TikTok credentials not configured' });
      const state = crypto.randomBytes(16).toString('hex');
      oauthStates.set(state, Date.now() + 600000);
      const url = new URL('https://www.tiktok.com/v2/auth/authorize/');
      url.searchParams.set('client_key',    platformCreds.tiktok.client_id);
      url.searchParams.set('redirect_uri',  TT_REDIRECT);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope',         'video.upload,video.publish');
      url.searchParams.set('state',         state);
      res.json({ url: url.toString() });
    });

    app.get('/auth/tiktok/callback', async (req, res) => {
      const { code, state, error } = req.query;
      const dark = 'background:#0a0a0f;font-family:monospace;padding:40px';
      if (error) return res.send(`<body style="${dark};color:#ff4444"><h2>Auth failed: ${error}</h2></body>`);
      if (!oauthStates.has(state)) return res.send(`<body style="${dark};color:#ff4444"><h2>Invalid state — try again.</h2></body>`);
      oauthStates.delete(state);
      try {
        const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
          method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Cache-Control': 'no-cache' },
          body: new URLSearchParams({ client_key: platformCreds.tiktok.client_id,
            client_secret: platformCreds.tiktok.client_secret, code, grant_type: 'authorization_code', redirect_uri: TT_REDIRECT })
        });
        const t = await r.json();
        const td = t.data || t;
        if (!td.access_token) throw new Error(t.error?.message || JSON.stringify(t));
        platformTokens.tiktok = { access_token: td.access_token, refresh_token: td.refresh_token, expiry: Date.now() + (td.expires_in||86400)*1000 };
        savePlatformData();
        res.send(`<body style="${dark};color:#00f5a0"><h2>✓ TikTok connected!</h2><p>You can close this tab and return to VertiCut.</p></body>`);
      } catch (e) { res.send(`<body style="${dark};color:#ff4444"><h2>Error: ${e.message}</h2></body>`); }
    });

    async function getTTToken() {
      const t = platformTokens.tiktok;
      if (!t) throw new Error('Not connected to TikTok');
      if (Date.now() < t.expiry - 60000) return t.access_token;
      const r = await fetch('https://open.tiktokapis.com/v2/oauth/token/', {
        method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ client_key: platformCreds.tiktok.client_id,
          client_secret: platformCreds.tiktok.client_secret, grant_type: 'refresh_token', refresh_token: t.refresh_token })
      });
      const d = await r.json(); const td = d.data || d;
      if (!td.access_token) throw new Error('TikTok token refresh failed');
      platformTokens.tiktok.access_token = td.access_token;
      platformTokens.tiktok.expiry = Date.now() + (td.expires_in||86400)*1000;
      savePlatformData(); return td.access_token;
    }

    app.post('/upload/tiktok', async (req, res) => {
      const { filename, title = 'VertiCut Export', privacy = 'PUBLIC_TO_EVERYONE' } = req.body;
      const fp = path.join(outputsDir, filename);
      if (!fs.existsSync(fp)) return res.status(404).json({ error: 'File not found' });
      if (!platformTokens.tiktok) return res.status(401).json({ error: 'Not connected to TikTok' });
      try {
        const token = await getTTToken();
        const stat  = fs.statSync(fp);
        const initR = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
          body: JSON.stringify({
            post_info:   { title, privacy_level: privacy, disable_duet: false, disable_comment: false, disable_stitch: false },
            source_info: { source: 'FILE_UPLOAD', video_size: stat.size, chunk_size: stat.size, total_chunk_count: 1 }
          })
        });
        const initD = await initR.json();
        if (initD.error && initD.error.code !== 'ok') return res.status(500).json({ error: initD.error.message || initD.error.code });
        const { publish_id, upload_url } = initD.data;
        const buf   = fs.readFileSync(fp);
        const upR   = await fetch(upload_url, {
          method: 'PUT',
          headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes 0-${stat.size-1}/${stat.size}`, 'Content-Length': String(stat.size) },
          body: buf
        });
        if (!upR.ok) return res.status(500).json({ error: `TikTok upload HTTP ${upR.status}` });
        res.json({ ok: true, publish_id, url: 'https://www.tiktok.com/upload' });
      } catch (e) { res.status(500).json({ error: e.message }); }
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
