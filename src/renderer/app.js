'use strict';

const api = window.honk;

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

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
  browserUrl: 'https://www.google.com',
  pendingLink: null,
  toastTimer: null,
  extensions: [],
  sites: [],
  language: 'ar',
  font: 'cairo',
  history: [],
  favorites: [],
};

const PHASE_LABEL = {
  queued: 'بالانتظار',
  playlist: 'قائمة التشغيل',
  downloading: 'تنزيل',
  merging: 'دمج',
  converting: 'تحويل',
  tagging: 'وسم',
  done: 'مكتمل'
};

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function sanitizeError(error) {
  let message = error && error.message ? error.message : String(error || '');
  message = message.replace(/^Error invoking remote method '[^']+':\s*/i, '');
  message = message.replace(/^Error:\s*/i, '');
  return message.trim() || 'حدث خطأ غير متوقع.';
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

  if (/^https?:\/\//i.test(raw)) {
    try { return new URL(raw).toString(); } catch { return null; }
  }

  if (/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(raw)) {
    try { return new URL(`https://${raw}`).toString(); } catch { return null; }
  }

  return null;
}

function toBrowserTarget(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  if (/^https?:\/\//i.test(raw)) {
    try { return new URL(raw).toString(); } catch { return null; }
  }

  if (/^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?(?:\/.*)?$/i.test(raw)) {
    return `http://${raw}`;
  }

  if (/^(?:[\w-]+\.)+[a-z]{2,}(?::\d+)?(?:\/.*)?$/i.test(raw)) {
    try { return new URL(`https://${raw}`).toString(); } catch { return null; }
  }

  return `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
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
  document.documentElement.dataset.theme = resolveTheme(theme);
}

function applyLanguage(lang) {
  const L = window.HonkLocales;
  if (!L) return;
  state.language = lang || 'ar';
  const tr = L.TRANSLATIONS[state.language] || L.TRANSLATIONS.ar;
  document.documentElement.lang = state.language;
  document.documentElement.dir = tr.dir || 'rtl';
  $$('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (tr[key]) el.textContent = tr[key];
  });
  // placeholders
  const hint = $('#url-hint'); if (hint && tr.supportsHint) hint.textContent = tr.supportsHint;
  const topLang = $('#top-language'); if (topLang) topLang.value = state.language;
  const setLang = $('#settings-language'); if (setLang) setLang.value = state.language;
  // engine pill text will be refreshed by refreshEnv
}

function applyFont(font) {
  const L = window.HonkLocales;
  state.font = font || 'cairo';
  document.documentElement.dataset.font = state.font;
  const f = L ? L.FONT_OPTIONS.find(x=>x.value===state.font) : null;
  if (f) document.documentElement.style.setProperty('--font', f.family);
  const ff = $('#font-preview');
  if (ff && f) ff.style.fontFamily = f.family;
  const sel = $('#settings-font'); if (sel) sel.value = state.font;
}

function populateLanguageAndFont() {
  const L = window.HonkLocales;
  if (!L) return;
  const mk = (sel, opts) => { if(!sel) return; sel.textContent=''; for(const o of opts){ const op=document.createElement('option'); op.value=o.value; op.textContent=o.label; sel.appendChild(op);} };
  mk($('#top-language'), L.LANGUAGE_OPTIONS);
  mk($('#settings-language'), L.LANGUAGE_OPTIONS);
  mk($('#settings-font'), L.FONT_OPTIONS);
}

function t(key){ return window.HonkLocales ? window.HonkLocales.getTranslation(state.language, key) : key; }

function setTab(name) {
  $$('.tab').forEach((tab) => {
    const active = tab.dataset.tab === name;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
  });

  $$('.tab-panel').forEach((panel) => {
    panel.classList.toggle('is-active', panel.id === `tab-${name}`);
  });

  if (name === 'browser') {
    setTimeout(updateBrowserNav, 0);
  } else if (document.title.includes(' — ')) {
    document.title = 'Honk Downloader';
  }

  if (name === 'extensions') loadExtensions();
  if (name === 'sites') loadSites();
  if (name === 'history') renderHistory();
  if (name === 'favorites') renderFavorites();
  if (name === 'settings') {
    refreshEnv();
    refreshBridge();
    refreshAppInfo();
  }
}

function iconUrlFor(site){
  const slug = (site.icon || site.name.toLowerCase().replace(/[^a-z0-9]+/g,'-')).replace(/^-+|-+$/g,'') || 'site';
  return `assets/icons/${slug}.svg`;
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
  showToast(isFav ? 'أُزيل من المفضلة' : 'أُضيف للمفضلة', 'success');
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
  $('#history-count').textContent = String(items.length);
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
    const btn = createElement('button','btn ghost compact','فتح');
    btn.type='button';
    btn.onclick=()=>{ $('#url').value=h.url; setTab('download'); analyze(h.url); };
    const del = createElement('button','btn ghost compact','حذف');
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

function renderFavorites(){
  const list = $('#fav-list'); if(!list) return;
  list.textContent='';
  const favs = state.favorites || state.settings?.favorites || [];
  $('#fav-count').textContent = String(favs.length);
  $('#fav-empty').classList.toggle('is-hidden', favs.length>0);
  for (const f of favs){
    const card = createElement('div','site-card');
    const img = createElement('img','site-icon');
    img.src = iconUrlFor(f);
    img.alt = f.name;
    img.onerror = ()=>{ img.style.display='none'; };
    const copy = createElement('div','site-copy');
    copy.append(createElement('b',null,f.name), createElement('span',null,f.category||'عام'));
    const star = createElement('button','fav-btn is-fav','★');
    star.type='button'; star.title='إزالة من المفضلة';
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
      if (sel && sel.options.length <= 11) {
        sel.innerHTML = '<option value="">كل الفئات</option>' + cats.map(c=>`<option value="${c}">${c}</option>`).join('');
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
      img.src = iconUrlFor(s);
      img.alt = s.name;
      img.loading = 'lazy';
      img.onerror = ()=>{ img.style.display='none'; };
      card.appendChild(img);
    }
    const copy = createElement('div','site-copy');
    copy.append(createElement('b', null, s.name), createElement('span', null, `${s.category}`));
    const star = createElement('button','fav-btn' + (isFavorite(s.url)?' is-fav':''), isFavorite(s.url)?'★':'☆');
    star.type='button'; star.title='مفضلة';
    star.addEventListener('click', (e)=>{ e.stopPropagation(); toggleFavorite(s); });
    card.append(copy, star);
    card.title = `${s.name} — ${s.url}`;
    card.addEventListener('click', ()=>{ $('#url').value = s.url; setTab('download'); analyze(s.url); });
    grid.appendChild(card);
  }
}

function bindSites(){
  const search = $('#sites-search'); if(search) search.addEventListener('input', renderSites);
  const cat = $('#sites-category'); if(cat) cat.addEventListener('change', renderSites);
  const add = $('#batch-add');
  if(add) add.addEventListener('click', async ()=>{
    const txt = $('#batch-input').value || '';
    const urls = txt.split(/\r?\n/).map(l=>l.trim()).filter(Boolean).map(u=>normalizeDownloadUrl(u)||u);
    if(!urls.length){ showToast('الصق روابطًا أولًا'); return; }
    for(const url of urls){
      // add as queued jobs without info? Create jobs directly
      const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
      const job = { id, url, title: url, thumbnail:null, mode: state.mode, quality: $('#quality-select')?.value || 'best', audioFormat: $('#audio-format-select')?.value || 'mp3', playlist:false, percent:0, phase:'queued', speed:null, eta:null, size:null, item:null, totalItems:null, status:'queued', error:null, finalPath:null, folder:null, el:null };
      state.jobs.set(id, job);
    }
    renderQueue();
    showToast(`تمت إضافة ${urls.length} روابط`, 'success');
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
    if (!button.dataset.originalLabel) button.dataset.originalLabel = button.textContent;
    button.disabled = true;
    button.textContent = label || 'جارٍ…';
  } else {
    button.disabled = false;
    if (button.dataset.originalLabel) {
      button.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
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
    setUrlHint('أدخل رابطًا صالحًا يبدأ بـ http:// أو https://', true);
    return null;
  }

  $('#url').value = url;
  state.busyInfo = true;
  setButtonBusy($('#analyze-btn'), true, 'جارٍ التحليل…');
  setUrlHint('جارٍ قراءة بيانات الفيديو…', false);

  try {
    const info = await api.fetchInfo(url, $('#cookie-source').value);
    state.info = info;
    state.mode = preferredMode === 'audio' ? 'audio' : 'video';
    renderPreview(info);
    setUrlHint('تم التحليل بنجاح. اختر الجودة ثم اضغط «تحميل الآن».', false);
    // History
    if (state.settings?.enableHistory) {
      addHistory({ url, title: info.title || url, thumb: info.thumbnail || null, extractor: info.extractor || null, at: Date.now() });
    }
    return info;
  } catch (error) {
    state.info = null;
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

  add('best', 'أفضل جودة');

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

  if (info.isLive) add('بث مباشر', 'live');
  if (info.isPlaylist) add(`قائمة تشغيل · ${info.playlistCount || ''}`.trim(), 'warn');
  if (info.extractor) add(info.extractor, 'info');
  if (Array.isArray(info.subtitleLangs) && info.subtitleLangs.length) {
    add(`ترجمة · ${info.subtitleLangs.length}`, 'ok');
  }
  if (info.hasVideo === false && info.hasAudio !== false) add('صوت فقط', 'info');
  if (state.env && !state.env.merge) add('FFmpeg غير متوفر', 'warn');
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

  $('#preview-title').textContent = info.title || 'فيديو بدون عنوان';
  $('#preview-title').title = info.title || '';

  const parts = [];
  if (info.uploader) parts.push(info.uploader);
  if (duration) parts.push(duration);
  if (info.extractor) parts.push(info.extractor);
  if (info.isLive) parts.push('بث مباشر');
  $('#preview-meta').textContent = parts.join(' • ') || '—';

  renderBadges(info);
  populateQualities(info);

  const defaultQuality = state.settings ? state.settings.videoQuality : 'best';
  const qualitySelect = $('#quality-select');
  if (Array.from(qualitySelect.options).some((option) => option.value === defaultQuality)) {
    qualitySelect.value = defaultQuality;
  }

  const defaultAudio = state.settings ? state.settings.audioFormat : 'mp3';
  const audioSelect = $('#audio-format-select');
  if (Array.from(audioSelect.options).some((option) => option.value === defaultAudio)) {
    audioSelect.value = defaultAudio;
  }

  $('#playlist-field').classList.toggle('is-hidden', !info.isPlaylist);
  if (!info.isPlaylist) $('#opt-playlist').checked = false;

  updateModeUi();
}

function hidePreview() {
  state.info = null;
  $('#preview').classList.add('is-hidden');
  $('#preview-empty').classList.remove('is-hidden');
}

function updateModeUi() {
  $$('#mode-toggle .seg').forEach((button) => {
    button.classList.toggle('is-active', button.dataset.mode === state.mode);
  });

  $('#quality-field').classList.toggle('is-hidden', state.mode === 'audio');
  $('#audio-format-field').classList.toggle('is-hidden', state.mode !== 'audio');

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
      notes.push('تحويل الصوت معطّل لأن FFmpeg غير متوفر. ثبّته من الإعدادات.');
    } else {
      notes.push('FFmpeg غير متوفر؛ سيتم تنزيل أفضل صيغة مدمجة بدل دمج الفيديو والصوت.');
    }
  }

  if (state.info.isLive) notes.push('هذا بث مباشر، وقد لا يكتمل التحميل.');
  if (state.info.isPlaylist) notes.push('هذا رابط قائمة تشغيل؛ فعّل الخيار لتحميل كل العناصر.');

  const heights = Array.isArray(state.info.heights) ? state.info.heights : [];
  if (heights.length) {
    notes.push(`الجودات المتاحة: ${heights.slice(0, 7).map((height) => `${height}p`).join('، ')}`);
  }

  $('#preview-note').textContent = notes.join(' ');
}

/* ---------- Downloads ---------- */

async function startDownload() {
  if (!state.info) {
    showToast('حلّل رابطًا أولًا.');
    return;
  }

  if (state.mode === 'audio' && state.env && !state.env.merge) {
    showToast('تحويل الصوت يتطلب FFmpeg. ثبّته من الإعدادات.', 'error');
    return;
  }

  const id = crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  const job = {
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
  };

  state.jobs.set(id, job);
  renderQueue();

  try {
    const result = await api.startDownload({
      id,
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
    });

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

  const openBtn = createElement('button', 'queue-action', 'فتح');
  openBtn.type = 'button';
  openBtn.dataset.action = 'open';
  openBtn.classList.add('is-hidden');
  openBtn.addEventListener('click', () => {
    if (job.finalPath) api.openPath(job.finalPath);
  });

  const folderBtn = createElement('button', 'queue-action', 'المجلد');
  folderBtn.type = 'button';
  folderBtn.dataset.action = 'folder';
  folderBtn.addEventListener('click', () => openJobFolder(job));

  const pauseBtn = createElement('button', 'queue-action', '⏸ إيقاف');
  pauseBtn.type = 'button';
  pauseBtn.dataset.action = 'pause';
  pauseBtn.addEventListener('click', async () => {
    if (job.status === 'running' && !job.paused) { await api.pauseDownload(job.id); job.paused = true; pauseBtn.textContent = '▶ استئناف'; job.status = 'paused'; updateJobCard(job); }
    else if (job.paused) { await api.resumeDownload(job.id); job.paused = false; pauseBtn.textContent = '⏸ إيقاف'; job.status = 'running'; updateJobCard(job); }
  });

  const retryBtn = createElement('button', 'queue-action', '↻ إعادة');
  retryBtn.type = 'button';
  retryBtn.dataset.action = 'retry';
  retryBtn.classList.add('is-hidden');
  retryBtn.addEventListener('click', () => startDownload());

  const cancelBtn = createElement('button', 'queue-action', 'إلغاء');
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

  if (job.status === 'queued') {
    badgeText = 'بالانتظار';
    refs.meta.textContent = 'في الانتظار…';
  } else if (job.status === 'running') {
    if (job.phase === 'merging' || job.phase === 'converting' || job.phase === 'tagging') {
      badgeText = PHASE_LABEL[job.phase] || 'معالجة';
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
    if (job.eta) metaParts.push(`متبقي ${job.eta}`);
    refs.meta.textContent = metaParts.join(' • ') || 'جارٍ التحميل…';
  } else if (job.status === 'done') {
    badgeText = 'مكتمل';
    refs.meta.textContent = job.finalPath || 'تم حفظ الملف.';
    refs.meta.title = job.finalPath || '';
  } else if (job.status === 'cancelled') {
    badgeText = 'ملغى';
    refs.meta.textContent = 'تم إلغاء التحميل.';
  } else if (job.status === 'error') {
    badgeText = 'خطأ';
    refs.meta.textContent = job.error || 'فشل التحميل.';
    refs.meta.title = job.error || '';
  } else if (job.status === 'paused') {
    badgeText = 'متوقف';
    refs.meta.textContent = 'إيقاف مؤقت — اضغط استئناف';
    refs.meta.title = '';
  }

  refs.badge.textContent = badgeText;

  const percent = job.status === 'done' ? 100 : Math.max(0, Math.min(100, job.percent || 0));
  refs.fill.classList.toggle('is-indeterminate', indeterminate);
  if (!indeterminate) refs.fill.style.width = `${percent}%`;

  const detailParts = [];
  if (job.status === 'running' && job.phase) {
    detailParts.push(PHASE_LABEL[job.phase] || job.phase);
  }
  if (job.playlist) detailParts.push('قائمة');
  if (job.mode === 'audio') detailParts.push('صوت');
  refs.detail.textContent = detailParts.join(' • ') || (job.status === 'queued' ? 'بانتظار الدور' : '');
  refs.detail.title = job.error || '';

  refs.openBtn.classList.toggle('is-hidden', job.status !== 'done' || !job.finalPath);
  refs.openBtn.disabled = !job.finalPath;
  refs.cancelBtn.classList.toggle('is-hidden', job.status !== 'running' && job.status !== 'queued' && job.status !== 'paused');
  if (refs.pauseBtn) {
    refs.pauseBtn.classList.toggle('is-hidden', job.status !== 'running' && job.status !== 'paused');
    refs.pauseBtn.textContent = job.paused ? '▶ استئناف' : '⏸ إيقاف';
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
  showToast(`اكتمل التحميل: ${job.title}`, 'success');
}

function handleError(payload) {
  const job = state.jobs.get(payload.id);
  if (!job) return;

  job.status = 'error';
  job.error = payload.message || 'فشل التحميل.';
  updateJobCard(job);
  showToast(job.error, 'error');
}

function handleCancelled(payload) {
  const job = state.jobs.get(payload.id);
  if (!job) return;

  job.status = 'cancelled';
  updateJobCard(job);
}

/* ---------- Browser ---------- */

let browserView = null;

function currentBrowserUrl() {
  if (!browserView) return state.browserUrl;
  try {
    return browserView.getURL() || state.browserUrl;
  } catch {
    return state.browserUrl;
  }
}

function setAddress(url) {
  state.browserUrl = url || state.browserUrl;
  const address = $('#address');
  if (document.activeElement !== address) address.value = state.browserUrl;
}

function updateBrowserNav() {
  if (!browserView) return;

  try {
    $('#nav-back').disabled = !browserView.canGoBack();
    $('#nav-forward').disabled = !browserView.canGoForward();
  } catch {
    $('#nav-back').disabled = true;
    $('#nav-forward').disabled = true;
  }
}

function navigateBrowser(url) {
  if (!browserView) return;

  try {
    if (browserView.getURL() === url) {
      browserView.reload();
      return;
    }
  } catch {
    /* webview not ready yet */
  }

  browserView.src = url;
}

function loadInBrowser(target) {
  const url = toBrowserTarget(target);
  if (!url) return;

  setTab('browser');
  setAddress(url);
  navigateBrowser(url);
}

function showLinkChip(link) {
  if (!link || !link.url) return;
  state.pendingLink = link;
  $('#link-chip-title').textContent = link.text || 'رابط محدد';
  $('#link-chip-url').textContent = link.url;
  $('#link-chip-url').title = link.url;
  $('#link-chip').classList.remove('is-hidden');
}

function hideLinkChip() {
  state.pendingLink = null;
  $('#link-chip').classList.add('is-hidden');
}

function startBrowserLoading() {
  const bar = $('#browser-loading-bar');
  bar.style.opacity = '1';
  bar.style.width = '28%';
}

function finishBrowserLoading() {
  const bar = $('#browser-loading-bar');
  bar.style.width = '100%';
  setTimeout(() => {
    bar.style.opacity = '0';
    setTimeout(() => {
      bar.style.width = '0';
    }, 220);
  }, 180);
}

/* ---------- Extensions ---------- */

async function loadExtensions() {
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
  container.textContent = '';

  const items = state.extensions;
  $('#extensions-count').textContent = String(items.length);
  $('#extensions-empty').classList.toggle('is-hidden', items.length > 0);

  items.forEach((ext) => {
    const item = createElement('div', 'extension-item');
    const copy = createElement('div', 'extension-copy');

    const title = createElement('strong', null, ext.name || ext.folder || 'إضافة');
    copy.appendChild(title);

    const metaParts = [];
    if (ext.version && ext.version !== '—') metaParts.push(`v${ext.version}`);
    if (ext.id) metaParts.push(ext.id);
    copy.appendChild(createElement('span', 'hint', metaParts.join(' • ') || '—'));

    if (ext.folder) copy.appendChild(createElement('span', 'hint', ext.folder));
    if (ext.error) copy.appendChild(createElement('span', 'hint is-error', ext.error));

    const actions = createElement('div', 'extension-actions');
    actions.appendChild(createElement(
      'span',
      `badge ${ext.loaded ? 'badge-ok' : 'badge-warn'}`,
      ext.loaded ? 'مثبتة' : 'تعذّر التحميل'
    ));

    const reload = createElement('button', 'btn ghost compact', 'إعادة تحميل');
    reload.type = 'button';
    reload.addEventListener('click', async () => {
      setButtonBusy(reload, true, 'جارٍ…');
      try {
        await api.reloadExtension({ id: ext.id, folder: ext.folder });
        await loadExtensions();
        showToast('تمت إعادة تحميل الإضافة.', 'success');
      } catch (error) {
        showToast(sanitizeError(error), 'error');
      } finally {
        setButtonBusy(reload, false);
      }
    });

    const remove = createElement('button', 'btn ghost compact', 'إزالة');
    remove.type = 'button';
    remove.addEventListener('click', async () => {
      const label = ext.name || ext.folder || 'الإضافة';
      if (!window.confirm(`إزالة «${label}»؟`)) return;

      setButtonBusy(remove, true, 'جارٍ…');
      try {
        await api.removeExtension({ id: ext.id, folder: ext.folder });
        await loadExtensions();
        showToast('تمت إزالة الإضافة.', 'success');
      } catch (error) {
        showToast(sanitizeError(error), 'error');
      } finally {
        setButtonBusy(remove, false);
      }
    });

    actions.append(reload, remove);
    item.append(copy, actions);
    container.appendChild(item);
  });
}

/* ---------- Settings / env / bridge ---------- */

function setCookieSource(source) {
  const value = source || 'none';

  [$('#cookie-source'), $('#settings-cookie-source')].forEach((select) => {
    if (Array.from(select.options).some((option) => option.value === value)) {
      select.value = value;
    }
  });
}

function applySettingsToForm(settings) {
  $('#settings-dir').value = settings.downloadDir;
  $('#settings-quality').value = settings.videoQuality;
  $('#settings-audio').value = settings.audioFormat;
  $('#settings-home').value = settings.browserHome;
  $('#settings-theme').value = settings.theme || 'system';
  $('#settings-concurrent').value = String(settings.maxConcurrentDownloads || 2);
  $('#settings-metadata').checked = settings.embedMetadata !== false;
  $('#settings-subtitles').checked = Boolean(settings.downloadSubtitles);
  $('#settings-subtitle-lang').value = settings.subtitleLangs || 'ar,en';
  $('#bridge-enabled').checked = settings.extensionBridge !== false;
  $('#auto-download-extension').checked = Boolean(settings.autoDownloadFromExtension);
  // new
  const $id = (s)=>document.getElementById(s);
  if ($id('settings-language')) $id('settings-language').value = settings.language || 'ar';
  if ($id('settings-font')) $id('settings-font').value = settings.font || 'cairo';
  if ($id('settings-video-format')) $id('settings-video-format').value = settings.videoFormat || 'mp4';
  if ($id('settings-speed')) $id('settings-speed').value = settings.speedLimit || '';
  if ($id('settings-proxy')) $id('settings-proxy').value = settings.proxy || '';
  if ($id('settings-template')) $id('settings-template').value = settings.filenameTemplate || '';
  if ($id('playlist-start')) $id('playlist-start').value = settings.playlistStart || 1;
  if ($id('playlist-end')) $id('playlist-end').value = settings.playlistEnd || 0;
  if ($id('opt-chapters')) $id('opt-chapters').checked = Boolean(settings.downloadChapters);
  if ($id('opt-sponsorblock')) $id('opt-sponsorblock').checked = Boolean(settings.sponsorblock);
  if ($id('opt-subfolder')) $id('opt-subfolder').checked = Boolean(settings.outputSubfolder);
  if ($id('opt-thumb-only')) $id('opt-thumb-only').checked = Boolean(settings.downloadThumbnail);
  if ($id('minimize-tray')) $id('minimize-tray').checked = Boolean(settings.minimizeToTray);
  if ($id('auto-start')) $id('auto-start').checked = Boolean(settings.autoStart);
  applyLanguage(settings.language || 'ar');
  applyFont(settings.font || 'cairo');
  setCookieSource(settings.cookieSource);

  if (!state.info) {
    $('#opt-metadata').checked = settings.embedMetadata !== false;
    $('#opt-subtitles').checked = Boolean(settings.downloadSubtitles);
    $('#subtitle-lang').value = settings.subtitleLangs || 'ar,en';
    $('#subtitle-lang-field').classList.toggle('is-hidden', !settings.downloadSubtitles);
  }

  if (state.info) {
    const qualitySelect = $('#quality-select');
    if (Array.from(qualitySelect.options).some((option) => option.value === settings.videoQuality)) {
      qualitySelect.value = settings.videoQuality;
    }

    const audioSelect = $('#audio-format-select');
    if (Array.from(audioSelect.options).some((option) => option.value === settings.audioFormat)) {
      audioSelect.value = settings.audioFormat;
    }
  }
}

async function loadSettings() {
  try {
    state.settings = await api.getSettings();
    applyTheme(state.settings.theme);
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
    `ffprobe: ${env.ffprobe || 'غير متوفر'}`
  ].join('\n');
}

async function refreshEnv() {
  setBadge($('#env-ytdlp'), 'warn', 'جارٍ الفحص…');
  setBadge($('#env-ffmpeg'), 'warn', 'جارٍ الفحص…');
  $('#env-ytdlp-version').textContent = '—';
  $('#env-ffmpeg-version').textContent = '—';

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

    updatePreviewNote();
    updateDownloadAvailability();

    if (state.info) renderBadges(state.info);
  } catch (error) {
    setBadge($('#env-ytdlp'), 'bad', 'خطأ');
    setBadge($('#env-ffmpeg'), 'bad', 'خطأ');
    $('#engine-pill').className = 'engine-pill is-bad';
    $('#engine-pill-text').textContent = 'تعذّر فحص المحرّكات';
    showToast(sanitizeError(error), 'error');
  }
}

async function refreshCookieCount() {
  const badge = $('#env-cookies');
  try {
    const count = await api.cookieCount();
    if (count > 0) {
      setBadge(badge, 'ok', `${count} كوكي`);
    } else {
      setBadge(badge, null, 'لا توجد كوكيز');
    }
  } catch {
    setBadge(badge, null, '—');
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
  state.bridge = status;

  const dot = $('#bridge-dot');
  dot.dataset.online = status && status.running ? 'true' : 'false';

  const label = $('#bridge-status');
  const port = $('#bridge-port');

  if (!status) {
    label.textContent = 'تعذّر قراءة حالة الجسر.';
  } else if (!status.enabled) {
    label.textContent = 'جسر الإضافة معطّل من الإعدادات.';
  } else if (status.running) {
    label.textContent = `الجسر يعمل على 127.0.0.1:${status.port}`;
  } else {
    label.textContent = status.error || 'الجسر متوقف. اضغط «إعادة التشغيل».';
  }

  port.textContent = status && status.port ? String(status.port) : '—';
}

async function refreshBridge() {
  try {
    const status = await api.bridgeStatus();
    renderBridge(status);
  } catch (error) {
    renderBridge(null);
    showToast(sanitizeError(error), 'error');
  }
}

/* ---------- Installer ---------- */

function setInstallUi(target, progress) {
  const fill = $(`#install-${target}-fill`);
  const text = $(`#install-${target}-text`);
  if (!fill || !text) return;

  const phase = progress.phase;
  const percent = typeof progress.percent === 'number' ? progress.percent : null;

  if (phase === 'done') {
    fill.classList.remove('is-indeterminate');
    fill.style.width = '100%';
    text.textContent = progress.message || 'تم التثبيت بنجاح.';
    return;
  }

  if (phase === 'download' && percent !== null) {
    fill.classList.remove('is-indeterminate');
    fill.style.width = `${Math.max(2, Math.min(100, percent))}%`;
    text.textContent = progress.message
      ? `${progress.message} ${Math.round(percent)}%`
      : `جارٍ التنزيل… ${Math.round(percent)}%`;
    return;
  }

  fill.classList.add('is-indeterminate');
  text.textContent = progress.message || 'جارٍ التجهيز…';
}

