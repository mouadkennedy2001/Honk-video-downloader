'use strict';

const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
const {
  app,
  BrowserWindow,
  ipcMain,
  dialog,
  shell,
  clipboard,
  session,
  nativeTheme,
  Menu,
  Tray,
  nativeImage,
  Notification
} = require('electron');

const binaries = require('./binaries');
const installer = require('./installer');
const settings = require('./settings');
const downloader = require('./downloader');
const extensions = require('./extensions');
const bridge = require('./bridge');
const { SITES } = require('./sites');
const { BROWSER_PARTITION, exportCookies } = require('./cookies');

const BROWSER_COOKIE_SOURCES = new Set([
  'chrome', 'chromium', 'firefox', 'brave', 'edge', 'opera', 'vivaldi', 'safari', 'whale'
]);

let mainWindow = null;
let bridgeHandle = null;
let bridgeError = null;
let pendingProtocolUrl = null;

const installLocks = new Set();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

function sendToWindow(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
    return true;
  }
  return false;
}

function browserSession() {
  return session.fromPartition(BROWSER_PARTITION);
}

function applyTheme() {
  const current = settings.load();
  nativeTheme.themeSource = current.theme;
}

function isDarkTheme() {
  const current = settings.load();
  return current.theme === 'dark' || (current.theme === 'system' && nativeTheme.shouldUseDarkColors);
}

