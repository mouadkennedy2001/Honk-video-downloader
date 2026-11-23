/* Generates the static HTML pages of the Wasel website.
   Run: node build-pages.js   (from the website folder) */
const fs = require('fs');
const path = require('path');

const NAV = [
  ['navHome', 'index.html', 'الرئيسية'],
  ['navDownload', 'download.html', 'التحميل'],
  ['navFeatures', 'features.html', 'المزايا'],
  ['navPlatforms', 'platforms.html', 'المنصات'],
  ['navFiles', 'files.html', 'الملفات'],
  ['navReleases', 'releases.html', 'الإصدارات'],
  ['navFaq', 'faq.html', 'الأسئلة'],
  ['navDeveloper', 'developer.html', 'المطوّر']
];

const SITE_LOGO_NAMES = ['youtube', 'instagram', 'tiktok', 'facebook', 'x', 'vimeo', 'soundcloud', 'dailymotion', 'reddit', 'telegram', 'twitch', 'spotify'];
const SITE_LABELS = { youtube: 'YouTube', instagram: 'Instagram', tiktok: 'TikTok', facebook: 'Facebook', x: 'X', vimeo: 'Vimeo', soundcloud: 'SoundCloud', dailymotion: 'Dailymotion', reddit: 'Reddit', telegram: 'Telegram', twitch: 'Twitch', spotify: 'Spotify' };

function head(title, desc, titleKey) {
  return `<!DOCTYPE html>
<html lang="ar" dir="rtl" data-page-title="${titleKey}">
<head>
  <meta charset="UTF-8">
  <script>document.documentElement.classList.add('js')</script>
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="theme-color" content="#3584e4">
  <meta name="description" content="${desc}">
  <meta property="og:title" content="واصل | Wasel Downloader">
  <meta property="og:description" content="${desc}">
  <meta property="og:image" content="assets/app-screenshot.png">
  <meta property="og:type" content="website">
  <title>${title}</title>
  <link rel="icon" type="image/svg+xml" href="assets/favicon.svg">
  <link rel="preload" href="assets/fonts/cairo-subset.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="styles.css">
  <script src="app.js" defer></script>
</head>
<body>
  <div class="bg-orbs" aria-hidden="true"><i></i><i></i><i></i></div>
  <a class="skip-link" href="#main" data-i18n="skipLink">تخطَّ إلى المحتوى</a>`;
}

function header() {
  return `
  <header class="topbar" id="top">
    <div class="topbar-inner shell">
      <a class="brand" href="index.html" aria-label="Wasel">
        <img class="brand-mark" src="assets/favicon.svg" alt="" width="38" height="38">
        <span class="brand-text">
          <strong data-i18n="brandName">واصل</strong>
          <small data-i18n="brandTag">محمّل الفيديو</small>
        </span>
      </a>
      <nav class="nav" id="mainNav" aria-label="Main navigation">
        ${NAV.map(([k, h, l]) => `<a href="${h}" data-i18n="${k}">${l}</a>`).join('\n        ')}
      </nav>
      <div class="topbar-actions">
        <a class="icon-btn star-btn" href="https://github.com/mouadkennedy2001/Honk-video-downloader/stargazers" target="_blank" rel="noopener" data-i18n-title="starTitle" aria-label="GitHub stars">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9L12 2.8Z"/></svg>
          <span id="starCount">1</span>
        </a>
        <button class="icon-btn lang-btn" id="langBtn" type="button" data-i18n-title="langTitle" aria-label="Switch language"><span id="langLabel">EN</span></button>
        <button class="icon-btn theme-btn" id="themeBtn" type="button" data-i18n-title="themeTitle" aria-label="Change theme"></button>
        <button class="icon-btn menu-btn" id="menuBtn" type="button" data-i18n-title="menuTitle" aria-label="Open menu" aria-expanded="false" aria-controls="mainNav">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16"/></svg>
        </button>
      </div>
    </div>
  </header>

  <main id="main">`;
}

