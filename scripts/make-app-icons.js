'use strict';
/*
 * Renders build/icon-master.svg into the full app icon set:
 *   build/icon.png           512x512  (electron-builder linux)
 *   build/icon.ico           16/32/48 BMP + 256 PNG (electron-builder win)
 *   build/icon.icns          128/256/512 PNG entries (electron-builder mac)
 *   src/renderer/assets/icon.png  512x512 (window/notifications)
 *   extensions/wasel-media-grabber/icon128.png  128x128
 *
 * Usage: npx electron scripts/make-app-icons.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const { app, BrowserWindow } = require('electron');

const ROOT = path.join(__dirname, '..');
const SVG = path.join(ROOT, 'build', 'icon-master.svg');

function packIco(images) {
  // images: [{ width, data (PNG) } ...] — PNG entries (Vista+)
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);

  const entries = [];
  let offset = 6 + 16 * count;
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0); // width (0 = 256)
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 1); // height
    entry.writeUInt8(0, 2); // palette
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // color planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += img.data.length;
    entries.push(entry);
  }

  return Buffer.concat([header, ...entries, ...images.map((img) => img.data)]);
}

function packIcns(images) {
  // images: [{ type, data (PNG) }]
  let total = 8;
  for (const img of images) total += 8 + img.data.length;

  const chunks = [];
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(total, 4);
  chunks.push(header);

  for (const img of images) {
    const entryHeader = Buffer.alloc(8);
    entryHeader.write(img.type, 0, 'ascii');
    entryHeader.writeUInt32BE(8 + img.data.length, 4);
    chunks.push(entryHeader, img.data);
  }

  return Buffer.concat(chunks);
}

async function renderPng(size) {
  const svg = fs.readFileSync(SVG, 'utf8');
  const html = `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;background:transparent;overflow:hidden}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`;

  const win = new BrowserWindow({
    show: false,
    width: size,
    height: size,
    frame: false,
    transparent: false,
    backgroundColor: '#00000000',
    webPreferences: { backgroundThrottling: false, offscreen: false }
  });

  await win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  await new Promise((resolve) => setTimeout(resolve, 250));

  const image = await win.webContents.capturePage({ x: 0, y: 0, width: size, height: size });
  win.destroy();

  if (image.isEmpty()) throw new Error(`capture failed for size ${size}`);
  return image;
}

app.whenReady().then(async () => {
  try {
    const master = await renderPng(512);
    const png = (image) => image.toPNG();

    // --- PNG outputs ---
    fs.writeFileSync(path.join(ROOT, 'build', 'icon.png'), png(master));
    fs.writeFileSync(path.join(ROOT, 'src', 'renderer', 'assets', 'icon.png'), png(master));

    const img256 = master.resize({ width: 256 });
    const img128 = master.resize({ width: 128 });
    const img64 = master.resize({ width: 64 });
    const img48 = master.resize({ width: 48 });
    const img32 = master.resize({ width: 32 });
    const img16 = master.resize({ width: 16 });

    fs.writeFileSync(
      path.join(ROOT, 'extensions', 'wasel-media-grabber', 'icon128.png'),
      png(img128)
    );

    // --- ICO (Windows) ---
    const ico = packIco([
      { width: 256, data: png(img256) },
      { width: 64, data: png(img64) },
      { width: 48, data: png(img48) },
      { width: 32, data: png(img32) },
      { width: 16, data: png(img16) }
    ]);
    fs.writeFileSync(path.join(ROOT, 'build', 'icon.ico'), ico);

    // --- ICNS (macOS) ---
    const icns = packIcns([
      { type: 'ic07', data: png(img128) },
      { type: 'ic08', data: png(img256) },
      { type: 'ic09', data: png(master) }
    ]);
    fs.writeFileSync(path.join(ROOT, 'build', 'icon.icns'), icns);

    console.log('✔ icons generated:');
    for (const f of ['build/icon.png', 'build/icon.ico', 'build/icon.icns', 'src/renderer/assets/icon.png', 'extensions/wasel-media-grabber/icon128.png']) {
      console.log(`  ${f} (${fs.statSync(path.join(ROOT, f)).size} bytes)`);
    }
  } catch (error) {
    console.error('icon generation failed:', error);
    process.exitCode = 1;
  } finally {
    app.quit();
  }
});