function hardenBrowserSession() {
  const ses = browserSession();
  const platformToken = process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64';

  const userAgent = `Mozilla/5.0 (${platformToken}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
  ses.setUserAgent(userAgent);

  ses.setPermissionRequestHandler((_contents, permission, callback) => {
    const allowed = new Set(['fullscreen', 'clipboard-sanitized-write', 'clipboard-read', 'notifications']);
    callback(allowed.has(permission));
  });

  ses.setPermissionCheckHandler((_contents, permission) => (
    permission === 'fullscreen' || permission === 'clipboard-sanitized-write'
  ));
}

function focusWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;

  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

let tray = null;
function createTray() {
  try {
    if (tray) return;
    const iconPath = path.join(__dirname, '..', 'renderer', 'assets', 'icon.png');
    const icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) return;
    tray = new Tray(icon.resize({ width: 16, height: 16 }));
    const menu = Menu.buildFromTemplate([
      { label: 'إظهار', click: focusWindow },
      { label: 'تحميل جديد', click: () => { focusWindow(); sendToWindow('tray:new-download'); } },
      { type: 'separator' },
      { label: 'خروج', click: () => app.quit() },
    ]);
    tray.setToolTip('Honk Downloader');
    tray.setContextMenu(menu);
    tray.on('click', focusWindow);
  } catch {}
}

function applyAutoStart() {
  try {
    const s = settings.load();
    app.setLoginItemSettings({ openAtLogin: Boolean(s.autoStart), openAsHidden: false });
  } catch {}
}

function notify(title, body) {
  try {
    const s = settings.load();
    if (!s.showNotifications) return;
    if (!Notification.isSupported()) return;
    new Notification({ title: title || 'Honk Downloader', body: body || '', icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png') }).show();
  } catch {}
}

function createWindow() {
  applyTheme();

  mainWindow = new BrowserWindow({
    width: 1380,
    height: 920,
    minWidth: 980,
    minHeight: 640,
    show: false,
    maximize: true,
    backgroundColor: isDarkTheme() ? '#07101c' : '#ffffff',
    title: 'Honk Downloader',
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'win32' ? 'default' : 'hiddenInset',
    icon: path.join(__dirname, '..', 'renderer', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webviewTag: true,
      spellcheck: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();

    if (pendingProtocolUrl) {
      const url = pendingProtocolUrl;
      pendingProtocolUrl = null;
      setTimeout(() => handleProtocolUrl(url), 400);
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('minimize', (e) => {
    try {
      const s = settings.load();
      if (s.minimizeToTray) { e.preventDefault(); mainWindow.hide(); createTray(); }
    } catch {}
  });
  mainWindow.on('close', (e) => {
    try {
      const s = settings.load();
      if (s.minimizeToTray && mainWindow) { e.preventDefault(); mainWindow.hide(); createTray(); }
    } catch {}
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow.webContents.getURL()) {
      event.preventDefault();
      if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    }
  });

  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.nodeIntegrationInSubFrames = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;

    if (!/^https?:\/\//i.test(params.src)) {
      event.preventDefault();
    }
  });

  mainWindow.webContents.on('before-input-event', (event, input) => {
    const key = typeof input.key === 'string' ? input.key : '';
    const opensDevTools = key === 'F12'
      || (input.control && input.shift && key.toLowerCase() === 'i');

    if (opensDevTools) {
      mainWindow.webContents.toggleDevTools();
      event.preventDefault();
    }
  });
}

function validateHttpUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4096) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function cookieFile() {
  return path.join(app.getPath('userData'), 'browser-cookies.txt');
}

async function resolveCookieArgs(source) {
  const value = String(source || 'none');

  if (value === 'embedded') {
    try {
      const exported = await exportCookies(cookieFile());
      return ['--cookies', exported.path];
    } catch {
      return [];
    }
  }

  if (BROWSER_COOKIE_SOURCES.has(value)) {
    return ['--cookies-from-browser', value];
  }

  return [];
}

function isExistingPath(value) {
  if (typeof value !== 'string' || !value || value.includes('\0')) return false;
  try {
    return fs.existsSync(value);
  } catch {
    return false;
  }
}

function commandVersion(binary, args) {
  if (!binary) return null;
  try {
    const output = execFileSync(binary, args, {
      encoding: 'utf8',
      timeout: 7000,
      windowsHide: true
    });
    return output.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  } catch {
    return null;
  }
}

function envStatus() {
  const status = binaries.status();
  return {
    ...status,
    ytDlpVersion: commandVersion(status.ytDlp, ['--version']),
    ffmpegVersion: commandVersion(status.ffmpeg, ['-version'])
  };
}

function bridgeStatus() {
  const current = settings.load();
  return {
    enabled: current.extensionBridge,
    running: Boolean(bridgeHandle),
    port: bridgeHandle ? bridgeHandle.port : current.bridgePort,
    error: bridgeError
  };
}

async function stopBridge() {
  if (!bridgeHandle) return;

  const handle = bridgeHandle;
  bridgeHandle = null;

  try {
    await handle.close();
  } catch {
    /* ignore */
  }
}

async function startBridge() {
  const current = settings.load();

  if (!current.extensionBridge) {
    bridgeError = null;
    await stopBridge();
    return bridgeStatus();
  }

  if (bridgeHandle) return bridgeStatus();

  try {
    bridgeHandle = await bridge.start({
      port: current.bridgePort,
      version: app.getVersion(),
      onSend: async (payload) => {
        const latest = settings.load();

        if (!latest.extensionBridge) {
          return { accepted: false, reason: 'bridge_disabled' };
        }

        const delivered = sendToWindow('extension:received', {
          ...payload,
          autoDownload: latest.autoDownloadFromExtension
        });

        if (delivered) {
          focusWindow();
          return { accepted: true, port: bridgeHandle ? bridgeHandle.port : null };
        }

        return { accepted: false, reason: 'window_not_ready' };
      }
    });

    bridgeError = null;
  } catch (error) {
    bridgeHandle = null;
    bridgeError = error && error.message ? error.message : 'تعذّر تشغيل جسر الإضافة.';
  }

  return bridgeStatus();
}

async function restartBridge() {
  await stopBridge();
  return startBridge();
}

function handleProtocolUrl(rawUrl) {
  let parsed;

  try {
    parsed = new URL(String(rawUrl || '').trim());
  } catch {
    return;
  }

  if (parsed.protocol !== 'honk:') return;

  if (parsed.hostname === 'open') {
    focusWindow();
    return;
  }

  if (parsed.hostname === 'download') {
    const target = validateHttpUrl(parsed.searchParams.get('url') || '');
    if (!target) return;

    const payload = {
      url: target,
      title: parsed.searchParams.get('title') || null,
      pageUrl: validateHttpUrl(parsed.searchParams.get('page') || ''),
      referer: null,
      mode: parsed.searchParams.get('mode') === 'audio' ? 'audio' : 'video',
      source: 'protocol',
      receivedAt: Date.now(),
      autoDownload: settings.load().autoDownloadFromExtension
    };

    if (!sendToWindow('extension:received', payload)) {
      pendingProtocolUrl = rawUrl;
      focusWindow();
    } else {
      focusWindow();
    }
  }
}

function protocolFromArgv(argv) {
  return (Array.isArray(argv) ? argv : []).find((arg) => /^honk:\/\//i.test(String(arg || '')));
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settings.load());

  ipcMain.handle('settings:set', async (_event, patch) => {
    const previous = settings.load();
    const saved = settings.save(patch);

    applyTheme();

    if (previous.extensionBridge !== saved.extensionBridge || previous.bridgePort !== saved.bridgePort) {
      await restartBridge();
    }

    return saved;
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    name: app.getName(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    userData: app.getPath('userData'),
    binDir: binaries.getUserBinDir(),
    bridge: bridgeStatus()
  }));

  ipcMain.handle('dialog:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'اختر مجلد التحميل',
      properties: ['openDirectory', 'createDirectory']
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('sites:list', () => SITES);
  ipcMain.handle('sites:count', () => SITES.length);
  ipcMain.handle('sites:categories', () => {
    const { CATEGORIES } = require('./sites');
    return CATEGORIES || [...new Set(SITES.map(s=>s.category))];
  });
  ipcMain.handle('app:apply-autostart', () => { applyAutoStart(); return true; });
  ipcMain.handle('app:notify', (_e, title, body) => { notify(title, body); return true; });
  ipcMain.handle('dialog:open-file', async () => {
    const r = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Cookies / Files', extensions: ['txt','json','*'] }] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('env:check', () => envStatus());

  ipcMain.handle('clipboard:read', () => clipboard.readText());

  ipcMain.handle('clipboard:write', (_event, value) => {
    clipboard.writeText(String(value || ''));
    return true;
  });

  ipcMain.handle('cookies:count', async () => {
    const cookies = await browserSession().cookies.get({});
    return cookies.length;
  });

  ipcMain.handle('shell:open-path', async (_event, target) => {
    if (!isExistingPath(target)) return false;
    const error = await shell.openPath(target);
    return !error;
  });

  ipcMain.handle('shell:show-item', (_event, target) => {
    if (!isExistingPath(target)) return false;
    shell.showItemInFolder(target);
    return true;
  });

  ipcMain.handle('shell:open-external', async (_event, target) => {
    if (/^https?:\/\//i.test(String(target))) {
      await shell.openExternal(String(target));
    }
  });

  ipcMain.handle('yt:info', async (_event, rawUrl, cookieSource) => {
    const url = validateHttpUrl(rawUrl);
    if (!url) throw new Error('الرابط غير صالح. يجب أن يبدأ بـ http:// أو https://');

    const cookieArgs = await resolveCookieArgs(cookieSource);
    return downloader.getInfo(url, cookieArgs);
  });

  ipcMain.handle('yt:download', async (event, options = {}) => {
    const url = validateHttpUrl(options.url);
    if (!url) throw new Error('الرابط غير صالح.');

    const id = String(options.id || '');
    if (!/^[a-zA-Z0-9-]{6,64}$/.test(id)) throw new Error('معرّف التحميل غير صالح.');

    const currentSettings = settings.load();
    const cookieArgs = await resolveCookieArgs(options.cookieSource);
    const sender = event.sender;

    return downloader.startDownload(
      {
        id,
        url,
        mode: options.mode === 'audio' ? 'audio' : 'video',
        quality: options.quality,
        audioFormat: options.audioFormat,
        videoFormat: options.videoFormat || currentSettings.videoFormat,
        mergeOutputFormat: options.mergeOutputFormat || currentSettings.mergeOutputFormat,
        recodeVideo: options.recodeVideo || currentSettings.recodeVideo,
        playlist: Boolean(options.playlist),
        embedMetadata: options.embedMetadata !== undefined
          ? Boolean(options.embedMetadata)
          : currentSettings.embedMetadata,
        downloadSubtitles: options.downloadSubtitles !== undefined
          ? Boolean(options.downloadSubtitles)
          : currentSettings.downloadSubtitles,
        subtitleLangs: options.subtitleLangs || currentSettings.subtitleLangs,
        maxConcurrent: currentSettings.maxConcurrentDownloads,
        outputDir: currentSettings.downloadDir,
        // advanced merged from settings + per-job
        speedLimit: options.speedLimit ?? currentSettings.speedLimit,
        proxy: options.proxy ?? currentSettings.proxy,
        filenameTemplate: options.filenameTemplate ?? currentSettings.filenameTemplate,
        outputSubfolder: options.outputSubfolder ?? currentSettings.outputSubfolder,
        downloadChapters: options.downloadChapters ?? currentSettings.downloadChapters,
        downloadThumbnail: options.downloadThumbnail ?? currentSettings.downloadThumbnail,
        downloadInfoJson: options.downloadInfoJson ?? currentSettings.downloadInfoJson,
        writeDescription: options.writeDescription ?? currentSettings.writeDescription,
        sponsorblock: options.sponsorblock ?? currentSettings.sponsorblock,
        restrictFilenames: options.restrictFilenames ?? currentSettings.restrictFilenames,
        playlistStart: options.playlistStart ?? currentSettings.playlistStart,
        playlistEnd: options.playlistEnd ?? currentSettings.playlistEnd,
        audioBitrate: options.audioBitrate ?? currentSettings.audioBitrate,
        embedChapters: options.embedChapters ?? currentSettings.embedChapters,
        parseMetadata: options.parseMetadata ?? currentSettings.parseMetadata,
        skipDownload: options.skipDownload ?? currentSettings.skipDownload,
        extractorArgs: options.extractorArgs ?? currentSettings.extractorArgs,
        maxHeight: options.maxHeight ?? currentSettings.maxHeight,
        userAgent: options.userAgent ?? currentSettings.userAgent,
        bufferSize: options.bufferSize ?? currentSettings.bufferSize,
        thumbnailOnly: Boolean(options.thumbnailOnly)
      },
      cookieArgs,
      (payload) => {
        if (sender.isDestroyed()) return;

        const channels = {
          progress: 'yt:progress',
          done: 'yt:done',
          error: 'yt:error',
          cancelled: 'yt:cancelled'
        };

        const channel = channels[payload.type];
        if (channel) sender.send(channel, payload);
      }
    );
  });

  ipcMain.handle('yt:cancel', (_event, id) => downloader.cancelDownload(String(id)));
  ipcMain.handle('yt:pause', (_event, id) => downloader.pauseDownload(String(id)));
  ipcMain.handle('yt:resume', (_event, id) => downloader.resumeDownload(String(id)));

  ipcMain.handle('extensions:list', () => extensions.list());

  ipcMain.handle('extensions:add-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'اختر مجلد إضافة Chrome',
      properties: ['openDirectory']
    });

    if (result.canceled) return null;
    return extensions.installFromFolder(result.filePaths[0]);
  });

  ipcMain.handle('extensions:add-archive', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'اختر ملف إضافة (.crx أو .zip)',
      properties: ['openFile'],
      filters: [{ name: 'Chrome Extensions', extensions: ['crx', 'zip'] }]
    });

    if (result.canceled) return null;
    return extensions.installFromArchive(result.filePaths[0]);
  });

  ipcMain.handle('extensions:install-bundled', () => extensions.installBundled());
  ipcMain.handle('extensions:remove', (_event, target) => extensions.remove(target));
  ipcMain.handle('extensions:reload', (_event, target) => extensions.reload(target));
  ipcMain.handle('extensions:open-folder', () => extensions.openRoot());

  ipcMain.handle('bridge:status', () => bridgeStatus());
  ipcMain.handle('bridge:test', () => testBridge());

  ipcMain.handle('bridge:restart', async () => {
    const result = await restartBridge();
    return { ...result, ...(await testBridge()) };
  });

  ipcMain.handle('tools:install', async (event, rawTarget) => {
    const requested = String(rawTarget || 'all');
    let targets;

    if (requested === 'all') {
      targets = ['yt-dlp', 'ffmpeg'].filter((target) => !binaries.resolve(target));
    } else if (requested === 'yt-dlp' || requested === 'ffmpeg') {
      targets = [requested];
    } else {
      throw new Error('أداة غير معروفة.');
    }

    if (!targets.length) {
      return {
        skipped: true,
        message: 'كل المكتبات المطلوبة مثبّتة بالفعل.',
        results: []
      };
    }

    const sender = event.sender;
    const results = [];

    for (const target of targets) {
      if (installLocks.has(target)) {
        throw new Error('هناك عملية تثبيت جارية بالفعل لهذه الأداة.');
      }

      installLocks.add(target);

      try {
        const result = await installer.install(target, (progress) => {
          if (sender.isDestroyed()) return;
          sender.send('tools:install-progress', { ...progress, target });
        });

        results.push(result);
      } finally {
        installLocks.delete(target);
      }
    }

    return {
      skipped: false,
      message: 'تم تثبيت المكتبات المطلوبة.',
      results,
      env: envStatus()
    };
  });

  ipcMain.handle('tools:update-ytdlp', async (event) => {
    if (installLocks.has('yt-dlp')) {
      throw new Error('هناك عملية تحديث جارية بالفعل.');
    }

    installLocks.add('yt-dlp');
    const sender = event.sender;

    try {
      const result = await installer.install('yt-dlp', (progress) => {
        if (sender.isDestroyed()) return;
        sender.send('tools:install-progress', { ...progress, target: 'yt-dlp' });
      });

      return {
        message: `تم تحديث yt-dlp${result.version ? ` إلى ${result.version}` : ''}.`,
        version: result.version,
        env: envStatus()
      };
    } finally {
      installLocks.delete('yt-dlp');
    }
  });
}

function testBridge() {
  return new Promise((resolve) => {
    if (!bridgeHandle) {
      resolve({ ok: false, error: 'جسر الإضافة غير مشغّل.' });
      return;
    }

    const request = require('http').get({
      host: '127.0.0.1',
      port: bridgeHandle.port,
      path: '/ping',
      timeout: 4000
    }, (response) => {
      let body = '';
      response.on('data', (chunk) => { body += chunk.toString('utf8'); });
      response.on('end', () => {
        try {
          resolve({ ok: response.statusCode === 200, response: JSON.parse(body) });
        } catch {
          resolve({ ok: false, error: 'استجابة غير صالحة من الجسر.' });
        }
      });
    });

    request.on('timeout', () => {
      request.destroy();
      resolve({ ok: false, error: 'انتهت مهلة الاتصال بالجسر.' });
    });

    request.on('error', (error) => {
      resolve({ ok: false, error: error.message });
    });
  });
}

function buildWebviewContextMenu(contents, params) {
  const candidate = validateHttpUrl(params.srcURL) || validateHttpUrl(params.linkURL);

  if (!candidate) {
    if (params.isEditable) {
      Menu.buildFromTemplate([
        { role: 'cut', label: 'قص' },
        { role: 'copy', label: 'نسخ' },
        { role: 'paste', label: 'لصق' },
        { type: 'separator' },
        { role: 'selectAll', label: 'تحديد الكل' }
      ]).popup({ window: mainWindow });
    }
    return;
  }

  const menu = Menu.buildFromTemplate([
    {
      label: 'تحميل بواسطة Honk',
      click: () => {
        const delivered = sendToWindow('extension:received', {
          url: candidate,
          title: params.mediaType === 'video' ? 'فيديو من الصفحة' : (params.linkText || null),
          pageUrl: contents.getURL(),
          mode: 'video',
          source: 'context-menu',
          receivedAt: Date.now(),
          autoDownload: settings.load().autoDownloadFromExtension
        });

        if (delivered) focusWindow();
      }
    },
    {
      label: 'فتح في المتصفح',
      click: () => { shell.openExternal(candidate); }
    },
    {
      label: 'نسخ الرابط',
      click: () => { clipboard.writeText(candidate); }
    }
  ]);

  menu.popup({ window: mainWindow });
}

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;

  contents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) {
      sendToWindow('browser:open-url', url);
    }
    return { action: 'deny' };
  });

  contents.on('context-menu', (_menuEvent, params) => {
    if (params.linkURL || params.srcURL) {
      sendToWindow('browser:context-link', {
        url: validateHttpUrl(params.srcURL) || validateHttpUrl(params.linkURL),
        text: params.linkText || ''
      });
    }

    buildWebviewContextMenu(contents, params);
  });
});

app.on('second-instance', (_event, argv) => {
  const protocolUrl = protocolFromArgv(argv);
  if (protocolUrl) handleProtocolUrl(protocolUrl);
  focusWindow();
});

app.on('open-url', (event, url) => {
  event.preventDefault();
  handleProtocolUrl(url);
});

app.whenReady().then(async () => {
  if (!gotLock) return;

  app.setAppUserModelId('app.honk.downloader');

  const userBinDir = path.join(app.getPath('userData'), 'bin');
  fs.mkdirSync(userBinDir, { recursive: true });
  binaries.setUserBinDir(userBinDir);
  installer.setBinDir(userBinDir);

  try {
    app.setAsDefaultProtocolClient('honk');
  } catch {
    /* protocol registration is optional */
  }

  hardenBrowserSession();
  registerIpc();

  await extensions.ensureInitialized();
  await extensions.loadInstalled();

  createWindow();

  await startBridge();

  const protocolUrl = protocolFromArgv(process.argv);
  if (protocolUrl) {
    pendingProtocolUrl = protocolUrl;
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  stopBridge();
});
