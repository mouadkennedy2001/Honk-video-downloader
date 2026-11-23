'use strict';

/**
 * Copy the Electron renderer into the Capacitor web folder and wire the
 * mobile bridge. Run from anywhere: node mobile/scripts/sync-web.js
 */
const fs = require('fs');
const path = require('path');

const mobileDir = path.resolve(__dirname, '..');
const rootDir = path.resolve(mobileDir, '..');
const rendererDir = path.join(rootDir, 'src', 'renderer');
const wwwDir = path.join(mobileDir, 'www');
const iconsDir = path.join(rootDir, 'icons');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dest = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dest);
    else fs.copyFileSync(src, dest);
  }
}

function removeElementById(html, tag, id) {
  const escapedId = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const openingPattern = new RegExp(`<${tag}\\b(?=[^>]*\\bid="${escapedId}")[^>]*>`, 'g');
  const openings = [...html.matchAll(openingPattern)];
  if (openings.length !== 1) {
    throw new Error(`Expected one <${tag}> element with id="${id}", found ${openings.length}.`);
  }

  const start = openings[0].index;
  const tokens = new RegExp(`<\\/?${tag}\\b[^>]*>`, 'g');
  tokens.lastIndex = start;
  let depth = 0;
  let match;

  while ((match = tokens.exec(html))) {
    if (match[0].startsWith(`</${tag}`)) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(0, start) + html.slice(tokens.lastIndex);
      }
    } else if (!match[0].endsWith('/>')) {
      depth += 1;
    }
  }

  throw new Error(`Could not find closing </${tag}> for id="${id}".`);
}

function stripDesktopFeatures(html) {
  const extensionTab = /^[ \t]*<button\b(?=[^>]*\bdata-tab="extensions")[^>]*>.*?<\/button>\r?\n/gm;
  const matches = [...html.matchAll(extensionTab)];
  if (matches.length !== 1) {
    throw new Error(`Expected one extensions tab button, found ${matches.length}.`);
  }

  html = html.replace(extensionTab, '');
  html = removeElementById(html, 'section', 'tab-extensions');
  html = removeElementById(html, 'div', 'bridge-panel');
  return removeElementById(html, 'div', 'feature-extension');
}

function main() {
  fs.rmSync(wwwDir, { recursive: true, force: true });
  fs.mkdirSync(wwwDir, { recursive: true });

  copyDir(rendererDir, wwwDir);
  copyDir(iconsDir, path.join(wwwDir, 'icons'));
  fs.copyFileSync(
    path.join(mobileDir, 'www-src', 'mobile.js'),
    path.join(wwwDir, 'mobile.js')
  );

  // The renderer uses ../../icons from src/renderer. In the APK the icons
  // are bundled next to index.html.
  const appPath = path.join(wwwDir, 'app.js');
  const appSource = fs.readFileSync(appPath, 'utf8')
    .replace(/\.\.\/\.\.\/icons\//g, 'icons/');
  fs.writeFileSync(appPath, appSource);

  // Load the Android bridge before app.js builds window.wasel.
  const htmlPath = path.join(wwwDir, 'index.html');
  let html = stripDesktopFeatures(fs.readFileSync(htmlPath, 'utf8'));
  if (!html.includes('mobile.js')) {
    html = html.replace(
      '<script src="app.js"></script>',
      '<script src="mobile.js"></script>\n  <script src="app.js"></script>'
    );
  }
  fs.writeFileSync(htmlPath, html);

  // Serve the supported-site directory as local JSON (no network, no server).
  const { SITES } = require(path.join(rootDir, 'src', 'main', 'sites.js'));
  fs.writeFileSync(
    path.join(wwwDir, 'sites.json'),
    JSON.stringify(SITES, null, 2)
  );

  console.log(`✓ Mobile web assets synced to ${wwwDir}`);
}

main();
