'use strict';

(() => {
  if (typeof chrome === 'undefined' || !chrome.runtime) return;

  const BRIDGE_PORTS = [47821, 47822, 47823, 47824, 47825, 47826, 47827, 47828, 47829, 47830];
  const MEDIA_PATTERN = /\.(mp4|m4v|webm|mkv|mov|avi|flv|wmv|ts|m3u8|mpd|mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i;
  const STREAM_CONTENT = /^(application\/(vnd\.apple\.mpegurl|x-mpegurl|dash\+xml)|video\/|audio\/)/i;
  const MAX_PER_TAB = 80;
  const QUEUE_KEY = 'wasel:pending-links';
  const MAX_QUEUE = 100;
  const mediaByTab = new Map();
  const appPorts = new Map();
  let flushing = false;

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
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#3584e4' });
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

  async function readQueue() {
    try {
      const data = await chrome.storage.local.get(QUEUE_KEY);
      return Array.isArray(data[QUEUE_KEY]) ? data[QUEUE_KEY] : [];
    } catch {
      return [];
    }
  }

  async function writeQueue(items) {
    const safe = (Array.isArray(items) ? items : [])
      .filter((item) => item && item.url)
      .slice(-MAX_QUEUE);

    try {
      await chrome.storage.local.set({ [QUEUE_KEY]: safe });
    } catch {
      /* storage may be unavailable; the in-memory result is still returned */
    }
    return safe;
  }

  async function queuePayload(payload) {
    const url = normalize(payload && payload.url);
    if (!url) return { ok: false, error: 'رابط غير صالح.' };

    const item = { ...(payload || {}), url, queuedAt: Date.now() };
    const queue = await readQueue();

    if (queue.some((queued) => queued && queued.url === url)) {
      return { ok: true, queued: false, duplicate: true, count: queue.length };
    }

    const saved = await writeQueue([...queue, item]);
    return { ok: true, queued: true, count: saved.length };
  }

  async function postToApp(port, payload) {
    try {
      const response = await fetchWithTimeout(`http://127.0.0.1:${port}/send`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-Wasel-Client': 'extension'
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

  async function sendToApp(payload, queueOnFailure = true) {
    const url = normalize(payload && payload.url);
    if (!url) return { ok: false, error: 'رابط غير صالح.' };

    const clean = { ...(payload || {}), url };
    const port = await findAppPort();

    if (!port) {
      if (!queueOnFailure) {
        return { ok: false, error: 'التطبيق غير مشغّل. افتح Wasel Downloader أولًا.' };
      }

      const queued = await queuePayload(clean);
      return {
        ok: false,
        queued: Boolean(queued.queued),
        count: queued.count,
        error: queued.queued
          ? 'التطبيق غير مشغّل — حُفظ الرابط للإرسال تلقائيًا عند فتحه.'
          : 'التطبيق غير مشغّل.'
      };
    }

    const result = await postToApp(port, clean);

    if (!result.ok && queueOnFailure) {
      const queued = await queuePayload(clean);
      result.queued = Boolean(queued.queued);
      result.count = queued.count;
      if (result.queued) {
        result.error = 'تعذّر الإرسال الآن — حُفظ الرابط للإرسال تلقائيًا لاحقًا.';
      }
    }

    return result;
  }

  async function flushQueue() {
    if (flushing) {
      const queue = await readQueue();
      return { sent: 0, remaining: queue.length, busy: true };
    }

    const queue = await readQueue();
    if (!queue.length) return { sent: 0, remaining: 0 };

    flushing = true;
    try {
      const port = await findAppPort();
      if (!port) return { sent: 0, remaining: queue.length };

      const remaining = [];
      let sent = 0;

      for (const item of queue) {
        const result = await postToApp(port, item);
        if (result.ok) sent += 1;
        else remaining.push(item);
      }

      await writeQueue(remaining);
      return { sent, remaining: remaining.length };
    } finally {
      flushing = false;
    }
  }

  setTimeout(() => { flushQueue().catch(() => {}); }, 1500);
  setInterval(() => { flushQueue().catch(() => {}); }, 15000);

  try {
    chrome.alarms.create('wasel-flush-queue', { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm && alarm.name === 'wasel-flush-queue') flushQueue().catch(() => {});
    });
  } catch {
    /* alarms are optional */
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    const type = message && message.type;

    if (type === 'wasel:get-media') {
      const tabId = sender && sender.tab ? sender.tab.id : message.tabId;
      sendResponse({ ok: true, items: typeof tabId === 'number' ? listFor(tabId) : [] });
      return false;
    }

    if (type === 'wasel:media-found') {
      const tabId = sender && sender.tab ? sender.tab.id : message.tabId;
      for (const item of Array.isArray(message.items) ? message.items : []) {
        addMedia(tabId, item && item.url, 'page');
      }
      sendResponse({ ok: true });
      return false;
    }

    if (type === 'wasel:scan-tab') {
      const tabId = message.tabId;
      sendResponse({ ok: true, items: typeof tabId === 'number' ? listFor(tabId) : [] });
      return false;
    }

    if (type === 'wasel:send-to-app') {
      sendToApp(message.payload)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === 'wasel:queue-add') {
      queuePayload(message.payload)
        .then(sendResponse)
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === 'wasel:queue-list') {
      readQueue()
        .then((items) => sendResponse({ ok: true, items }))
        .catch(() => sendResponse({ ok: true, items: [] }));
      return true;
    }

    if (type === 'wasel:queue-flush') {
      flushQueue()
        .then((result) => sendResponse({ ok: true, ...result }))
        .catch((error) => sendResponse({ ok: false, error: error.message }));
      return true;
    }

    if (type === 'wasel:queue-clear') {
      writeQueue([])
        .then(() => sendResponse({ ok: true }))
        .catch(() => sendResponse({ ok: false }));
      return true;
    }

    if (type === 'wasel:open-app') {
      findAppPort().then((port) => {
        if (port) flushQueue().catch(() => {});
        sendResponse({ ok: Boolean(port), port });
      });
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

        chrome.tabs.sendMessage(tab.id, { type: 'wasel:toggle-panel' }, () => {
          void chrome.runtime.lastError;
        });
      });
    });
  } catch {
    /* commands are optional */
  }
})();
