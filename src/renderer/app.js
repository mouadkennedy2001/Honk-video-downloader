'use strict';

const api = window.wasel;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

function createIcon(name, className = 'icon') {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('class', className);
  svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
  use.setAttribute('href', `#ic-${name}`);
  svg.appendChild(use);
  return svg;
}

const state = {
  settings: null,
  env: null,
  info: null,
  appInfo: null,
  bridge: null,
  mode: 'video',
  jobs: new Map(),
  busyInfo: false,
  incomingBusy: false,
  installing: new Set(),
  pendingLink: null,
  toastTimer: null,
  extensions: [],
  sites: [],
  language: 'ar',
  history: [],
  favorites: [],
  siteProfile: null,
  incomingQueue: [],
  libraryTimer: null,
  // Preview player
  previewPlayerUrl: null,
};

const PHASE_KEYS = {
  queued: 'queued',
  playlist: 'playlist',
  downloading: 'downloading',
  merging: 'merging',
  converting: 'converting',
  tagging: 'tagging',
  retrying: 'retrying',
  searching: 'searching',
  playlist: 'playlist',
  paused: 'paused',
  done: 'done'
};

function phaseLabel(phase) {
  return t(PHASE_KEYS[phase] || 'processing');
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function sanitizeError(error) {
  let message = error && error.message ? error.message : String(error || '');
  message = message.replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '');
  message = message.replace(/^(?:ERROR|Error|FATAL):\s*/i, '');
  message = message.replace(/\s*\(?(?:رمز الخروج|exit code)\s*\d+\)?/gi, '').trim();

  // Last line of defence: never show terminal paths, stack traces or bare exit
  // codes in the UI, even if an untranslated error crosses the bridge.
  if (!message
    || /^(?:error|failed|failure|undefined|null|\d{1,4})$/i.test(message)
    || /^(?:[A-Za-z]:\\|\/|\.{1,2}\/)/.test(message)
    || /^(?:Traceback|at\s+\S+\s+\()/i.test(message)) {
    return t('unexpectedError');
  }

  return message.length > 260 ? `${message.slice(0, 260)}…` : message;
}

function showToast(message, kind) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.dataset.kind = kind || '';
  toast.classList.remove('is-hidden');

  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => {
    toast.classList.add('is-hidden');
  }, 4400);
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function normalizeDownloadUrl(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  const spotifyUri = raw.match(/^spotify:(track|album|playlist|artist|episode|show):([A-Za-z0-9]+)$/i);
  if (spotifyUri) {
    return `https://open.spotify.com/${spotifyUri[1].toLowerCase()}/${spotifyUri[2]}`;
  }

  if (/^https?:\/\//i.test(raw)) {
    try { return new URL(raw).toString(); } catch { return null; }
  }

  if (/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(raw)) {
    try { return new URL(`https://${raw}`).toString(); } catch { return null; }
  }

  return null;
}

/* ---------- Local library & site memory helpers ---------- */

function siteKeyFor(rawUrl) {
  const url = normalizeDownloadUrl(rawUrl);
  if (!url) return '';

  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
    const aliases = {
      'youtu.be': 'youtube.com',
      'm.youtube.com': 'youtube.com',
      'music.youtube.com': 'youtube.com',
      'open.spotify.com': 'spotify.com'
    };
    return aliases[host] || host;
  } catch {
    return '';
  }
}

function getSiteProfile(rawUrl) {
  const key = siteKeyFor(rawUrl);
  const profile = key && state.settings && state.settings.siteProfiles
    ? state.settings.siteProfiles[key]
    : null;
  return profile ? { key, ...profile } : null;
}

async function saveSiteProfile(rawUrl) {
  const key = siteKeyFor(rawUrl);
  if (!key) return null;

  const existing = (state.settings && state.settings.siteProfiles) || {};
  const profile = {
    ...(existing[key] || {}),
    mode: state.mode === 'audio' ? 'audio' : 'video',
    quality: $('#quality-select').value || 'best',
    audioFormat: $('#audio-format-select').value || 'mp3',
    cookieSource: $('#cookie-source').value || 'none',
    at: Date.now()
  };

  try {
    state.settings = await api.saveSettings({
      siteProfiles: { ...existing, [key]: profile }
    });
    state.siteProfile = { key, ...profile };
  } catch {
    /* Profile saving is a convenience; never block the download. */
  }
  return state.siteProfile;
}

function cleanSuggestedName(title) {
  return String(title || '')
    .replace(/\s*\[[^\]]{6,}\]\s*$/, '')
    .replace(/\s*[-–—|]\s*(?:YouTube|Spotify|Facebook|Instagram|TikTok)\s*$/i, '')
    .replace(/\s*\((?:official(?:\s+video)?|lyrics?|HD|HQ|4K|1080p|720p)\)\s*/gi, ' ')
    .replace(/[<>:"\\/|?*]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function titleKeyForDuplicate(title) {
  return cleanSuggestedName(title)
    .toLowerCase()
    .replace(/[^a-z0-9\u0600-\u06ff]+/g, ' ')
    .trim();
}

/* ---------- Theme ---------- */

function systemTheme() {
  return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolveTheme(theme) {
  if (theme === 'light' || theme === 'dark') return theme;
  return systemTheme();
}

function applyTheme(theme) {
  const resolved = resolveTheme(theme);
  document.documentElement.dataset.theme = resolved;
  const themeIcon = $('#theme-icon');
  if (themeIcon) themeIcon.setAttribute('href', resolved === 'dark' ? '#ic-moon' : '#ic-sun');
}

function appDisplayName() {
  return t('appTitle');
}

function applyLanguage(lang) {
  const L = window.WaselLocales;
  if (!L) return;

  state.language = lang || 'ar';
  const tr = L.TRANSLATIONS[state.language] || L.TRANSLATIONS.ar;
  document.documentElement.lang = state.language;
  document.documentElement.dir = tr.dir || 'rtl';

  $$('[data-i18n]').forEach((el) => {
    const value = t(el.dataset.i18n);
    if (value !== undefined) el.textContent = value;
  });
  $$('[data-i18n-title]').forEach((el) => {
    const value = t(el.dataset.i18nTitle);
    if (value !== undefined) el.title = value;
  });
  $$('[data-i18n-aria]').forEach((el) => {
    const value = t(el.dataset.i18nAria);
    if (value !== undefined) el.setAttribute('aria-label', value);
  });
  $$('[data-i18n-placeholder]').forEach((el) => {
    const value = t(el.dataset.i18nPlaceholder);
    if (value !== undefined) el.placeholder = value;
  });

  document.title = appDisplayName();

  const hint = $('#url-hint');
  if (hint) {
    hint.textContent = t('urlHint');
    hint.classList.remove('is-error');
  }

  const topLang = $('#top-language');
  if (topLang) topLang.value = state.language;
  const setLang = $('#settings-language');
  if (setLang) setLang.value = state.language;

  applyTheme(document.documentElement.dataset.theme);

  // Re-render anything generated by JavaScript so it follows the new language.
  if (state.info) renderPreview(state.info);
  renderQueue();
  renderHistory();
  renderFavorites();
  renderSites();
  renderExtensions();
  if (state.env) setEnginePill(state.env);
  if (state.bridge) renderBridge(state.bridge);
}

function populateLanguages() {
  const L = window.WaselLocales;
  if (!L) return;
  const mk = (sel, opts) => { if(!sel) return; sel.textContent=''; for(const o of opts){ const op=document.createElement('option'); op.value=o.value; op.textContent=o.label; sel.appendChild(op);} };
  mk($('#top-language'), L.LANGUAGE_OPTIONS);
  mk($('#settings-language'), L.LANGUAGE_OPTIONS);
}

function t(key, vars = {}) {
  let value = window.WaselLocales
    ? window.WaselLocales.getTranslation(state.language, key)
    : key;
  if (typeof value === 'string' && vars && Object.keys(vars).length) {
    value = value.replace(/\{(\w+)\}/g, (match, name) => (
      Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match
    ));
  }
  return value;
}

function setTab(name) {
  $$('.tab').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `tab-${name}`);
  });

  if (document.title.includes(' — ')) {
    document.title = appDisplayName();
  }

  if (name === 'extensions') loadExtensions();
  if (name === 'sites') loadSites();
  if (name === 'history') {
    renderHistory();
    refreshLibrary();
  }
  if (name === 'favorites') renderFavorites();
  if (name === 'settings') {
    refreshEnv();
    refreshBridge();
    refreshAppInfo();
  }
}

