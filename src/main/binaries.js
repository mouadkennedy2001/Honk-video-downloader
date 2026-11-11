'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const isWindows = process.platform === 'win32';

let userBinDir = process.env.HONK_BIN_DIR || null;

function setUserBinDir(dir) {
  userBinDir = dir ? path.resolve(dir) : null;
  return userBinDir;
}

function getUserBinDir() {
  return userBinDir;
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
  const cmd = isWindows && !command.endsWith('.exe') ? `${command}.exe` : command;
  const candidates = [];
  if (isWindows) {
    candidates.push('where.exe', 'where');
  }
  candidates.push(isWindows ? 'where.exe' : 'which');
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
    const exe = `${command}.exe`;
    for (const dir of winCommon) {
      try {
        const p = require('path').join(dir, exe);
        if (require('fs').existsSync(p)) return p;
      } catch {}
    }
  }
  for (const finder of candidates) {
    try {
      const output = execFileSync(finder, [isWindows ? cmd : command], {
        encoding: 'utf8',
        timeout: 5000,
        windowsHide: true
      });
      const match = output
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (match) return match;
    } catch {}
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
  if (!userBinDir) return null;
  const candidate = path.join(userBinDir, executableName(name));
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
    userBinDir,
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
