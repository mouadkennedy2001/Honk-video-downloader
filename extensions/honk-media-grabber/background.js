'use strict';

(() => {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  const BRIDGE_PORTS = [47821, 47822, 47823, 47824, 47825];
  const MEDIA_PATTERN = /\.(mp4|m4v|webm|mkv|mov|avi|flv|wmv|ts|m3u8|mpd|mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i;
  const STREAM_CONTENT = /^(application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)|video\/|audio\/)/i;
  const MAX_PER_TAB = 80;
  const mediaByTab = new Map();
  const appPorts = new Map();

  function normalize(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value || value.startsWith('data:') || value.startsWith('blob:')) return null;

    try {
      const url = new URL(value);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      return url.toString();
    } catch {
      return null;
    }
  }

  function classify(url) {
    let pathname = '';

    try {
      pathname = new URL(url).pathname.toLowerCase();
    } catch {
      pathname = url.toLowerCase();
    }

    if (/\.(m3u8|mpd)$/.test(pathname)) return 'stream';
    if (/\.(mp3|m4a|aac|ogg|oga|opus|wav|flac)$/.test(pathname)) return 'audio';
    return 'video';
  }

  function tabMedia(tabId) {
    if (!mediaByTab.has(tabId)) mediaByTab.set(tabId, new Map());
    return mediaByTab.get(tabId);
  }

  function addMedia(tabId, rawUrl, source) {
    if (typeof tabId !== 'number' || tabId < 0) return;

    const url = normalize(rawUrl);
    if (!url) return;

    const bucket = tabMedia(tabId);

    if (!bucket.has(url) && bucket.size >= MAX_PER_TAB) {
      const oldest = bucket.keys().next().value;
      if (oldest) bucket.delete(oldest);
    }

    bucket.set(url, {
      url,
      type: classify(url),
      source: source || 'network',
      foundAt: Date.now()
    });

    updateBadge(tabId);
  }

  function updateBadge(tabId) {
    try {
      if (!chrome.action || !chrome.action.setBadgeText) return;
      const count = tabMedia(tabId).size;
      chrome.action.setBadgeText({
        tabId,
        text: count > 99 ? '99+' : count > 0 ? String(count) : ''
      });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#ffe400' });
    } catch {
      /* badge is optional */
    }
  }

  function listFor(tabId) {
    return Array.from(tabMedia(tabId).values())
      .sort((a, b) => b.foundAt - a.foundAt)
      .slice(0, MAX_PER_TAB)
      .map((item) => ({ url: item.url, type: item.type, source: item.source }));
  }

  function headerValue(headers, name) {
    const target = String(name).toLowerCase();

    for (const header of Array.isArray(headers) ? headers : []) {
      if (String(header.name || '').toLowerCase() === target) return header.value || '';
    }

    return '';
  }

  function captureRequest(details) {
    if (!details || !details.url) return;
    if (details.tabId === undefined || details.tabId < 0) return;

    if (MEDIA_PATTERN.test(details.url) || headerValue(details.responseHeaders, 'content-type')) {
      const contentType = headerValue(details.responseHeaders, 'content-type');

      if (MEDIA_PATTERN.test(details.url) || STREAM_CONTENT.test(contentType)) {
        addMedia(details.tabId, details.url, 'network');
      }
    }
  }

  try {
    chrome.webRequest.onBeforeRequest.addListener((details) => {
      if (!details || !MEDIA_PATTERN.test(details.url || '')) return;
      addMedia(details.tabId, details.url, 'network');
    }, {
      urls: ['http://*/*', 'https://*/*'],
      types: ['media', 'object', 'xmlhttprequest']
    });
  } catch {
    /* webRequest is optional in some Electron builds */
  }

  try {
    chrome.webRequest.onHeadersReceived.addListener((details) => {
      if (!details || !details.responseHeaders) return;
      captureRequest(details);
    }, {
      urls: ['http://*/*', 'https://*/*'],
      types: ['media', 'object', 'xmlhttprequest']
    }, ['responseHeaders']);
  } catch {
    /* webRequest is optional in some Electron builds */
  }

  try {
    chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
      if (changeInfo && changeInfo.url) {
        mediaByTab.delete(tabId);
        updateBadge(tabId);
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      mediaByTab.delete(tabId);
    });
  } catch {
    /* tabs permission may be unavailable */
  }

  function fetchWithTimeout(url, options, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  async function findAppPort() {
    const cached = appPorts.get('port');
    const checkedAt = appPorts.get('checkedAt') || 0;

    if (cached && Date.now() - checkedAt < 15000) return cached;

    for (const port of BRIDGE_PORTS) {
      try {
        const response = await fetchWithTimeout(`http://127.0.0.1:${port}/ping`, {
          method: 'GET',
          cache: 'no-store'
        }, 1200);

        if (response.ok) {
          appPorts.set('port', port);
          appPorts.set('checkedAt', Date.now());
          return port;
        }
      } catch {
        /* try the next port */
      }
    }

    appPorts.delete('port');
    appPorts.set('checkedAt', Date.now());
    return null;
  }

  async function sendToApp(payload) {
    const port = await findAppPort();

    if (!port) {
      return { ok: false, error: 'التطبيق غير مشغّل. افتح Honk Downloader أولًا.' };
    }

    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${port}/send`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-Honk-Client': 'extension'
        },
        body: JSON.stringify(payload || {})
      }, 5000);

      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        return { ok: false, error: data.error || 'تعذّر إرسال الرابط إلى التطبيق.' };
      }

      return { ok: true, port, response: data };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : 'تعذّر الاتصال بالتطبيق.' };
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message && message.type;

    if (type === 'honk:get-media') {
      const tabId = sender && sender.tab ? sender.tab.id : message.tabId;
      sendResponse({ ok: true, items: typeof tabId === 'number' ? listFor(tabId) : [] });
      return false;
    }

    if (type === 'honk:media-found') {
      const tabId = sender && sender.tab ? sender.tab.id : message.tabId;
      for (const item of Array.isArray(message.items) ? message.items : []) {
        addMedia(tabId, item && item.url, 'page');
      }
      sendResponse({ ok: true });
      return false;
    }

    if (type === 'honk:scan-tab') {
      const tabId = message.tabId;
      sendResponse({ ok: true, items: typeof tabId === 'number' ? listFor(tabId) : [] });
      return false;
    }

    if (type === 'honk:send-to-app') {
      sendToApp(message.payload)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === 'honk:open-app') {
      findAppPort().then((port) => sendResponse({ ok: Boolean(port), port }));
      return true;
    }

    return false;
  });

  try {
    chrome.commands.onCommand.addListener((command) => {
      if (command !== 'toggle-panel') return;

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tab = tabs && tabs[0];
        if (!tab || typeof tab.id !== 'number') return;

        chrome.tabs.sendMessage(tab.id, { type: 'honk:toggle-panel' }, () => {
          void chrome.runtime.lastError;
        });
      });
    });
  } catch {
    /* commands are optional */
  }
})();