function iconUrlFor(site){
  const slug = (site.icon || site.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')).replace(/^-+|-+$/g,'') || 'site';
  return `../../icons/${encodeURIComponent(slug)}.svg`;
}

const CATEGORY_KEYS = {
  'عام': 'general',
  'صوت': 'audioCategory',
  'تواصل اجتماعي': 'social',
  'فيديو': 'videoCategory',
  'صور وفيديو': 'photoVideo',
  'رياضة': 'sports',
  'أخبار': 'news',
  'أرشيف': 'archive',
  'تعليمي': 'education',
  'ألعاب': 'gaming',
  'محتوى مدفوع': 'paidContent',
  'تخزين': 'storage',
  'ترفيه': 'entertainment',
  'محتوى': 'content'
};

function categoryLabel(category) {
  return CATEGORY_KEYS[category] ? t(CATEGORY_KEYS[category]) : (category || '');
}

function setSiteIcon(image, site) {
  // Always prefer the bundled Adwaita-style SVG icons: consistent and offline.
  image.onerror = null;
  image.src = iconUrlFor(site);
}

function isFavorite(url){
  return (state.favorites||[]).some(f=>f.url===url);
}

async function toggleFavorite(site){
  const isFav = isFavorite(site.url);
  let favs = [...(state.favorites || [])];
  if (isFav) favs = favs.filter(f=>f.url!==site.url);
  else favs.unshift({ url: site.url, name: site.name, icon: site.icon, color: site.color, initials: site.initials, category: site.category, at: Date.now() });
  state.favorites = favs;
  try { state.settings = await api.saveSettings({ favorites: favs }); } catch {}
  renderSites();
  renderFavorites();
  showToast(isFav ? t('favoriteRemoved') : t('favoriteAdded'), 'success');
}

async function addHistory(entry){
  if (!state.settings?.enableHistory) return;
  const hist = [entry, ...(state.history||[])].filter((v,i,a)=>a.findIndex(x=>x.url===v.url)===i).slice(0, state.settings.maxHistory||200);
  state.history = hist;
  try { await api.saveSettings({ history: hist }); } catch {}
  renderHistory();
}

function renderHistory(){
  const list = $('#history-list'); if(!list) return;
  list.textContent='';
  const items = state.history || state.settings?.history || [];
  $('#history-empty').classList.toggle('is-hidden', items.length>0);
  for (const h of items){
    const row = createElement('div','history-item');
    const copy = createElement('div'); copy.style.minWidth='0'; copy.style.flex='1';
    const b = createElement('b', null, h.title || h.url);
    b.title = h.title || h.url;
    const url = createElement('span', null, h.url);
    const when = createElement('span', null, h.at ? new Date(h.at).toLocaleString(state.language||'ar', {dateStyle:'short',timeStyle:'short'}) : '');
    copy.append(b,url,when);
    const act = createElement('div'); act.style.display='flex'; act.style.gap='6px';
    const btn = createElement('button','btn ghost compact',t('open'));
    btn.type='button';
    btn.onclick=()=>{ $('#url').value=h.url; setTab('download'); analyze(h.url); };
    const del = createElement('button','btn ghost compact',t('deleteAction'));
    del.type='button';
    del.onclick=async ()=>{
      const nh = (state.history||[]).filter(x=>x.url!==h.url);
      state.history=nh;
      await api.saveSettings({ history: nh }).catch(()=>{});
      renderHistory();
    };
    act.append(btn,del);
    row.append(copy,act);
    list.appendChild(row);
  }
}

function fileStamp(entry) {
  const at = Number(entry.completedAt || entry.at) || 0;
  return at
    ? new Date(at).toLocaleString(state.language || 'ar', { dateStyle: 'short', timeStyle: 'short' })
    : '';
}

function fileCopy(entry, extra) {
  const copy = createElement('div');
  copy.style.minWidth = '0';
  copy.style.flex = '1';

  const title = createElement('b', null, entry.title || entry.url);
  title.title = entry.title || entry.url;
  const path = createElement('span', null, entry.path || entry.url);
  path.title = entry.path || '';
  const meta = createElement('span', null, [
    formatBytes(entry.size),
    fileStamp(entry),
    extra
  ].filter(Boolean).join(' • '));
  copy.append(title, path, meta);
  return copy;
}

async function recordDownloadFile(job, payload) {
  const target = payload.finalPath || job.finalPath;
  if (!target) return;

  const url = job.url || state.info?.webpageUrl || $('#url').value;
  const record = {
    url,
    title: job.title || state.info?.title || url,
    path: target,
    size: parseSizeToBytes(job.size || payload.size),
    completedAt: Date.now(),
    thumb: job.thumbnail || payload.thumbnail || state.info?.thumbnail || null,
    mode: job.mode || state.mode
  };

  try {
    const files = [record, ...(state.settings?.downloadFiles || []).filter((f) => f.path !== target)]
      .slice(0, state.settings?.maxHistory || 500);
    state.settings = await api.saveSettings({ downloadFiles: files });
    if ($('#tab-history')?.classList.contains('is-active')) refreshLibrary();
  } catch {
    /* A failed record must not turn a completed download into an error. */
  }
}

async function dismissMissingFile(entry) {
  const target = entry.path;
  const files = (state.settings?.downloadFiles || [])
    .map((f) => (f.path === target ? { ...f, path: '' } : f));
  try {
    state.settings = await api.saveSettings({ downloadFiles: files });
    await refreshLibrary();
  } catch (error) {
    showToast(sanitizeError(error), 'error');
  }
}

function renderMissingFiles(missing) {
  const list = $('#missing-list');
  if (!list) return;
  list.textContent = '';
  $('#missing-empty').classList.toggle('is-hidden', missing.length > 0);

  for (const entry of missing) {
    const row = createElement('div', 'history-item');
    const actions = createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '6px';

    const again = createElement('button', 'btn ghost compact', t('reDownload'));
    again.type = 'button';
    again.addEventListener('click', () => handleIncoming({ url: entry.url, autoDownload: true }));

    const dismiss = createElement('button', 'btn ghost compact', t('dismiss'));
    dismiss.type = 'button';
    dismiss.addEventListener('click', () => dismissMissingFile(entry));

    actions.append(again, dismiss);
    row.append(
      fileCopy(entry),
      createElement('span', 'badge badge-bad', t('missingFiles')),
      actions
    );
    list.appendChild(row);
  }
}

function renderLibraryFiles(present) {
  const list = $('#library-list');
  if (!list) return;
  list.textContent = '';
  $('#library-empty').classList.toggle('is-hidden', present.length > 0);

  const counts = new Map();
  for (const entry of present) {
    const key = titleKeyForDuplicate(entry.title);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }

  for (const entry of present) {
    const row = createElement('div', 'history-item');
    const suggestion = cleanSuggestedName(entry.title);
    const isDuplicate = counts.get(titleKeyForDuplicate(entry.title)) > 1;

    const open = createElement('button', 'btn ghost compact', t('open'));
    open.type = 'button';
    open.addEventListener('click', () => api.showItem(entry.path));

    row.append(fileCopy(entry, `${t('suggestedName')}: ${suggestion}`));
    if (isDuplicate) row.appendChild(createElement('span', 'badge badge-warn', t('duplicate')));
    row.appendChild(open);
    list.appendChild(row);
  }
}

async function refreshLibrary() {
  if (!api.scanLibrary || !$('#missing-list') || !$('#library-list')) return;

  try {
    const result = await api.scanLibrary(state.settings?.downloadFiles || []);
    renderMissingFiles(Array.isArray(result?.missing) ? result.missing : []);
    renderLibraryFiles(Array.isArray(result?.present) ? result.present : []);
  } catch {
    renderMissingFiles([]);
    renderLibraryFiles([]);
  }
}

function parseSizeToBytes(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const match = String(value || '').trim().match(/^([\d.,]+)\s*([KMGTPE]?i?B)$/i);
  if (!match) return 0;
  const amount = Number(match[1].replace(/,/g, ''));
  const unit = match[2].toUpperCase();
  const powers = { B: 0, KIB: 1, KB: 1, MIB: 2, MB: 2, GIB: 3, GB: 3, TIB: 4, TB: 4, PIB: 5, PB: 5, EIB: 6, EB: 6 };
  return Number.isFinite(amount) ? amount * (1024 ** (powers[unit] || 0)) : 0;
}

function formatBytes(bytes) {
  if (!bytes) return '0 B';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / (1024 ** index);
  return `${value >= 10 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`;
}

async function shareUrl(url) {
  const clean = normalizeDownloadUrl(url);
  if (!clean) {
    showToast(t('invalidUrl'), 'error');
    return;
  }

  try {
    if (api.share) {
      await api.share({ title: appDisplayName(), url: clean });
      return;
    }
    if (navigator.share) {
      await navigator.share({ title: appDisplayName(), url: clean });
      return;
    }
    await api.writeClipboard(clean);
    showToast(t('copied'), 'success');
  } catch (error) {
    if (error && error.name === 'AbortError') return;
    showToast(sanitizeError(error), 'error');
  }
}

function renderFavorites(){
  const list = $('#fav-list'); if(!list) return;
  list.textContent='';
  const favs = state.favorites || state.settings?.favorites || [];
  $('#fav-count').textContent = String(favs.length);
  $('#fav-empty').classList.toggle('is-hidden', favs.length>0);
  for (const f of favs){
    const card = createElement('div','site-card');
    const img = createElement('img','site-icon');
    setSiteIcon(img, f);
    img.alt = f.name;
    const copy = createElement('div','site-copy');
    copy.append(createElement('b',null,f.name), createElement('span',null,categoryLabel(f.category)));
    const star = createElement('button','fav-btn is-fav','★');
    star.type='button'; star.title=t('removeFavorite');
    star.onclick=(e)=>{ e.stopPropagation(); toggleFavorite(f); };
    card.append(img,copy,star);
    card.style.cursor='pointer';
    card.onclick=()=>{ $('#url').value=f.url; setTab('download'); analyze(f.url); };
    list.appendChild(card);
  }
}

async function loadSites() {
  if (!api.listSites) return;
  try {
    const sites = await api.listSites();
    state.sites = Array.isArray(sites) ? sites : [];
    // populate categories dynamically
    try {
      const cats = api.sitesCategories ? await api.sitesCategories() : [...new Set(state.sites.map(s=>s.category))].sort();
      const sel = $('#sites-category');
      if (sel) {
        const current = sel.value;
        sel.textContent = '';
        const all = document.createElement('option');
        all.value = '';
        all.dataset.i18n = 'allCategories';
        all.textContent = t('allCategories');
        sel.appendChild(all);
        for (const cat of cats) {
          const option = document.createElement('option');
          option.value = cat;
          if (CATEGORY_KEYS[cat]) {
            option.dataset.i18n = CATEGORY_KEYS[cat];
          }
          option.textContent = categoryLabel(cat);
          sel.appendChild(option);
        }
        sel.value = cats.includes(current) ? current : '';
      }
    } catch {}
    renderSites();
  } catch(e){ showToast(sanitizeError(e),'error'); }
}

function renderSites() {
  const grid = $('#sites-grid'); if(!grid) return;
  const q = ($('#sites-search')?.value || '').toLowerCase();
  const cat = $('#sites-category')?.value || '';
  const list = state.sites.filter(s => {
    const okQ = !q || s.name.toLowerCase().includes(q) || (s.url||'').toLowerCase().includes(q);
    const okC = !cat || s.category===cat;
    return okQ && okC;
  });
  grid.textContent='';
  $('#sites-count').textContent = String(list.length);
  const showIcons = state.settings?.showSiteIcons !== false;
  for (const s of list) {
    const card = createElement('div','site-card animate-in');
    if (showIcons) {
      const img = createElement('img','site-icon');
      setSiteIcon(img, s);
      img.alt = s.name;
      img.loading = 'lazy';
      card.appendChild(img);
    }
    const copy = createElement('div','site-copy');
    copy.append(createElement('b', null, s.name), createElement('span', null, categoryLabel(s.category)));
    const star = createElement('button','fav-btn' + (isFavorite(s.url)?' is-fav':''), isFavorite(s.url)?'★':'☆');
    star.type='button'; star.title=t('favorite');
    star.addEventListener('click', (e)=>{ e.stopPropagation(); toggleFavorite(s); });
    card.append(copy, star);
    card.title = `${s.name} — ${s.url}`;
    card.addEventListener('click', ()=>{
      $('#url').value = s.url;
      setTab('download');
      // Spotify's home page has no track to analyze; let the user paste a link.
      if (/spotify/i.test(s.name || '')) {
        setUrlHint(t('spotifyPasteHint'), false);
      } else {
        analyze(s.url);
      }
    });
    grid.appendChild(card);
  }
}

function readBatchUrls() {
  const txt = $('#batch-input')?.value || '';
  return txt.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((url) => normalizeDownloadUrl(url) || url);
}

function bindSites(){
  const search = $('#sites-search'); if(search) search.addEventListener('input', renderSites);
  const cat = $('#sites-category'); if(cat) cat.addEventListener('change', renderSites);

  const add = $('#batch-add');
  if(add) add.addEventListener('click', ()=>{
    const urls = readBatchUrls();
    if(!urls.length){ showToast(t('noLinks')); return; }
    for(const url of urls){
      const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const job = { id, url, title: url, thumbnail:null, mode: state.mode, quality: $('#quality-select')?.value || 'best', audioFormat: $('#audio-format-select')?.value || 'mp3', playlist:false, percent:0, phase:'queued', speed:null, eta:null, size:null, item:null, totalItems:null, status:'queued', error:null, finalPath:null, folder:null, el:null };
      state.jobs.set(id, job);
    }
    renderQueue();
    showToast(t('addedLinks', { count: urls.length }), 'success');
  });

  const analyzeAll = $('#batch-analyze-all');
  if(analyzeAll) analyzeAll.addEventListener('click', async ()=>{
    const urls = readBatchUrls();
    if(!urls.length){ showToast(t('noLinks')); return; }
    setButtonBusy(analyzeAll, true, t('analyzing'));
    let analyzed = 0;
    for(const url of urls){
      const info = await analyze(url);
      if(info) analyzed += 1;
    }
    setButtonBusy(analyzeAll, false);
    showToast(t('analyzeAllDone', { count: analyzed, total: urls.length }), 'success');
  });

  const clearB = $('#batch-clear'); if(clearB) clearB.addEventListener('click', ()=>{ const el=$('#batch-input'); if(el) el.value=''; });
}

function setUrlHint(text, isError) {
  const hint = $('#url-hint');
  hint.textContent = text;
  hint.classList.toggle('is-error', Boolean(isError));
}

function setButtonBusy(button, busy, label) {
  if (!button) return;

  if (busy) {
    if (button.dataset.originalHtml === undefined) button.dataset.originalHtml = button.innerHTML;
    button.disabled = true;
    button.replaceChildren(createIcon('spinner', 'icon spin'), document.createTextNode(label || t('busy')));
  } else {
    button.disabled = false;
    if (button.dataset.originalHtml !== undefined) {
      button.innerHTML = button.dataset.originalHtml;
      delete button.dataset.originalHtml;
    }
  }
}

function setBadge(element, tone, text) {
  element.className = 'badge';
  if (tone) element.classList.add(`badge-${tone}`);
  element.textContent = text;
}

/* ---------- Analyze / preview ---------- */

async function analyze(urlOverride, preferredMode) {
  if (state.busyInfo) return null;

  const url = normalizeDownloadUrl(urlOverride === undefined ? $('#url').value : urlOverride);
  if (!url) {
    setUrlHint(t('validUrlRequired'), true);
    return null;
  }

  $('#url').value = url;
  state.siteProfile = null;
  state.busyInfo = true;
  setButtonBusy($('#analyze-btn'), true, t('analyzing'));
  setUrlHint(t('readingInfo'), false);

  try {
    state.siteProfile = getSiteProfile(url);
    if (state.siteProfile?.cookieSource) setCookieSource(state.siteProfile.cookieSource);

    const info = await api.fetchInfo(url, $('#cookie-source').value);
    state.info = info;
    // Spotify only provides audio; spotdl always writes an audio file.
    // A saved per-site preference wins over the generic default; an explicit
    // request from the extension still wins over the saved preference.
    state.mode = info.backend === 'spotdl'
      ? 'audio'
      : (preferredMode || state.siteProfile?.mode || 'video');
    renderPreview(info);
    const success = state.siteProfile
      ? t('siteProfileApplied')
      : (info.backend === 'spotdl' ? t('spotifyAnalyzeSuccess') : t('analyzeSuccess'));
    setUrlHint(success, false);
    // History
    if (state.settings?.enableHistory) {
      addHistory({ url, title: info.title || url, thumb: info.thumbnail || null, extractor: info.extractor || null, at: Date.now() });
    }
    return info;
  } catch (error) {
    state.info = null;
    state.siteProfile = null;
    hidePreview();
    setUrlHint(sanitizeError(error), true);
    return null;
  } finally {
    state.busyInfo = false;
    setButtonBusy($('#analyze-btn'), false);
  }
}

function populateQualities(info) {
  const select = $('#quality-select');
  select.textContent = '';

  const add = (value, label) => {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  };

  add('best', t('bestQuality'));

  const heights = Array.isArray(info.heights) ? info.heights : [];
  const unique = [...new Set(heights.filter((height) => Number.isFinite(height) && height >= 144))];

  if (unique.length) {
    for (const height of unique.slice(0, 12)) add(String(height), `${height}p`);
  } else {
    for (const height of [2160, 1440, 1080, 720, 480, 360]) add(String(height), `${height}p`);
  }
}

function renderBadges(info) {
  const container = $('#preview-badges');
  container.textContent = '';

  const add = (text, tone) => {
    const badge = createElement('span', `badge${tone ? ` badge-${tone}` : ''}`, text);
    container.appendChild(badge);
  };

  if (info.isLive) add(t('live'), 'live');
  if (info.isPlaylist) add(`${t('playlist')} · ${info.playlistCount || ''}`.trim(), 'warn');
  if (info.extractor) add(info.extractor, 'info');
  if (info.backend === 'spotdl') add('spotdl', 'ok');
  if (Array.isArray(info.subtitleLangs) && info.subtitleLangs.length) {
    add(`${t('subtitleBadge')} · ${info.subtitleLangs.length}`, 'ok');
  }
  if (info.hasVideo === false && info.hasAudio !== false) add(t('audioOnly'), 'info');
  if (state.env && !state.env.merge) add(t('ffmpegBadge'), 'warn');
  if (state.siteProfile) add(t('siteProfileBadge'), 'info');
}

function renderPreview(info) {
  $('#preview-empty').classList.add('is-hidden');
  $('#preview').classList.remove('is-hidden');

  const thumb = $('#preview-thumb');
  if (info.thumbnail) {
    thumb.src = info.thumbnail;
    thumb.classList.remove('is-hidden');
  } else {
    thumb.removeAttribute('src');
    thumb.classList.add('is-hidden');
  }

  const duration = formatDuration(info.duration);
  const durationEl = $('#preview-duration');
  durationEl.textContent = duration || '';
  durationEl.classList.toggle('is-hidden', !duration);

  $('#preview-title').textContent = info.title || t('untitled');
  $('#preview-title').title = info.title || '';

  const parts = [];
  if (info.uploader) parts.push(info.uploader);
  if (duration) parts.push(duration);
  if (info.extractor) parts.push(info.extractor);
  if (info.isLive) parts.push(t('live'));
  $('#preview-meta').textContent = parts.join(' • ') || '—';

  renderBadges(info);
  populateQualities(info);

  const defaultQuality = state.siteProfile?.quality
    || (state.settings ? state.settings.videoQuality : 'best');
  const qualitySelect = $('#quality-select');
  if (Array.from(qualitySelect.options).some((option) => option.value === defaultQuality)) {
    qualitySelect.value = defaultQuality;
  }

  const defaultAudio = state.siteProfile?.audioFormat
    || (state.settings ? state.settings.audioFormat : 'mp3');
  const audioSelect = $('#audio-format-select');
  if (Array.from(audioSelect.options).some((option) => option.value === defaultAudio)) {
    audioSelect.value = defaultAudio;
  }

  $('#playlist-field').classList.toggle('is-hidden', !info.isPlaylist);
  if (!info.isPlaylist) $('#opt-playlist').checked = false;

  // Load preview video if in video mode
  if (state.mode === 'video') {
    loadPreviewVideo(info);
  } else {
    hidePreviewPlayer();
  }

  updateModeUi();
}

async function loadPreviewVideo(info) {
  const playerWrap = $('#preview-player-wrap');
  const player = $('#preview-player');
  const overlay = $('#player-overlay');
  const playBtn = $('#player-play-btn');

  // Show loading state
  playerWrap.classList.remove('is-hidden');
  overlay.classList.remove('is-hidden');
  player.classList.add('is-hidden');

  // Remove old event listeners
  playBtn.onclick = null;
  player.onloadeddata = null;
  player.onerror = null;

  try {
    // Use the webpage URL for preview
    const url = info.webpageUrl || $('#url').value;
    if (!url) {
      hidePreviewPlayer();
      return;
    }

    const previewUrl = await api.getPreviewUrl(url, $('#cookie-source').value, 'video');
    state.previewPlayerUrl = previewUrl;

    player.src = previewUrl;
    player.load();

    // Show player when loaded
    player.onloadeddata = () => {
      player.classList.remove('is-hidden');
      overlay.classList.add('is-hidden');
    };

    player.onerror = (e) => {
      console.warn('Preview player error:', e);
      hidePreviewPlayer();
    };

    // Play button handler
    playBtn.onclick = () => {
      if (player.paused) {
        player.play().catch(() => {});
      } else {
        player.pause();
      }
    };

    // Sync overlay with player state
    player.onplay = () => overlay.classList.add('is-hidden');
    player.onpause = () => overlay.classList.remove('is-hidden');
    player.onended = () => overlay.classList.remove('is-hidden');

  } catch (error) {
    console.warn('Could not load preview video:', error);
    hidePreviewPlayer();
  }
}

function hidePreviewPlayer() {
  const playerWrap = $('#preview-player-wrap');
  const player = $('#preview-player');
  const overlay = $('#player-overlay');

  player.pause();
  player.removeAttribute('src');
  player.load();
  playerWrap.classList.add('is-hidden');
  overlay.classList.remove('is-hidden');
  state.previewPlayerUrl = null;
}

function hidePreview() {
  state.info = null;
  hidePreviewPlayer();
  $('#preview').classList.add('is-hidden');
  $('#preview-empty').classList.remove('is-hidden');
}

function updateModeUi() {
  $$('#mode-toggle .seg').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === state.mode);
  });

  $('#quality-field').classList.toggle('is-hidden', state.mode === 'audio');
  $('#audio-format-field').classList.toggle('is-hidden', state.mode !== 'audio');

  // Handle preview player visibility based on mode
  if (state.mode === 'video' && state.info) {
    loadPreviewVideo(state.info);
  } else {
    hidePreviewPlayer();
  }

  updateDownloadAvailability();
  updatePreviewNote();
}

