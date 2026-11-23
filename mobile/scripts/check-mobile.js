'use strict';

/** Static validation of the offline APK scaffold. No Android SDK required. */
const fs = require('fs');
const path = require('path');

const mobileDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(mobileDir, '..');
const problems = [];
let checks = 0;

function ok(label) {
  checks += 1;
  console.log(`  ✓ ${label}`);
}

function bad(label, detail) {
  problems.push(`${label}${detail ? ` — ${detail}` : ''}`);
  console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
}

function exists(file, label) {
  if (fs.existsSync(file)) ok(label || path.relative(rootDir, file));
  else bad(label || path.relative(rootDir, file), 'missing');
}

function contains(file, needles, label) {
  if (!fs.existsSync(file)) {
    bad(label || path.basename(file), 'missing');
    return;
  }
  const text = fs.readFileSync(file, 'utf8');
  const missing = needles.filter((needle) => !text.includes(needle));
  if (missing.length) bad(label || path.basename(file), `missing: ${missing.join(', ')}`);
  else ok(label || path.basename(file));
}

function excludes(file, needles, label) {
  if (!fs.existsSync(file)) {
    bad(label || path.basename(file), 'missing');
    return;
  }
  const text = fs.readFileSync(file, 'utf8');
  const found = needles.filter((needle) => text.includes(needle));
  if (found.length) bad(label || path.basename(file), `unexpected: ${found.join(', ')}`);
  else ok(label || path.basename(file));
}

function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

console.log('Mobile APK checks:');

const pkg = json(path.join(mobileDir, 'package.json'));
const cap = json(path.join(mobileDir, 'capacitor.config.json'));

exists(path.join(mobileDir, 'scripts', 'apply-android.js'), 'android Gradle patcher');
exists(path.join(mobileDir, 'www-src', 'mobile.js'), 'web bridge source');
contains(path.join(mobileDir, 'www-src', 'mobile.js'), ['window.wasel', 'Ytdlp', 'onSharedLink'], 'web bridge methods');

if (cap.appId === 'app.wasel.downloader') ok('Capacitor appId matches Java package');
else bad('Capacitor appId matches Java package', `got ${cap.appId}`);

for (const dep of ['@capacitor/core', '@capacitor/cli', '@capacitor/android']) {
  if (pkg.dependencies?.[dep] || pkg.devDependencies?.[dep]) ok(`${dep} declared`);
  else bad(`${dep} declared`);
}

const template = path.join(mobileDir, 'android-template');
contains(path.join(template, 'app', 'src', 'main', 'python', 'wasel_engine.py'),
  ['def info(', 'def preview_url(', 'def download(', 'def cancel(', 'def pause(', 'def resume(', 'ProgressBridge'],
  'Python engine API');
contains(path.join(template, 'app', 'src', 'main', 'java', 'app', 'wasel', 'downloader', 'YtdlpPlugin.java'),
  ['@CapacitorPlugin', 'previewUrl', 'ProgressBridge', 'FileProvider'], 'Java Capacitor plugin');
contains(path.join(template, 'app', 'src', 'main', 'AndroidManifest.xml'),
  ['android.intent.action.SEND', 'android.intent.action.VIEW', 'android.permission.INTERNET',
    'android:icon="@mipmap/ic_launcher"', 'android:roundIcon="@mipmap/ic_launcher_round"'], 'Android manifest');
exists(path.join(template, 'app', 'src', 'main', 'res', 'drawable-v24', 'ic_launcher_foreground.xml'),
  'adaptive launcher foreground');
exists(path.join(template, 'app', 'src', 'main', 'res', 'mipmap-anydpi-v26', 'ic_launcher.xml'),
  'adaptive launcher icon');

// Generated web assets are produced by `npm run sync:web`.
const www = path.join(mobileDir, 'www');
if (fs.existsSync(www)) {
  contains(path.join(www, 'index.html'), ['mobile.js', 'app.js'], 'generated index.html');
  excludes(path.join(www, 'index.html'),
    ['data-tab="extensions"', 'id="tab-extensions"', 'id="bridge-panel"', 'id="feature-extension"',
      '<webview', 'data-tab="browser"', 'id="tab-browser"', 'browserHome', 'cookieEmbedded'],
    'generated mobile UI excludes browser and desktop extensions');
  exists(path.join(www, 'sites.json'), 'generated sites.json');
  exists(path.join(www, 'icons'), 'generated icons/');
  const appJs = path.join(www, 'app.js');
  if (fs.existsSync(appJs)) {
    const text = fs.readFileSync(appJs, 'utf8');
    if (text.includes('../../icons/')) bad('icon paths rewritten for APK');
    else ok('icon paths rewritten for APK');
  }
} else {
  bad('generated www/', 'run npm run sync:web');
}

// If the Android project was generated, verify the patch was applied.
const android = path.join(mobileDir, 'android');
if (fs.existsSync(android)) {
  const appGradle = path.join(android, 'app', 'build.gradle');
  const kts = path.join(android, 'app', 'build.gradle.kts');
  const gradleFile = fs.existsSync(appGradle) ? appGradle : kts;
  contains(gradleFile, ['chaquopy', '3.12', 'yt-dlp', 'arm64-v8a'], 'patched app Gradle');
  contains(path.join(android, 'app', 'src', 'main', 'python', 'wasel_engine.py'),
    ['def download('], 'Python engine copied into Android project');
} else {
  console.log('  · Android project not generated yet (expected until `npx cap add android`).');
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} mobile check(s) failed.`);
  process.exit(1);
}
console.log(`\n✓ Mobile scaffold OK (${checks} checks).`);
