const { v4: uuidv4 } = require('uuid');
const { spawn } = require('child_process');
const path = require('path');
const fs   = require('fs');

const { ffmpegPath, getVideoInfo } = require('./ffmpeg');
const { getJob, setJob, setProc, deleteProc, getFilePath, setFilePath } = require('./jobs');

function registerRoutes(app, outputsDir) {

  // ── POST /upload ───────────────────────────────────────────────────────────
  app.post('/upload', async (req, res) => {
    const { filePath } = req.body;
    if (!filePath) return res.status(400).json({ error: 'No file path provided' });
    if (!fs.existsSync(filePath)) return res.status(400).json({ error: 'File not found: ' + filePath });
    try {
      const info     = await getVideoInfo(filePath);
      const fileId   = uuidv4();
      setFilePath(fileId, filePath);
      res.json({
        filename:     fileId,
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

  // ── GET /video/:filename ───────────────────────────────────────────────────
  app.get('/video/:filename', (req, res) => {
    const fp = getFilePath(req.params.filename);
    if (!fp || !fs.existsSync(fp)) return res.status(404).send('Not found');
    res.sendFile(fp);
  });

  // ── GET /audio_track/:filename/:idx ────────────────────────────────────────
  app.get('/audio_track/:filename/:idx', (req, res) => {
    const fp  = getFilePath(req.params.filename);
    const idx = parseInt(req.params.idx);
    if (isNaN(idx) || idx < 0) return res.status(400).send('Bad track index');
    if (!fp || !fs.existsSync(fp)) return res.status(404).send('Not found');

    res.setHeader('Content-Type', 'audio/mpeg');
    const proc = spawn(ffmpegPath, [
      '-i', fp,
      '-map', `0:a:${idx}`,
      '-c:a', 'libmp3lame', '-b:a', '128k',
      '-f', 'mp3', 'pipe:1'
    ]);
    proc.stderr.on('data', () => {});
    proc.stdout.pipe(res);
    req.on('close', () => { try { proc.kill(); } catch {} });
  });

  // ── POST /process ──────────────────────────────────────────────────────────
  app.post('/process', async (req, res) => {
    const data = req.body;
    const { filename, zones, output_path,
            output_width  = 1080,
            output_height = 1920,
            output_fps    = 60    } = data;
    const trimStart   = data.trim_start    || 0;
    const trimEnd     = data.trim_end      || null;
    const mutedTracks = data.muted_tracks  || [];

    if (!output_path) return res.status(400).json({ error: 'No output path provided' });

    const filepath = getFilePath(filename);
    if (!filepath || !fs.existsSync(filepath))
      return res.status(404).json({ error: 'Source video not found' });

    let info;
    try { info = await getVideoInfo(filepath); }
    catch (e) { return res.status(500).json({ error: e.message }); }

    const outDuration = trimEnd
      ? trimEnd - trimStart
      : (trimStart > 0 ? info.duration - trimStart : info.duration);

    const outId        = uuidv4();
    const outputPath   = output_path;
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
    if (trimEnd)            trimFilter = `trim=start=${trimStart}:end=${trimEnd},setpts=PTS-STARTPTS,`;
    else if (trimStart > 0) trimFilter = `trim=start=${trimStart},setpts=PTS-STARTPTS,`;

    // Build filter_complex
    const vidW = info.width, vidH = info.height;
    const filterParts = [];
    filterParts.push(`color=black:s=${output_width}x${output_height}:r=${output_fps}[canvas]`);

    // Track which zones are renderable (not entirely outside video bounds)
    const renderableZoneIndices = [];

    for (let i = 0; i < zones.length; i++) {
      const z         = zones[i];
      const origSrcX  = parseInt(z.src_x);
      const origSrcY  = parseInt(z.src_y);
      const origSrcW  = parseInt(z.src_w);
      const origSrcH  = parseInt(z.src_h);
      const origDstX  = parseInt(z.dst_x);
      const origDstY  = parseInt(z.dst_y);
      const origDstW  = parseInt(z.dst_w);
      const origDstH  = parseInt(z.dst_h);

      // Scale factors: how src pixels map to dst pixels
      const scaleX = origDstW / origSrcW;
      const scaleY = origDstH / origSrcH;

      // Clamp src to video bounds so out-of-bounds areas are simply not rendered
      // (instead of being filled with black padding that overlays other zones)
      const clampedSrcX = Math.max(0, Math.min(vidW, origSrcX));
      const clampedSrcY = Math.max(0, Math.min(vidH, origSrcY));
      const clampedSrcW = Math.max(0, Math.min(vidW, origSrcX + origSrcW)) - clampedSrcX;
      const clampedSrcH = Math.max(0, Math.min(vidH, origSrcY + origSrcH)) - clampedSrcY;

      // Skip zones entirely outside the video
      if (clampedSrcW <= 0 || clampedSrcH <= 0) continue;

      // Adjust dst to match only the clamped portion
      const sx = clampedSrcX;
      const sy = clampedSrcY;
      const sw = clampedSrcW;
      const sh = clampedSrcH;
      const dw = Math.round(clampedSrcW * scaleX);
      const dh = Math.round(clampedSrcH * scaleY);
      const dx = Math.round(origDstX + (clampedSrcX - origSrcX) * scaleX);
      const dy = Math.round(origDstY + (clampedSrcY - origSrcY) * scaleY);

      const blurSigma = parseFloat(z.blur)    || 0;
      const feather   = parseFloat(z.feather) || 0;
      const shape     = z.shape || 'rect';

      const blurFilter = blurSigma > 0 ? `,gblur=sigma=${blurSigma}` : '';

      let maskFilter = '';
      if (shape !== 'rect' || feather > 0) {
        let alphaExpr;

        if (shape === 'ellipse') {
          alphaExpr = `255*lte(pow((X-W/2)/max(1,W/2),2)+pow((Y-H/2)/max(1,H/2),2),1)`;
        } else if (shape === 'polygon' && z.points && z.points.length >= 3) {
          const pts = z.points; // normalized 0-1 relative to src bbox
          const n   = pts.length;
          const crossings = [];
          for (let k = 0; k < n; k++) {
            const j  = (k + 1) % n;
            const x1 = (pts[k].x * dw).toFixed(2), y1 = (pts[k].y * dh).toFixed(2);
            const x2 = (pts[j].x * dw).toFixed(2), y2 = (pts[j].y * dh).toFixed(2);
            crossings.push(
              `gt(${x1}+(Y-${y1})/(${y2}-${y1})*(${x2}-${x1}),X)*abs(gt(${y1},Y)-gt(${y2},Y))`
            );
          }
          alphaExpr = `255*mod(${crossings.join('+')},2)`;
        } else {
          // rect with feather — linear ramp from each edge inward
          alphaExpr = `clip(min(min(X+1,W-1-X),min(Y+1,H-1-Y))*255/max(1,${feather}),0,255)`;
        }

        // For ellipse/polygon apply gblur only to the alpha plane (plane 8) for feather
        const featherGblur = (feather > 0 && shape !== 'rect')
          ? `,gblur=sigma=${feather}:planes=8`
          : '';

        maskFilter = `,format=yuva420p,geq=lum='lum(X,Y)':cb='cb(X,Y)':cr='cr(X,Y)':a='${alphaExpr}'${featherGblur}`;
      }

      const ri = renderableZoneIndices.length;
      renderableZoneIndices.push({ dx, dy });
      filterParts.push(
        `[0:v]${trimFilter}crop=${sw}:${sh}:${sx}:${sy},scale=${dw}:${dh}${blurFilter}${maskFilter}[z${ri}]`
      );
    }

    let prev = 'canvas';
    for (let i = 0; i < renderableZoneIndices.length; i++) {
      const { dx, dy } = renderableZoneIndices[i];
      const nxt = i < renderableZoneIndices.length - 1 ? `ov${i}` : 'out';
      filterParts.push(`[${prev}][z${i}]overlay=${dx}:${dy}:format=auto:shortest=1[${nxt}]`);
      prev = nxt;
    }
    if (renderableZoneIndices.length === 0) {
      filterParts.push(`[canvas]null[out]`);
    }

    // ── Audio: trim + merge active (non-muted) tracks into one ─────────────
    const audioCount = info.audioCount || 0;
    const activeTracks = [];
    for (let ai = 0; ai < audioCount; ai++) {
      if (!mutedTracks.includes(ai)) activeTracks.push(ai);
    }
    let audioFilterStr = '';
    let audioMapArg    = null;

    if (activeTracks.length > 0) {
      let aTrim = '';
      if (trimEnd)            aTrim = `atrim=start=${trimStart}:end=${trimEnd},asetpts=PTS-STARTPTS`;
      else if (trimStart > 0) aTrim = `atrim=start=${trimStart},asetpts=PTS-STARTPTS`;

      if (activeTracks.length === 1 && !aTrim) {
        audioMapArg = `0:a:${activeTracks[0]}`;
      } else if (activeTracks.length === 1) {
        const ai = activeTracks[0];
        audioFilterStr = `;[0:a:${ai}]${aTrim}[aout]`;
        audioMapArg = '[aout]';
      } else {
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
    setJob(jobId, { status: 'running', progressPath, error: null });

    const proc = spawn(ffmpegPath, cmd);
    setProc(jobId, proc);

    let stderrBuf = '';
    proc.stderr.on('data', d => { stderrBuf += d.toString(); });
    proc.on('close', code => {
      deleteProc(jobId);
      const job = getJob(jobId);
      if (code === 0) {
        job.status = 'done';
      } else {
        job.status = 'error';
        job.error  = stderrBuf || `FFmpeg exited with code ${code}`;
      }
      try { fs.unlinkSync(progressPath); } catch {}
    });

    res.json({ job_id: jobId });
  });

  // ── GET /progress/:jobId ───────────────────────────────────────────────────
  app.get('/progress/:jobId', (req, res) => {
    const job = getJob(req.params.jobId);
    if (!job) return res.status(404).json({ error: 'Job not found' });

    if (job.status === 'done')
      return res.json({ status: 'done' });

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

}

module.exports = { registerRoutes };