function updateDownloadAvailability() {
  const audioBlocked = state.mode === 'audio' && state.env && !state.env.merge;
  $('#download-btn').disabled = Boolean(audioBlocked || !state.info);
}

function updatePreviewNote() {
  if (!state.info) return;

  const notes = [];
  if (state.env && !state.env.merge) {
    if (state.mode === 'audio') {
      notes.push(t('ffmpegAudioNote'));
    } else {
      notes.push(t('ffmpegVideoNote'));
    }
  }

  if (state.info.backend === 'spotdl') notes.push(t('spotifyNote'));
  if (state.info.infoDegraded) notes.push(t('spotifyInfoNote'));
  if (state.info.isLive) notes.push(t('liveNote'));
  if (state.info.isPlaylist) notes.push(t('playlistNote'));

  const heights = Array.isArray(state.info.heights) ? state.info.heights : [];
  if (heights.length) {
    notes.push(t('availableQualities', {
      list: heights.slice(0, 7).map((height) => `${height}p`).join(', ')
    }));
  }

  $('#preview-note').textContent = notes.join(' ');
}

/* ---------- Downloads ---------- */

function downloadOptionsFor(job) {
  return {
    id: job.id,
    url: job.url,
    mode: job.mode,
    quality: job.quality,
    audioFormat: job.audioFormat,
    videoFormat: $('#settings-video-format')?.value || 'mp4',
    playlist: job.playlist,
    embedMetadata: $('#opt-metadata').checked,
    downloadSubtitles: $('#opt-subtitles').checked,
    subtitleLangs: $('#subtitle-lang').value,
    cookieSource: $('#cookie-source').value,
    speedLimit: $('#settings-speed')?.value || '',
    proxy: $('#settings-proxy')?.value || '',
    filenameTemplate: $('#settings-template')?.value || '%(title).150s [%(id)s].%(ext)s',
    outputSubfolder: $('#opt-subfolder')?.checked || false,
    downloadChapters: $('#opt-chapters')?.checked || false,
    sponsorblock: $('#opt-sponsorblock')?.checked || false,
    thumbnailOnly: $('#opt-thumb-only')?.checked || false,
    playlistStart: Number($('#playlist-start')?.value || 1),
    playlistEnd: Number($('#playlist-end')?.value || 0),
  };
}

