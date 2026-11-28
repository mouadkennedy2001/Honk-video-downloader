'use strict';

/*
 * Central human-friendly error mapping.
 *
 * yt-dlp/spotdl/FFmpeg print raw terminal output, exit codes and stack traces.
 * None of that belongs in the UI. Every error crossing the IPC boundary is
 * passed through friendlyError() so non-technical users see a clear next step.
 */

const FALLBACK_DOWNLOAD = 'تعذّر تحميل الملف. قد يكون الرابط محمياً أو غير متاح حالياً. جرّب رابطاً آخر أو حدّث محرك التحميل من الإعدادات.';
const FALLBACK_INFO = 'تعذّر قراءة بيانات هذا الرابط. تأكد من صحة الرابط ثم أعد المحاولة.';
const FALLBACK_INSTALL = 'تعذّر تجهيز الأدوات المطلوبة. تحقق من اتصالك بالإنترنت ثم أعد المحاولة من الإعدادات.';

const RULES = [
  {
    test: /ffmpeg[^\n]*(not found|not installed|missing)|ENOENT[^\n]*ffmpeg/i,
    message: 'جارٍ تثبيت أدوات المعالجة المطلوبة…'
  },
  {
    test: /(yt-dlp|spotdl)[^\n]*(not found|not installed|missing)|ENOENT[^\n]*(yt-dlp|spotdl)|spawn\s+\S*\s+ENOENT/i,
    message: 'جارٍ تجهيز محرك التحميل…'
  },
  {
    test: /permission|EACCES|EPERM|access to the path is denied/i,
    message: 'لا توجد صلاحية للكتابة في مجلد التحميل. اختر مجلداً آخر من الإعدادات.'
  },
  {
    test: /no space left|ENOSPC|disk space/i,
    message: 'المساحة المتاحة على القرص غير كافية. أفرغ بعض المساحة ثم أعد المحاولة.'
  },
  {
    test: /timed? ?out|ETIMEDOUT|ENOTFOUND|ECONNRESET|ECONNABORTED|socket timeout|network is unreachable|getaddrinfo/i,
    message: 'تعذّر الاتصال بالخادم. تحقق من الإنترنت ثم أعد المحاولة.'
  },
  {
    test: /too many requests|rate.?limit|\b429\b|try again later/i,
    message: 'تم تجاوز حد الطلبات. انتظر قليلاً ثم أعد المحاولة.'
  },
  {
    test: /\b403\b|forbidden|access denied|unauthorized/i,
    message: 'تم رفض الوصول إلى هذا المحتوى. جرّب تحديث الكوكيز من الإعدادات.'
  },
  {
    test: /private video|this video is private|sign in to confirm|log in required|registration required|cookies? required/i,
    message: 'هذا المحتوى محمي ويتطلب تسجيل الدخول. أضف الكوكيز من الإعدادات ثم أعد المحاولة.'
  },
  {
    test: /not available in your country|geo ?restrict|blocked in your region/i,
    message: 'هذا المحتوى غير متاح في منطقتك الحالية.'
  },
  {
    test: /video unavailable|has been removed|is unavailable|deleted by|private playlist/i,
    message: 'الفيديو غير متاح أو تم حذفه. جرّب رابطاً آخر.'
  },
  {
    test: /unsupported url|unsupported URL|no suitable|not a valid url|invalid url|unable to extract/i,
    message: 'الرابط غير مدعوم أو غير صالح. جرّب رابطاً آخر.'
  },
  {
    test: /no (?:audio|results|songs|matches)|could not find|song not found|search failed/i,
    message: 'تعذّر العثور على الصوت المطلوب. جارٍ المحاولة من مصدر بديل…'
  },
  {
    test: /playlist|playlist not found/i,
    message: 'تعذّر تحليل قائمة التشغيل. تأكد من أن الرابط عام ثم أعد المحاولة.'
  }
];

function stripAnsi(value) {
  return String(value || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r/g, '');
}

function fallbackFor(context) {
  if (context === 'info' || context === 'preview') return FALLBACK_INFO;
  if (context === 'install') return FALLBACK_INSTALL;
  return FALLBACK_DOWNLOAD;
}

function friendlyError(raw, context) {
  const fallback = fallbackFor(context);
  const input = raw && typeof raw === 'object'
    ? (raw.message || raw.error || '')
    : raw;
  const text = stripAnsi(input).trim();

  if (!text) return fallback;

  for (const rule of RULES) {
    if (rule.test.test(text)) return rule.message;
  }

  // Strip IPC wrappers, terminal noise and bare exit codes before displaying.
  let message = text
    .replace(/^Error invoking remote method ['"][^'"]+['"]:\s*/i, '')
    .replace(/^(?:ERROR|Error|FATAL):\s*/i, '')
    .replace(/\s*\(?(?:رمز الخروج|exit code)\s*\d+\)?/gi, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-1)[0] || '';

  message = message
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^Traceback.*$/i, '')
    .trim();

  const tooTechnical = !message
    || /^(?:error|failed|failure|undefined|null|\d{1,4})$/i.test(message)
    || /^(?:[A-Za-z]:\\|\/|\.{1,2}\/)/.test(message)
    || /^(?:at\s+\S+\s+\(|File\s+"|raise\s+)/i.test(message);

  if (tooTechnical) return fallback;
  return message.length > 260 ? `${message.slice(0, 260)}…` : message;
}

module.exports = {
  friendlyError,
  FALLBACK_DOWNLOAD,
  FALLBACK_INFO,
  FALLBACK_INSTALL
};
