'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const VIDEO_QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360'];
const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'wav', 'flac', 'best'];
const COOKIE_SOURCES = [
  'none', 'embedded', 'chrome', 'chromium', 'firefox', 'brave',
  'edge', 'opera', 'vivaldi', 'safari', 'whale'
];
const THEMES = ['system', 'light', 'dark'];
const SUBTITLE_LANGS = ['ar', 'en', 'ar,en', 'all'];

const DEFAULT_BRIDGE_PORT = 47821;

let cache = null;

function defaults() {
  return {
    downloadDir: app.getPath('downloads'),
    videoQuality: 'best',
    audioFormat: 'mp3',
    browserHome: 'https://www.youtube.com',
    cookieSource: 'none',
    theme: 'system',
    maxConcurrentDownloads: 2,
    embedMetadata: true,
    downloadSubtitles: false,
    subtitleLangs: 'ar,en',
    extensionBridge: true,
    autoDownloadFromExtension: false,
    bridgePort: DEFAULT_BRIDGE_PORT,
    extensions: [],
    extensionsInitialized: false
  };
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function normalize(value) {
  const base = defaults();
  const next = { ...base, ...(value && typeof value === 'object' ? value : {}) };

  if (typeof next.downloadDir !== 'string' || !next.downloadDir.trim()) {
    next.downloadDir = base.downloadDir;
  }

  next.downloadDir = path.resolve(next.downloadDir);

  if (!fs.existsSync(next.downloadDir)) {
    try {
      fs.mkdirSync(next.downloadDir, { recursive: true });
    } catch {
      next.downloadDir = base.downloadDir;
    }
  }

  if (!VIDEO_QUALITIES.includes(String(next.videoQuality))) {
    next.videoQuality = base.videoQuality;
  }

  if (!AUDIO_FORMATS.includes(String(next.audioFormat))) {
    next.audioFormat = base.audioFormat;
  }

  if (typeof next.browserHome !== 'string' || !/^https?:\/\//i.test(next.browserHome)) {
    next.browserHome = base.browserHome;
  }

  if (!COOKIE_SOURCES.includes(String(next.cookieSource))) {
    next.cookieSource = base.cookieSource;
  }

  if (!THEMES.includes(String(next.theme))) {
    next.theme = base.theme;
  }

  if (!SUBTITLE_LANGS.includes(String(next.subtitleLangs))) {
    next.subtitleLangs = base.subtitleLangs;
  }

  next.maxConcurrentDownloads = clampNumber(next.maxConcurrentDownloads, 1, 6, base.maxConcurrentDownloads);
  next.bridgePort = clampNumber(next.bridgePort, 1024, 65535, base.bridgePort);
  next.embedMetadata = Boolean(next.embedMetadata);
  next.downloadSubtitles = Boolean(next.downloadSubtitles);
  next.extensionBridge = Boolean(next.extensionBridge);
  next.autoDownloadFromExtension = Boolean(next.autoDownloadFromExtension);

  if (!Array.isArray(next.extensions)) {
    next.extensions = [];
  }

  next.extensions = [...new Set(
    next.extensions
      .filter((folder) => typeof folder === 'string' && folder && folder === path.basename(folder))
  )];

  next.extensionsInitialized = Boolean(next.extensionsInitialized);

  return next;
}

function load() {
  if (cache) return { ...cache };

  try {
    const raw = fs.readFileSync(settingsFile(), 'utf8');
    cache = normalize(JSON.parse(raw));
  } catch {
    cache = normalize({});
  }

  return { ...cache };
}

function save(patch) {
  const next = normalize({ ...load(), ...(patch && typeof patch === 'object' ? patch : {}) });
  const file = settingsFile();
  const tmp = `${file}.tmp`;

  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(next, null, 2), 'utf8');
  fs.renameSync(tmp, file);

  cache = next;
  return { ...next };
}

module.exports = {
  load,
  save,
  videoQualities: VIDEO_QUALITIES,
  audioFormats: AUDIO_FORMATS,
  cookieSources: COOKIE_SOURCES,
  themes: THEMES,
  subtitleLangs: SUBTITLE_LANGS,
  DEFAULT_BRIDGE_PORT
};