async function launchDownload(job) {
  state.jobs.set(job.id, job);
  renderQueue();

  try {
    const result = await api.startDownload(downloadOptionsFor(job));
    if (result && result.folder) job.folder = result.folder;
    if (job.status === 'queued') job.status = 'running';
    updateJobCard(job);
  } catch (error) {
    job.status = 'error';
    job.error = sanitizeError(error);
    updateJobCard(job);
    showToast(job.error, 'error');
  }
}

async function startDownload() {
  if (!state.info) {
    showToast(t('analyzeFirst'));
    return;
  }

  if (state.mode === 'audio' && state.env && !state.env.merge) {
    showToast(t('audioNeedsFfmpeg'), 'error');
    return;
  }

  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  // Remember the exact choices used for this site so the next link from the
  // same site starts with the same mode, quality, format and cookie source.
  await saveSiteProfile(state.info.webpageUrl || $('#url').value);

  await launchDownload({
    id,
    url: state.info.webpageUrl || $('#url').value,
    title: state.info.title || $('#url').value,
    thumbnail: state.info.thumbnail || null,
    mode: state.mode,
    quality: $('#quality-select').value,
    audioFormat: $('#audio-format-select').value,
    playlist: state.info.isPlaylist && $('#opt-playlist').checked,
    percent: 0,
    phase: 'queued',
    speed: null,
    eta: null,
    size: null,
    item: null,
    totalItems: null,
    status: 'queued',
    error: null,
    finalPath: null,
    folder: null,
    el: null
  });
}

async function retryDownload(job) {
  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  state.jobs.delete(job.id);
  await launchDownload({
    ...job,
    id,
    status: 'queued',
    error: null,
    percent: 0,
    phase: 'queued',
    paused: false,
    finalPath: null,
    el: null
  });
}

