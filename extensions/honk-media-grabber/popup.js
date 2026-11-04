'use strict';

(() => {
  const BRIDGE_PORTS = [47821, 47822, 47823, 47824, 47825];
  const TYPE_LABEL = { video: 'فيديو', audio: 'صوت', stream: 'بث' };

  const list = document.getElementById('list');
  const badge = document.getElementById('badge');
  const appStatus = document.getElementById('app-status');
  const status = document.getElementById('status');
  let activeTab = null;
  let items = [];
  let statusTimer = null;

  function setStatus(message, isError) {
    status.textContent = message;
    status.dataset.error = isError ? 'true' : 'false';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { status.textContent = ''; }, 3600);
  }

  function runtimeMessage(message, timeout = 5000) {
    return new Promise((resolve) => {
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

  function sendTabMessage(tabId, message) {
    return new Promise((resolve) => {
      try {
        chrome.tabs.sendMessage(tabId, message, (response) => {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch {
        resolve(null);
      }
    });
  }

  function queryActiveTab() {
    return new Promise((resolve) => {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        resolve((tabs && tabs[0]) || null);
      });
    });
  }

  function fetchTimeout(url, options, timeout) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
  }

  async function directSend(payload) {
    for (const port of BRIDGE_PORTS) {
      try {
        const probe = await fetchTimeout(`http://127.0.0.1:${port}/ping`, {
          method: 'GET',
          cache: 'no-store'
        }, 1000);

        if (!probe.ok) continue;

        const response = await fetchTimeout(`http://127.0.0.1:${port}/send`, {
          method: 'POST',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/json',
            'X-Honk-Client': 'extension'
          },
          body: JSON.stringify(payload)
        }, 5000);

        if (response.ok) return { ok: true, port };
      } catch {
        /* try next port */
      }
    }

    return { ok: false };
  }

  async function sendToApp(payload) {
    if (!payload || !payload.url) return;

    setStatus('جارٍ الإرسال…', false);

    let result = await runtimeMessage({ type: 'honk:send-to-app', payload }, 7000);

    if (!result || !result.ok) {
      result = await directSend(payload);
    }

    if (result && result.ok) {
      setStatus('تم الإرسال إلى التطبيق.', false);
      setAppOnline(true, result.port);
    } else {
      setStatus('التطبيق غير مشغّل. افتحه أولًا.', true);
      setAppOnline(false);
    }
  }

  function setAppOnline(online, port) {
    appStatus.dataset.online = online ? 'true' : 'false';
    appStatus.textContent = online ? 'التطبيق متصل' : 'التطبيق غير مشغّل';
    appStatus.title = port ? `المنفذ ${port}` : '';
  }

  function render() {
    list.textContent = '';
    badge.textContent = String(items.length);

    if (!items.length) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = 'لم يُعثر على روابط وسائط في هذه الصفحة بعد. شغّل الفيديو ثم اضغط تحديث.';
      list.appendChild(empty);
      return;
    }

    for (const item of items.slice(0, 60)) {
      const row = document.createElement('div');
      row.className = 'row';

      const type = document.createElement('span');
      type.className = 'type';
      type.dataset.type = item.type || 'video';
      type.textContent = TYPE_LABEL[item.type] || 'وسائط';

      const copy = document.createElement('div');
      copy.className = 'copy';

      const url = document.createElement('span');
      url.className = 'url';
      url.textContent = item.url;
      url.title = item.url;

      const meta = document.createElement('span');
      meta.className = 'meta';
      meta.textContent = item.source || 'page';

      copy.append(url, meta);

      const send = document.createElement('button');
      send.type = 'button';
      send.className = 'btn primary';
      send.textContent = 'إرسال';
      send.addEventListener('click', () => sendToApp({
        url: item.url,
        title: activeTab ? activeTab.title : document.title,
        pageUrl: activeTab ? activeTab.url : location.href,
        mode: item.type === 'audio' ? 'audio' : 'video'
      }));

      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.className = 'btn';
      copyButton.textContent = 'نسخ';
      copyButton.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(item.url);
          setStatus('تم نسخ الرابط.', false);
        } catch {
          setStatus('تعذّر النسخ.', true);
        }
      });

      row.append(type, copy, send, copyButton);
      list.appendChild(row);
    }
  }

  async function scan() {
    activeTab = await queryActiveTab();
    items = [];

    if (!activeTab) {
      render();
      setAppOnline(false);
      return;
    }

    const seen = new Map();

    const pageResult = await sendTabMessage(activeTab.id, { type: 'honk:scan' });
    if (pageResult && Array.isArray(pageResult.items)) {
      for (const item of pageResult.items) {
        if (item && item.url) seen.set(item.url, item);
      }
    }

    const networkResult = await runtimeMessage({ type: 'honk:scan-tab', tabId: activeTab.id });
    if (networkResult && Array.isArray(networkResult.items)) {
      for (const item of networkResult.items) {
        if (item && item.url && !seen.has(item.url)) seen.set(item.url, item);
      }
    }

    items = Array.from(seen.values()).reverse();
    render();
  }

  async function checkApp() {
    const result = await runtimeMessage({ type: 'honk:open-app' }, 4000);

    if (result && result.ok) {
      setAppOnline(true, result.port);
    } else {
      setAppOnline(false);
    }
  }

  document.getElementById('refresh').addEventListener('click', async () => {
    await scan();
    await checkApp();
  });

  document.getElementById('send-page').addEventListener('click', async () => {
    if (!activeTab) activeTab = await queryActiveTab();
    if (!activeTab) return;

    await sendToApp({
      url: activeTab.url,
      title: activeTab.title,
      pageUrl: activeTab.url
    });
  });

  document.getElementById('open-app').addEventListener('click', () => {
    setStatus('جارٍ فتح التطبيق…', false);
  });

  scan().then(checkApp);
})();