async function runInstaller(target, button) {
  if (state.installing.has(target)) return;

  state.installing.add(target);
  setButtonBusy(button, true, 'جارٍ التثبيت…');

  try {
    const result = await api.installTool(target);
    if (result && result.skipped) {
      showToast(result.message || 'كل المكتبات مثبّتة بالفعل.');
    } else {
      showToast('تم تثبيت المكتبات المطلوبة.', 'success');
    }

    await refreshEnv();
    await refreshAppInfo();
  } catch (error) {
    showToast(sanitizeError(error), 'error');
  } finally {
    state.installing.delete(target);
    setButtonBusy(button, false);
  }
}

function bindInstaller() {
  $('#install-ytdlp').addEventListener('click', () => runInstaller('yt-dlp', $('#install-ytdlp')));
  $('#install-ffmpeg').addEventListener('click', () => runInstaller('ffmpeg', $('#install-ffmpeg')));
  $('#install-all').addEventListener('click', () => runInstaller('all', $('#install-all')));

  $('#update-ytdlp').addEventListener('click', async () => {
    const button = $('#update-ytdlp');
    if (state.installing.has('yt-dlp')) return;

    state.installing.add('yt-dlp');
    setButtonBusy(button, true, 'جارٍ التحديث…');

    try {
      const result = await api.updateYtDlp();
      showToast(result && result.message ? result.message : 'تم تحديث yt-dlp.', 'success');
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
    const target = progress && progress.target;
    if (target === 'yt-dlp' || target === 'ffmpeg') setInstallUi(target, progress);
  });
}

/* ---------- Incoming extension payloads ---------- */

async function handleIncoming(payload) {
  if (!payload || !payload.url || state.incomingBusy) return;

  state.incomingBusy = true;

  try {
    $('#url').value = payload.url;
    setTab('download');
    setUrlHint(
      payload.title
        ? `رابط مستلم من الإضافة: ${payload.title}`
        : 'تم استلام رابط من الإضافة.',
      false
    );
    showToast('تم استلام رابط من الإضافة.', 'success');

    const info = await analyze(payload.url, payload.mode === 'audio' ? 'audio' : 'video');

    if (info && payload.autoDownload) {
      if (state.mode === 'audio' && state.env && !state.env.merge) {
        showToast('الرابط صوتي وFFmpeg غير متوفر؛ لم يبدأ التحميل تلقائيًا.', 'error');
      } else {
        await startDownload();
      }
    }
  } finally {
    state.incomingBusy = false;
  }
}

/* ---------- Binders ---------- */

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

  if (window.matchMedia) {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => {
      if (!state.settings || state.settings.theme === 'system') applyTheme('system');
    };

    if (media.addEventListener) media.addEventListener('change', onChange);
    else if (media.addListener) media.addListener(onChange);
  }
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
        showToast('الحافظة فارغة.');
        return;
      }

      $('#url').value = text;
      const url = normalizeDownloadUrl(text);
      if (url) analyze(url);
      else setUrlHint('تم اللصق، لكن النص لا يبدو رابطًا صالحًا.', true);
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    }
  });

  $('#open-in-browser').addEventListener('click', () => {
    const url = normalizeDownloadUrl($('#url').value);
    if (!url) {
      setUrlHint('أدخل رابطًا صالحًا أولًا.', true);
      return;
    }
    loadInBrowser(url);
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
    if (!state.info) return;
    loadInBrowser(state.info.webpageUrl || $('#url').value);
  });

  $('#preview-copy').addEventListener('click', async () => {
    const target = (state.info && state.info.webpageUrl) || $('#url').value;
    if (!target) return;

    try {
      await api.writeClipboard(target);
      showToast('تم نسخ الرابط.', 'success');
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    }
  });

  $('#clear-completed').addEventListener('click', () => {
    for (const [id, job] of state.jobs) {
      if (job.status === 'done' || job.status === 'cancelled' || job.status === 'error') {
        state.jobs.delete(id);
      }
    }
    renderQueue();
  });

  api.onProgress(handleProgress);
  api.onDone(handleDone);
  api.onError(handleError);
  api.onCancelled(handleCancelled);
  api.onExtensionReceived(handleIncoming);
}

