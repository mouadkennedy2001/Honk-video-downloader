/* ============================================================
   Wasel Downloader website — interactions & bilingual content
   No build step, no framework: open index.html directly.
   ============================================================ */
(function () {
  'use strict';

  document.documentElement.classList.add('js');

  // Each HTML page ships with its own title; keep it instead of replacing it with the site name.
  var basePageTitle = document.title;

  var REPO = 'https://github.com/mouadkennedy2001/Honk-video-downloader';
  var API = 'https://api.github.com/repos/mouadkennedy2001/Honk-video-downloader';
  var FALLBACK_STARS = 1;

  function assetUrl(tag, name) {
    return REPO + '/releases/download/' + tag + '/' + encodeURIComponent(name);
  }

  /* ---------------- Release data (from GitHub Releases API) ---------------- */
  var RELEASES = [
    {
      tag: 'v2.0.0',
      name: 'v2.0.0',
      date: '2026-11-23',
      badge: 'stable',
      notes: {
        ar: 'إصدار مستقر للويندوز والأندرويد: تحسين الأداء، وتصميم محدّث، وحل أغلبية المشاكل، وجعل التطبيق أكثر استقرارًا. تغيّر الاسم من Honk إلى واصل، وهو بدون أي طرق دفع.',
        en: 'Stable release for Windows and Android: performance improvements, a refreshed design, most issues fixed, and better overall stability. Renamed from Honk to Wasel, with no payment methods.'
      },
      assets: [
        { name: 'Wasel-Downloader-2.0.0-x64.exe', platform: 'windows', size: 121618496, sha: 'a11a5ea9b323c60b1a3c97dd9112a61c1defde7f97174d1f8ed11abd9bef58a9' },
        { name: 'Wasel.Downloader.2.0.0.exe', platform: 'windows', size: 110466317, sha: '5a0400f37a454f99753bba96d56ccbf78748d0b0acc71dbc5fd10b3912dcd1fd' },
        { name: 'app-debug.apk', platform: 'android', size: 49660220, sha: 'eb99e7c7286ef6b30931f09a731c4e4bca230bddc1bf5e66b7e05fad02fae1fb' }
      ]
    },
    {
      tag: 'v2.0.1',
      name: 'v1.9.0',
      date: '2026-11-17',
      badge: 'previous',
      notes: {
        ar: 'تحديث كبير: تحسين الأداء، وتغيير التصميم، وحل أغلبية المشاكل، وتثبيت العمل. تغيّر الاسم من Honk إلى واصل (Wasel)، بدون أي طرق دفع. ملاحظة: الوسم v2.0.1 واسم الإصدار v1.9.0.',
        en: 'Major update: performance improvements, a new design, most issues fixed, and rename from Honk to Wasel — with no payment methods. Note: tag v2.0.1, release name v1.9.0.'
      },
      assets: [
        { name: 'Wasel-Downloader-1.9.0-x64.exe', platform: 'windows', size: 121540607, sha: '6faad4f6bbfa28b92b39859f3a24ef1bc66e160bb2e68104c40089ff76eb158e' }
      ]
    },
    {
      tag: 'v1.0.0',
      name: 'v1.0.0',
      date: '2026-11-04',
      badge: 'legacy',
      notes: {
        ar: 'أول إصدار للتطبيق، وكان متاحًا للينكس فقط في البداية: حزمة deb و AppImage، مع ملف تثبيت للويندوز أُضيف لاحقًا.',
        en: 'The first release, initially available for Linux only: a deb package and AppImage, with a Windows installer added later.'
      },
      assets: [
        { name: 'honk-downloader_1.0.0_amd64.deb', platform: 'linux', size: 103993620, sha: 'fc02f09b269ca7249372520eb32fefc6152b89d3ce6ee66f3a0ce0ebdd1ba0fd' },
        { name: 'Honk.Downloader-1.0.0.AppImage', platform: 'linux', size: 128475531, sha: '445445cfebed19b827272d8abcb566a35ae0b1731714854df4824af2c48086dd' },
        { name: 'Honk.Downloader.Setup.1.0.0.exe', platform: 'windows', size: 121258693, sha: 'aa0de3d670c31f021165613b9436e2c7eb7078137af7b31051feb5ce0b3ac3b5' }
      ]
    }
  ];

  // Source archives are shown as files too, for people who build from source.
  RELEASES[0].sourceAssets = [
    { name: 'Source code (zip) — v2.0.0', platform: 'source', size: null, sha: null, url: REPO + '/archive/refs/tags/v2.0.0.zip' },
    { name: 'Source code (tar.gz) — v2.0.0', platform: 'source', size: null, sha: null, url: REPO + '/archive/refs/tags/v2.0.0.tar.gz' }
  ];

  /* ---------------- Dictionary ---------------- */
  var I18N = {
    ar: {
      pageTitle: 'واصل | محمّل الفيديو',
      titleHome: 'واصل | محمّل الفيديو',
      titleDownload: 'حمّل واصل',
      titleFeatures: 'المزايا | واصل',
      titlePlatforms: 'المنصات | واصل',
      titleFiles: 'الملفات | واصل',
      titleReleases: 'الإصدارات | واصل',
      titleFaq: 'الأسئلة الشائعة | واصل',
      titleDeveloper: 'المطوّر | واصل',
      skipLink: 'تخطَّ إلى المحتوى',
      brandName: 'واصل',
      brandTag: 'محمّل الفيديو',
      navHome: 'الرئيسية',
      navDownload: 'التحميل',
      navFeatures: 'المزايا',
      navPlatforms: 'المنصات',
      navFiles: 'الملفات',
      navReleases: 'الإصدارات',
      navFaq: 'الأسئلة',
      navDeveloper: 'المطوّر',
      starTitle: 'عرض المشروع على GitHub',
      langTitle: 'التبديل إلى الإنجليزية',
      themeTitle: 'تغيير المظهر: فاتح / داكن / النظام',
      menuTitle: 'فتح القائمة',
      heroEyebrow: 'مفتوح المصدر · مجاني تمامًا · بلا إعلانات',
      heroTitle1: 'حمّل الفيديو والصوت',
      heroTitle2: 'بطريقة أنيقة',
      heroDesc: 'واصل تطبيق خفيف وسريع لتحميل الفيديو والصوت من أكثر من ألف موقع، بواجهة عربية نظيفة مستوحاة من GNOME، وبدون أي إعلانات أو طرق دفع.',
      stableBtn: 'تثبيت أحدث إصدار مستقر',
      stableMeta: 'v2.0.0 · ويندوز x64 · 116 MB',
      betaBtn: 'تجربة الإصدار التجريبي',
      betaMeta: 'أندرويد · نسخة APK تجريبية · 47 MB',
      allFilesBtn: 'تصفّح كل الملفات ←',
      allFilesBtnShort: 'كل الملفات',
      viewSourceBtn: 'شفرة المصدر ←',
      starsOnGitHub: 'نجمة على GitHub',
      license: 'رخصة MIT',
      noPayment: 'بلا طرق دفع',
      homeHighlightsTitle: 'تجربة بسيطة، نتائج قوية',
      homeHighlightsDesc: 'نظرة سريعة على أهم ما يقدّمه التطبيق، وكل التفاصيل في صفحاتها الخاصة.',
      moreFeaturesBtn: 'كل المزايا ←',
      latestTitle: 'آخر إصدار مستقر',
      latestDesc: 'v2.0.0 متاح لويندوز x64 ونسخة تجريبية للأندرويد، مع كل الملفات وبصمات التحقق في صفحة الملفات.',
      allReleasesBtn: 'كل الإصدارات ←',
      downloadPageTitle: 'حمّل واصل',
      downloadPageDesc: 'اختر الإصدار المناسب لجهازك: أحدث بناء مستقر للويندوز أو نسخة APK تجريبية للأندرويد. كل الروابط مباشرة من GitHub.',
      verifyNote: 'قبل التثبيت، يمكنك نسخ بصمة SHA-256 ومقارنتها من صفحة الملفات للتأكد من سلامة التنزيل.',
      screenshotCaption: 'لقطة حقيقية من التطبيق · واجهة عربية بأسلوب GNOME',
      badgeFloatingTitle: 'خفيف وسريع',
      badgeFloatingSub: 'مبني على Electron',
      badgeRtlTitle: 'عربي بالكامل',
      badgeRtlSub: 'واجهة RTL و3 سمات',
      statSites: 'موقع مدعوم',
      statQuality: 'أعلى جودة متاحة',
      statFormats: 'صيغ استخراج الصوت',
      statThemes: 'فاتح · داكن · النظام',
      featuresKicker: 'لماذا واصل؟',
      featuresTitle: 'كل ما تحتاجه، بلا تعقيد',
      featuresDesc: 'محرّك قوي مبني على yt-dlp و FFmpeg، وواجهة بسيطة تضع كل الخيارات في مكانها الصحيح.',
      f1Title: 'جودة تصل إلى 4K',
      f1Desc: 'اختر أفضل جودة أو 2160p و1440p و1080p وما دونها، مع دمج تلقائي للفيديو والصوت.',
      f2Title: 'استخراج الصوت',
      f2Desc: 'احفظ الصوت وحده بصيغ MP3 و M4A و Opus و WAV و FLAC بجودة تصل إلى الأصل.',
      f3Title: 'قوائم التشغيل',
      f3Desc: 'نزّل العنصر الحالي فقط أو القائمة كاملة، مع حد أقصى للتحميلات المتزامنة.',
      f4Title: 'الترجمات والبيانات',
      f4Desc: 'حمّل الترجمات وادمجها، وأضف بيانات الفيديو والغلاف إلى الملف النهائي عبر FFmpeg.',
      f5Title: 'كوكيز متصفحك',
      f5Desc: 'استخدم كوكيز Chrome أو Firefox أو Brave أو Edge أو Opera أو Vivaldi أو Safari للمحتوى الذي يتطلب دخولًا.',
      f6Title: 'إضافة المتصفح',
      f6Desc: 'أرسل الروابط من Chrome إلى التطبيق عبر Wasel Media Grabber وجسر محلي آمن على 127.0.0.1.',
      f7Title: 'ثلاث سمات وعربية كاملة',
      f7Desc: 'فاتح، داكن، أو حسب النظام، مع واجهة RTL مرتبة وخطوط عربية واضحة.',
      f8Title: 'خفيف وخاص',
      f8Desc: 'لا متصفح داخلي ولا إعلانات ولا تتبع. أدوات التحميل تُثبَّت بضغطة زر من الإعدادات.',
      sitesLabel: 'يعمل مع:',
      platformsKicker: 'نزّل على جهازك',
      platformsTitle: 'إصدار لكل منصة',
      platformsDesc: 'كل الروابط مباشرة من صفحة الإصدارات الرسمية على GitHub. اختر ما يناسب جهازك.',
      winTag: 'الأكثر استخدامًا',
      winTitle: 'ويندوز',
      winDesc: 'مثبّت x64 أو نسخة محمولة من الإصدار المستقر 2.0.0.',
      linuxTag: 'لينكس',
      linuxTitle: 'لينكس',
      linuxDesc: 'حزمة deb أو AppImage من أرشيف الإصدار 1.0.0.',
      androidTag: 'جوال',
      androidTitle: 'أندرويد',
      androidDesc: 'ملف APK من بناء التطوير (debug) للتجربة على الهاتف.',
      howInstallBtn: 'طريقة التثبيت',
      macTag: 'من المصدر',
      macTitle: 'ماك',
      macDesc: 'لا يوجد ملف dmg منشور بعد؛ يمكنك البناء من المصدر باستخدام npm.',
      sourceBtn: 'شفرة المصدر',
      buildGuideBtn: 'دليل البناء',
      versionLabel: 'الإصدار',
      sizeLabel: 'الحجم',
      downloadBtn: 'تحميل',
      filesKicker: 'قسم الملفات',
      filesTitle: 'كل الملفات في مكان واحد',
      filesDesc: 'روابط مباشرة لكل الإصدارات، مع الحجم وبصمة SHA-256 للتحقق من سلامة الملف قبل تثبيته.',
      filterAll: 'الكل',
      filterWindows: 'ويندوز',
      filterLinux: 'لينكس',
      filterAndroid: 'أندرويد',
      filterSource: 'المصدر',
      searchPlaceholder: 'ابحث عن اسم ملف...',
      filesEmpty: 'لا توجد ملفات مطابقة.',
      copyLink: 'نسخ رابط التحميل',
      copyHash: 'نسخ بصمة SHA-256',
      platformLabel: 'المنصة',
      platformWindows: 'ويندوز',
      platformLinux: 'لينكس',
      platformAndroid: 'أندرويد',
      platformSource: 'المصدر',
      releasesKicker: 'سجل الإصدارات',
      releasesTitle: 'الإصدارات السابقة',
      releasesDesc: 'تابع تطور المشروع من أول إصدار على لينكس حتى أحدث بناء للويندوز والأندرويد.',
      releaseStable: 'مستقر',
      releasePrevious: 'سابق',
      releaseLegacy: 'أرشيف',
      releaseView: 'عرض الإصدار على GitHub ←',
      releaseCount: 'ملف',
      faqKicker: 'أسئلة شائعة',
      faqTitle: 'قبل أن تبدأ',
      faqDesc: 'إجابات مختصرة عن أكثر ما يسأل عنه المستخدمون قبل تثبيت واصل واستخدامه.',
      faq1q: 'هل واصل مجاني تمامًا؟',
      faq1a: 'نعم. المشروع مفتوح المصدر برخصة MIT، بلا إعلانات وبلا اشتراكات أو طرق دفع.',
      faq2q: 'ما المواقع التي يدعمها؟',
      faq2a: 'يعتمد على yt-dlp، لذا يدعم أكثر من ألف موقع منها يوتيوب وإنستغرام وتيك توك وفيسبوك وX وفيميو وSoundCloud، كما يقبل الروابط المباشرة mp4 و m3u8.',
      faq3q: 'هل أحتاج لتثبيت yt-dlp و FFmpeg يدويًا؟',
      faq3a: 'لا. يمكنك تثبيتهما أو تحديثهما من الإعدادات ← المحرّكات والمكتبات ← تثبيت الناقص، ويبقى التثبيت اليدوي متاحًا.',
      faq4q: 'هل يمكن تحميل محتوى يتطلب تسجيل الدخول؟',
      faq4a: 'نعم، اختر متصفحك كمصدر للكوكيز من قائمة التحميل أو الإعدادات، بشرط أن يكون المتصفح يسمح بقراءة كوكيزه.',
      faq5q: 'كيف أثبّت نسخة أندرويد؟',
      faq5a: 'نزّل ملف app-debug.apk من أعلى الصفحة، ثم افتحه على الهاتف واسمح بالتثبيت من مصادر غير معروفة لهذا الملف فقط. إنها نسخة تجريبية وليست موقّعة.',
      faq6q: 'كيف أتحقق من الملف الذي نزّلته؟',
      faq6a: 'في قسم الملفات تجد بصمة SHA-256 لكل ملف؛ انسخها وقارنها بعد التحميل بأداة مثل certutil -hashfile FILE SHA256 على ويندوز أو sha256sum FILE على لينكس.',
      ctaTitle: 'مشروع مفتوح المصدر',
      ctaDesc: 'أعجبك التطبيق؟ أضف نجمة للمشروع، أو ساهم بفكرة وإصلاح على GitHub.',
      ctaBtn: 'زيارة المستودع',
      devKicker: 'وراء المشروع',
      devTitle: 'المطوّر وحساباته',
      devRole: 'مطوّر واصل',
      devName: 'زروقي احمد معاذ',
      devDesc: 'صمّم وبنى Wasel Downloader باستخدام Electron و yt-dlp و FFmpeg، بواجهة عربية مستوحاة من GNOME.',
      accountsTitle: 'حساباتي',
      accountsDesc: 'تابع المطوّر على منصاته المختلفة.',
      noLink: 'بدون رابط',
      copyUsername: 'نسخ اسم المستخدم',
      copyEmail: 'إرسال بريد إلكتروني',
      footerDesc: 'حمّل بحرية، بأناقة.',
      footerBy: 'بالمطوّر',
      footerMade: 'صُمّم بأسلوب GNOME Adwaita',
      toastCopied: 'تم النسخ إلى الحافظة',
      toastFailed: 'تعذّر النسخ، حاول مرة أخرى'
    },
    en: {
      pageTitle: 'Wasel | Video Downloader',
      titleHome: 'Wasel | Video Downloader',
      titleDownload: 'Download Wasel',
      titleFeatures: 'Features | Wasel',
      titlePlatforms: 'Platforms | Wasel',
      titleFiles: 'Files | Wasel',
      titleReleases: 'Releases | Wasel',
      titleFaq: 'FAQ | Wasel',
      titleDeveloper: 'Developer | Wasel',
      skipLink: 'Skip to content',
      brandName: 'Wasel',
      brandTag: 'Video Downloader',
      navHome: 'Home',
      navDownload: 'Download',
      navFeatures: 'Features',
      navPlatforms: 'Platforms',
      navFiles: 'Files',
      navReleases: 'Releases',
      navFaq: 'FAQ',
      navDeveloper: 'Developer',
      starTitle: 'View project on GitHub',
      langTitle: 'Switch to Arabic',
      themeTitle: 'Change theme: light / dark / system',
      menuTitle: 'Open menu',
      heroEyebrow: 'Open source · Completely free · No ads',
      heroTitle1: 'Download video and audio',
      heroTitle2: 'the elegant way',
      heroDesc: 'Wasel is a light, fast downloader for video and audio from over a thousand sites, with a clean Arabic-friendly interface inspired by GNOME — and no ads or payments.',
      stableBtn: 'Install latest stable version',
      stableMeta: 'v2.0.0 · Windows x64 · 116 MB',
      betaBtn: 'Try the experimental build',
      betaMeta: 'Android · experimental APK · 47 MB',
      allFilesBtn: 'Browse all files →',
      allFilesBtnShort: 'All files',
      viewSourceBtn: 'Source code →',
      starsOnGitHub: 'stars on GitHub',
      license: 'MIT licensed',
      noPayment: 'No payment methods',
      homeHighlightsTitle: 'Simple experience, powerful results',
      homeHighlightsDesc: 'A quick look at what the app offers, with full details on dedicated pages.',
      moreFeaturesBtn: 'All features →',
      latestTitle: 'Latest stable release',
      latestDesc: 'v2.0.0 is available for Windows x64 plus an experimental Android build, with all files and checksums on the Files page.',
      allReleasesBtn: 'All releases →',
      downloadPageTitle: 'Download Wasel',
      downloadPageDesc: 'Pick the right build for your device: the latest stable Windows release or an experimental Android APK. All links point directly to GitHub.',
      verifyNote: 'Before installing, you can copy the SHA-256 hash and compare it from the Files page to verify your download.',
      screenshotCaption: 'Real screenshot of the app · Arabic GNOME-style interface',
      badgeFloatingTitle: 'Light & fast',
      badgeFloatingSub: 'Built on Electron',
      badgeRtlTitle: 'Fully Arabic',
      badgeRtlSub: 'RTL layout & 3 themes',
      statSites: 'supported sites',
      statQuality: 'maximum quality',
      statFormats: 'audio formats',
      statThemes: 'light · dark · system',
      featuresKicker: 'Why Wasel?',
      featuresTitle: 'Everything you need, no clutter',
      featuresDesc: 'A powerful engine built on yt-dlp and FFmpeg, wrapped in a simple interface that keeps every option where it belongs.',
      f1Title: 'Up to 4K quality',
      f1Desc: 'Pick the best format or 2160p, 1440p, 1080p and below, with automatic video and audio merging.',
      f2Title: 'Audio extraction',
      f2Desc: 'Save audio only as MP3, M4A, Opus, WAV or FLAC at the best available quality.',
      f3Title: 'Playlists',
      f3Desc: 'Download just the current item or the whole playlist, with a limit on concurrent downloads.',
      f4Title: 'Subtitles & metadata',
      f4Desc: 'Fetch and embed subtitles, plus write metadata and cover art into the final file with FFmpeg.',
      f5Title: 'Your browser cookies',
      f5Desc: 'Use cookies from Chrome, Firefox, Brave, Edge, Opera, Vivaldi or Safari for sign-in protected content.',
      f6Title: 'Browser extension',
      f6Desc: 'Send links from Chrome to the app with Wasel Media Grabber and a secure local bridge on 127.0.0.1.',
      f7Title: 'Three themes, full Arabic',
      f7Desc: 'Light, dark or system, plus a tidy RTL layout and clear Arabic typography.',
      f8Title: 'Light & private',
      f8Desc: 'No built-in browser, no ads, no tracking. Install the download tools with one click from Settings.',
      sitesLabel: 'Works with:',
      platformsKicker: 'Get it on your device',
      platformsTitle: 'An edition for every platform',
      platformsDesc: 'Every link points straight to the official GitHub releases page. Pick the one that fits your device.',
      winTag: 'Most popular',
      winTitle: 'Windows',
      winDesc: 'x64 installer or portable build from the stable 2.0.0 release.',
      linuxTag: 'Linux',
      linuxTitle: 'Linux',
      linuxDesc: 'deb package or AppImage from the archived 1.0.0 release.',
      androidTag: 'Mobile',
      androidTitle: 'Android',
      androidDesc: 'Debug-build APK for trying the app on your phone.',
      howInstallBtn: 'How to install',
      macTag: 'From source',
      macTitle: 'macOS',
      macDesc: 'No dmg published yet; you can build from source with npm.',
      sourceBtn: 'Source code',
      buildGuideBtn: 'Build guide',
      versionLabel: 'Version',
      sizeLabel: 'Size',
      downloadBtn: 'Download',
      filesKicker: 'Files section',
      filesTitle: 'Every file in one place',
      filesDesc: 'Direct links for all releases, with file sizes and SHA-256 hashes to verify integrity before installing.',
      filterAll: 'All',
      filterWindows: 'Windows',
      filterLinux: 'Linux',
      filterAndroid: 'Android',
      filterSource: 'Source',
      searchPlaceholder: 'Search a file name...',
      filesEmpty: 'No matching files.',
      copyLink: 'Copy download link',
      copyHash: 'Copy SHA-256 hash',
      platformLabel: 'Platform',
      platformWindows: 'Windows',
      platformLinux: 'Linux',
      platformAndroid: 'Android',
      platformSource: 'Source',
      releasesKicker: 'Changelog',
      releasesTitle: 'Previous releases',
      releasesDesc: 'Follow the project from the first Linux-only build to the latest Windows and Android binaries.',
      releaseStable: 'Stable',
      releasePrevious: 'Previous',
      releaseLegacy: 'Archive',
      releaseView: 'View release on GitHub →',
      releaseCount: 'files',
      faqKicker: 'FAQ',
      faqTitle: 'Before you start',
      faqDesc: 'Short answers to the questions people ask most before installing and using Wasel.',
      faq1q: 'Is Wasel completely free?',
      faq1a: 'Yes. It is open source under the MIT license, with no ads, subscriptions or payment methods.',
      faq2q: 'Which sites are supported?',
      faq2a: 'It uses yt-dlp, so it supports over a thousand sites including YouTube, Instagram, TikTok, Facebook, X, Vimeo and SoundCloud, plus direct mp4 and m3u8 links.',
      faq3q: 'Do I need to install yt-dlp and FFmpeg manually?',
      faq3a: 'No. You can install or update them from Settings → Engines & libraries → Install missing, and manual installation still works.',
      faq4q: 'Can I download sign-in protected content?',
      faq4a: 'Yes. Choose your browser as the cookies source from the download view or Settings, provided your browser allows reading its cookies.',
      faq5q: 'How do I install the Android version?',
      faq5a: 'Download app-debug.apk from the top of this page, open it on your phone and allow installation from unknown sources for this file only. It is an unsigned experimental build.',
      faq6q: 'How can I verify the file I downloaded?',
      faq6a: 'The Files section lists a SHA-256 hash for every file. Copy it and compare after downloading with certutil -hashfile FILE SHA256 on Windows or sha256sum FILE on Linux.',
      ctaTitle: 'An open-source project',
      ctaDesc: 'Like the app? Star the project or contribute an idea and a fix on GitHub.',
      ctaBtn: 'Visit repository',
      devKicker: 'Behind the project',
      devTitle: 'The developer & accounts',
      devRole: 'Wasel developer',
      devName: 'Zerouki Ahmed Mouad',
      devDesc: 'Designed and built Wasel Downloader with Electron, yt-dlp and FFmpeg, with an Arabic interface inspired by GNOME.',
      accountsTitle: 'My accounts',
      accountsDesc: 'Follow the developer across these platforms.',
      noLink: 'No link',
      copyUsername: 'Copy username',
      copyEmail: 'Send an email',
      footerDesc: 'Download freely, elegantly.',
      footerBy: 'By',
      footerMade: 'Designed after GNOME Adwaita',
      toastCopied: 'Copied to clipboard',
      toastFailed: 'Could not copy, please try again'
    }
  };

  var state = {
    lang: 'ar',
    theme: 'light',
    filter: 'all',
    query: '',
    stars: FALLBACK_STARS
  };

  function t(key) {
    return (I18N[state.lang] && I18N[state.lang][key]) || (I18N.ar[key]) || key;
  }

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var $$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  /* ---------------- Toast / clipboard ---------------- */
  var toastTimer;
  function toast(message) {
    var el = $('#toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(function () { toast(t('toastCopied')); }, function () { legacyCopy(text); });
    } else {
      legacyCopy(text);
    }
  }

  function legacyCopy(text) {
    try {
      var ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', '');
      ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
      document.body.appendChild(ta);
      ta.select();
      var ok = document.execCommand('copy');
      document.body.removeChild(ta);
      toast(ok ? t('toastCopied') : t('toastFailed'));
    } catch (e) {
      toast(t('toastFailed'));
    }
  }

  /* ---------------- Translation ---------------- */
  function applyLanguage(lang) {
    state.lang = (lang === 'en') ? 'en' : 'ar';
    var root = document.documentElement;
    root.lang = state.lang;
    root.dir = state.lang === 'ar' ? 'rtl' : 'ltr';
    var titleKey = root.getAttribute('data-page-title');
    document.title = (titleKey && t(titleKey)) || basePageTitle || t('pageTitle');

    $$('[data-i18n]').forEach(function (el) { el.textContent = t(el.getAttribute('data-i18n')); });
    $$('[data-i18n-placeholder]').forEach(function (el) { el.setAttribute('placeholder', t(el.getAttribute('data-i18n-placeholder'))); });
    $$('[data-i18n-title]').forEach(function (el) {
      var value = t(el.getAttribute('data-i18n-title'));
      el.setAttribute('title', value);
      el.setAttribute('aria-label', value);
    });

    $('#langLabel').textContent = state.lang === 'ar' ? 'EN' : 'ع';
    updateThemeButton();
    renderFiles();
    renderReleases();
    try { localStorage.setItem('wasel-site-lang', state.lang); } catch (e) {}
  }

  /* ---------------- Theme ---------------- */
  var THEMES = ['light', 'dark', 'system'];
  var themeIcons = {
    light: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M18.7 5.3l-1.6 1.6M6.9 17.1l-1.6 1.6"/></svg>',
    dark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/></svg>',
    system: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8M12 17v4"/></svg>'
  };

  function applyTheme(theme) {
    state.theme = THEMES.indexOf(theme) >= 0 ? theme : 'light';
    if (state.theme === 'system') {
      document.documentElement.removeAttribute('data-theme');
    } else {
      document.documentElement.setAttribute('data-theme', state.theme);
    }
    updateThemeButton();
    try { localStorage.setItem('wasel-site-theme', state.theme); } catch (e) {}
  }

  function updateThemeButton() {
    var btn = $('#themeBtn');
    if (!btn) return;
    btn.innerHTML = themeIcons[state.theme];
    var label = t('themeTitle') + ' [' + state.theme + ']';
    btn.setAttribute('title', label);
    btn.setAttribute('aria-label', label);
  }

  /* ---------------- Helpers ---------------- */
  function formatSize(bytes) {
    if (!bytes) return '—';
    return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  }

  function formatDate(iso) {
    try {
      return new Intl.DateTimeFormat(state.lang === 'ar' ? 'ar-u-nu-latn' : 'en-US', {
        year: 'numeric', month: 'short', day: 'numeric'
      }).format(new Date(iso + 'T00:00:00Z'));
    } catch (e) { return iso; }
  }

  var PLATFORM_ICON = {
    windows: '<path d="M3 5.5 11 4.4v7.1H3V5.5Zm9-1.2L21 3v8.5h-9V4.3ZM3 12.5h8v7.1L3 18.5v-6Zm9 0h9V21l-9-1.3v-7.2Z"/>',
    linux: '<path d="M12 2c-3 0-4 3-4 6 0 2-1.5 3-2 5-.7 2.8.2 5 2 8h8c1.8-3 2.7-5.2 2-8-.5-2-2-3-2-5 0-3-1-6-4-6Z"/>',
    android: '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M10 18.6h4M9 6h6"/>',
    source: '<path d="M8 3 3 12l5 9M16 3l5 9-5 9M14 4l-4 16"/>'
  };

  function iconSvg(platform) {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (PLATFORM_ICON[platform] || PLATFORM_ICON.source) + '</svg>';
  }

  function fileUrl(file, tag) {
    return file.url || assetUrl(tag, file.name);
  }

  function allFiles() {
    var out = [];
    RELEASES.forEach(function (rel) {
      rel.assets.forEach(function (a) {
        out.push({ file: a, tag: rel.tag, version: rel.name });
      });
      (rel.sourceAssets || []).forEach(function (a) {
        out.push({ file: a, tag: rel.tag, version: rel.name });
      });
    });
    return out;
  }

  /* ---------------- Files list ---------------- */
  function renderFiles() {
    var list = $('#filesList');
    if (!list) return;
    var q = state.query.trim().toLowerCase();
    var items = allFiles().filter(function (item) {
      var platformOk = state.filter === 'all' || item.file.platform === state.filter;
      var queryOk = !q || (item.file.name + ' ' + item.version + ' ' + item.file.platform).toLowerCase().indexOf(q) >= 0;
      return platformOk && queryOk;
    });

    list.innerHTML = items.map(function (item) {
      var f = item.file;
      var url = fileUrl(f, item.tag);
      var platformLabel = t('platform' + f.platform.charAt(0).toUpperCase() + f.platform.slice(1));
      var hashLine = f.sha
        ? '<span class="file-hash">SHA-256: ' + f.sha.slice(0, 16) + '… <button class="copy-mini" type="button" data-copy="' + f.sha + '" data-i18n-title="copyHash" title="' + t('copyHash') + '" aria-label="' + t('copyHash') + '"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button></span>'
        : '<span class="file-hash">—</span>';

      return '' +
        '<div class="file-row">' +
          '<div class="file-main">' +
            '<span class="file-icon ' + f.platform + '">' + iconSvg(f.platform) + '</span>' +
            '<div><div class="file-name">' + escapeHtml(f.name) + '</div>' + hashLine + '</div>' +
          '</div>' +
          '<div class="file-cell" data-label="' + t('versionLabel') + '"><b>' + escapeHtml(item.version) + '</b></div>' +
          '<div class="file-cell" data-label="' + t('sizeLabel') + '">' + formatSize(f.size) + '</div>' +
          '<div class="file-cell mobile-show" data-label="' + t('platformLabel') + '">' + platformLabel + '</div>' +
          '<div class="file-actions">' +
            '<a class="btn btn-primary btn-sm" href="' + url + '" target="_blank" rel="noopener">' + t('downloadBtn') + '</a>' +
            '<button class="icon-btn icon-copy" type="button" data-copy="' + url + '" data-i18n-title="copyLink" title="' + t('copyLink') + '" aria-label="' + t('copyLink') + '"><svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/></svg></button>' +
          '</div>' +
        '</div>';
    }).join('');

    $('#filesEmpty').hidden = items.length > 0;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  /* ---------------- Releases ---------------- */
  function renderReleases() {
    var root = $('#releaseList');
    if (!root) return;

    root.innerHTML = RELEASES.map(function (rel) {
      var badgeKey = rel.badge === 'stable' ? 'releaseStable' : (rel.badge === 'previous' ? 'releasePrevious' : 'releaseLegacy');
      var assets = rel.assets.map(function (a) {
        return '<span class="asset-chip ' + a.platform + '"><i></i>' + escapeHtml(a.name) + '</span>';
      }).join('');
      var displayVersion = rel.tag === 'v2.0.1' && state.lang === 'ar'
        ? rel.name + ' (وسم ' + rel.tag + ')'
        : rel.tag === 'v2.0.1' ? rel.name + ' (tag ' + rel.tag + ')' : rel.name;

      return '' +
        '<article class="release-item ' + rel.badge + '">' +
          '<div class="release-card">' +
            '<div class="release-head">' +
              '<span class="release-version">' + escapeHtml(displayVersion) + '</span>' +
              '<span class="release-badge ' + rel.badge + '">' + t(badgeKey) + '</span>' +
              '<span class="release-date">' + formatDate(rel.date) + '</span>' +
            '</div>' +
            '<p>' + escapeHtml(rel.notes[state.lang] || rel.notes.ar) + '</p>' +
            '<div class="release-assets">' + assets + '</div>' +
            '<div class="release-foot">' +
              '<a href="' + REPO + '/releases/tag/' + rel.tag + '" target="_blank" rel="noopener">' + t('releaseView') + '</a>' +
              '<span class="release-count">' + rel.assets.length + ' ' + t('releaseCount') + '</span>' +
            '</div>' +
          '</div>' +
        '</article>';
    }).join('');
  }

  /* ---------------- Stars from GitHub (with offline fallback) ---------------- */
  function updateStars() {
    var count = state.stars;
    var starCount = $('#starCount');
    var heroStars = $('#heroStars');
    if (starCount) starCount.textContent = String(count);
    if (heroStars) heroStars.textContent = String(count);

    if (!window.fetch) return;
    fetch(API, { headers: { 'Accept': 'application/vnd.github+json' } })
      .then(function (res) { if (!res.ok) throw new Error('GitHub API'); return res.json(); })
      .then(function (data) {
        if (typeof data.stargazers_count === 'number') {
          state.stars = data.stargazers_count;
          if (starCount) starCount.textContent = String(state.stars);
          if (heroStars) heroStars.textContent = String(state.stars);
        }
      })
      .catch(function () { /* offline or rate-limited: keep the embedded count */ });
  }

  /* ---------------- Navigation & interactions ---------------- */
  function setupNav() {
    var menuBtn = $('#menuBtn');
    var nav = $('#mainNav');
    if (menuBtn && nav) {
      menuBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        var open = nav.classList.toggle('open');
        menuBtn.setAttribute('aria-expanded', String(open));
      });
      document.addEventListener('click', function (e) {
        if (nav.classList.contains('open') && !nav.contains(e.target) && !menuBtn.contains(e.target)) {
          nav.classList.remove('open');
          menuBtn.setAttribute('aria-expanded', 'false');
        }
      });
      $$('a', nav).forEach(function (a) {
        a.addEventListener('click', function () {
          nav.classList.remove('open');
          menuBtn.setAttribute('aria-expanded', 'false');
        });
      });
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && nav.classList.contains('open')) {
          nav.classList.remove('open');
          menuBtn.setAttribute('aria-expanded', 'false');
        }
      });
    }

    // With one HTML file per section, the current file decides the active nav item.
    var current = (location.pathname.split('/').pop() || 'index.html').toLowerCase();
    if (current === '') current = 'index.html';
    $$('.nav a').forEach(function (a) {
      var target = (a.getAttribute('href') || '').split('/').pop().toLowerCase();
      if (target === current || (current === 'index.html' && target === 'index.html')) {
        a.classList.add('active');
        a.setAttribute('aria-current', 'page');
      }
    });
  }

  var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function countUp(el) {
    var target = parseInt(el.getAttribute('data-count'), 10) || 0;
    var suffix = el.getAttribute('data-suffix') || '';
    if (reduceMotion || !window.requestAnimationFrame) {
      el.textContent = target + suffix;
      return;
    }
    var start = performance.now();
    var duration = 1100;
    function frame(now) {
      var p = Math.min((now - start) / duration, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(frame);
    }
    requestAnimationFrame(frame);
  }

  function setupReveal() {
    if (!('IntersectionObserver' in window)) {
      $$('.reveal').forEach(function (el) { el.classList.add('visible'); });
      $$('[data-count]').forEach(countUp);
      return;
    }
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          if (entry.target.hasAttribute('data-count')) countUp(entry.target);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.08, rootMargin: '0px 0px -40px 0px' });
    $$('.reveal').forEach(function (el) { observer.observe(el); });
    $$('[data-count]').forEach(function (el) { observer.observe(el); });
  }

  function init() {
    var savedLang = null, savedTheme = null;
    try { savedLang = localStorage.getItem('wasel-site-lang'); savedTheme = localStorage.getItem('wasel-site-theme'); } catch (e) {}
    var browserLang = (navigator.language || 'ar').toLowerCase().indexOf('en') === 0 ? 'en' : 'ar';

    applyTheme(savedTheme || 'light');
    applyLanguage(savedLang || browserLang);

    var langBtn = $('#langBtn');
    if (langBtn) langBtn.addEventListener('click', function () {
      applyLanguage(state.lang === 'ar' ? 'en' : 'ar');
    });

    var themeBtn = $('#themeBtn');
    if (themeBtn) themeBtn.addEventListener('click', function () {
      var next = (THEMES.indexOf(state.theme) + 1) % THEMES.length;
      applyTheme(THEMES[next]);
    });

    $$('#fileFilters .chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        state.filter = chip.getAttribute('data-filter');
        $$('#fileFilters .chip').forEach(function (c) { c.classList.toggle('active', c === chip); });
        renderFiles();
      });
    });

    var fileSearch = $('#fileSearch');
    if (fileSearch) fileSearch.addEventListener('input', function (e) {
      state.query = e.target.value || '';
      renderFiles();
    });

    document.addEventListener('click', function (e) {
      var btn = e.target.closest ? e.target.closest('[data-copy]') : null;
      if (btn) copyText(btn.getAttribute('data-copy'));
    });

    var year = $('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    setupNav();
    setupReveal();
    updateStars();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
