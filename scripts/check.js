'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');

const files = [
  'src/main/main.js',
  'src/main/preload.js',
  'src/main/binaries.js',
  'src/main/installer.js',
  'src/main/bridge.js',
  'src/main/settings.js',
  'src/main/cookies.js',
  'src/main/extensions.js',
  'src/main/downloader.js',
  'src/main/sites.js',
  'src/renderer/app.js',
  'src/renderer/locales.js',
  'extensions/honk-media-grabber/background.js',
  'extensions/honk-media-grabber/content.js',
  'extensions/honk-media-grabber/popup.js',
  'scripts/check.js'
];

let ok = true;

function fail(message) {
  ok = false;
  console.error(`✗ ${message}`);
}

function pass(message) {
  console.log(`✓ ${message}`);
}

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function exists(relative) {
  return fs.existsSync(path.join(root, relative));
}

for (const file of files) {
  const fullPath = path.join(root, file);

  try {
    execFileSync(process.execPath, ['--check', fullPath], { stdio: 'pipe' });
    pass(file);
  } catch (error) {
    fail(file);
    if (error.stderr) process.stderr.write(error.stderr.toString());
  }
}

/* ---------- Renderer assets ---------- */

const rendererDir = 'src/renderer';
const html = read(`${rendererDir}/index.html`);
const requiredAssets = ['styles.css', 'app.js', 'locales.js', 'assets/icon.png'];

for (const asset of requiredAssets) {
  const present = exists(`${rendererDir}/${asset}`);
  const referenced = html.includes(asset) || asset === 'assets/icon.png';

  if (!present || !referenced) {
    fail(`missing or unreferenced renderer asset: ${asset}`);
  } else {
    pass(`renderer asset: ${asset}`);
  }
}

if (!/<meta[^>]+http-equiv="Content-Security-Policy"/i.test(html)) {
  fail('renderer is missing a Content-Security-Policy meta tag');
} else {
  pass('renderer CSP present');
}

if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) {
  fail('renderer contains an inline script tag');
} else {
  pass('renderer scripts are external only');
}

/* ---------- Renderer element IDs ---------- */

const appSource = read(`${rendererDir}/app.js`);
const htmlIds = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
const duplicateIds = htmlIds.filter((id, index) => htmlIds.indexOf(id) !== index);

if (duplicateIds.length) {
  fail(`duplicate renderer IDs: ${[...new Set(duplicateIds)].join(', ')}`);
} else {
  pass('renderer IDs are unique');
}

const idSet = new Set(htmlIds);
const referencedIds = new Set();

for (const match of appSource.matchAll(/\$\('#([A-Za-z][\w-]*)'/g)) referencedIds.add(match[1]);
for (const match of appSource.matchAll(/getElementById\('([^']+)'\)/g)) referencedIds.add(match[1]);

const missingIds = [...referencedIds].filter((id) => !idSet.has(id));

if (missingIds.length) {
  fail(`renderer references missing IDs: ${missingIds.join(', ')}`);
} else {
  pass(`renderer ID references resolve (${referencedIds.size} IDs)`);
}

/* ---------- Bundled extension ---------- */

const extensionDir = 'extensions/honk-media-grabber';
const manifestPath = path.join(root, extensionDir, 'manifest.json');

try {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (manifest.manifest_version !== 3) throw new Error('manifest_version must be 3');
  if (typeof manifest.name !== 'string' || !manifest.name) throw new Error('missing name');
  if (!Array.isArray(manifest.content_scripts) || !manifest.content_scripts.length) {
    throw new Error('missing content_scripts');
  }

  pass('bundled extension manifest');

  const manifestFiles = new Set();

  for (const icon of Object.values(manifest.icons || {})) manifestFiles.add(icon);
  for (const icon of Object.values((manifest.action && manifest.action.default_icon) || {})) {
    manifestFiles.add(icon);
  }

  if (manifest.background && manifest.background.service_worker) {
    manifestFiles.add(manifest.background.service_worker);
  }

  if (manifest.action && manifest.action.default_popup) {
    manifestFiles.add(manifest.action.default_popup);
  }

  for (const script of manifest.content_scripts) {
    for (const file of script.js || []) manifestFiles.add(file);
    for (const file of script.css || []) manifestFiles.add(file);
  }

  for (const file of manifestFiles) {
    if (!exists(`${extensionDir}/${file}`)) fail(`manifest references missing file: ${file}`);
  }

  pass(`manifest files exist (${manifestFiles.size} files)`);
} catch (error) {
  fail(`bundled extension manifest: ${error.message}`);
}

const popupPath = `${extensionDir}/popup.html`;

if (!exists(popupPath)) {
  fail('missing extension popup.html');
} else {
  const popupHtml = read(popupPath);

  for (const asset of ['popup.css', 'popup.js']) {
    if (!popupHtml.includes(asset) || !exists(`${extensionDir}/${asset}`)) {
      fail(`popup asset missing or unreferenced: ${asset}`);
    }
  }

  if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(popupHtml)) {
    fail('popup.html contains an inline script tag');
  }

  pass('extension popup assets');
}

/* ---------- Binary environment ---------- */

try {
  const binaries = require('../src/main/binaries');
  const status = binaries.status();

  console.log('');
  console.log(`yt-dlp: ${status.ytDlp || 'NOT FOUND'}`);
  console.log(`ffmpeg: ${status.ffmpeg || 'NOT FOUND'}`);
  console.log(`ffprobe: ${status.ffprobe || 'NOT FOUND'}`);
  console.log('');

  if (!status.ok) {
    console.warn('⚠ yt-dlp is required for downloads. See README.md (المتطلبات).');
  }

  if (!status.merge) {
    console.warn('⚠ ffmpeg is required for merging video+audio and audio conversion.');
  }
} catch (error) {
  fail(`environment check failed: ${error.message}`);
}

if (ok) {
  console.log('✓ All checks passed.');
} else {
  console.error('✗ Checks failed.');
}

process.exitCode = ok ? 0 : 1;