function createJobCard(job) {
  const card = createElement('article', 'queue-item');
  card.dataset.id = job.id;

  const thumb = createElement('div', 'queue-thumb');
  const img = createElement('img');
  img.alt = '';
  const fileType = createElement('span', 'queue-file', job.mode === 'audio' ? 'AUD' : 'VID');
  thumb.append(img, fileType);

  const body = createElement('div', 'queue-body');

  const top = createElement('div', 'queue-top');
  const title = createElement('span', 'queue-title', job.title);
  title.title = job.title;
  const badge = createElement('span', 'queue-badge');
  top.append(title, badge);

  const meta = createElement('div', 'queue-meta');

  const bar = createElement('div', 'queue-progress');
  const fill = createElement('span');
  bar.appendChild(fill);

  const bottom = createElement('div', 'queue-bottom');
  const detail = createElement('span', 'queue-detail');
  const actions = createElement('div', 'queue-actions');

  const openBtn = createElement('button', 'queue-action', t('open'));
  openBtn.type = 'button';
  openBtn.dataset.action = 'open';
  openBtn.classList.add('is-hidden');
  openBtn.addEventListener('click', () => {
    if (job.finalPath) api.openPath(job.finalPath);
  });

  const folderBtn = createElement('button', 'queue-action', t('folder'));
  folderBtn.type = 'button';
  folderBtn.dataset.action = 'folder';
  folderBtn.addEventListener('click', () => openJobFolder(job));

  const pauseBtn = createElement('button', 'queue-action', t('pause'));
  pauseBtn.type = 'button';
  pauseBtn.dataset.action = 'pause';
  pauseBtn.addEventListener('click', async () => {
    if (job.status === 'running' && !job.paused) { await api.pauseDownload(job.id); job.paused = true; pauseBtn.textContent = t('resume'); job.status = 'paused'; updateJobCard(job); }
    else if (job.paused) { await api.resumeDownload(job.id); job.paused = false; pauseBtn.textContent = t('pause'); job.status = 'running'; updateJobCard(job); }
  });

  const retryBtn = createElement('button', 'queue-action', t('retry'));
  retryBtn.type = 'button';
  retryBtn.dataset.action = 'retry';
  retryBtn.classList.add('is-hidden');
  retryBtn.addEventListener('click', () => retryDownload(job));

  const cancelBtn = createElement('button', 'queue-action', t('cancel'));
  cancelBtn.type = 'button';
  cancelBtn.dataset.action = 'cancel';
  cancelBtn.addEventListener('click', () => api.cancelDownload(job.id));

  actions.append(openBtn, folderBtn, pauseBtn, retryBtn, cancelBtn);
  bottom.append(detail, actions);
  body.append(top, meta, bar, bottom);
  card.append(thumb, body);

  card.refs = { img, fileType, badge, meta, fill, detail, openBtn, cancelBtn, pauseBtn, retryBtn };
  return card;
}

function updateJobCard(job) {
  if (!job.el) return;

  const refs = job.el.refs;

  if (job.thumbnail) {
    refs.img.src = job.thumbnail;
    refs.img.classList.remove('is-hidden');
    refs.fileType.classList.add('is-hidden');
  } else {
    refs.img.removeAttribute('src');
    refs.img.classList.add('is-hidden');
    refs.fileType.classList.remove('is-hidden');
  }

  job.el.dataset.status = job.status;

  let badgeText = '—';
  let indeterminate = false;
  let processing = false;

  if (job.status === 'queued') {
    badgeText = t('queued');
    refs.meta.textContent = t('waiting');
  } else if (job.status === 'running') {
    if (job.phase === 'merging' || job.phase === 'converting' || job.phase === 'tagging') {
      badgeText = phaseLabel(job.phase);
      indeterminate = true;
      processing = true;
    } else if (job.phase === 'retrying') {
      badgeText = phaseLabel(job.phase);
      indeterminate = true;
    } else if (job.phase === 'playlist' && job.totalItems) {
      badgeText = `${job.item || 1}/${job.totalItems}`;
    } else {
      badgeText = `${Math.round(job.percent || 0)}%`;
    }

    const metaParts = [];
    if (job.percent > 0 && !indeterminate) metaParts.push(`${job.percent.toFixed(1)}%`);
    if (job.size) metaParts.push(job.size);
    if (job.speed) metaParts.push(job.speed);
    if (job.eta) metaParts.push(t('remaining', { time: job.eta }));
    // Post-processing (merging/converting) can take a while after the last
    // percentage update; say what is happening instead of freezing at 99%.
    refs.meta.textContent = processing
      ? t('processingFile')
      : (metaParts.join(' • ') || t('downloading'));
  } else if (job.status === 'done') {
    badgeText = t('done');
    refs.meta.textContent = job.finalPath || t('fileSaved');
    refs.meta.title = job.finalPath || '';
  } else if (job.status === 'cancelled') {
    badgeText = t('cancelled');
    refs.meta.textContent = t('downloadCancelled');
  } else if (job.status === 'error') {
    badgeText = t('errorShort');
    refs.meta.textContent = job.error || t('downloadFailed');
    refs.meta.title = job.error || '';
  } else if (job.status === 'paused') {
    badgeText = t('paused');
    refs.meta.textContent = t('pausedHint');
    refs.meta.title = '';
  }

  refs.badge.textContent = badgeText;

  const percent = job.status === 'done' ? 100 : Math.max(0, Math.min(100, job.percent || 0));
  refs.fill.classList.toggle('is-indeterminate', indeterminate);
  if (!indeterminate) refs.fill.style.width = `${percent}%`;

  const detailParts = [];
  if (job.status === 'running' && job.phase) {
    detailParts.push(phaseLabel(job.phase));
  }
  if (job.playlist) detailParts.push(t('playlistShort'));
  if (job.mode === 'audio') detailParts.push(t('audioShort'));
  refs.detail.textContent = detailParts.join(' • ') || (job.status === 'queued' ? t('queueWaiting') : '');
  refs.detail.title = job.error || '';

  refs.openBtn.classList.toggle('is-hidden', job.status !== 'done' || !job.finalPath);
  refs.openBtn.disabled = !job.finalPath;
  refs.cancelBtn.classList.toggle('is-hidden', job.status !== 'running' && job.status !== 'queued' && job.status !== 'paused');
  if (refs.pauseBtn) {
    refs.pauseBtn.classList.toggle('is-hidden', job.status !== 'running' && job.status !== 'paused');
    refs.pauseBtn.textContent = job.paused ? t('resume') : t('pause');
  }
  if (refs.retryBtn) {
    refs.retryBtn.classList.toggle('is-hidden', job.status !== 'error' && job.status !== 'cancelled');
  }
}

function renderQueue() {
  const list = $('#queue-list');
  list.textContent = '';

  for (const job of state.jobs.values()) {
    job.el = createJobCard(job);
    list.appendChild(job.el);
    updateJobCard(job);
  }

  $('#queue-empty').classList.toggle('is-hidden', state.jobs.size > 0);
  $('#queue-count').textContent = String(state.jobs.size);
}

function openJobFolder(job) {
  if (job.finalPath) {
    api.showItem(job.finalPath);
    return;
  }

  if (job.folder) {
    api.openPath(job.folder);
    return;
  }

  if (state.settings) api.openPath(state.settings.downloadDir);
}

function handleProgress(payload) {
  const job = state.jobs.get(payload.id);
  if (!job) return;

  job.status = 'running';
  job.phase = payload.phase || 'downloading';

  if (typeof payload.percent === 'number' && Number.isFinite(payload.percent)) {
    job.percent = payload.percent;
  }

  job.speed = payload.speed || null;
  job.eta = payload.eta || null;
  job.size = payload.size || null;
  job.item = payload.item || null;
  job.totalItems = payload.totalItems || null;

  updateJobCard(job);
}

function handleDone(payload) {
  const job = state.jobs.get(payload.id);
  if (!job) return;

  job.status = 'done';
  job.phase = 'done';
  job.percent = 100;
  job.finalPath = payload.finalPath || null;
  job.folder = payload.folder || job.folder;

  updateJobCard(job);
  recordDownloadFile(job, payload);
  showToast(t('downloadComplete', { title: job.title }), 'success');
}

function handleError(payload) {
  const job = state.jobs.get(payload.id);
  if (!job) return;

  job.status = 'error';
  job.error = payload.message || t('downloadFailed');
  updateJobCard(job);
  showToast(job.error, 'error');
}

function handleCancelled(payload) {
  const job = state.jobs.get(payload.id);
  if (!job) return;

  job.status = 'cancelled';
  updateJobCard(job);
}

function bindTabs() {
  $$('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab));
  });
}

function bindTheme() {
  $('#theme-toggle').addEventListener('click', async () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next);
    $('#settings-theme').value = next;

    try {
      state.settings = await api.saveSettings({ theme: next });
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    }
  });

  $('#settings-theme').addEventListener('change', () => {
    applyTheme($('#settings-theme').value);
  });
}

async function processIncomingQueue() {
  if (state.incomingBusy || !state.incomingQueue.length) return;

  state.incomingBusy = true;
  const payload = state.incomingQueue.shift();
  try {
    $('#url').value = payload.url;
    setTab('download');
    const info = await analyze(payload.url, payload.mode === 'audio' ? 'audio' : 'video');
    if (info && payload.autoDownload) await startDownload();
  } finally {
    state.incomingBusy = false;
    if (state.incomingQueue.length) setTimeout(processIncomingQueue, 0);
  }
}

function handleIncoming(payload) {
  if (!payload || !payload.url) return;

  const url = normalizeDownloadUrl(payload.url);
  if (!url) return;

  // The extension can fire several /send calls in one burst. Queue them here
  // instead of dropping links while analyze() is busy.
  state.incomingQueue.push({ ...payload, url });
  if (state.incomingQueue.length > 50) state.incomingQueue.shift();
  processIncomingQueue();
}

