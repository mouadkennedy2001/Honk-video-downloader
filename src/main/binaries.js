'use strict';

const fs = require('fs');
const path = require('path');

const isWindows = process.platform === 'win32';

let userBinDir = process.env.WASEL_BIN_DIR || process.env.HONK_BIN_DIR || null;

// Safe default that works both inside Electron and in plain Node:
// <userData>/bin when Electron is available; for plain Node testing the
// fallback is ~/.wasel-downloader/bin (legacy ~/.honk-downloader still accepted).
function defaultUserBinDir() {
  try {
    const { app } = require('electron');
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), 'bin');
    }
  } catch {
    /* electron not available (CLI/testing) */
  }
  const os = require('os');
  const home = os.homedir();
  const legacy = path.join(home, '.honk-downloader', 'bin');
  const next = path.join(home, '.wasel-downloader', 'bin');
  try {
    if (fs.existsSync(legacy) && !fs.existsSync(next)) return legacy;
  } catch { /* ignore */ }
  return next;
}

function setUserBinDir(dir) {
  userBinDir = dir ? path.resolve(dir) : null;
  return userBinDir;
}

function getUserBinDir() {
  return userBinDir || defaultUserBinDir();
}

function executableName(name) {
  return isWindows ? `${name}.exe` : name;
}

function isFile(candidate) {
  try {
    return fs.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function which(command) {
  const fileName = isWindows && !command.toLowerCase().endsWith('.exe')
    ? `${command}.exe`
    : command;
  // Common Windows install locations
  const winCommon = [
    'C:\\Program Files\\ffmpeg\\bin',
    'C:\\Program Files (x86)\\ffmpeg\\bin',
    'C:\\Users\\Public\\ffmpeg\\bin',
    process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\Microsoft\\WinGet\\Packages` : null,
    process.env.PROGRAMDATA ? `${process.env.PROGRAMDATA}\\chocolatey\\bin` : null,
    process.env.HOME ? `${process.env.HOME}\\scoop\\shims` : null,
  ].filter(Boolean);
  if (isWindows && winCommon.length) {
    for (const dir of winCommon) {
      const candidate = path.join(dir, fileName);
      if (isFile(candidate)) return candidate;
    }
  }

  const searchPath = String(process.env.PATH || '')
    .split(path.delimiter)
    .map((directory) => directory.trim().replace(/^"(.*)"$/, '$1'))
    .filter(Boolean);

  for (const directory of searchPath) {
    const candidate = path.join(directory, fileName);
    try {
      if (!isFile(candidate)) continue;
      if (!isWindows) fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function bundledPaths(name) {
  const fileName = executableName(name);
  const roots = [];

  if (process.resourcesPath) {
    roots.push(path.join(process.resourcesPath, 'bin'));
    roots.push(path.join(process.resourcesPath, 'app.asar.unpacked', 'bin'));
  }

  roots.push(path.join(__dirname, '..', '..', 'bin'));

  return roots.map((root) => path.join(root, fileName));
}

function bundledPath(name) {
  for (const candidate of bundledPaths(name)) {
    if (isFile(candidate)) return candidate;
  }
  return null;
}

function userBinPath(name) {
  const candidate = path.join(getUserBinDir(), executableName(name));
  return isFile(candidate) ? candidate : null;
}

function envPath(name) {
  const key = `${name.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_PATH`;
  const value = process.env[key];
  return value && isFile(value) ? value : null;
}

function resolve(name) {
  return envPath(name) || userBinPath(name) || bundledPath(name) || which(name);
}

function status() {
  const ytDlp = resolve('yt-dlp');
  const ffmpeg = resolve('ffmpeg');
  const ffprobe = resolve('ffprobe');

  return {
    ytDlp,
    ffmpeg,
    ffprobe,
    userBinDir: getUserBinDir(),
    ok: Boolean(ytDlp),
    merge: Boolean(ffmpeg)
  };
}

module.exports = {
  resolve,
  status,
  which,
  setUserBinDir,
  getUserBinDir,
  executableName
};
