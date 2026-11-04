'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app, session, shell } = require('electron');
const AdmZip = require('adm-zip');
const settings = require('./settings');
const { BROWSER_PARTITION } = require('./cookies');

const MAX_ARCHIVE_ENTRIES = 5000;
const MAX_EXTRACTED_BYTES = 200 * 1024 * 1024;

const loadErrors = new Map();

function browserSession() {
  return session.fromPartition(BROWSER_PARTITION);
}

function extensionManager() {
  const browser = browserSession();
  return browser.extensions && typeof browser.extensions.loadExtension === 'function'
    ? browser.extensions
    : browser;
}

function rootDir() {
  const dir = path.join(app.getPath('userData'), 'extensions');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function bundledDir() {
  const candidates = [];

  if (process.resourcesPath) {
    candidates.push(path.join(process.resourcesPath, 'extensions', 'honk-media-grabber'));
    candidates.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'extensions', 'honk-media-grabber'));
  }

  candidates.push(path.join(__dirname, '..', '..', 'extensions', 'honk-media-grabber'));

  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'manifest.json'))) return candidate;
  }

  return null;
}

function isInside(parent, target) {
  const base = path.resolve(parent);
  const resolved = path.resolve(target);
  return resolved === base || resolved.startsWith(`${base}${path.sep}`);
}

function readManifest(dir) {
  const manifestPath = path.join(dir, 'manifest.json');
  const raw = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(raw);

  if (!manifest || typeof manifest.name !== 'string' || !manifest.name.trim()) {
    throw new Error('ملف manifest.json لا يحتوي على اسم إضافة صالح.');
  }

  return manifest;
}

function sanitizeFolderBase(name) {
  const base = String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 36);

  return base || 'extension';
}

function uniqueFolder(name) {
  const suffix = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  return `${sanitizeFolderBase(name)}-${suffix}`;
}

function loadedExtensions() {
  try {
    return extensionManager().getAllExtensions();
  } catch {
    return [];
  }
}

function folderFromExtensionPath(extensionPath) {
  if (!extensionPath || !isInside(rootDir(), extensionPath)) return null;
  const relative = path.relative(rootDir(), extensionPath);
  return relative.split(path.sep)[0] || null;
}

function findInstalledByNameVersion(name, version) {
  const targetVersion = String(version || '');

  for (const folder of settings.load().extensions) {
    const dir = path.join(rootDir(), folder);

    try {
      const manifest = readManifest(dir);
      if (manifest.name === name && String(manifest.version || '') === targetVersion) {
        return { folder, dir };
      }
    } catch {
      /* ignore broken folders */
    }
  }

  return null;
}

function toInfo(extension, folder) {
  return {
    key: extension.id || folder,
    id: extension.id || null,
    name: extension.name || 'إضافة بدون اسم',
    version: extension.version || '—',
    path: extension.path || null,
    folder: folder || null,
    loaded: true,
    error: null,
    manifestVersion: extension.manifest ? extension.manifest.manifest_version : null
  };
}

async function unloadFolder(folder) {
  const dir = path.resolve(path.join(rootDir(), folder));
  const matching = loadedExtensions().filter((extension) => {
    try {
      return path.resolve(extension.path) === dir;
    } catch {
      return false;
    }
  });

  for (const extension of matching) {
    try {
      await extensionManager().removeExtension(extension.id);
    } catch {
      /* ignore */
    }
  }
}

async function installFromFolder(sourceDir) {
  const source = path.resolve(sourceDir);
  const manifest = readManifest(source);
  const existing = findInstalledByNameVersion(manifest.name, manifest.version);

  if (existing) {
    await removeInstalled(existing.folder);
  }

  const folder = uniqueFolder(manifest.name);
  const destination = path.join(rootDir(), folder);

  fs.cpSync(source, destination, { recursive: true, dereference: true });
  readManifest(destination);

  try {
    const extension = await extensionManager().loadExtension(destination, { allowFileAccess: true });
    loadErrors.delete(destination);

    const current = settings.load();
    if (!current.extensions.includes(folder)) {
      settings.save({ extensions: [...current.extensions, folder] });
    }

    return {
      ...toInfo(extension, folder),
      alreadyInstalled: Boolean(existing)
    };
  } catch (error) {
    fs.rmSync(destination, { recursive: true, force: true });
    throw new Error(`تعذّر تحميل الإضافة: ${error.message}`);
  }
}