function footer() {
  return `  </main>

  <footer class="footer">
    <div class="shell footer-inner">
      <div class="footer-brand">
        <img src="assets/favicon.svg" alt="" width="32" height="32">
        <span><strong data-i18n="brandName">واصل</strong> — <span data-i18n="footerDesc">حمّل بحرية، بأناقة.</span></span>
      </div>
      <div class="footer-links">
        <a href="index.html" data-i18n="navHome">الرئيسية</a>
        <a href="files.html" data-i18n="navFiles">الملفات</a>
        <a href="releases.html" data-i18n="navReleases">الإصدارات</a>
        <a href="faq.html" data-i18n="navFaq">الأسئلة</a>
        <a href="developer.html" data-i18n="navDeveloper">المطوّر</a>
      </div>
      <p class="footer-note"><span data-i18n="footerBy">بالمطوّر</span> <b data-i18n="devName">زروقي احمد معاذ</b> · <span data-i18n="footerMade">صُمّم بأسلوب GNOME Adwaita</span> · <span data-i18n="license">رخصة MIT</span> · © <span id="year">2026</span></p>
    </div>
  </footer>

  <div class="toast" id="toast" role="status" aria-live="polite"></div>
</body>
</html>
`;
}

function pageHead(kicker, title, desc) {
  return `    <section class="section page-head shell">
      <div class="section-head reveal">
        <span class="kicker" data-i18n="${kicker}">${kicker}</span>
        <h1 data-i18n="${title}">${title}</h1>
        <p data-i18n="${desc}">${desc}</p>
      </div>
    </section>`;
}

const HERO = `    <section class="hero shell" id="download">
      <div class="hero-copy reveal">
        <div class="eyebrow"><span class="eyebrow-dot"></span><span data-i18n="heroEyebrow">مفتوح المصدر · مجاني تمامًا · بلا إعلانات</span></div>
        <h1><span data-i18n="heroTitle1">حمّل الفيديو والصوت</span><br><span class="accent" data-i18n="heroTitle2">بطريقة أنيقة</span></h1>
        <p class="hero-desc" data-i18n="heroDesc">واصل تطبيق خفيف وسريع لتحميل الفيديو والصوت من أكثر من ألف موقع، بواجهة عربية نظيفة مستوحاة من GNOME، وبدون أي إعلانات أو طرق دفع.</p>
        <div class="hero-ctas">
          <a class="btn btn-primary btn-lg" href="https://github.com/mouadkennedy2001/Honk-video-downloader/releases/download/v2.0.0/Wasel-Downloader-2.0.0-x64.exe" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20h16"/></svg>
            <span><strong data-i18n="stableBtn">تثبيت أحدث إصدار مستقر</strong><small data-i18n="stableMeta">v2.0.0 · ويندوز x64 · 116 MB</small></span>
          </a>
          <a class="btn btn-secondary btn-lg" href="https://github.com/mouadkennedy2001/Honk-video-downloader/releases/download/v2.0.0/app-debug.apk" target="_blank" rel="noopener">
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.6h4"/></svg>
            <span><strong data-i18n="betaBtn">تجربة الإصدار التجريبي</strong><small data-i18n="betaMeta">أندرويد · نسخة APK تجريبية · 47 MB</small></span>
          </a>
        </div>
        <div class="hero-links">
          <a href="download.html" data-i18n="allFilesBtn">تصفّح كل الملفات ←</a>
          <span class="dot-sep">•</span>
          <a href="https://github.com/mouadkennedy2001/Honk-video-downloader" target="_blank" rel="noopener" data-i18n="viewSourceBtn">شفرة المصدر ←</a>
        </div>
        <div class="hero-meta">
          <span><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9L12 2.8Z"/></svg> <b id="heroStars">1</b> <span data-i18n="starsOnGitHub">نجمة على GitHub</span></span>
          <span data-i18n="license">رخصة MIT</span>
          <span data-i18n="noPayment">بلا طرق دفع</span>
        </div>
      </div>
      <div class="hero-visual reveal">
        <figure class="app-shot">
          <div class="app-shot-bar" aria-hidden="true"><i></i><i></i><i></i><span>wasel</span></div>
          <picture>
            <source srcset="assets/app-screenshot.webp" type="image/webp">
            <img src="assets/app-screenshot.png" width="1365" height="851" decoding="async" alt="لقطة حقيقية من واجهة تطبيق واصل">
          </picture>
          <figcaption data-i18n="screenshotCaption">لقطة حقيقية من التطبيق · واجهة عربية بأسلوب GNOME</figcaption>
        </figure>
        <div class="float-badge badge-top"><span class="badge-check">✓</span><span><strong data-i18n="badgeFloatingTitle">خفيف وسريع</strong><small data-i18n="badgeFloatingSub">مبني على Electron</small></span></div>
        <div class="float-badge badge-bottom"><span class="badge-rtl">ع</span><span><strong data-i18n="badgeRtlTitle">عربي بالكامل</strong><small data-i18n="badgeRtlSub">واجهة RTL و3 سمات</small></span></div>
      </div>
    </section>`;

