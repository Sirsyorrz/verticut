const { spawn } = require('child_process');

// ── FFmpeg / FFprobe paths ─────────────────────────────────────────────────────
function fixAsarPath(p) {
  if (p && p.includes('app.asar') && !p.includes('app.asar.unpacked')) {
    return p.replace('app.asar', 'app.asar.unpacked');
  }
  return p;
}

const ffmpegPath  = fixAsarPath(require('ffmpeg-static'));
const ffprobePath = fixAsarPath(require('ffprobe-static').path);

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
          label:    (s.tags && s.tags.title && s.tags.title.trim()) || `Track ${i + 1}`
        }));
        resolve({
          width: vs.width, height: vs.height, duration: dur, fps: num / den,
          audioCount: audioStreams.length, audioInfo
        });
      } catch (e) { reject(e); }
    });
  });
}

module.exports = { ffmpegPath, ffprobePath, getVideoInfo };
