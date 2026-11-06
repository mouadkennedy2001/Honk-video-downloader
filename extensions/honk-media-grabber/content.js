(() => {
  'use strict';

  if (window.top !== window) return;
  if (document.getElementById('honk-media-grabber-root')) return;

  const BRIDGE_PORTS = [47821, 47822, 47823, 47824, 47825];
  const MEDIA_PATTERN = /\.(mp4|m4v|webm|mkv|mov|avi|flv|wmv|ts|m3u8|mpd|mp3|m4a|aac|ogg|oga|opus|wav|flac)(?:[?#]|$)/i;
  const META_KEYS = new Set([
    'og:video',
    'og:video:url',
    'og:video:secure_url',
    'og:audio',
    'og:audio:url',
    'og:audio:secure_url',
    'twitter:player:stream'
  ]);
  const TYPE_LABEL = { video: 'فيديو', audio: 'صوت', stream: 'بث' };

  const state = {
    items: new Map(),
    filter: 'all',
    host: null,
    panel: null,
    list: null,
    status: null,
    appStatus: null,
    badge: null,
    filterBar: null,
    signature: '',
    appOnline: false,
    appPort: null,
    checkedAt: 0,
    statusTimer: null,
    rendering: false
  };

  function normalize(raw) {
    if (!raw || typeof raw !== 'string') return null;
    const value = raw.trim();
    if (!value || value.startsWith('data:') || value.startsWith('blob:')) return null;

    try {
      const url = new URL(value, location.href);
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

  function addItem(rawUrl, source, hintType) {
    const url = normalize(rawUrl);
    if (!url) return;

    const existing = state.items.get(url);
    const type = hintType || classify(url);

    if (existing) {
      existing.sources.add(source || 'page');
      return;
    }

    state.items.set(url, {
      url,
      type,
      sources: new Set([source || 'page']),
      foundAt: Date.now()
    });
  }

  function collectFromDom() {
    document.querySelectorAll('video, audio').forEach((media) => {
      const tag = media.tagName.toLowerCase();
      const type = tag === 'audio' ? 'audio' : 'video';

      addItem(media.currentSrc, 'page', type);
      addItem(media.getAttribute('src'), 'page', type);
      addItem(media.getAttribute('data-src'), 'page', type);
      addItem(media.getAttribute('data-video-src'), 'page', type);

      media.querySelectorAll('source').forEach((source) => {
        addItem(source.getAttribute('src'), 'page', type);
        addItem(source.getAttribute('data-src'), 'page', type);
      });
    });

    document.querySelectorAll('source[src]').forEach((source) => addItem(source.getAttribute('src'), 'page'));

    document.querySelectorAll('a[href]').forEach((anchor) => {
      const href = anchor.getAttribute('href');
      if (href && MEDIA_PATTERN.test(href)) addItem(href, 'page');
    });

    document.querySelectorAll('meta[property], meta[name]').forEach((meta) => {
      const key = (meta.getAttribute('property') || meta.getAttribute('name') || '').toLowerCase();
      if (META_KEYS.has(key)) addItem(meta.getAttribute('content'), 'meta');
    });

    document.querySelectorAll('link[rel="preload"], link[rel="prefetch"]').forEach((link) => {
      const as = (link.getAttribute('as') || '').toLowerCase();
      if (as === 'video' || as === 'audio' || MEDIA_PATTERN.test(link.getAttribute('href') || '')) {
        addItem(link.getAttribute('href'), 'preload', as === 'audio' ? 'audio' : 'video');
      }
    });

    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        const data = JSON.parse(script.textContent || '');
        const visit = (value, depth) => {
          if (!value || depth > 5) return;

          if (Array.isArray(value)) {
            value.forEach((item) => visit(item, depth + 1));
            return;
          }

          if (typeof value === 'object') {
            if (typeof value.contentUrl === 'string') addItem(value.contentUrl, 'ld+json');
            if (typeof value.embedUrl === 'string') addItem(value.embedUrl, 'ld+json');

            for (const key of Object.keys(value)) {
              if (key === 'contentUrl' || key === 'embedUrl') continue;
              visit(value[key], depth + 1);
            }
          }
        };

        visit(data, 0);
      } catch {
        /* invalid JSON-LD */
      }
    });

    try {
      performance.getEntriesByType('resource').forEach((entry) => {
        if (entry && MEDIA_PATTERN.test(entry.name)) addItem(entry.name, 'network');
      });
    } catch {
      /* performance API unavailable */
    }
  }

  function runtimeMessage(message, timeout = 1800) {
    return new Promise((resolve) => {
      if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.sendMessage) {
        resolve(null);
        return;
      }

      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        resolve(null);
      }, timeout);

      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch {
        clearTimeout(timer);
        resolve(null);
      }
    });
  }

  async function collectFromBackground() {
    const response = await runtimeMessage({ type: 'honk:get-media' });

    if (response && Array.isArray(response.items)) {
      for (const item of response.items) addItem(item.url, item.source || 'network', item.type);
    }

    const domItems = Array.from(state.items.values())
      .filter((item) => item.sources.has('page') || item.sources.has('meta') || item.sources.has('ld+json'))
      .slice(0, 40)
      .map((item) => ({ url: item.url, type: item.type }));

    if (domItems.length) {
      runtimeMessage({ type: 'honk:media-found', items: domItems }, 1000);
    }
  }

  function fetchTimeout(url, options, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);

    return fetch(url, { ...options, signal: controller.signal })
      .finally(() => clearTimeout(timer));
  }

  async function findAppPort(force) {
    if (!force && state.appPort && Date.now() - state.checkedAt < 15000) return state.appPort;

    for (const port of BRIDGE_PORTS) {
      try {
        const response = await fetchTimeout(`http://127.0.0.1:${port}/ping`, {
          method: 'GET',
          cache: 'no-store'
        }, 1200);

        if (response.ok) {
          state.appPort = port;
          state.appOnline = true;
          state.checkedAt = Date.now();
          return port;
        }
      } catch {
        /* try next port */
      }
    }

    state.appPort = null;
    state.appOnline = false;
    state.checkedAt = Date.now();
    return null;
  }

  async function sendDirect(payload) {
    const port = await findAppPort();

    if (!port) return { ok: false, error: 'app_offline' };

    try {
      const response = await fetchTimeout(`http://127.0.0.1:${port}/send`, {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          'X-Honk-Client': 'extension'
        },
        body: JSON.stringify(payload)
      }, 6000);

      const data = await response.json().catch(() => ({}));
      return response.ok
        ? { ok: true, port, response: data }
        : { ok: false, error: data.error || 'send_failed' };
    } catch (error) {
      return { ok: false, error: error && error.message ? error.message : 'network_error' };
    }
  }

  async function sendToApp(item) {
    if (!item) return;

    setStatus('جارٍ الإرسال إلى التطبيق…', false);

    const payload = {
      url: item.url,
      title: document.title,
      pageUrl: location.href,
      referer: location.href,
      mode: item.type === 'audio' ? 'audio' : 'video'
    };

    let result = await runtimeMessage({ type: 'honk:send-to-app', payload }, 7000);

    if (!result || !result.ok) {
      result = await sendDirect(payload);
    }

    if (result && result.ok) {
      state.appOnline = true;
      state.checkedAt = Date.now();
      setStatus('تم إرسال الرابط إلى التطبيق.', false);
      updateAppStatus();
      return;
    }

    await copyText(item.url);
    setStatus('التطبيق غير مشغّل — نُسخ الرابط إلى الحافظة.', true);
    await findAppPort(true);
    updateAppStatus();
  }

  function copyText(textValue) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(textValue).catch(() => fallbackCopy(textValue));
    }

    return Promise.resolve(fallbackCopy(textValue));
  }

  function fallbackCopy(textValue) {
    const textarea = document.createElement('textarea');
    textarea.value = textValue;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.documentElement.appendChild(textarea);
    textarea.select();

    try {
      document.execCommand('copy');
    } catch {
      /* ignore */
    } finally {
      textarea.remove();
    }
  }

  function setStatus(message, isError) {
    if (!state.status) return;
    state.status.textContent = message;
    state.status.dataset.error = isError ? 'true' : 'false';
    clearTimeout(state.statusTimer);
    state.statusTimer = setTimeout(() => {
      if (state.status) state.status.textContent = '';
    }, 3600);
  }

  function updateAppStatus() {
    if (!state.appStatus) return;

    state.appStatus.dataset.online = state.appOnline ? 'true' : 'false';
    state.appStatus.textContent = state.appOnline ? 'التطبيق متصل' : 'التطبيق غير مشغّل';
    state.appStatus.title = state.appPort ? `المنفذ ${state.appPort}` : 'افتح Honk Downloader';
    updateDot();
  }

  function updateBadge() {
    if (!state.badge) return;
    const count = state.items.size;
    state.badge.textContent = count > 99 ? '99+' : String(count);
    state.badge.style.display = count > 0 ? 'flex' : 'none';
  }

  function visibleItems() {
    const all = Array.from(state.items.values()).reverse();

    if (state.filter === 'all') return all;
    return all.filter((item) => item.type === state.filter);
  }

  function renderFilter() {
    if (!state.filterBar) return;

    state.filterBar.querySelectorAll('button[data-filter]').forEach((button) => {
      button.dataset.active = button.dataset.filter === state.filter ? 'true' : 'false';
    });
  }

  function renderList(force) {
    if (!state.list) return;

    const items = visibleItems();
    const signature = `${state.filter}:${items.map((item) => item.url).join('|')}`;

    if (!force && signature === state.signature) {
      updateBadge();
      renderFilter();
      return;
    }

    state.signature = signature;
    state.rendering = true;
    state.list.textContent = '';

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'hk-empty';
      empty.textContent = state.items.size
        ? 'لا توجد عناصر بهذا التصنيف.'
        : 'لم يُعثر على روابط وسائط بعد. شغّل الفيديو ثم اضغط تحديث.';
      state.list.appendChild(empty);
      state.rendering = false;
      updateBadge();
      renderFilter();
      return;
    }

    for (const item of items.slice(0, 100)) {
      const row = document.createElement('div');
      row.className = 'hk-row';

      const type = document.createElement('span');
      type.className = 'hk-type';
      type.dataset.type = item.type;
      type.textContent = TYPE_LABEL[item.type] || 'وسائط';

      const copy = document.createElement('div');
      copy.className = 'hk-copy';

      const link = document.createElement('span');
      link.className = 'hk-url';
      link.textContent = item.url;
      link.title = item.url;

      const meta = document.createElement('span');
      meta.className = 'hk-meta';
      meta.textContent = Array.from(item.sources).slice(0, 3).join(' • ');

      copy.append(link, meta);

      const send = document.createElement('button');
      send.type = 'button';
      send.className = 'hk-btn hk-primary';
      send.textContent = 'إرسال';
      send.title = 'إرسال إلى Honk Downloader';
      send.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        sendToApp(item);
      });

      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'hk-btn';
      copyButton.textContent = 'نسخ';
      copyButton.addEventListener('click', async (event) => {
        event.preventDefault();
        event.stopPropagation();
        await copyText(item.url);
        setStatus('تم نسخ الرابط.', false);
      });

      row.append(type, copy, send, copyButton);
      state.list.appendChild(row);
    }

    state.rendering = false;
    updateBadge();
    renderFilter();
  }

  async function refresh(force) {
    if (state.rendering) return;

    collectFromDom();
    await collectFromBackground();
    renderList(force);
    updateAppStatus();
  }

  function buildStyles() {
    const style = document.createElement('style');
    style.textContent = `
      :host {
        --hk-blue: #008fff;
        --hk-blue-strong: #006fd1;
        --hk-yellow: #ffe400;
        --hk-ink: #111111;
        --hk-muted: #5c6672;
        --hk-surface: #ffffff;
        --hk-soft: #f3f6f9;
        --hk-border: rgba(17, 17, 17, 0.12);
        --hk-shadow: 0 22px 60px rgba(7, 20, 35, 0.32);
        all: initial;
      }

      * { box-sizing: border-box; }

      .hk-launcher {
        position: fixed;
        right: 18px;
        bottom: 18px;
        width: 52px;
        height: 52px;
        border-radius: 18px;
        border: 3px solid var(--hk-ink);
        background: linear-gradient(145deg, var(--hk-blue), var(--hk-blue-strong));
        color: #ffffff;
        font: 900 20px/1 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        cursor: pointer;
        box-shadow: 0 16px 34px rgba(0, 50, 100, 0.38);
        z-index: 2147483647;
        display: grid;
        place-items: center;
        transition: transform 0.16s ease, box-shadow 0.16s ease;
      }

      .hk-launcher:hover { transform: translateY(-2px) scale(1.04); }
      .hk-launcher:active { transform: scale(0.97); }

      .hk-badge {
        position: absolute;
        top: -6px;
        left: -6px;
        min-width: 20px;
        height: 20px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--hk-yellow);
        color: var(--hk-ink);
        border: 2px solid var(--hk-ink);
        font: 900 10px/16px system-ui, sans-serif;
        display: none;
        align-items: center;
        justify-content: center;
      }

      .hk-dot {
        position: absolute;
        right: 2px;
        bottom: 2px;
        width: 11px;
        height: 11px;
        border-radius: 999px;
        border: 2px solid var(--hk-ink);
        background: #ff5d5d;
      }

      .hk-dot[data-online="true"] { background: #3fcc6b; }

      .hk-panel {
        position: fixed;
        right: 18px;
        bottom: 82px;
        width: min(430px, calc(100vw - 36px));
        max-height: min(560px, 72vh);
        display: none;
        flex-direction: column;
        background: var(--hk-surface);
        color: var(--hk-ink);
        border: 2px solid var(--hk-ink);
        border-radius: 20px;
        box-shadow: var(--hk-shadow);
        font: 400 13px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
        direction: rtl;
        overflow: hidden;
        z-index: 2147483647;
      }

      .hk-panel[data-open="true"] { display: flex; }

      .hk-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        padding: 12px 14px;
        background: linear-gradient(120deg, var(--hk-blue), var(--hk-blue-strong));
        color: #ffffff;
      }

      .hk-title {
        display: flex;
        flex-direction: column;
        gap: 2px;
        min-width: 0;
      }

      .hk-title strong {
        font-size: 14px;
        font-weight: 900;
        letter-spacing: 0.01em;
      }

      .hk-app-status {
        font-size: 10px;
        font-weight: 700;
        opacity: 0.92;
      }

      .hk-app-status[data-online="true"] { color: #d9ffe6; }
      .hk-app-status[data-online="false"] { color: #fff2a8; }

      .hk-close {
        appearance: none;
        border: 0;
        background: rgba(255, 255, 255, 0.16);
        color: #ffffff;
        width: 30px;
        height: 30px;
        border-radius: 10px;
        font: 400 20px/1 system-ui, sans-serif;
        cursor: pointer;
      }

      .hk-toolbar {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 9px 10px;
        border-bottom: 1px solid var(--hk-border);
        background: var(--hk-surface);
        flex-wrap: wrap;
      }

      .hk-filters {
        display: flex;
        gap: 4px;
        padding: 3px;
        border-radius: 10px;
        background: var(--hk-soft);
      }

      .hk-filter {
        appearance: none;
        border: 0;
        background: transparent;
        color: var(--hk-muted);
        font: 700 11px/1 system-ui, sans-serif;
        padding: 6px 9px;
        border-radius: 7px;
        cursor: pointer;
      }

      .hk-filter[data-active="true"] {
        background: var(--hk-ink);
        color: #ffffff;
      }

      .hk-spacer { flex: 1 1 auto; }

      .hk-btn {
        appearance: none;
        border: 1px solid var(--hk-border);
        background: var(--hk-surface);
        color: var(--hk-ink);
        font: 800 11px/1 system-ui, sans-serif;
        padding: 7px 10px;
        border-radius: 9px;
        cursor: pointer;
        white-space: nowrap;
        transition: background 0.15s ease, transform 0.12s ease;
      }

      .hk-btn:hover { background: var(--hk-soft); }
      .hk-btn:active { transform: scale(0.97); }

      .hk-primary {
        background: var(--hk-blue);
        border-color: var(--hk-blue);
        color: #ffffff;
      }

      .hk-primary:hover { background: var(--hk-blue-strong); }

      .hk-list {
        display: flex;
        flex-direction: column;
        gap: 7px;
        padding: 10px;
        overflow-y: auto;
        min-height: 80px;
      }

      .hk-empty {
        margin: 10px 6px;
        font-size: 12px;
        color: var(--hk-muted);
        text-align: center;
      }

      .hk-row {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px;
        border: 1px solid var(--hk-border);
        border-radius: 12px;
        background: var(--hk-soft);
      }

      .hk-type {
        flex: 0 0 auto;
        font: 900 10px/1 system-ui, sans-serif;
        padding: 5px 7px;
        border-radius: 7px;
        background: rgba(0, 143, 255, 0.14);
        color: var(--hk-blue-strong);
      }

      .hk-type[data-type="audio"] { background: rgba(63, 204, 107, 0.18); color: #187a3d; }
      .hk-type[data-type="stream"] { background: rgba(255, 228, 0, 0.45); color: #6b5b00; }

      .hk-copy {
        flex: 1 1 auto;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 1px;
        direction: ltr;
        text-align: left;
      }

      .hk-url {
        font: 700 11px/1.35 ui-monospace, "SFMono-Regular", Consolas, monospace;
        color: var(--hk-ink);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hk-meta {
        font: 500 9px/1.3 system-ui, sans-serif;
        color: var(--hk-muted);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .hk-foot {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 8px 12px;
        border-top: 1px solid var(--hk-border);
        font: 700 10px/1.3 system-ui, sans-serif;
        color: var(--hk-muted);
      }

      .hk-status[data-error="true"] { color: #b42318; }
      .hk-status[data-error="false"] { color: #187a3d; }

      @media (prefers-color-scheme: dark) {
        :host {
          --hk-ink: #eaf1f8;
          --hk-muted: #9fb0c2;
          --hk-surface: #111d2c;
          --hk-soft: #17283b;
          --hk-border: rgba(234, 241, 248, 0.14);
        }

        .hk-panel { border-color: #07101c; }
        .hk-launcher { border-color: #07101c; }
        .hk-filter[data-active="true"] { background: var(--hk-yellow); color: #111111; }
        .hk-primary { color: #ffffff; }
      }

      @media (max-width: 520px) {
        .hk-panel {
          right: 8px;
          left: 8px;
          width: auto;
          bottom: 76px;
          max-height: 68vh;
        }

        .hk-launcher { right: 12px; bottom: 12px; }
      }
    `;
    return style;
  }

  function buildLauncher() {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'hk-launcher';
    button.title = 'Honk Media Grabber — روابط الفيديو والصوت';
    button.setAttribute('aria-label', 'Honk Media Grabber');
    button.textContent = 'H';

    const badge = document.createElement('span');
    badge.className = 'hk-badge';
    badge.textContent = '0';
    badge.style.display = 'none';

    const dot = document.createElement('span');
    dot.className = 'hk-dot';
    dot.dataset.online = 'false';

    button.append(badge, dot);
    state.badge = badge;
    state.dot = dot;

    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      togglePanel();
    });

    return button;
  }

  function buildPanel() {
    const panel = document.createElement('div');
    panel.className = 'hk-panel';
    panel.dataset.open = 'false';
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', 'روابط الوسائط');

    const head = document.createElement('div');
    head.className = 'hk-head';

    const title = document.createElement('div');
    title.className = 'hk-title';
    const strong = document.createElement('strong');
    strong.textContent = 'روابط الوسائط';
    const appStatus = document.createElement('span');
    appStatus.className = 'hk-app-status';
    appStatus.dataset.online = 'false';
    appStatus.textContent = 'جارٍ فحص التطبيق…';
    title.append(strong, appStatus);

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'hk-close';
    close.textContent = '×';
    close.setAttribute('aria-label', 'إغلاق');
    close.addEventListener('click', () => togglePanel(false));

    head.append(title, close);

    const toolbar = document.createElement('div');
    toolbar.className = 'hk-toolbar';

    const filters = document.createElement('div');
    filters.className = 'hk-filters';

    [
      ['all', 'الكل'],
      ['video', 'فيديو'],
      ['audio', 'صوت'],
      ['stream', 'بث']
    ].forEach(([value, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'hk-filter';
      button.dataset.filter = value;
      button.dataset.active = value === 'all' ? 'true' : 'false';
      button.textContent = label;
      button.addEventListener('click', () => {
        state.filter = value;
        renderList(true);
      });
      filters.appendChild(button);
    });

    const spacer = document.createElement('span');
    spacer.className = 'hk-spacer';

    const refreshButton = document.createElement('button');
    refreshButton.type = 'button';
    refreshButton.className = 'hk-btn';
    refreshButton.textContent = 'تحديث';
    refreshButton.addEventListener('click', () => refresh(true));

    const sendPage = document.createElement('button');
    sendPage.type = 'button';
    sendPage.className = 'hk-primary hk-btn';
    sendPage.textContent = 'إرسال الصفحة';
    sendPage.title = 'إرسال رابط الصفحة الحالية إلى التطبيق';
    sendPage.addEventListener('click', () => {
      sendToApp({ url: location.href, type: 'video' });
    });

    const copyAll = document.createElement('button');
    copyAll.type = 'button';
    copyAll.className = 'hk-btn';
    copyAll.textContent = 'نسخ الكل';
    copyAll.addEventListener('click', async () => {
      const items = visibleItems();

      if (!items.length) {
        setStatus('لا توجد روابط للنسخ.', true);
        return;
      }

      await copyText(items.map((item) => item.url).join('\n'));
      setStatus(`تم نسخ ${items.length} رابطًا.`, false);
    });

    toolbar.append(filters, spacer, refreshButton, sendPage, copyAll);

    const list = document.createElement('div');
    list.className = 'hk-list';

    const foot = document.createElement('div');
    foot.className = 'hk-foot';

    const status = document.createElement('span');
    status.className = 'hk-status';
    status.dataset.error = 'false';

    const hint = document.createElement('span');
    hint.textContent = 'Alt+Shift+H';

    foot.append(status, hint);

    panel.append(head, toolbar, list, foot);

    state.panel = panel;
    state.list = list;
    state.status = status;
    state.appStatus = appStatus;
    state.filterBar = filters;
    state.dot = state.dot || null;

    return panel;
  }

  function updateDot() {
    if (!state.dot) return;
    state.dot.dataset.online = state.appOnline ? 'true' : 'false';
  }

  async function togglePanel(force) {
    if (!state.panel) return;

    const shouldOpen = force === undefined ? state.panel.dataset.open !== 'true' : Boolean(force);
    state.panel.dataset.open = shouldOpen ? 'true' : 'false';

    if (shouldOpen) {
      await findAppPort(true);
      updateAppStatus();
      updateDot();
      await refresh(true);
    }
  }

  function isOwnMutation(mutations) {
    if (!state.host) return false;

    return mutations.every((mutation) => {
      if (mutation.target === state.host || state.host.contains(mutation.target)) return true;

      return Array.from(mutation.addedNodes).every((node) => (
        node === state.host || state.host.contains(node)
      )) && Array.from(mutation.removedNodes).every((node) => (
        node === state.host || state.host.contains(node)
      ));
    });
  }

  function mount() {
    const host = document.createElement('div');
    host.id = 'honk-media-grabber-root';
    host.style.all = 'initial';

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.append(buildStyles(), buildLauncher(), buildPanel());

    document.documentElement.appendChild(host);
    state.host = host;

    setTimeout(() => refresh(true), 900);
    setInterval(() => {
      if (state.panel && state.panel.dataset.open === 'true') refresh(false);
    }, 12000);

    let timer = null;
    const observer = new MutationObserver((mutations) => {
      if (isOwnMutation(mutations)) return;

      clearTimeout(timer);
      timer = setTimeout(() => refresh(false), 1200);
    });

    try {
      observer.observe(document.documentElement, { childList: true, subtree: true });
    } catch {
      /* ignore */
    }

    document.addEventListener('keydown', (event) => {
      if (event.altKey && event.shiftKey && (event.code === 'KeyH' || event.key.toLowerCase() === 'h')) {
        event.preventDefault();
        togglePanel();
      }
    }, true);

    if (typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
        if (!message) return false;

        if (message.type === 'honk:toggle-panel') {
          togglePanel();
          return false;
        }

        if (message.type === 'honk:scan') {
          collectFromDom();
          sendResponse({
            ok: true,
            items: Array.from(state.items.values()).map((item) => ({
              url: item.url,
              type: item.type,
              source: Array.from(item.sources).join('+')
            }))
          });
          return false;
        }

        return false;
      });
    }

    findAppPort(true).then(() => {
      updateAppStatus();
      updateDot();
    });
  }

  if (document.documentElement) {
    mount();
  } else {
    document.addEventListener('DOMContentLoaded', mount, { once: true });
  }
})();
