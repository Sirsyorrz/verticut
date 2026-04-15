#!/usr/bin/env node
/**
 * Downloads the Windows x64 ffmpeg.exe binary into node_modules/ffmpeg-static/
 * so electron-builder can pack it when cross-compiling from Linux/macOS.
 */
'use strict';

const https   = require('https');
const fs      = require('fs');
const path    = require('path');
const zlib    = require('zlib');
const { pipeline } = require('stream');

const FFMPEG_DIR  = path.join(__dirname, '..', 'node_modules', 'ffmpeg-static');
const FFMPEG_EXE  = path.join(FFMPEG_DIR, 'ffmpeg.exe');
const RELEASE_TAG = require(path.join(FFMPEG_DIR, 'package.json'))['ffmpeg-static']['binary-release-tag'];
// eugeneware/ffmpeg-static release URL pattern
const DOWNLOAD_URL = `https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE_TAG}/ffmpeg-win32-x64.gz`;

if (fs.existsSync(FFMPEG_EXE)) {
  console.log('✅ ffmpeg.exe already present, skipping download.');
  process.exit(0);
}

console.log(`⬇️  Downloading ffmpeg.exe (${RELEASE_TAG}) for Windows x64…`);
console.log(`   URL: ${DOWNLOAD_URL}`);

function get(url, cb) {
  https.get(url, { headers: { 'User-Agent': 'verticut-build' } }, res => {
    if (res.statusCode === 301 || res.statusCode === 302) {
      return get(res.headers.location, cb);
    }
    cb(res);
  }).on('error', err => { console.error('Download error:', err.message); process.exit(1); });
}

get(DOWNLOAD_URL, res => {
  if (res.statusCode !== 200) {
    console.error(`❌ HTTP ${res.statusCode} — could not download ffmpeg.exe`);
    process.exit(1);
  }
  const out = fs.createWriteStream(FFMPEG_EXE);
  pipeline(res, zlib.createGunzip(), out, err => {
    if (err) { console.error('❌ Extract error:', err.message); process.exit(1); }
    fs.chmodSync(FFMPEG_EXE, 0o755);
    console.log('✅ ffmpeg.exe downloaded successfully.');
  });
});
