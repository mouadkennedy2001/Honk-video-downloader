'use strict';

/*
 * Android bridge for the shared Wasel UI.
 *
 * This file is copied to www/mobile.js by scripts/sync-web.js. It replaces the
 * Electron preload API with the same method names backed by Capacitor plugins
 * and a local Chaquopy module running yt-dlp inside the APK. No server is used.
 */
(function () {
  const cap = window.Capacitor || {};
  const plugins = cap.Plugins || {};

  function plugin(name) {
    return plugins[name] || (cap.Plugins && cap.Plugins[name]) || null;
  }

  function call(name, method, payload) {
    const p = plugin(name);
    if (!p || typeof p[method] !== 'function') {
      return Promise.reject(new Error(`المكوّن ${name} غير متاح على هذا الجهاز.`));
    }
    return p[method](payload || {});
  }

  function listen(name, event, handler) {
    const p = plugin(name);
    if (p && typeof p.addListener === 'function') {
      p.addListener(event, handler).catch(function () {});
    }
    return function () {};
  }

  function engineResult(result) {
    if (!result) throw new Error('استجابة فارغة من المحرك.');
    if (result.error || result.ok === false) {
      throw new Error(result.error || result.message || 'فشل محرك التحميل.');
    }
    return result;
  }

  const DEFAULT_SETTINGS = {
    downloadDir: 'Wasel',
    videoQuality: 'best',
    audioFormat: 'm4a',
    videoFormat: 'mp4',
    cookieSource: 'none',
    theme: 'system',
    language: 'ar',
    maxConcurrentDownloads: 2,
    embedMetadata: false,
    downloadSubtitles: false,
    subtitleLangs: 'ar,en',
    history: [],
    favorites: [],
    enableHistory: true,
    enableFavorites: true,
    maxHistory: 200,
    filenameTemplate: '%(title).150s [%(id)s].%(ext)s'
  };

  function readSettings() {
    try {
      const settings = Object.assign({}, DEFAULT_SETTINGS, JSON.parse(localStorage.getItem('wasel.settings') || '{}'));
      delete settings.browserHome;
      delete settings.extensionBridge;
      delete settings.autoDownloadFromExtension;
      localStorage.setItem('wasel.settings', JSON.stringify(settings));
      return settings;
    } catch (_error) {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  let sitesCache = null;
  function loadSites() {
    if (sitesCache) return Promise.resolve(sitesCache);
    return fetch('sites.json')
      .then(function (response) {
        if (!response.ok) throw new Error('sites.json');
        return response.json();
      })
      .then(function (sites) {
        sitesCache = sites;
        return sites;
      });
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text);
    }
    const input = document.createElement('textarea');
    input.value = text;
    input.style.position = 'fixed';
    input.style.opacity = '0';
    document.body.appendChild(input);
    input.select();
    try { document.execCommand('copy'); } finally { input.remove(); }
    return Promise.resolve();
  }

  const relay = function (event) {
    return function (handler) {
      listen('Ytdlp', event, function (payload) { handler(payload || {}); });
    };
  };

  window.wasel = {
    /* ---------- Settings and local data ---------- */
    getSettings: function () { return Promise.resolve(readSettings()); },
    saveSettings: function (patch) {
      const next = Object.assign(readSettings(), patch || {});
      localStorage.setItem('wasel.settings', JSON.stringify(next));
      return Promise.resolve(next);
    },

    /* ---------- Engine ---------- */
    environment: function () {
      return Promise.resolve({
        ok: true,
        // The APK uses a progressive yt-dlp format; no FFmpeg is bundled.
        merge: true,
        ytDlp: 'yt-dlp (مدمج)',
        ytDlpVersion: ' bundled',
        ffmpeg: null,
        ffprobe: null,
        spotdl: null
      });
    },
    appInfo: function () {
      return Promise.resolve({
        version: '2.0.0-mobile',
        electron: 'Android WebView',
        chrome: navigator.userAgent,
        platform: 'android',
        userData: 'internal storage',
        binDir: ' bundled yt-dlp'
      });
    },

    /* ---------- Download engine ---------- */
    fetchInfo: function (url, cookieSource) {
      return call('Ytdlp', 'info', { url: url, cookieSource: cookieSource || 'none' })
        .then(engineResult);
    },
    getPreviewUrl: function (url, cookieSource, mode) {
      return call('Ytdlp', 'previewUrl', { url: url, cookieSource: cookieSource || 'none', mode: mode || 'video' })
        .then(engineResult)
        .then(function (result) { return result.url; });
    },
    startDownload: function (options) {
      return call('Ytdlp', 'download', { options: JSON.stringify(options || {}) });
    },
    cancelDownload: function (id) { return call('Ytdlp', 'cancel', { id: id }); },
    pauseDownload: function (id) { return call('Ytdlp', 'pause', { id: id }); },
    resumeDownload: function (id) { return call('Ytdlp', 'resume', { id: id }); },

    onProgress: relay('progress'),
    onDone: relay('done'),
    onError: relay('error'),
    onCancelled: relay('cancelled'),

    /* ---------- Sites ---------- */
    listSites: loadSites,
    sitesCategories: function () {
      return loadSites().then(function (sites) {
        return [...new Set(sites.map(function (site) { return site.category; }))].sort();
      });
    },

    /* ---------- Sharing and system ---------- */
    share: function (payload) {
      return call('Share', 'share', Object.assign({ dialogTitle: 'Wasel Downloader' }, payload || {}));
    },
    writeClipboard: copyText,
    readClipboard: function () {
      return navigator.clipboard && navigator.clipboard.readText
        ? navigator.clipboard.readText()
        : Promise.resolve('');
    },
    openExternal: function (url) { return call('Browser', 'open', { url: url }); },
    openPath: function (path) { return call('Ytdlp', 'openPath', { path: path }).catch(function () {}); },
    showItem: function (path) { return call('Ytdlp', 'openPath', { path: path }).catch(function () {}); },
    chooseFolder: function () { return Promise.resolve(readSettings().downloadDir); },

    /* ---------- Incoming links from other apps ---------- */
    onSharedLink: function (handler) {
      listen('Ytdlp', 'sharedLink', function (payload) {
        if (payload && payload.url) handler(payload.url);
      });
      const app = plugin('App');
      if (app && typeof app.addListener === 'function') {
        app.addListener('appUrlOpen', function (data) {
          if (data && data.url && /^https?:\/\//i.test(data.url)) handler(data.url);
        }).catch(function () {});
      }
    },

    /* ---------- Desktop-only features ----------
     * The shared renderer still calls these methods even though the related
     * panels are stripped from the APK. Safe stubs keep init() from throwing.
     */
    installTool: function () { return Promise.resolve({ ok: false, message: 'المحرّك مدمج في APK.' }); },
    updateYtDlp: function () { return Promise.resolve({ ok: false, message: 'حدّث التطبيق للحصول على إصدار جديد.' }); },
    applyAutoStart: function () {},
    onInstallProgress: function () {},

    listExtensions: function () { return Promise.resolve({ extensions: [] }); },
    addExtensionFolder: function () { return Promise.resolve(null); },
    addExtensionArchive: function () { return Promise.resolve(null); },
    installBundledExtension: function () { return Promise.resolve(null); },
    reloadExtension: function () { return Promise.resolve({ ok: false }); },
    removeExtension: function () { return Promise.resolve({ ok: false }); },
    openExtensionsFolder: function () { return Promise.resolve(); },
    onExtensionReceived: function () {},
    bridgeStatus: function () { return Promise.resolve({ running: false }); },
    testBridge: function () { return Promise.resolve({ ok: false, error: 'الجسر غير متاح في APK.' }); },
    restartBridge: function () { return Promise.resolve({ ok: false }); }
  };

  document.documentElement.dataset.platform = 'mobile';
})();
