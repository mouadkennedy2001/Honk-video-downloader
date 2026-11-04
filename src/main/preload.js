'use strict';

const { contextBridge, ipcRenderer } = require('electron');

function subscribe(channel, callback) {
  if (typeof callback !== 'function') return () => {};
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld('honk', {
  platform: process.platform,

  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (patch) => ipcRenderer.invoke('settings:set', patch),
  appInfo: () => ipcRenderer.invoke('app:info'),

  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  environment: () => ipcRenderer.invoke('env:check'),
  cookieCount: () => ipcRenderer.invoke('cookies:count'),

  installTool: (target) => ipcRenderer.invoke('tools:install', target),
  updateYtDlp: () => ipcRenderer.invoke('tools:update-ytdlp'),

  fetchInfo: (url, cookieSource) => ipcRenderer.invoke('yt:info', url, cookieSource || 'none'),
  startDownload: (options) => ipcRenderer.invoke('yt:download', options),
  cancelDownload: (id) => ipcRenderer.invoke('yt:cancel', id),

  listExtensions: () => ipcRenderer.invoke('extensions:list'),
  addExtensionFolder: () => ipcRenderer.invoke('extensions:add-folder'),
  addExtensionArchive: () => ipcRenderer.invoke('extensions:add-archive'),
  installBundledExtension: () => ipcRenderer.invoke('extensions:install-bundled'),
  removeExtension: (target) => ipcRenderer.invoke('extensions:remove', target),
  reloadExtension: (target) => ipcRenderer.invoke('extensions:reload', target),
  openExtensionsFolder: () => ipcRenderer.invoke('extensions:open-folder'),

  bridgeStatus: () => ipcRenderer.invoke('bridge:status'),
  restartBridge: () => ipcRenderer.invoke('bridge:restart'),
  testBridge: () => ipcRenderer.invoke('bridge:test'),

  openPath: (target) => ipcRenderer.invoke('shell:open-path', target),
  showItem: (target) => ipcRenderer.invoke('shell:show-item', target),
  openExternal: (url) => ipcRenderer.invoke('shell:open-external', url),
  readClipboard: () => ipcRenderer.invoke('clipboard:read'),
  writeClipboard: (value) => ipcRenderer.invoke('clipboard:write', value),

  onProgress: (callback) => subscribe('yt:progress', callback),
  onDone: (callback) => subscribe('yt:done', callback),
  onError: (callback) => subscribe('yt:error', callback),
  onCancelled: (callback) => subscribe('yt:cancelled', callback),

  onInstallProgress: (callback) => subscribe('tools:install-progress', callback),

  onBrowserOpenUrl: (callback) => subscribe('browser:open-url', callback),
  onBrowserLink: (callback) => subscribe('browser:context-link', callback),

  onExtensionReceived: (callback) => subscribe('extension:received', callback)
});