function bindDownloader() {
  $('#analyze-btn').addEventListener('click', () => analyze());
  $('#url').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      analyze();
    }
  });

  $('#paste-btn').addEventListener('click', async () => {
    try {
      const text = (await api.readClipboard()).trim();
      if (!text) {
        showToast(t('clipboardEmpty'));
        return;
      }

      $('#url').value = text;
      const url = normalizeDownloadUrl(text);
      if (url) analyze(url);
      else setUrlHint(t('validUrlRequired'), true);
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    }
  });

  $('#mode-toggle').addEventListener('click', (event) => {
    const button = event.target.closest('.seg');
    if (!button) return;
    state.mode = button.dataset.mode === 'audio' ? 'audio' : 'video';
    updateModeUi();
  });

  $('#opt-subtitles').addEventListener('change', () => {
    $('#subtitle-lang-field').classList.toggle('is-hidden', !$('#opt-subtitles').checked);
  });
  $('#download-btn').addEventListener('click', startDownload);

  $('#preview-browse').addEventListener('click', () => {
    const url = state.info && (state.info.webpageUrl || $('#url').value);
    if (url) api.openExternal(url);
  });
  $('#preview-copy').addEventListener('click', () => {
    const url = (state.info && state.info.webpageUrl) || $('#url').value;
    if (url) api.writeClipboard(url).then(() => showToast(t('copied'), 'success'))
      .catch((error) => showToast(sanitizeError(error), 'error'));
  });
  $('#preview-share').addEventListener('click', () => {
    const url = (state.info && state.info.webpageUrl) || $('#url').value;
    if (url) shareUrl(url);
  });

  $('#clear-completed').addEventListener('click', () => {
    for (const [id, job] of state.jobs) {
      if (job.status === 'done' || job.status === 'cancelled' || job.status === 'error') {
        state.jobs.delete(id);
      }
    }
    renderQueue();
  });

  $('#clear-history')?.addEventListener('click', async () => {
    state.history = [];
    try {
      state.settings = await api.saveSettings({ history: [] });
    } catch { /* keep the local list cleared even if saving fails */ }
    renderHistory();
  });

  api.onProgress(handleProgress);
  api.onDone(handleDone);
  api.onError(handleError);
  api.onCancelled(handleCancelled);
  if (api.onExtensionReceived) api.onExtensionReceived(handleIncoming);
  // Android share / "open with" intents arrive through the mobile bridge.
  if (api.onSharedLink) api.onSharedLink((url) => handleIncoming({ url }));
}

async function loadExtensions() {
  if (!$('#extensions-list')) return;
  try {
    const result = await api.listExtensions();
    state.extensions = result && Array.isArray(result.extensions) ? result.extensions : [];
    renderExtensions();
  } catch (error) {
    showToast(sanitizeError(error), 'error');
  }
}

function renderExtensions() {
  const container = $('#extensions-list');
  if (!container) return;

  container.textContent = '';
  $('#extensions-count').textContent = String(state.extensions.length);
  $('#extensions-empty').classList.toggle('is-hidden', state.extensions.length > 0);

  for (const extension of state.extensions) {
    const item = createElement('div', 'extension-item');
    const icon = createIcon('puzzle', 'extension-icon');
    const copy = createElement('div', 'extension-copy');
    const name = createElement('b', null, extension.name || t('extension'));
    const details = createElement(
      'span',
      null,
      `${extension.version || '—'} · ${t(extension.loaded ? 'loaded' : 'notLoaded')}`
    );
    if (extension.error) details.title = extension.error;
    copy.append(name, details);

    const actions = createElement('div', 'extension-actions');
    const reload = createElement('button', 'btn ghost compact', t('reload'));
    reload.type = 'button';
    reload.addEventListener('click', async () => {
      setButtonBusy(reload, true, t('busy'));
      try {
        await api.reloadExtension({ id: extension.id, folder: extension.folder });
        await loadExtensions();
        showToast(t('extensionReloaded'), 'success');
      } catch (error) {
        showToast(sanitizeError(error), 'error');
      } finally {
        setButtonBusy(reload, false);
      }
    });

    const remove = createElement('button', 'btn ghost compact', t('remove'));
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      if (!window.confirm(t('confirmRemove', { name: extension.name || t('extension') }))) return;
      setButtonBusy(remove, true, t('busy'));
      try {
        await api.removeExtension({ id: extension.id, folder: extension.folder });
        await loadExtensions();
        showToast(t('extensionRemoved'), 'success');
      } catch (error) {
        showToast(sanitizeError(error), 'error');
      } finally {
        setButtonBusy(remove, false);
      }
    });

    actions.append(reload, remove);
    item.append(icon, copy, actions);
    container.appendChild(item);
  }
}

function bindExtensions() {
  if (!$('#extensions-list')) return;

  const installers = [
    ['#add-extension-folder', () => api.addExtensionFolder(), 'extensionInstalled'],
    ['#add-extension-archive', () => api.addExtensionArchive(), 'extensionInstalled'],
    ['#install-bundled-extension', () => api.installBundledExtension(), 'bundledInstalled']
  ];

  installers.forEach(([selector, task, successKey]) => {
    const button = $(selector);
    button.addEventListener('click', async () => {
      setButtonBusy(button, true, t('installing'));
      try {
        const result = await task();
        if (result === null || result === undefined) return;
        await loadExtensions();
        showToast(t(successKey), 'success');
      } catch (error) {
        showToast(sanitizeError(error), 'error');
      } finally {
        setButtonBusy(button, false);
      }
    });
  });

  $('#refresh-extensions').addEventListener('click', loadExtensions);
  $('#open-extensions-folder').addEventListener('click', () => api.openExtensionsFolder());
}

function setCookieSource(source) {
  const value = source || 'none';
  [$('#cookie-source'), $('#settings-cookie-source')].forEach((select) => {
    if (select && Array.from(select.options).some((option) => option.value === value)) {
      select.value = value;
    }
  });
}

function applySettingsToForm(settings) {
  $('#settings-dir').value = settings.downloadDir || '';
  $('#settings-quality').value = settings.videoQuality || 'best';
  $('#settings-audio').value = settings.audioFormat || 'mp3';
  $('#settings-theme').value = settings.theme || 'system';
  $('#settings-concurrent').value = String(settings.maxConcurrentDownloads || 2);
  $('#settings-metadata').checked = settings.embedMetadata !== false;
  $('#settings-subtitles').checked = Boolean(settings.downloadSubtitles);
  $('#settings-subtitle-lang').value = settings.subtitleLangs || 'ar,en';
  const bridgeEnabled = $('#bridge-enabled');
  const autoDownload = $('#auto-download-extension');
  if (bridgeEnabled) bridgeEnabled.checked = settings.extensionBridge !== false;
  if (autoDownload) autoDownload.checked = Boolean(settings.autoDownloadFromExtension);

  const optionalValues = {
    'settings-language': settings.language || 'ar',
    'settings-video-format': settings.videoFormat || 'mp4',
    'settings-speed': settings.speedLimit || '',
    'settings-proxy': settings.proxy || '',
    'settings-template': settings.filenameTemplate || '%(title).150s [%(id)s].%(ext)s',
    'playlist-start': settings.playlistStart || 1,
    'playlist-end': settings.playlistEnd || 0
  };
  for (const [id, value] of Object.entries(optionalValues)) {
    const element = document.getElementById(id);
    if (element) element.value = value;
  }
  const optionalChecks = {
    'opt-chapters': settings.downloadChapters,
    'opt-sponsorblock': settings.sponsorblock,
    'opt-subfolder': settings.outputSubfolder,
    'opt-thumb-only': settings.downloadThumbnail,
    'minimize-tray': settings.minimizeToTray,
    'auto-start': settings.autoStart
  };
  for (const [id, checked] of Object.entries(optionalChecks)) {
    const element = document.getElementById(id);
    if (element) element.checked = Boolean(checked);
  }

  state.history = Array.isArray(settings.history) ? settings.history : [];
  state.favorites = Array.isArray(settings.favorites) ? settings.favorites : [];
  $('#opt-metadata').checked = settings.embedMetadata !== false;
  $('#opt-subtitles').checked = Boolean(settings.downloadSubtitles);
  $('#subtitle-lang').value = settings.subtitleLangs || 'ar,en';
  $('#subtitle-lang-field').classList.toggle('is-hidden', !settings.downloadSubtitles);
  applyLanguage(settings.language || 'ar');
  setCookieSource(settings.cookieSource);
  renderHistory();
  renderFavorites();
}

async function loadSettings() {
  try {
    state.settings = await api.getSettings();
    applyTheme(state.settings.theme || 'system');
    applySettingsToForm(state.settings);
  } catch (error) {
    showToast(sanitizeError(error), 'error');
  }
}

function ffmpegVersionLabel(version) {
  if (!version) return '—';
  const match = String(version).match(/version\s+(\S+)/i);
  return match ? match[1] : version;
}