function bindBrowser() {
  browserView = $('#browser-view');

  $('#nav-back').addEventListener('click', () => {
    try { browserView.goBack(); } catch { /* ignore */ }
  });

  $('#nav-forward').addEventListener('click', () => {
    try { browserView.goForward(); } catch { /* ignore */ }
  });

  $('#nav-reload').addEventListener('click', () => {
    try { browserView.reload(); } catch { /* ignore */ }
  });

  $('#nav-home').addEventListener('click', () => {
    const home = state.settings ? state.settings.browserHome : 'https://www.youtube.com';
    loadInBrowser(home);
  });

  $('#address-form').addEventListener('submit', (event) => {
    event.preventDefault();
    const target = toBrowserTarget($('#address').value);
    if (!target) return;
    setAddress(target);
    navigateBrowser(target);
  });

  $('#address').addEventListener('focus', () => $('#address').select());

  $('#page-download').addEventListener('click', () => {
    const url = currentBrowserUrl();
    if (!url || !/^https?:\/\//i.test(url)) {
      showToast('لا توجد صفحة صالحة لتحميلها.', 'error');
      return;
    }

    $('#url').value = url;
    setTab('download');
    analyze(url);
  });

  $('#browser-open-external').addEventListener('click', () => {
    const url = currentBrowserUrl();
    if (/^https?:\/\//i.test(url)) api.openExternal(url);
  });

  browserView.addEventListener('did-navigate', (event) => {
    setAddress(event.url);
    updateBrowserNav();
  });

  browserView.addEventListener('did-navigate-in-page', (event) => {
    if (event.isMainFrame) setAddress(event.url);
    updateBrowserNav();
  });

  browserView.addEventListener('dom-ready', () => {
    setAddress(currentBrowserUrl());
    updateBrowserNav();
  });

  browserView.addEventListener('did-start-loading', startBrowserLoading);
  browserView.addEventListener('did-stop-loading', () => {
    finishBrowserLoading();
    updateBrowserNav();
  });

  browserView.addEventListener('page-title-updated', (event) => {
    const browserActive = $('#tab-browser').classList.contains('is-active');
    if (browserActive) {
      document.title = event.title ? `${event.title} — Honk Downloader` : 'Honk Downloader';
    }
  });

  browserView.addEventListener('did-fail-load', (event) => {
    if (event.errorCode === -3 || event.isMainFrame === false) return;
    finishBrowserLoading();
    showToast(`تعذّر فتح الصفحة: ${event.errorDescription || event.errorCode}`, 'error');
  });

  $('#link-chip-download').addEventListener('click', () => {
    if (!state.pendingLink) return;
    const url = state.pendingLink.url;
    hideLinkChip();
    $('#url').value = url;
    setTab('download');
    analyze(url);
  });

  $('#link-chip-open').addEventListener('click', () => {
    if (!state.pendingLink) return;
    const url = state.pendingLink.url;
    hideLinkChip();
    loadInBrowser(url);
  });

  $('#link-chip-close').addEventListener('click', hideLinkChip);

  api.onBrowserOpenUrl((url) => loadInBrowser(url));
  api.onBrowserLink((link) => showLinkChip(link));
}

function bindExtensions() {
  const installers = [
    ['#add-extension-folder', () => api.addExtensionFolder(), 'تم تثبيت الإضافة.'],
    ['#add-extension-archive', () => api.addExtensionArchive(), 'تم تثبيت الإضافة.'],
    ['#install-bundled-extension', () => api.installBundledExtension(), 'تم تثبيت الإضافة المدمجة.']
  ];

  installers.forEach(([selector, task, successMessage]) => {
    const button = $(selector);
    button.addEventListener('click', async () => {
      setButtonBusy(button, true, 'جارٍ التثبيت…');

      try {
        const result = await task();
        if (result === null || result === undefined) return;
        await loadExtensions();
        showToast(successMessage, 'success');
      } catch (error) {
        showToast(sanitizeError(error), 'error');
      } finally {
        setButtonBusy(button, false);
      }
    });
  });

  $('#refresh-extensions').addEventListener('click', () => loadExtensions());
  $('#open-extensions-folder').addEventListener('click', () => api.openExtensionsFolder());
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
    setButtonBusy(button, true, 'جارٍ الحفظ…');

    try {
      const saved = await api.saveSettings({
        downloadDir: $('#settings-dir').value.trim(),
        videoQuality: $('#settings-quality').value,
        audioFormat: $('#settings-audio').value,
        videoFormat: $('#settings-video-format')?.value || 'mp4',
        browserHome: $('#settings-home').value.trim(),
        cookieSource: $('#settings-cookie-source').value,
        theme: $('#settings-theme').value,
        language: $('#settings-language')?.value || $('#top-language')?.value || 'ar',
        font: $('#settings-font')?.value || 'cairo',
        maxConcurrentDownloads: Number($('#settings-concurrent').value),
        embedMetadata: $('#settings-metadata').checked,
        downloadSubtitles: $('#settings-subtitles').checked,
        subtitleLangs: $('#settings-subtitle-lang').value,
        extensionBridge: $('#bridge-enabled').checked,
        autoDownloadFromExtension: $('#auto-download-extension').checked,
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
      applyFont(saved.font);
      applySettingsToForm(saved);
      updatePreviewNote();
      await refreshBridge();
      if (api.applyAutoStart) api.applyAutoStart();
      showToast('تم حفظ الإعدادات.', 'success');
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
  $('#settings-font')?.addEventListener('change', async (e)=>{
    applyFont(e.target.value);
    try { state.settings = await api.saveSettings({ font: e.target.value }); } catch {}
    if (api.notify) api.notify('Font', e.target.value);
  });

  $('#reset-settings').addEventListener('click', async () => {
    if (!window.confirm('إعادة الإعدادات الافتراضية (سيُبقى مجلد التحميل الحالي)؟')) return;

    try {
      const saved = await api.saveSettings({
        theme: 'system',
        videoQuality: 'best',
        audioFormat: 'mp3',
        browserHome: 'https://www.youtube.com',
        cookieSource: 'none',
        maxConcurrentDownloads: 2,
        embedMetadata: true,
        downloadSubtitles: false,
        subtitleLangs: 'ar,en',
        extensionBridge: true,
        autoDownloadFromExtension: false
      });

      state.settings = saved;
      applyTheme(saved.theme);
      applySettingsToForm(saved);
      await refreshBridge();
      showToast('تمت إعادة الإعدادات الافتراضية.', 'success');
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
    await refreshCookieCount();
    await refreshAppInfo();
  });

  $('#open-userdata').addEventListener('click', () => {
    if (state.appInfo && state.appInfo.userData) api.openPath(state.appInfo.userData);
  });

  $('#open-bindir').addEventListener('click', () => {
    if (state.appInfo && state.appInfo.binDir) api.openPath(state.appInfo.binDir);
  });

  $('#bridge-enabled').addEventListener('change', async () => {
    try {
      state.settings = await api.saveSettings({
        extensionBridge: $('#bridge-enabled').checked
      });
      await refreshBridge();
      showToast('تم تحديث حالة جسر الإضافة.', 'success');
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    }
  });

  $('#auto-download-extension').addEventListener('change', async () => {
    try {
      state.settings = await api.saveSettings({
        autoDownloadFromExtension: $('#auto-download-extension').checked
      });
      showToast('تم تحديث خيار التحميل التلقائي.', 'success');
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    }
  });

  $('#bridge-test').addEventListener('click', async () => {
    const button = $('#bridge-test');
    setButtonBusy(button, true, 'جارٍ…');

    try {
      const result = await api.testBridge();
      if (result && result.ok) {
        showToast('الجسر يعمل بشكل سليم.', 'success');
      } else {
        showToast((result && result.error) || 'تعذّر الاتصال بالجسر.', 'error');
      }
      await refreshBridge();
    } catch (error) {
      showToast(sanitizeError(error), 'error');
    } finally {
      setButtonBusy(button, false);
    }
  });

  $('#bridge-restart').addEventListener('click', async () => {
    const button = $('#bridge-restart');
    setButtonBusy(button, true, 'جارٍ…');

    try {
      await api.restartBridge();
      await refreshBridge();
      showToast('تمت إعادة تشغيل الجسر.', 'success');
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
      showToast('لم يُعثر على رابط صالح في العنصر المُسقط.', 'error');
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
      hideLinkChip();
      $('#drop-overlay').classList.add('is-hidden');
      return;
    }

    const modifier = event.ctrlKey || event.metaKey;
    if (!modifier) return;

    if (event.key.toLowerCase() === 'l') {
      event.preventDefault();
      setTab('browser');
      setTimeout(() => {
        $('#address').focus();
        $('#address').select();
      }, 30);
    }

    if (event.key === '1') {
      event.preventDefault();
      setTab('download');
    }

    if (event.key === '2') {
      event.preventDefault();
      setTab('browser');
    }

    if (event.key === '3') {
      event.preventDefault();
      setTab('extensions');
    }

    if (event.key === '4') {
      event.preventDefault();
      setTab('settings');
    }
  });
}

async function init() {
  populateLanguageAndFont();
  bindTabs();
  bindTheme();
  bindDownloader();
  bindBrowser();
  bindExtensions();
  bindSettings();
  bindDropZone();
  bindGlobalShortcuts();
  bindSites();

  await loadSettings();
  if (state.settings) {
    applyLanguage(state.settings.language || 'ar');
    applyFont(state.settings.font || 'cairo');
  }

  await Promise.all([
    refreshEnv(),
    refreshCookieCount(),
    refreshAppInfo(),
    refreshBridge()
  ]);

  updateModeUi();
  updateBrowserNav();

  if (state.settings) {
    setAddress(currentBrowserUrl());
  }
}

document.addEventListener('DOMContentLoaded', init);