const STATS = `    <section class="stats shell reveal" aria-label="Statistics">
      <div class="stat"><strong data-count="1000" data-suffix="+">1000+</strong><span data-i18n="statSites">موقع مدعوم</span></div>
      <div class="stat"><strong data-count="4" data-suffix="K">4K</strong><span data-i18n="statQuality">أعلى جودة متاحة</span></div>
      <div class="stat"><strong data-count="5">5</strong><span data-i18n="statFormats">صيغ استخراج الصوت</span></div>
      <div class="stat"><strong data-count="3">3</strong><span data-i18n="statThemes">فاتح · داكن · النظام</span></div>
    </section>`;

const FEATURE_CARDS = [
  ['blue', 'M4 17V9m5 8V5m5 12v-6m5 6V7', 'f1Title', 'f1Desc'],
  ['green', 'M9 18V5l10-2v13M6 18a3 3 0 1 0 6 0 3 3 0 0 0-6 0Zm10-2a3 3 0 1 0 6 0 3 3 0 0 0-6 0Z', 'f2Title', 'f2Desc'],
  ['purple', 'M4 6h16M4 12h16M4 18h10m3-3 3 3-3 3', 'f3Title', 'f3Desc'],
  ['orange', 'M3 4h18v16H3zM3 9h18M8 14h8M8 17h5', 'f4Title', 'f4Desc'],
  ['teal', 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18', 'f5Title', 'f5Desc'],
  ['blue', 'M3 4h18v16H3zM8.5 9.5h.01M4 16.5 9 12l4 3.5 3-2.5 4 3.5', 'f6Title', 'f6Desc'],
  ['pink', 'M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1', 'f7Title', 'f7Desc'],
  ['green', 'M12 3 4 6.5v5c0 5 3.4 8.4 8 9.5 4.6-1.1 8-4.5 8-9.5v-5L12 3Zm-3 9 2 2 4-4', 'f8Title', 'f8Desc']
];

function featureCards() {
  return FEATURE_CARDS.map(([color, path, tk, dk]) => `        <article class="feature-card reveal">
          <span class="feature-icon ${color}"><svg viewBox="0 0 24 24"><path d="${path}"/></svg></span>
          <h3 data-i18n="${tk}">${tk}</h3>
          <p data-i18n="${dk}">${dk}</p>
        </article>`).join('\n');
}

function sitesMarquee() {
  const group = SITE_LOGO_NAMES.map(n => `<img src="assets/sites/${n}.svg" alt="${SITE_LABELS[n]}" loading="lazy">`).join('');
  return `      <div class="sites-marquee reveal" aria-label="${'Supported sites'}">
        <div class="marquee-track"><div class="marquee-group">${group}</div><div class="marquee-group" aria-hidden="true">${group}</div></div>
      </div>`;
}

function platformCards() {
  return `        <article class="platform-card reveal">
          <span class="platform-tag win" data-i18n="winTag">الأكثر استخدامًا</span>
          <span class="platform-icon win"><svg viewBox="0 0 24 24"><path d="M3 5.5 11 4.4v7.1H3V5.5Zm9-1.2L21 3v8.5h-9V4.3ZM3 12.5h8v7.1L3 18.5v-6Zm9 0h9V21l-9-1.3v-7.2Z"/></svg></span>
          <h3 data-i18n="winTitle">ويندوز</h3>
          <p data-i18n="winDesc">مثبّت x64 أو نسخة محمولة من الإصدار المستقر 2.0.0.</p>
          <div class="platform-meta"><span data-i18n="versionLabel">الإصدار</span> <b>v2.0.0</b><span data-i18n="sizeLabel">الحجم</span> <b>116 MB / 105 MB</b></div>
          <div class="platform-actions">
            <a class="btn btn-primary btn-sm" href="https://github.com/mouadkennedy2001/Honk-video-downloader/releases/download/v2.0.0/Wasel-Downloader-2.0.0-x64.exe" target="_blank" rel="noopener" data-i18n="downloadBtn">تحميل</a>
            <a class="btn btn-ghost btn-sm" href="files.html" data-i18n="allFilesBtnShort">كل الملفات</a>
          </div>
        </article>
        <article class="platform-card reveal">
          <span class="platform-tag linux" data-i18n="linuxTag">لينكس</span>
          <span class="platform-icon linux"><svg viewBox="0 0 24 24"><path d="M12 2c-3 0-4 3-4 6 0 2-1.5 3-2 5-.7 2.8.2 5 2 8h8c1.8-3 2.7-5.2 2-8-.5-2-2-3-2-5 0-3-1-6-4-6Z"/></svg></span>
          <h3 data-i18n="linuxTitle">لينكس</h3>
          <p data-i18n="linuxDesc">حزمة deb أو AppImage من أرشيف الإصدار 1.0.0.</p>
          <div class="platform-meta"><span data-i18n="versionLabel">الإصدار</span> <b>v1.0.0</b><span data-i18n="sizeLabel">الحجم</span> <b>99 MB / 123 MB</b></div>
          <div class="platform-actions">
            <a class="btn btn-primary btn-sm" href="https://github.com/mouadkennedy2001/Honk-video-downloader/releases/download/v1.0.0/honk-downloader_1.0.0_amd64.deb" target="_blank" rel="noopener" data-i18n="downloadBtn">تحميل</a>
            <a class="btn btn-ghost btn-sm" href="files.html" data-i18n="allFilesBtnShort">كل الملفات</a>
          </div>
        </article>
        <article class="platform-card reveal">
          <span class="platform-tag android" data-i18n="androidTag">جوال</span>
          <span class="platform-icon android"><svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.6h4M9 6h6"/></svg></span>
          <h3 data-i18n="androidTitle">أندرويد</h3>
          <p data-i18n="androidDesc">ملف APK من بناء التطوير (debug) للتجربة على الهاتف.</p>
          <div class="platform-meta"><span data-i18n="versionLabel">الإصدار</span> <b>v2.0.0</b><span data-i18n="sizeLabel">الحجم</span> <b>47 MB</b></div>
          <div class="platform-actions">
            <a class="btn btn-primary btn-sm" href="https://github.com/mouadkennedy2001/Honk-video-downloader/releases/download/v2.0.0/app-debug.apk" target="_blank" rel="noopener" data-i18n="downloadBtn">تحميل</a>
            <a class="btn btn-ghost btn-sm" href="faq.html" data-i18n="howInstallBtn">طريقة التثبيت</a>
          </div>
        </article>
        <article class="platform-card reveal">
          <span class="platform-tag mac" data-i18n="macTag">من المصدر</span>
          <span class="platform-icon mac"><svg viewBox="0 0 24 24"><path d="M16.5 3.2c.1 1.1-.4 2.2-1.1 3-.8.9-2 1.5-3.1 1.4-.1-1 .4-2.1 1.1-2.9.8-.8 2.1-1.4 3.1-1.5ZM20 16.4c-.5 1.2-.8 1.7-1.5 2.8-1 1.5-2.4 3.3-4.1 3.3-1.5 0-1.9-1-4-1s-2.6 1-4 1c-1.7 0-3-1.6-4-3.1-2.7-4.1-3-8.9-1.3-11.4 1.2-1.7 3-2.7 4.7-2.7 1.8 0 2.9 1 4 1 1 0 2.3-1.2 4.1-1 1.4.1 2.7.8 3.7 2-3.2 1.8-2.7 6.5.4 8.1Z"/></svg></span>
          <h3 data-i18n="macTitle">ماك</h3>
          <p data-i18n="macDesc">لا يوجد ملف dmg منشور بعد؛ يمكنك البناء من المصدر باستخدام npm.</p>
          <div class="platform-meta"><span data-i18n="versionLabel">الإصدار</span> <b>main</b><span data-i18n="sizeLabel">الحجم</span> <b>— MB</b></div>
          <div class="platform-actions">
            <a class="btn btn-primary btn-sm" href="https://github.com/mouadkennedy2001/Honk-video-downloader/archive/refs/heads/main.zip" target="_blank" rel="noopener" data-i18n="sourceBtn">شفرة المصدر</a>
            <a class="btn btn-ghost btn-sm" href="https://github.com/mouadkennedy2001/Honk-video-downloader#readme" target="_blank" rel="noopener" data-i18n="buildGuideBtn">دليل البناء</a>
          </div>
        </article>`;
}

const FILES_PANEL = `    <div class="files-panel reveal">
      <div class="files-toolbar">
        <div class="filter-chips" id="fileFilters" role="group" aria-label="Filter files">
          <button class="chip active" type="button" data-filter="all" data-i18n="filterAll">الكل</button>
          <button class="chip" type="button" data-filter="windows" data-i18n="filterWindows">ويندوز</button>
          <button class="chip" type="button" data-filter="linux" data-i18n="filterLinux">لينكس</button>
          <button class="chip" type="button" data-filter="android" data-i18n="filterAndroid">أندرويد</button>
          <button class="chip" type="button" data-filter="source" data-i18n="filterSource">المصدر</button>
        </div>
        <label class="search-box">
          <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 4 4"/></svg>
          <input id="fileSearch" type="search" data-i18n-placeholder="searchPlaceholder" placeholder="ابحث عن اسم ملف..." autocomplete="off">
        </label>
      </div>
      <div class="files-list" id="filesList"></div>
      <p class="files-empty" id="filesEmpty" hidden data-i18n="filesEmpty">لا توجد ملفات مطابقة.</p>
    </div>`;

const FAQ_LIST = `    <div class="faq-list reveal">
      <details><summary data-i18n="faq1q">هل واصل مجاني تمامًا؟</summary><p data-i18n="faq1a">نعم. المشروع مفتوح المصدر برخصة MIT، بلا إعلانات وبلا اشتراكات أو طرق دفع.</p></details>
      <details><summary data-i18n="faq2q">ما المواقع التي يدعمها؟</summary><p data-i18n="faq2a">يعتمد على yt-dlp، لذا يدعم أكثر من ألف موقع منها يوتيوب وإنستغرام وتيك توك وفيسبوك وX وفيميو وSoundCloud، كما يقبل الروابط المباشرة mp4 و m3u8.</p></details>
      <details><summary data-i18n="faq3q">هل أحتاج لتثبيت yt-dlp و FFmpeg يدويًا؟</summary><p data-i18n="faq3a">لا. يمكنك تثبيتهما أو تحديثهما من الإعدادات ← المحرّكات والمكتبات ← تثبيت الناقص، ويبقى التثبيت اليدوي متاحًا.</p></details>
      <details><summary data-i18n="faq4q">هل يمكن تحميل محتوى يتطلب تسجيل الدخول؟</summary><p data-i18n="faq4a">نعم، اختر متصفحك كمصدر للكوكيز من قائمة التحميل أو الإعدادات، بشرط أن يكون المتصفح يسمح بقراءة كوكيزه.</p></details>
      <details><summary data-i18n="faq5q">كيف أثبّت نسخة أندرويد؟</summary><p data-i18n="faq5a">نزّل ملف app-debug.apk من صفحة التحميل، ثم افتحه على الهاتف واسمح بالتثبيت من مصادر غير معروفة لهذا الملف فقط. إنها نسخة تجريبية وليست موقّعة.</p></details>
      <details><summary data-i18n="faq6q">كيف أتحقق من الملف الذي نزّلته؟</summary><p data-i18n="faq6a">في قسم الملفات تجد بصمة SHA-256 لكل ملف؛ انسخها وقارنها بعد التحميل بأداة مثل <code>certutil -hashfile FILE SHA256</code> على ويندوز أو <code>sha256sum FILE</code> على لينكس.</p></details>
    </div>`;

const DEV_BLOCK = `    <div class="dev-layout">
      <article class="dev-card reveal">
        <img class="dev-avatar" src="assets/accounts/github.png" alt="" width="64" height="64">
        <div class="dev-info">
          <span class="dev-role" data-i18n="devRole">مطوّر واصل</span>
          <h3 data-i18n="devName">زروقي احمد معاذ</h3>
          <p data-i18n="devDesc">صمّم وبنى Wasel Downloader باستخدام Electron و yt-dlp و FFmpeg، بواجهة عربية مستوحاة من GNOME.</p>
          <a class="btn btn-ghost btn-sm" href="https://github.com/mouadkennedy2001" target="_blank" rel="noopener">GitHub <span aria-hidden="true">↗</span></a>
        </div>
      </article>
      <div class="accounts-wrap reveal">
        <h3 data-i18n="accountsTitle">حساباتي</h3>
        <p data-i18n="accountsDesc">تابع المطوّر على منصاته المختلفة.</p>
        <div class="accounts-grid">
          <a class="account-tile" href="https://www.instagram.com/mouad_kennedy/" target="_blank" rel="noopener">
            <img src="assets/accounts/instagram1.jpg" alt="" width="40" height="40" loading="lazy"><span><strong>Instagram</strong><small>@mouad_kennedy</small></span><b aria-hidden="true">↗</b>
          </a>
          <a class="account-tile" href="https://www.instagram.com/mouad_.ze/" target="_blank" rel="noopener">
            <img src="assets/accounts/instagram2.jpg" alt="" width="40" height="40" loading="lazy"><span><strong>Instagram</strong><small>@mouad_.ze</small></span><b aria-hidden="true">↗</b>
          </a>
          <a class="account-tile" href="https://github.com/mouadkennedy2001" target="_blank" rel="noopener">
            <img src="assets/accounts/github.png" alt="" width="40" height="40" loading="lazy"><span><strong>GitHub</strong><small>@mouadkennedy2001</small></span><b aria-hidden="true">↗</b>
          </a>
          <a class="account-tile" href="https://www.tiktok.com/@mouad_.ze" target="_blank" rel="noopener">
            <img src="assets/accounts/tiktok.jpg" alt="" width="40" height="40" loading="lazy"><span><strong>TikTok</strong><small>@mouad_.ze</small></span><b aria-hidden="true">↗</b>
          </a>
          <button class="account-tile" type="button" data-copy="mouadz_" data-i18n-title="copyUsername" title="نسخ اسم المستخدم">
            <img src="assets/accounts/discord.png" alt="" width="40" height="40" loading="lazy"><span><strong>Discord</strong><small>mouadz_</small></span><b aria-hidden="true">⧉</b>
          </button>
          <a class="account-tile" href="mailto:mouad.kennedy.2001@gmail.com" data-i18n-title="copyEmail" title="إرسال بريد إلكتروني">
            <img src="assets/accounts/gmail.jpg" alt="" width="40" height="40" loading="lazy"><span><strong>Gmail</strong><small>mouad.kennedy.2001@gmail.com</small></span><b aria-hidden="true">✉</b>
          </a>
        </div>
      </div>
    </div>`;

function cta() {
  return `    <section class="cta-band">
      <div class="shell cta-inner reveal">
        <div>
          <h2 data-i18n="ctaTitle">مشروع مفتوح المصدر</h2>
          <p data-i18n="ctaDesc">أعجبك التطبيق؟ أضف نجمة للمشروع، أو ساهم بفكرة وإصلاح على GitHub.</p>
        </div>
        <a class="btn btn-light btn-lg" href="https://github.com/mouadkennedy2001/Honk-video-downloader" target="_blank" rel="noopener">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2C6.5 2 2 6.6 2 12.2c0 4.5 2.9 8.4 6.8 9.7.5.1.7-.2.7-.5v-1.9c-2.8.6-3.4-1.2-3.4-1.2-.4-1.2-1.1-1.5-1.1-1.5-.9-.6.1-.6.1-.6 1 .1 1.5 1 1.5 1 .9 1.6 2.4 1.1 2.9.9.1-.7.4-1.1.7-1.4-2.2-.3-4.6-1.1-4.6-5 0-1.1.4-2 1-2.7-.1-.3-.4-1.3.1-2.7 0 0 .8-.3 2.7 1a9.3 9.3 0 0 1 5 0c1.9-1.3 2.7-1 2.7-1 .5 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.7-4.6 5 .4.4.8 1.1.8 2.2v3.3c0 .3.2.6.7.5A10.2 10.2 0 0 0 22 12.2C22 6.6 17.5 2 12 2Z"/></svg>
          <span data-i18n="ctaBtn">زيارة المستودع</span>
        </a>
      </div>
    </section>`;
}

function wrap(title, desc, body) {
  var titleKeys = {
    'واصل | Wasel Downloader': 'titleHome',
    'التحميل | واصل': 'titleDownload',
    'المزايا | واصل': 'titleFeatures',
    'المنصات | واصل': 'titlePlatforms',
    'الملفات | واصل': 'titleFiles',
    'الإصدارات | واصل': 'titleReleases',
    'الأسئلة الشائعة | واصل': 'titleFaq',
    'المطوّر | واصل': 'titleDeveloper'
  };
  return head(title, desc, titleKeys[title] || 'titleHome') + '\n' + header() + '\n' + body + '\n' + cta() + '\n' + footer();
}

const pages = {
  'index.html': wrap(
    'واصل | Wasel Downloader',
    'واصل — محمّل فيديو وصوت مفتوح المصدر بواجهة GNOME. حمّل أحدث إصدار مستقر أو تجريبي للأندرويد.',
    HERO + '\n' + STATS + `
    <section class="section shell">
      <div class="section-head reveal">
        <span class="kicker" data-i18n="featuresKicker">لماذا واصل؟</span>
        <h2 data-i18n="homeHighlightsTitle">تجربة بسيطة، نتائج قوية</h2>
        <p data-i18n="homeHighlightsDesc">نظرة سريعة على أهم ما يقدّمه التطبيق، وكل التفاصيل في صفحاتها الخاصة.</p>
      </div>
      <div class="feature-grid">
${FEATURE_CARDS.slice(0, 4).map(([c, p, tk, dk]) => `        <article class="feature-card reveal"><span class="feature-icon ${c}"><svg viewBox="0 0 24 24"><path d="${p}"/></svg></span><h3 data-i18n="${tk}">${tk}</h3><p data-i18n="${dk}">${dk}</p></article>`).join('\n')}
      </div>
      <div class="home-links reveal">
        <a class="btn btn-secondary btn-sm" href="features.html" data-i18n="moreFeaturesBtn">كل المزايا ←</a>
        <a class="btn btn-secondary btn-sm" href="platforms.html" data-i18n="navPlatforms">المنصات ←</a>
        <a class="btn btn-secondary btn-sm" href="files.html" data-i18n="navFiles">الملفات ←</a>
      </div>
    </section>
    <section class="section section-alt">
      <div class="shell">
        <div class="section-head reveal">
          <span class="kicker" data-i18n="releasesKicker">سجل الإصدارات</span>
          <h2 data-i18n="latestTitle">آخر إصدار مستقر</h2>
          <p data-i18n="latestDesc">v2.0.0 متاح لويندوز x64 ونسخة تجريبية للأندرويد، مع كل الملفات وبصمات التحقق في صفحة الملفات.</p>
        </div>
        <div class="latest-row reveal">
          <div class="latest-card"><span class="release-badge stable" data-i18n="releaseStable">مستقر</span><strong>v2.0.0</strong><span data-i18n="winTitle">ويندوز</span><b>116 MB</b></div>
          <div class="latest-card"><span class="release-badge previous" data-i18n="releasePrevious">سابق</span><strong>v1.9.0</strong><span data-i18n="winTitle">ويندوز</span><b>116 MB</b></div>
          <div class="latest-card"><span class="release-badge stable" data-i18n="androidTitle">أندرويد</span><strong>APK</strong><span data-i18n="betaMeta">أندرويد · نسخة APK تجريبية · 47 MB</span><b>47 MB</b></div>
        </div>
        <div class="home-links reveal"><a class="btn btn-primary btn-sm" href="releases.html" data-i18n="allReleasesBtn">كل الإصدارات ←</a></div>
      </div>
    </section>`
  ),

  'download.html': wrap(
    'التحميل | واصل',
    'حمّل واصل: أحدث إصدار مستقر للويندوز وإصدار تجريبي للأندرويد بروابط مباشرة.',
    pageHead('navDownload', 'downloadPageTitle', 'downloadPageDesc') + `
    <section class="shell download-choices">
      <a class="download-choice prim reveal" href="https://github.com/mouadkennedy2001/Honk-video-downloader/releases/download/v2.0.0/Wasel-Downloader-2.0.0-x64.exe" target="_blank" rel="noopener">
        <span class="choice-icon"><svg viewBox="0 0 24 24"><path d="M12 3v12m0 0 4.5-4.5M12 15l-4.5-4.5M4 20h16"/></svg></span>
        <span class="choice-body"><small data-i18n="releaseStable">مستقر</small><strong data-i18n="stableBtn">تثبيت أحدث إصدار مستقر</strong><em data-i18n="stableMeta">v2.0.0 · ويندوز x64 · 116 MB</em></span>
        <span class="choice-go">←</span>
      </a>
      <a class="download-choice reveal" href="https://github.com/mouadkennedy2001/Honk-video-downloader/releases/download/v2.0.0/app-debug.apk" target="_blank" rel="noopener">
        <span class="choice-icon"><svg viewBox="0 0 24 24"><rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.6h4"/></svg></span>
        <span class="choice-body"><small data-i18n="androidTitle">أندرويد</small><strong data-i18n="betaBtn">تجربة الإصدار التجريبي</strong><em data-i18n="betaMeta">أندرويد · نسخة APK تجريبية · 47 MB</em></span>
        <span class="choice-go">←</span>
      </a>
    </section>
    <section class="section shell">
      <div class="notice reveal">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v5m0 3h.01"/></svg>
        <p data-i18n="verifyNote">قبل التثبيت، يمكنك نسخ بصمة SHA-256 ومقارنتها من صفحة الملفات للتأكد من سلامة التنزيل.</p>
        <a class="btn btn-ghost btn-sm" href="files.html" data-i18n="navFiles">الملفات ←</a>
      </div>
      <div class="platform-grid compact">${platformCards()}</div>
    </section>`
  ),

  'features.html': wrap(
    'المزايا | واصل',
    'مزايا واصل: جودة 4K، استخراج صوت، قوائم تشغيل، ترجمات، كوكيز متصفحات، وإضافة Chrome.',
    pageHead('featuresKicker', 'featuresTitle', 'featuresDesc') + `
    <section class="shell"><div class="feature-grid">
${featureCards()}
    </div>${sitesMarquee()}</section>`
  ),

  'platforms.html': wrap(
    'المنصات | واصل',
    'واصل متاح لويندوز ولينكس وأندرويد، ويمكن بناؤه من المصدر على ماك.',
    pageHead('platformsKicker', 'platformsTitle', 'platformsDesc') + `
    <section class="shell"><div class="platform-grid">${platformCards()}</div></section>`
  ),

  'files.html': wrap(
    'الملفات | واصل',
    'كل ملفات واصل: روابط مباشرة وأحجام وبصمات SHA-256 لكل الإصدارات.',
    pageHead('filesKicker', 'filesTitle', 'filesDesc') + `
    <section class="shell">${FILES_PANEL}</section>`
  ),

  'releases.html': wrap(
    'الإصدارات | واصل',
    'الإصدارات السابقة والحالية من واصل مع ملاحظات كل إصدار وملفاته.',
    pageHead('releasesKicker', 'releasesTitle', 'releasesDesc') + `
    <section class="shell"><div class="release-list" id="releaseList"></div></section>`
  ),

  'faq.html': wrap(
    'الأسئلة الشائعة | واصل',
    'إجابات عن الأسئلة الشائعة حول تثبيت واصل واستخدامه والتحقق من الملفات.',
    pageHead('faqKicker', 'faqTitle', 'faqDesc') + `
    <section class="shell">${FAQ_LIST}</section>`
  ),

  'developer.html': wrap(
    'المطوّر | واصل',
    'زروقي احمد معاذ مطوّر واصل، وحساباته على إنستغرام وGitHub وتيك توك وديسكورد وجيميل.',
    pageHead('devKicker', 'devTitle', 'devDesc') + `
    <section class="shell">${DEV_BLOCK}</section>`
  )
};

Object.entries(pages).forEach(([name, html]) => {
  fs.writeFileSync(path.join(__dirname, name), html);
  console.log('written', name, html.length);
});