function crxToZip(buffer) {
  if (buffer.length < 12 || buffer.subarray(0, 4).toString('ascii') !== 'Cr24') {
    return buffer;
  }

  const version = buffer.readUInt32LE(4);
  let offset;

  if (version === 2) {
    const publicKeyLength = buffer.readUInt32LE(8);
    const signatureLength = buffer.readUInt32LE(12);
    offset = 16 + publicKeyLength + signatureLength;
  } else if (version === 3) {
    const headerLength = buffer.readUInt32LE(8);
    offset = 12 + headerLength;
  } else {
    throw new Error('إصدار ملف CRX غير مدعوم.');
  }

  if (offset <= 0 || offset >= buffer.length) {
    throw new Error('ملف CRX تالف أو غير مكتمل.');
  }

  return buffer.subarray(offset);
}

function extractZipTo(zipBuffer, tempDir) {
  let zip;

  try {
    zip = new AdmZip(zipBuffer);
  } catch {
    throw new Error('تعذّر قراءة الأرشيف. تأكد أنه ملف CRX أو ZIP صالح.');
  }

  const entries = zip.getEntries();

  if (entries.length > MAX_ARCHIVE_ENTRIES) {
    throw new Error('الأرشيف يحتوي على عدد ملفات كبير جدًا.');
  }

  let totalBytes = 0;

  for (const entry of entries) {
    if (entry.isDirectory) continue;

    const entryName = entry.entryName.replace(/\\/g, '/');
    if (!entryName || entryName.startsWith('/') || entryName.includes('..')) continue;

    totalBytes += entry.header.size;
    if (totalBytes > MAX_EXTRACTED_BYTES) {
      throw new Error('حجم الأرشيف بعد فك الضغط كبير جدًا.');
    }

    const destination = path.join(tempDir, entryName);
    if (!isInside(tempDir, destination)) continue;

    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, entry.getData());
  }
}

function findManifestRoot(tempDir) {
  if (fs.existsSync(path.join(tempDir, 'manifest.json'))) return tempDir;

  const directories = fs.readdirSync(tempDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(tempDir, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'manifest.json')));

  if (directories.length === 1) return directories[0];

  throw new Error('لم يتم العثور على manifest.json داخل الأرشيف.');
}

