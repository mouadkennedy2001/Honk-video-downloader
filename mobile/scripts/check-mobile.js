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

function walk(dir, base, files) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const relative = path.relative(base, full).replace(/\\/g, '/');
    if (entry.isDirectory()) walk(full, base, files);
    else files.push(relative);
  }
  return files;
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
  ['def info(', 'def preview_url(', 'def download(', 'def cancel(', 'def pause(', 'def resume(',
    'ProgressBridge', '_SPOTIFY_ERROR', '_is_spotify'],
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

    // Every api.* call in the shared renderer must have a mobile stub,
    // otherwise init() aborts and the whole APK UI stays blank.
    const bridge = fs.readFileSync(path.join(www, 'mobile.js'), 'utf8');
    const defined = new Set(
      [...bridge.matchAll(/^\s{4}([A-Za-z][\w]*)\s*:/gm)].map((m) => m[1])
    );
    const used = new Set(
      [...text.matchAll(/api\.([A-Za-z][\w]*)\s*\(/g)].map((m) => m[1])
    );
    const missing = [...used].filter((name) => !defined.has(name));
    if (missing.length) bad('mobile bridge covers renderer API', `missing: ${missing.join(', ')}`);
    else ok('mobile bridge covers renderer API');
  }

  // Generated assets must match the current renderer; stale copies were the
  // reason the APK looked completely broken after UI changes.
  const rendererDir = path.join(rootDir, 'src', 'renderer');
  const copies = [
    ['locales.js', path.join(rendererDir, 'locales.js')],
    ['locales-1.js', path.join(rendererDir, 'locales-1.js')],
    ['locales-2.js', path.join(rendererDir, 'locales-2.js')],
    ['locales-3.js', path.join(rendererDir, 'locales-3.js')],
    ['locales-4.js', path.join(rendererDir, 'locales-4.js')],
    ['styles.css', path.join(rendererDir, 'styles.css')],
    ['mobile.js', path.join(mobileDir, 'www-src', 'mobile.js')]
  ];
  for (const [name, source] of copies) {
    const target = path.join(www, name);
    if (!fs.existsSync(source) || !fs.existsSync(target)) {
      bad(`generated ${name} is current`, 'missing file');
    } else if (!fs.readFileSync(source).equals(fs.readFileSync(target))) {
      bad(`generated ${name} is current`, 'run npm run sync:web');
    } else {
      ok(`generated ${name} is current`);
    }
  }

  const appSource = path.join(rendererDir, 'app.js');
  if (fs.existsSync(appSource) && fs.existsSync(appJs)) {
    const expected = fs.readFileSync(appSource, 'utf8').replace(/\.\.\/\.\.\/icons\//g, 'icons/');
    if (expected !== fs.readFileSync(appJs, 'utf8')) bad('generated app.js is current', 'run npm run sync:web');
    else ok('generated app.js is current');
  }

  const generatedHtml = fs.readFileSync(path.join(www, 'index.html'), 'utf8');
  if (generatedHtml.includes('id="install-spotdl"') && generatedHtml.includes('id="install-ytdlp"')) {
    ok('generated settings include every engine card');
  } else {
    bad('generated settings include every engine card', 'run npm run sync:web');
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
    ['def download(', '_SPOTIFY_ERROR'], 'Python engine copied into Android project');

  // The APK packages assets/public. A stale copy here is invisible to the
  // renderer-side checks but ships an old UI, so compare every generated file.
  const androidAssets = path.join(android, 'app', 'src', 'main', 'assets', 'public');
  const stale = [];
  if (!fs.existsSync(androidAssets)) {
    stale.push('assets/public missing');
  } else if (fs.existsSync(www)) {
    for (const relative of walk(www, www, [])) {
      const source = path.join(www, relative);
      const target = path.join(androidAssets, relative);
      if (!fs.existsSync(target) || !fs.readFileSync(source).equals(fs.readFileSync(target))) {
        stale.push(relative);
      }
    }
  }
  if (stale.length) bad('Android web assets are current', stale.slice(0, 8).join(', '));
  else ok('Android web assets are current');
} else {
  console.log('  · Android project not generated yet (expected until `npx cap add android`).');
}

if (problems.length) {
  console.error(`\n✗ ${problems.length} mobile check(s) failed.`);
  process.exit(1);
}
console.log(`\n✓ Mobile scaffold OK (${checks} checks).`);