function setEnginePill(env) {
  const pill = $('#engine-pill');
  const text = $('#engine-pill-text');
  pill.className = 'engine-pill';

  if (env.ok && env.merge) {
    pill.classList.add('is-ok');
    text.textContent = 'المحرّكات جاهزة';
  } else if (env.ok) {
    pill.classList.add('is-warn');
    text.textContent = 'FFmpeg غير متوفر';
  } else {
    pill.classList.add('is-bad');
    text.textContent = 'yt-dlp غير متوفر';
  }

  pill.title = [
    `yt-dlp: ${env.ytDlp || 'غير متوفر'}`,
    `FFmpeg: ${env.ffmpeg || 'غير متوفر'}`,
    `ffprobe: ${env.ffprobe || 'غير متوفر'}`,
    `spotdl: ${env.spotdl || 'غير متوفر'}`
  ].join('\n');
}

async function refreshEnv() {
  setBadge($('#env-ytdlp'), 'warn', 'جارٍ الفحص…');
  setBadge($('#env-ffmpeg'), 'warn', 'جارٍ الفحص…');
  setBadge($('#env-spotdl'), 'warn', 'جارٍ الفحص…');
  $('#env-ytdlp-version').textContent = '—';
  $('#env-ffmpeg-version').textContent = '—';
  $('#env-spotdl-version').textContent = '—';

  try {
    const env = await api.environment();
    state.env = env;
    setEnginePill(env);
    setBadge($('#env-ytdlp'), env.ok ? 'ok' : 'bad', env.ok ? 'متوفر' : 'غير متوفر');
    setBadge($('#env-ffmpeg'), env.merge ? 'ok' : 'bad', env.merge ? 'متوفر' : 'غير متوفر');
    $('#env-ytdlp-version').textContent = env.ytDlpVersion || (env.ytDlp ? 'متوفر' : 'غير متوفر');
    $('#env-ytdlp-version').title = env.ytDlp || '';
    $('#env-ffmpeg-version').textContent = ffmpegVersionLabel(env.ffmpegVersion);
    $('#env-ffmpeg-version').title = env.ffmpeg || '';
    setBadge($('#env-spotdl'), env.spotdl ? 'ok' : 'warn', env.spotdl ? t('available') : t('spotifyMissing'));
    $('#env-spotdl-version').textContent = env.spotdlVersion || (env.spotdl ? t('available') : '—');
    $('#env-spotdl-version').title = env.spotdl || '';
    // The HTML starts with an "installing" hint; always replace it with the
    // real state so the settings panel never looks stuck on "جارٍ التثبيت".
    resetInstallUi('yt-dlp', env.ok ? t('toolReady') : t('toolMissing'));
    resetInstallUi('ffmpeg', env.merge ? t('toolReady') : t('toolMissing'));
    resetInstallUi('spotdl', env.spotdl ? t('toolReady') : t('toolMissing'));
    updatePreviewNote();
    updateDownloadAvailability();
    if (state.info) renderBadges(state.info);
  } catch (error) {
    state.env = null;
    setBadge($('#env-ytdlp'), 'bad', 'خطأ');
    setBadge($('#env-ffmpeg'), 'bad', 'خطأ');
    setBadge($('#env-spotdl'), 'bad', 'خطأ');
    $('#engine-pill').className = 'engine-pill is-bad';
    $('#engine-pill-text').textContent = 'تعذّر فحص المحرّكات';
    resetInstallUi('yt-dlp', t('errorShort'));
    resetInstallUi('ffmpeg', t('errorShort'));
    resetInstallUi('spotdl', t('errorShort'));
    showToast(sanitizeError(error), 'error');
  }
}

async function refreshAppInfo() {
  try {
    const info = await api.appInfo();
    state.appInfo = info;
    $('#app-version').textContent = `v${info.version}`;
    $('#app-electron').textContent = info.electron || '—';
    $('#app-chrome').textContent = info.chrome || '—';
    $('#app-platform').textContent = `${info.platform}/${info.arch}`;
    $('#app-bindir').textContent = info.binDir || '—';
    $('#app-bindir').title = info.binDir || '';
  } catch (error) {
    showToast(sanitizeError(error), 'error');
  }
}

function renderBridge(status) {
  if (!$('#bridge-dot')) return;
  state.bridge = status;
  $('#bridge-dot').dataset.online = status && status.running ? 'true' : 'false';
  $('#bridge-status').textContent = status && status.running
    ? `يعمل على المنفذ ${status.port}`
    : 'متوقف';
  $('#bridge-port').textContent = status && status.port ? String(status.port) : '—';
}

async function refreshBridge() {
  if (!$('#bridge-dot')) return;
  try {
    renderBridge(await api.bridgeStatus());
  } catch (error) {
    renderBridge(null);
    showToast(sanitizeError(error), 'error');
  }
}

function resetInstallUi(target, message) {
  const fill = $(`#install-${target}-fill`);
  const text = $(`#install-${target}-text`);
  if (!fill || !text) return;

  fill.classList.remove('is-indeterminate');
  fill.style.width = '0%';
  if (message) text.textContent = message;
}

function setInstallUi(target, progress) {
  const fill = $(`#install-${target}-fill`);
  const text = $(`#install-${target}-text`);
  if (!fill || !text) return;

  const percent = typeof progress.percent === 'number' ? progress.percent : null;
  if (progress.phase === 'error') {
    fill.classList.remove('is-indeterminate');
    fill.style.width = '0%';
    text.textContent = progress.message || t('installFailed');
  } else if (progress.phase === 'done') {
    fill.classList.remove('is-indeterminate');
    fill.style.width = '100%';
    text.textContent = progress.message || 'تم التثبيت بنجاح.';
  } else if (progress.phase === 'download' && percent !== null) {
    fill.classList.remove('is-indeterminate');
    fill.style.width = `${Math.max(2, Math.min(100, percent))}%`;
    text.textContent = `${progress.message || 'جارٍ التنزيل…'} ${Math.round(percent)}%`;
  } else {
    fill.classList.add('is-indeterminate');
    text.textContent = progress.message || 'جارٍ التجهيز…';
  }
}

async function runInstaller(target, button) {
  if (state.installing.has(target)) return;
  state.installing.add(target);
  setButtonBusy(button, true, 'جارٍ التثبيت…');

  try {
    const result = await api.installTool(target);
    if (result && result.ok === false) {
      showToast(result.message || t('installFailed'), 'error');
    } else {
      showToast(result && result.message ? result.message : t('installDoneText'), 'success');
      await refreshEnv();
      await refreshAppInfo();
    }
  } catch (error) {
    const message = sanitizeError(error);
    showToast(message, 'error');
    const hint = $(`#install-${target}-text`);
    if (hint) hint.textContent = `${t('installFailed')} ${message}`.slice(0, 180);
  } finally {
    state.installing.delete(target);
    setButtonBusy(button, false);
    const fill = $(`#install-${target}-fill`);
    if (fill) fill.classList.remove('is-indeterminate');
  }
}

function bindInstaller() {
  $('#install-ytdlp').addEventListener('click', () => runInstaller('yt-dlp', $('#install-ytdlp')));
  $('#install-ffmpeg').addEventListener('click', () => runInstaller('ffmpeg', $('#install-ffmpeg')));
  $('#install-spotdl').addEventListener('click', () => runInstaller('spotdl', $('#install-spotdl')));
  $('#install-all').addEventListener('click', () => runInstaller('all', $('#install-all')));

  $('#update-ytdlp').addEventListener('click', async () => {
    const button = $('#update-ytdlp');
    if (state.installing.has('yt-dlp')) return;
    state.installing.add('yt-dlp');
    setButtonBusy(button, true, 'جارٍ التحديث…');
    try {
      const result = await api.updateYtDlp();
      showToast(result.message || 'تم تحديث yt-dlp.', 'success');
      await refreshEnv();
      await refreshAppInfo();
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    } finally {
      state.installing.delete('yt-dlp');
      setButtonBusy(button, false);
    }
  });

  api.onInstallProgress((progress) => {
    if (progress && (progress.target === 'yt-dlp' || progress.target === 'ffmpeg' || progress.target === 'spotdl')) {
      setInstallUi(progress.target, progress);
    }
  });
}

function applyAutoSetup(progress) {
  const banner = $('#engine-setup');
  if (!banner || !progress) return;

  const phase = String(progress.phase || '');
  const text = $('#engine-setup-text');
  const fill = $('#engine-setup-fill');
  const running = ['start', 'download', 'extract', 'install', 'searching'].includes(phase);

  if (running) {
    banner.classList.remove('is-hidden');
    banner.dataset.phase = phase;
    if (text) text.textContent = progress.message || t('preparingEngine');

    const percent = typeof progress.percent === 'number' ? Math.round(progress.percent) : null;
    if (phase === 'download' && percent !== null && percent > 0) {
      fill.classList.remove('is-indeterminate');
      fill.style.width = `${Math.max(2, Math.min(100, percent))}%`;
    } else {
      fill.classList.add('is-indeterminate');
      fill.style.width = '';
    }
    return;
  }

  if (phase === 'done' || phase === 'error') {
    banner.dataset.phase = phase;
    if (text) {
      text.textContent = phase === 'done' ? t('engineSetupDone') : (progress.message || t('engineSetupFailed'));
    }
    fill.classList.remove('is-indeterminate');
    fill.style.width = phase === 'done' ? '100%' : '0%';
    setTimeout(() => banner.classList.add('is-hidden'), phase === 'done' ? 2600 : 6000);
    refreshEnv();
  }
}

