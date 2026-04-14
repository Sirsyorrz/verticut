#!/usr/bin/env node
// ── Download Purfview faster-whisper standalone Windows exe ───────────────────
// Runs automatically before `npm run build` via the prebuild hook.
// Safe to re-run — skips download if the exe already exists.

const https    = require('https');
const fs       = require('fs');
const path     = require('path');
const os       = require('os');
const { spawnSync } = require('child_process');
const { path7za }   = require('7zip-bin');

const DEST_DIR  = path.resolve(__dirname, '..', 'resources', 'whisper');
const EXE_NAME  = 'faster-whisper.exe';
const EXE_PATH  = path.join(DEST_DIR, EXE_NAME);

// GitHub API — latest release on the Faster-Whisper-XXL tag
const RELEASE_API = 'https://api.github.com/repos/Purfview/whisper-standalone-win/releases/tags/Faster-Whisper-XXL';

// ── Helpers ───────────────────────────────────────────────────────────────────
function httpsGet(url, options = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { ...options, headers: { 'User-Agent': 'verticut-build', ...(options.headers || {}) } }, res => {
      // Follow redirects
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return httpsGet(res.headers.location, options).then(resolve).catch(reject);
      }
      resolve(res);
    });
    req.on('error', reject);
  });
}

function downloadFile(url, destPath) {
  return new Promise(async (resolve, reject) => {
    const res = await httpsGet(url).catch(reject);
    if (!res) return;
    if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode} for ${url}`));

    const total   = parseInt(res.headers['content-length'] || '0', 10);
    let received  = 0;
    let lastPct   = -1;

    const out = fs.createWriteStream(destPath);
    res.on('data', chunk => {
      received += chunk.length;
      if (total) {
        const pct = Math.floor((received / total) * 100);
        if (pct !== lastPct && pct % 5 === 0) {
          process.stdout.write(`\r  Downloading… ${pct}% (${(received / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB)`);
          lastPct = pct;
        }
      }
    });
    res.pipe(out);
    out.on('finish', () => { process.stdout.write('\n'); resolve(); });
    out.on('error', reject);
    res.on('error', reject);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  // Already bundled — nothing to do
  if (fs.existsSync(EXE_PATH)) {
    console.log(`✓ faster-whisper.exe already present — skipping download.`);
    return;
  }

  fs.mkdirSync(DEST_DIR, { recursive: true });

  // 1. Fetch release metadata
  console.log('Fetching faster-whisper release info from GitHub…');
  const apiRes = await httpsGet(RELEASE_API, { headers: { 'Accept': 'application/vnd.github+json' } });
  let body = '';
  for await (const chunk of apiRes) body += chunk;
  const release = JSON.parse(body);

  // 2. Find the latest Windows .7z asset (sort by name descending so highest version wins)
  const winAssets = release.assets
    .filter(a => a.name.toLowerCase().includes('windows') && a.name.endsWith('.7z'))
    .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));

  const asset = winAssets[0];
  if (!asset) {
    console.error('Could not find a Windows .7z asset in the release. Assets found:');
    release.assets.forEach(a => console.error(' -', a.name));
    process.exit(1);
  }

  console.log(`Found asset: ${asset.name} (${(asset.size / 1e6).toFixed(0)} MB compressed)`);

  // 3. Download the archive
  const archivePath = path.join(os.tmpdir(), asset.name);
  console.log(`Downloading to ${archivePath}…`);
  await downloadFile(asset.browser_download_url, archivePath);

  // 4. Extract everything flat into DEST_DIR (-e strips directory structure)
  console.log(`Extracting to ${DEST_DIR}…`);
  const result = spawnSync(
    path7za,
    ['e', archivePath, `-o${DEST_DIR}`, '-y'],
    { stdio: 'inherit' }
  );

  if (result.status !== 0) {
    console.error('7z extraction failed. Archive kept at:', archivePath);
    process.exit(1);
  }

  if (!fs.existsSync(EXE_PATH)) {
    // Try to find the exe under a different name in case the archive layout changed
    const allFiles = fs.readdirSync(DEST_DIR);
    const exeFile  = allFiles.find(f => f.toLowerCase().endsWith('.exe'));
    if (exeFile) {
      fs.renameSync(path.join(DEST_DIR, exeFile), EXE_PATH);
      console.log(`Renamed ${exeFile} → ${EXE_NAME}`);
    } else {
      console.error(`Extraction finished but no .exe found in ${DEST_DIR}.`);
      console.error('Files found:', allFiles.join(', ') || '(none)');
      console.error('Archive kept at:', archivePath, '— inspect it manually with: 7z l', archivePath);
      process.exit(1);
    }
  }

  // 5. Ensure the exe is executable (needed on Linux/macOS build machines)
  try { fs.chmodSync(EXE_PATH, 0o755); } catch {}

  // 6. Clean up archive only after confirming exe exists
  try { fs.unlinkSync(archivePath); } catch {}

  console.log(`✓ faster-whisper.exe ready at ${EXE_PATH}`);
}

main().catch(err => {
  console.error('download-whisper failed:', err.message);
  process.exit(1);
});
