'use strict';

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const VIDEO_QUALITIES = ['best', '2160', '1440', '1080', '720', '480', '360'];
const AUDIO_FORMATS = ['mp3', 'm4a', 'opus', 'wav', 'flac', 'best'];
const COOKIE_SOURCES = [
  'none', 'embedded', 'chrome', 'chromium', 'firefox', 'brave',
  'edge', 'opera', 'vivaldi', 'safari', 'whale', 'file'
];
const THEMES = ['system', 'light', 'dark'];
const LANGUAGES = ['ar','en','fr','es','de','tr','hi','zh','ru','pt','ja','ko','it','nl','sv','pl','ur','fa','id','ms','th','vi','uk','el'];
const FONTS = ['cairo','tajawal','almarai','noto-kufi-arabic','amiri','ibm-plex-arabic','noto-sans-arabic','noto-naskh-arabic','readex-pro','aladin','el-messiri','rubik','inter','roboto','poppins','exo2','segoe','system'];
const VIDEO_FORMATS = ['mp4','mkv','webm','mov','best'];
const SUBTITLE_LANGS = ['ar', 'en', 'ar,en', 'all','fr','es','de','tr'];

const DEFAULT_BRIDGE_PORT = 47821;

let cache = null;

function defaults() {
  return {
    downloadDir: app.getPath('downloads'),
    videoQuality: 'best',
    audioFormat: 'mp3',
    videoFormat: 'mp4',
    browserHome: 'https://www.youtube.com',
    cookieSource: 'none',
    cookieFile: '',
    theme: 'system',
    language: 'ar',
    font: 'cairo',
    maxConcurrentDownloads: 2,
    embedMetadata: true,
    downloadSubtitles: false,
    subtitleLangs: 'ar,en',
    extensionBridge: true,
    autoDownloadFromExtension: false,
    bridgePort: DEFAULT_BRIDGE_PORT,
    extensions: [],
    extensionsInitialized: false,
    // New enhanced options
    speedLimit: '', // e.g. "2M" per second or empty
    proxy: '',
    filenameTemplate: '%(title).150s [%(id)s].%(ext)s',
    outputSubfolder: false,
    downloadChapters: false,
    downloadThumbnail: false,
    downloadInfoJson: false,
    writeDescription: false,
    sponsorblock: false,
    restrictFilenames: false,
    playlistStart: 1,
    playlistEnd: 0, // 0 = all
    audioBitrate: '0',
    recodeVideo: 'best', // mp4/webm etc
    embedChapters: true,
    parseMetadata: false,
    skipDownload: false,
    extractorArgs: '',
    batchFile: '',
    autoUpdateYtdlp: true,
    minimizeToTray: false,
    autoStart: false,
    showNotifications: true,
    maxHeight: 0,
    mergeOutputFormat: 'mp4',
    noPostOverwrites: false,
    continueOnError: false,
    userAgent: '',
    bufferSize: '16K',
    // New premium features
    history: [], // {url,title,at,thumb}
    favorites: [], // {url,name,icon,color,at}
    enableHistory: true,
    enableFavorites: true,
    uiScale: '100',
    showSiteIcons: true,
    smoothAnimations: true,
    pauseOnError: false,
    retryFailed: 0,
    maxHistory: 200,
  };
}

function settingsFile() {
  return path.join(app.getPath('userData'), 'settings.json');
}