async function bindAutoSetup() {
  if (!api.onAutoSetupProgress) return;
  api.onAutoSetupProgress(applyAutoSetup);

  // The main process may have started installing before this listener existed.
  try {
    const status = await api.autoSetupStatus();
    if (status && status.phase && status.phase !== 'idle') applyAutoSetup(status);
  } catch {
    /* optional feature */
  }
}

function bindSettings() {
  $('#choose-dir').addEventListener('click', async () => {
    try {
      const dir = await api.chooseFolder();
      if (dir) $('#settings-dir').value = dir;
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    }
  });

  $('#save-settings').addEventListener('click', async () => {
    const button = $('#save-settings');
    setButtonBusy(button, true, t('saving'));

    try {
      const bridgeSettings = $('#bridge-enabled')
        ? {
          extensionBridge: $('#bridge-enabled').checked,
          autoDownloadFromExtension: $('#auto-download-extension').checked
        }
        : {};
      const saved = await api.saveSettings({
        downloadDir: $('#settings-dir').value.trim(),
        videoQuality: $('#settings-quality').value,
        audioFormat: $('#settings-audio').value,
        videoFormat: $('#settings-video-format')?.value || 'mp4',
        cookieSource: $('#settings-cookie-source').value,
        theme: $('#settings-theme').value,
        language: $('#settings-language')?.value || $('#top-language')?.value || 'ar',
        maxConcurrentDownloads: Number($('#settings-concurrent').value),
        embedMetadata: $('#settings-metadata').checked,
        downloadSubtitles: $('#settings-subtitles').checked,
        subtitleLangs: $('#settings-subtitle-lang').value,
        ...bridgeSettings,
        speedLimit: $('#settings-speed')?.value || '',
        proxy: $('#settings-proxy')?.value || '',
        filenameTemplate: $('#settings-template')?.value || '%(title).150s [%(id)s].%(ext)s',
        outputSubfolder: $('#opt-subfolder')?.checked || false,
        downloadChapters: $('#opt-chapters')?.checked || false,
        sponsorblock: $('#opt-sponsorblock')?.checked || false,
        downloadThumbnail: $('#opt-thumb-only')?.checked || false,
        playlistStart: Number($('#playlist-start')?.value || 1),
        playlistEnd: Number($('#playlist-end')?.value || 0),
        minimizeToTray: $('#minimize-tray')?.checked || false,
        autoStart: $('#auto-start')?.checked || false,
      });

      state.settings = saved;
      applyTheme(saved.theme);
      applyLanguage(saved.language);
      applySettingsToForm(saved);
      updatePreviewNote();
      await refreshBridge();
      if (api.applyAutoStart) api.applyAutoStart();
      showToast(t('saved'), 'success');
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    } finally {
      setButtonBusy(button, false);
    }
  });

  $('#settings-language')?.addEventListener('change', async (e)=>{
    applyLanguage(e.target.value);
    const top = $('#top-language'); if(top) top.value = e.target.value;
    try { state.settings = await api.saveSettings({ language: e.target.value }); } catch {}
  });
  $('#top-language')?.addEventListener('change', async (e)=>{
    const v = e.target.value;
    applyLanguage(v);
    const s = $('#settings-language'); if(s) s.value = v;
    try { state.settings = await api.saveSettings({ language: v }); } catch {}
  });
  $('#reset-settings').addEventListener('click', async () => {
    if (!window.confirm(t('resetConfirm'))) return;

    try {
      const bridgeSettings = $('#bridge-enabled')
        ? { extensionBridge: true, autoDownloadFromExtension: false }
        : {};
      const saved = await api.saveSettings({
        theme: 'system',
        videoQuality: 'best',
        audioFormat: 'mp3',
        cookieSource: 'none',
        maxConcurrentDownloads: 2,
        embedMetadata: true,
        downloadSubtitles: false,
        subtitleLangs: 'ar,en',
        ...bridgeSettings
      });

      state.settings = saved;
      applyTheme(saved.theme);
      applySettingsToForm(saved);
      await refreshBridge();
      showToast(t('resetDone'), 'success');
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    }
  });

  $('#open-downloads').addEventListener('click', () => {
    const dir = $('#settings-dir').value.trim()
      || (state.settings ? state.settings.downloadDir : '');
    if (dir) api.openPath(dir);
  });

  $('#env-refresh').addEventListener('click', async () => {
    await refreshEnv();
    await refreshAppInfo();
  });

  $('#open-userdata').addEventListener('click', () => {
    if (state.appInfo && state.appInfo.userData) api.openPath(state.appInfo.userData);
  });

  $('#open-bindir').addEventListener('click', () => {
    if (state.appInfo && state.appInfo.binDir) api.openPath(state.appInfo.binDir);
  });

  $('#bridge-enabled')?.addEventListener('change', async () => {
    try {
      state.settings = await api.saveSettings({
        extensionBridge: $('#bridge-enabled').checked
      });
      await refreshBridge();
      showToast(t('bridgeUpdated'), 'success');
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    }
  });

  $('#auto-download-extension')?.addEventListener('change', async () => {
    try {
      state.settings = await api.saveSettings({
        autoDownloadFromExtension: $('#auto-download-extension').checked
      });
      showToast(t('autoDownloadUpdated'), 'success');
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    }
  });

  $('#bridge-test')?.addEventListener('click', async () => {
    const button = $('#bridge-test');
    setButtonBusy(button, true, t('busy'));

    try {
      const result = await api.testBridge();
      if (result && result.ok) {
        showToast(t('bridgeOk'), 'success');
      } else {
        showToast((result && result.error) || t('bridgeFail'), 'error');
      }
      await refreshBridge();
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    } finally {
      setButtonBusy(button, false);
    }
  });

  $('#bridge-restart')?.addEventListener('click', async () => {
    const button = $('#bridge-restart');
    setButtonBusy(button, true, t('busy'));

    try {
      await api.restartBridge();
      await refreshBridge();
      showToast(t('bridgeRestarted'), 'success');
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    } finally {
      setButtonBusy(button, false);
    }
  });

  bindInstaller();
}

function bindDropZone() {
  const overlay = $('#drop-overlay');
  let depth = 0;

  const hasPayload = (event) => {
    const types = event.dataTransfer ? Array.from(event.dataTransfer.types || []) : [];
    return types.includes('text/uri-list') || types.includes('text/plain') || types.includes('Files');
  };

  document.addEventListener('dragenter', (event) => {
    if (!hasPayload(event)) return;
    event.preventDefault();
    depth += 1;
    overlay.classList.remove('is-hidden');
  });

  document.addEventListener('dragover', (event) => {
    if (!hasPayload(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  });

  document.addEventListener('dragleave', (event) => {
    if (!hasPayload(event)) return;
    depth = Math.max(0, depth - 1);
    if (depth === 0) overlay.classList.add('is-hidden');
  });

  document.addEventListener('drop', (event) => {
    if (!hasPayload(event)) return;
    event.preventDefault();
    depth = 0;
    overlay.classList.add('is-hidden');

    const transfer = event.dataTransfer;
    const raw = transfer.getData('text/uri-list')
      || transfer.getData('text/plain')
      || transfer.getData('URL')
      || '';

    const first = raw.split(/\r?\n/).map((line) => line.trim()).find((line) => line && !line.startsWith('#'));
    const url = normalizeDownloadUrl(first);

    if (!url) {
      showToast(t('invalidDrop'), 'error');
      return;
    }

    $('#url').value = url;
    setTab('download');
    analyze(url);
  });
}

function bindGlobalShortcuts() {
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      $('#drop-overlay').classList.add('is-hidden');
      return;
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;

    if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      setTab('download');
      setTimeout(() => {
        $('#url').focus();
        $('#url').select();
      }, 30);
    }

    if (event.key === '1') {
      event.preventDefault();
      setTab('download');
    }

    if (event.key === '2') {
      event.preventDefault();
      setTab('sites');
    }

    if (event.key === '3') {
      event.preventDefault();
      setTab('batch');
    }

    if (event.key === '4') {
      event.preventDefault();
      setTab('history');
    }

    if (event.key === '5') {
      event.preventDefault();
      setTab('favorites');
    }

    if (event.key === '6') {
      event.preventDefault();
      setTab('settings');
    }
  });
}

async function init() {
  populateLanguages();
  bindTabs();
  bindTheme();
  bindDownloader();
  bindExtensions();
  bindSettings();
  bindDropZone();
  bindGlobalShortcuts();
  bindSites();
  bindAutoSetup();

  await loadSettings();
  await loadSites();
  await loadExtensions();
  if (state.settings) {
    applyLanguage(state.settings.language || 'ar');
  }

  await Promise.all([
    refreshEnv(),
    refreshAppInfo(),
    refreshBridge()
  ]);

  updateModeUi();

  // Missing-file detection is local and cheap, but it must not block startup.
  refreshLibrary();
  state.libraryTimer = setInterval(() => {
    if ($('#tab-history')?.classList.contains('is-active')) refreshLibrary();
  }, 30000);
  window.addEventListener('beforeunload', () => clearInterval(state.libraryTimer));
}

document.addEventListener('DOMContentLoaded', init);