async function installFromArchive(archivePath) {
  const file = path.resolve(String(archivePath));
  const extension = path.extname(file).toLowerCase();

  if (extension !== '.crx' && extension !== '.zip') {
    throw new Error('الملف يجب أن يكون بصيغة .crx أو .zip');
  }

  const buffer = fs.readFileSync(file);
  const zipBuffer = crxToZip(buffer);
  const tempDir = path.join(rootDir(), `.tmp-${crypto.randomBytes(6).toString('hex')}`);

  fs.mkdirSync(tempDir, { recursive: true });

  try {
    extractZipTo(zipBuffer, tempDir);
    const manifestRoot = findManifestRoot(tempDir);
    return await installFromFolder(manifestRoot);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function installBundled() {
  const dir = bundledDir();
  if (!dir) throw new Error('الإضافة المدمجة غير موجودة في هذه النسخة.');

  const manifest = readManifest(dir);
  const previous = [];

  for (const folder of settings.load().extensions) {
    try {
      const installed = readManifest(path.join(rootDir(), folder));
      if (installed.name === manifest.name) previous.push(folder);
    } catch {
      /* ignore broken or missing folders */
    }
  }

  for (const folder of previous) {
    await removeInstalled(folder);
  }

  return installFromFolder(dir);
}

async function removeInstalled(folder) {
  if (!folder) return false;

  const dir = path.join(rootDir(), folder);
  if (!isInside(rootDir(), dir)) return false;

  await unloadFolder(folder);
  fs.rmSync(dir, { recursive: true, force: true });
  loadErrors.delete(dir);

  const current = settings.load();
  settings.save({ extensions: current.extensions.filter((item) => item !== folder) });
  return true;
}

async function removeById(id) {
  const extension = loadedExtensions().find((item) => item.id === id);
  if (!extension) return false;

  const folder = folderFromExtensionPath(extension.path);

  try {
    await extensionManager().removeExtension(id);
  } catch {
    /* ignore */
  }

  if (folder) {
    const dir = path.join(rootDir(), folder);
    fs.rmSync(dir, { recursive: true, force: true });
    loadErrors.delete(dir);

    const current = settings.load();
    settings.save({ extensions: current.extensions.filter((item) => item !== folder) });
  }

  return true;
}

async function remove(target) {
  if (target && target.folder) return removeInstalled(String(target.folder));
  if (target && target.id) return removeById(String(target.id));
  return false;
}

async function reload(target) {
  let folder = target && target.folder ? String(target.folder) : null;

  if (!folder && target && target.id) {
    const extension = loadedExtensions().find((item) => item.id === target.id);
    if (extension) folder = folderFromExtensionPath(extension.path);
  }

  if (!folder) throw new Error('لم يتم العثور على مجلد الإضافة.');

  const dir = path.join(rootDir(), folder);
  if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
    throw new Error('ملف manifest.json غير موجود.');
  }

  await unloadFolder(folder);

  try {
    const extension = await extensionManager().loadExtension(dir, { allowFileAccess: true });
    loadErrors.delete(dir);
    return toInfo(extension, folder);
  } catch (error) {
    loadErrors.set(dir, error.message);
    throw new Error(`تعذّر إعادة تحميل الإضافة: ${error.message}`);
  }
}

async function loadInstalled() {
  const current = settings.load();
  const missing = [];
  const loaded = loadedExtensions().map((extension) => path.resolve(extension.path || ''));

  for (const folder of current.extensions) {
    const dir = path.join(rootDir(), folder);

    if (!fs.existsSync(path.join(dir, 'manifest.json'))) {
      missing.push(folder);
      continue;
    }

    if (loaded.includes(path.resolve(dir))) continue;

    try {
      await extensionManager().loadExtension(dir, { allowFileAccess: true });
      loadErrors.delete(dir);
    } catch (error) {
      loadErrors.set(dir, error.message);
    }
  }

  if (missing.length) {
    settings.save({
      extensions: current.extensions.filter((folder) => !missing.includes(folder))
    });
  }
}

async function ensureInitialized() {
  const current = settings.load();
  if (current.extensionsInitialized) return;

  if (bundledDir()) {
    try {
      await installBundled();
    } catch (error) {
      loadErrors.set('bundled', error.message);
    }
  }

  settings.save({ extensionsInitialized: true });
}

function list() {
  const current = settings.load();
  const loaded = loadedExtensions();
  const loadedFolders = new Set();

  const result = loaded.map((extension) => {
    const folder = folderFromExtensionPath(extension.path);
    if (folder) loadedFolders.add(folder);
    return toInfo(extension, folder);
  });

  for (const folder of current.extensions) {
    if (loadedFolders.has(folder)) continue;

    const dir = path.join(rootDir(), folder);
    let name = folder;
    let version = '—';

    try {
      const manifest = readManifest(dir);
      name = manifest.name;
      version = manifest.version || version;
    } catch {
      /* keep folder name */
    }

    result.push({
      key: folder,
      id: null,
      name,
      version,
      path: dir,
      folder,
      loaded: false,
      error: loadErrors.get(dir) || 'لم يتم تحميل الإضافة.',
      manifestVersion: null
    });
  }

  return {
    root: rootDir(),
    extensions: result
  };
}

async function openRoot() {
  const dir = rootDir();
  const error = await shell.openPath(dir);
  return !error;
}

module.exports = {
  list,
  loadInstalled,
  ensureInitialized,
  installFromFolder,
  installFromArchive,
  installBundled,
  remove,
  reload,
  openRoot,
  bundledDir
};