function clampNumber(value, min, max, fallback) {
  const number = Number.parseInt(String(value), 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function sanitizeString(value, maxLength) {
  if (typeof value !== 'string') return '';
  return value.slice(0, maxLength || 1000);
}

function normalize(value) {
  const base = defaults();
  const next = { ...base, ...(value && typeof value === 'object' ? value : {}) };

  if (typeof next.downloadDir !== 'string' || !next.downloadDir.trim()) {
    next.downloadDir = base.downloadDir;
  }
  next.downloadDir = path.resolve(next.downloadDir);
  try { fs.mkdirSync(next.downloadDir, { recursive: true }); } catch { next.downloadDir = base.downloadDir; }

  if (!VIDEO_QUALITIES.includes(String(next.videoQuality))) next.videoQuality = base.videoQuality;
  if (!AUDIO_FORMATS.includes(String(next.audioFormat))) next.audioFormat = base.audioFormat;
  if (!VIDEO_FORMATS.includes(String(next.videoFormat))) next.videoFormat = base.videoFormat;
  if (typeof next.browserHome !== 'string' || !/^https?:\/\//i.test(next.browserHome)) next.browserHome = base.browserHome;
  if (!COOKIE_SOURCES.includes(String(next.cookieSource))) next.cookieSource = base.cookieSource;
  next.cookieFile = sanitizeString(next.cookieFile, 1000);
  if (!THEMES.includes(String(next.theme))) next.theme = base.theme;
  if (!LANGUAGES.includes(String(next.language))) next.language = base.language;
  if (!FONTS.includes(String(next.font))) next.font = base.font;
  if (!SUBTITLE_LANGS.includes(String(next.subtitleLangs))) {
    // allow comma separated combos plus new langs
    const allowed = new Set(SUBTITLE_LANGS);
    const parts = String(next.subtitleLangs).split(',').map(s=>s.trim()).filter(Boolean);
    if (!parts.every(p=>allowed.has(p) || /^[a-z]{2,3}$/.test(p))) next.subtitleLangs = base.subtitleLangs;
  }

  next.maxConcurrentDownloads = clampNumber(next.maxConcurrentDownloads, 1, 10, base.maxConcurrentDownloads);
  next.bridgePort = clampNumber(next.bridgePort, 1024, 65535, base.bridgePort);
  next.embedMetadata = Boolean(next.embedMetadata);
  next.downloadSubtitles = Boolean(next.downloadSubtitles);
  next.extensionBridge = Boolean(next.extensionBridge);
  next.autoDownloadFromExtension = Boolean(next.autoDownloadFromExtension);

  // enhanced booleans
  const bools = ['outputSubfolder','downloadChapters','downloadThumbnail','downloadInfoJson','writeDescription','sponsorblock','restrictFilenames','embedChapters','parseMetadata','skipDownload','autoUpdateYtdlp','minimizeToTray','autoStart','showNotifications','noPostOverwrites','continueOnError','enableHistory','enableFavorites','showSiteIcons','smoothAnimations','pauseOnError'];
  for (const k of bools) if (k in next) next[k] = Boolean(next[k]);

  next.history = Array.isArray(next.history) ? next.history.filter(h=>h && typeof h.url==='string' && /^https?:\/\/\S+$/.test(h.url)).slice(0,500) : [];
  next.favorites = Array.isArray(next.favorites) ? next.favorites.filter(f=>f && typeof f.url==='string').slice(0,200) : [];
  next.maxHistory = clampNumber(next.maxHistory, 20, 1000, 200);
  next.retryFailed = clampNumber(next.retryFailed, 0, 5, 0);
  next.uiScale = ['90','100','110','125','150'].includes(String(next.uiScale)) ? String(next.uiScale) : '100';

  next.speedLimit = sanitizeString(next.speedLimit, 50);
  next.proxy = sanitizeString(next.proxy, 500);
  next.filenameTemplate = sanitizeString(next.filenameTemplate, 500) || base.filenameTemplate;
  next.batchFile = sanitizeString(next.batchFile, 1000);
  next.extractorArgs = sanitizeString(next.extractorArgs, 500);
  next.audioBitrate = sanitizeString(next.audioBitrate, 20) || '0';
  next.recodeVideo = ['best','mp4','mkv','webm','mov','avi'].includes(next.recodeVideo) ? next.recodeVideo : 'best';
  next.playlistStart = clampNumber(next.playlistStart, 1, 10000, 1);
  next.playlistEnd = clampNumber(next.playlistEnd, 0, 10000, 0);
  next.maxHeight = clampNumber(next.maxHeight, 0, 4320, 0);
  next.mergeOutputFormat = ['mp4','mkv','webm','best'].includes(next.mergeOutputFormat) ? next.mergeOutputFormat : 'mp4';
  next.userAgent = sanitizeString(next.userAgent, 500);
  next.bufferSize = sanitizeString(next.bufferSize, 20) || '16K';

  if (!Array.isArray(next.extensions)) next.extensions = [];
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
  languages: LANGUAGES,
  fonts: FONTS,
  videoFormats: VIDEO_FORMATS,
  subtitleLangs: SUBTITLE_LANGS,
  DEFAULT_BRIDGE_PORT
};
