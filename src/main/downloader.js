'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const binaries = require('./binaries');

const MEDIA_EXTENSIONS = new Set([
  '.mp4', '.mkv', '.webm', '.mov', '.avi', '.flv', '.ts', '.m4v',
  '.mp3', '.m4a', '.aac', '.opus', '.ogg', '.wav', '.flac', '.3gp'
]);

const jobs = new Map();
const pending = [];
const INFO_TIMEOUT_MS = 90000;
const DEFAULT_CONCURRENCY = 2;

let activeCount = 0;
let maxActive = DEFAULT_CONCURRENCY;

function stripAnsi(value) {
  return String(value || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .replace(/\r/g, '');
}

function cleanError(text) {
  const lines = stripAnsi(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const errorLine = [...lines].reverse().find((line) => /error/i.test(line));
  let message = errorLine || lines[lines.length - 1] || '';

  message = message.replace(/^ERROR:\s*/i, '').trim();

  if (message.length > 500) message = `${message.slice(0, 500)}…`;
  return message;
}

function summarize(data) {
  const formats = Array.isArray(data.formats) ? data.formats : [];
  const thumbnails = Array.isArray(data.thumbnails) ? data.thumbnails : [];
  const entries = Array.isArray(data.entries) ? data.entries : [];

  const heightSources = formats.length
    ? formats
    : entries.flatMap((entry) => (Array.isArray(entry.formats) ? entry.formats : []));

  const heights = [...new Set(
    heightSources
      .filter((format) => format.height && format.vcodec && format.vcodec !== 'none')
      .map((format) => Number(format.height))
  )].filter((height) => Number.isFinite(height)).sort((a, b) => b - a);

  const thumbnail = data.thumbnail
    || (thumbnails.length ? thumbnails[thumbnails.length - 1].url : null)
    || entries.find((entry) => entry.thumbnail)?.thumbnail
    || null;

  const subtitleLangs = new Set([
    ...Object.keys(data.subtitles || {}),
    ...Object.keys(data.automatic_captions || {})
  ]);

  const playlistCount = data._type === 'playlist'
    ? Number(data.playlist_count || entries.length || 0)
    : 0;

  return {
    id: data.id || null,
    title: data.title || data.fulltitle || 'فيديو بدون عنوان',
    thumbnail: thumbnail || null,
    duration: Number.isFinite(data.duration) ? Number(data.duration) : null,
    uploader: data.uploader || data.channel || data.creator || null,
    webpageUrl: data.webpage_url || data.original_url || null,
    extractor: data.extractor_key || data.extractor || null,
    description: typeof data.description === 'string' ? data.description.slice(0, 400) : null,
    isLive: Boolean(data.is_live),
    isPlaylist: Boolean(playlistCount),
    playlistCount,
    heights,
    subtitleLangs: [...subtitleLangs].slice(0, 30),
    hasAudio: formats.length === 0 || formats.some((format) => format.acodec && format.acodec !== 'none'),
    hasVideo: formats.length === 0 || formats.some((format) => format.vcodec && format.vcodec !== 'none')
  };
}

function looksLikePlaylistUrl(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname.toLowerCase();

    if (/(?:^|\/)(playlist|sets|album|show|series)(?:\/|$)/.test(pathname)) return true;
    if (parsed.searchParams.has('list') && !parsed.searchParams.has('v')) return true;
    return false;
  } catch {
    return false;
  }
}

function buildInfoArgs(url, cookieArgs) {
  const args = [
    '--dump-single-json',
    looksLikePlaylistUrl(url) ? '--yes-playlist' : '--no-playlist',
    '--flat-playlist',
    '--no-warnings',
    '--color', 'no_color',
    '--socket-timeout', '20',
    '--retries', '3'
  ];

  if (Array.isArray(cookieArgs) && cookieArgs.length) args.push(...cookieArgs);

  args.push('--', url);
  return args;
}

function getInfo(url, cookieArgs) {
  const binary = binaries.resolve('yt-dlp');
  if (!binary) {
    return Promise.reject(new Error('لم يتم العثور على yt-dlp. استخدم زر التثبيت في الإعدادات ثم أعد المحاولة.'));
  }

  return new Promise((resolve, reject) => {
    const child = spawn(binary, buildInfoArgs(url, cookieArgs), {
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1' }
    });
    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill('SIGKILL'); } catch { /* ignore */ }
      reject(new Error('انتهت مهلة تحليل الرابط. تحقّق من الاتصال أو جرّب رابطًا آخر.'));
    }, INFO_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
      if (stdout.length > 40 * 1024 * 1024) {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      }
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
      if (stderr.length > 20000) stderr = stderr.slice(-20000);
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`تعذّر تشغيل yt-dlp: ${error.message}`));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(cleanError(stderr) || `فشل تحليل الرابط (رمز الخروج ${code}).`));
        return;
      }

      try {
        const data = JSON.parse(stdout);
        resolve(summarize(data));
      } catch {
        reject(new Error('تعذّر قراءة بيانات الفيديو. قد يكون الرابط غير مدعوم أو محميًا.'));
      }
    });
  });
}

function buildDownloadArgs(options, cookieArgs, hasFfmpeg) {
  const template = options.filenameTemplate || '%(title).150s [%(id)s].%(ext)s';
  const outputPath = options.outputDir ? (options.outputSubfolder ? path.join(options.outputDir, '%(uploader)s', template) : path.join(options.outputDir, template)) : template;
  const args = [
    options.playlist ? '--yes-playlist' : '--no-playlist',
    '--newline',
    '--no-warnings',
    '--color', 'no_color',
    '--socket-timeout', '20',
    '--retries', '10',
    '--fragment-retries', '10',
    '--concurrent-fragments', '6',
    '--buffer-size', options.bufferSize || '16K',
    '--trim-filenames', '180',
    '-O', 'filename',
    '-c', // resume partial
    '-o', outputPath
  ];

  if (options.restrictFilenames) args.push('--restrict-filenames');
  if (options.speedLimit) args.push('-r', options.speedLimit);
  if (options.proxy) args.push('--proxy', options.proxy);
  if (options.userAgent) args.push('--user-agent', options.userAgent);
  if (options.playlistStart || options.playlistEnd) {
    args.push('--playlist-start', String(options.playlistStart || 1));
    if (options.playlistEnd) args.push('--playlist-end', String(options.playlistEnd));
  }
  if (options.maxHeight) args.push('--max-height', String(options.maxHeight));
  if (options.sponsorblock) args.push('--sponsorblock-remove', 'default');
  if (options.downloadChapters || options.embedChapters) args.push('--embed-chapters');
  if (options.downloadThumbnail || options.thumbnailOnly) args.push('--write-thumbnail','--convert-thumbnails','jpg');
  if (options.downloadInfoJson) args.push('--write-info-json');
  if (options.writeDescription) args.push('--write-description');
  if (options.parseMetadata) args.push('--parse-metadata','title:%()s');
  if (options.skipDownload) args.push('-s');

  if (hasFfmpeg) {
    try { const ffmpegDir = path.dirname(binaries.resolve('ffmpeg')); if (ffmpegDir) args.push('--ffmpeg-location', ffmpegDir); } catch {}
  }

  if (Array.isArray(cookieArgs) && cookieArgs.length) args.push(...cookieArgs);

  if (options.mode === 'audio' || options.thumbnailOnly) {
    if (options.thumbnailOnly) args.push('--skip-download','--write-thumbnail');
    else {
      args.push('-f', 'ba/b', '-x');
      if (options.audioFormat && options.audioFormat !== 'best') {
        args.push('--audio-format', options.audioFormat);
        if (options.audioFormat === 'mp3') args.push('--audio-quality', '0');
        if (options.audioBitrate && options.audioBitrate !== '0') args.push('--audio-quality', options.audioBitrate);
      }
    }
  } else {
    const quality = options.quality && options.quality !== 'best'
      ? Number.parseInt(options.quality, 10)
      : null;

    if (hasFfmpeg) {
      if (quality) {
        args.push('-f', `bv*[height<=${quality}]+ba/b[height<=${quality}]/bv*+ba/b`);
      } else {
        args.push('-f', 'bv*+ba/b');
      }
      const outFmt = options.mergeOutputFormat || options.videoFormat || 'mp4';
      if (outFmt !== 'best') args.push('--merge-output-format', outFmt);
      if (options.recodeVideo && options.recodeVideo !== 'best') args.push('--recode-video', options.recodeVideo);
    } else if (quality) {
      args.push('-f', `b[height<=${quality}]/b`);
    } else {
      args.push('-f', 'b');
    }
  }

  if (hasFfmpeg && options.embedMetadata) {
    args.push('--embed-metadata', '--embed-thumbnail', '--convert-thumbnails', 'jpg');
  }

  if (hasFfmpeg && options.downloadSubtitles) {
    const langs = options.subtitleLangs && options.subtitleLangs !== 'all'
      ? options.subtitleLangs
      : 'all';

    args.push(
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', langs,
      '--embed-subs',
      '--compat-options', 'no-keep-subs'
    );
  }

  if (options.extractorArgs) {
    const parts = String(options.extractorArgs).split(/\s+/).filter(Boolean);
    for (const p of parts) args.push(p);
  }

  args.push('--', options.url);
  return args;
}

function findNewestMedia(folder, startedAt) {
  let newest = null;

  try {
    for (const name of fs.readdirSync(folder)) {
      const extension = path.extname(name).toLowerCase();
      if (!MEDIA_EXTENSIONS.has(extension)) continue;

      const fullPath = path.join(folder, name);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile()) continue;
      if (stat.mtimeMs < startedAt - 5000) continue;

      if (!newest || stat.mtimeMs > newest.mtimeMs) {
        newest = { fullPath, mtimeMs: stat.mtimeMs };
      }
    }
  } catch {
    return null;
  }

  return newest ? newest.fullPath : null;
}

function emitSafe(onEvent, payload) {
  try {
    onEvent(payload);
  } catch {
    /* the window may have been closed */
  }
}

function handleProgressLine(job, rawLine, onEvent) {
  const line = stripAnsi(rawLine).trim();
  if (!line) return;

  job.logTail = `${job.logTail}\n${line}`.slice(-12000);

  let match = line.match(/^\[download\] Destination:\s*(.+)$/);
  if (match) {
    job.lastDestination = match[1].trim();
    return;
  }

  match = line.match(/^\[download\]\s+(.+?)\s+has already been downloaded/);
  if (match) {
    job.finalPath = match[1].trim();
    return;
  }

  match = line.match(/^\[download\] Downloading item (\d+) of (\d+)/i);
  if (match) {
    job.playlistItem = Number(match[1]);
    job.playlistTotal = Number(match[2]);
    emitSafe(onEvent, {
      type: 'progress',
      id: job.id,
      percent: 0,
      phase: 'playlist',
      item: job.playlistItem,
      totalItems: job.playlistTotal,
      size: null,
      speed: null,
      eta: null
    });
    return;
  }

  match = line.match(/^\[Merger\] Merging formats into\s+"(.+)"$/);
  if (match) {
    job.finalPath = match[1].trim();
    emitSafe(onEvent, {
      type: 'progress',
      id: job.id,
      percent: 100,
      phase: 'merging',
      size: null,
      speed: null,
      eta: null
    });
    return;
  }

  match = line.match(/^\[ExtractAudio\] Destination:\s*(.+)$/);
  if (match) {
    job.finalPath = match[1].trim();
    emitSafe(onEvent, {
      type: 'progress',
      id: job.id,
      percent: 100,
      phase: 'converting',
      size: null,
      speed: null,
      eta: null
    });
    return;
  }

  const percentMatch = line.match(/^\[download\]\s+([\d.]+)%/);
  if (percentMatch) {
    const now = Date.now();
    if (now - job.lastProgressAt < 180) return;
    job.lastProgressAt = now;

    const sizeMatch = line.match(/of\s+(?:~\s*)?([\d.]+\s*[A-Za-z]+)/);
    const speedMatch = line.match(/\bat\s+(\S+)/);
    const etaMatch = line.match(/ETA\s+([\d:]+)/);

    emitSafe(onEvent, {
      type: 'progress',
      id: job.id,
      percent: Math.max(0, Math.min(100, Number.parseFloat(percentMatch[1]))),
      phase: 'downloading',
      item: job.playlistItem || null,
      totalItems: job.playlistTotal || null,
      size: sizeMatch ? sizeMatch[1] : null,
      speed: speedMatch && speedMatch[1] !== 'Unknown' ? speedMatch[1] : null,
      eta: etaMatch ? etaMatch[1] : null
    });
    return;
  }

  if (/^\[(Merger|ExtractAudio|VideoConvertor|FixupM3u8|FixupM4a|EmbedThumbnail|Metadata|EmbedSubtitle|SubtitlesConvertor)\]/.test(line)) {
    const phase = /Merger/.test(line)
      ? 'merging'
      : /Metadata|EmbedThumbnail/.test(line)
        ? 'tagging'
        : 'converting';

    emitSafe(onEvent, {
      type: 'progress',
      id: job.id,
      percent: 100,
      phase,
      size: null,
      speed: null,
      eta: null
    });
  }
}

function killTree(child) {
  if (!child || child.exitCode !== null) return;

  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
    } catch {
      /* ignore */
    }
    return;
  }

  try { child.kill('SIGTERM'); } catch { /* ignore */ }
  setTimeout(() => {
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
  }, 2500);
}

function startDownload(options, cookieArgs, onEvent) {
  const binary = binaries.resolve('yt-dlp');
  if (!binary) {
    throw new Error('لم يتم العثور على yt-dlp. استخدم زر التثبيت في الإعدادات ثم أعد المحاولة.');
  }

  if (!options.outputDir) throw new Error('لم يتم تحديد مجلد التحميل.');

  const ffmpeg = binaries.resolve('ffmpeg');
  const hasFfmpeg = Boolean(ffmpeg);

  if (options.mode === 'audio' && !hasFfmpeg) {
    throw new Error('تحويل الصوت يتطلب FFmpeg. استخدم زر التثبيت في الإعدادات ثم أعد المحاولة.');
  }

  const outputDir = path.resolve(String(options.outputDir));
  fs.mkdirSync(outputDir, { recursive: true });

  const job = {
    id: options.id,
    options: { ...options, outputDir },
    cookieArgs: Array.isArray(cookieArgs) ? cookieArgs : [],
    onEvent,
    child: null,
    cancelled: false,
    settled: false,
    status: 'queued',
    activeSlot: false,
    finalPath: null,
    lastDestination: null,
    lastProgressAt: 0,
    logTail: '',
    folder: outputDir,
    startedAt: Date.now(),
    playlistItem: null,
    playlistTotal: null
  };

  jobs.set(job.id, job);
  pending.push(job);

  const requested = Number.parseInt(options.maxConcurrent, 10);
  if (Number.isFinite(requested)) {
    maxActive = Math.min(6, Math.max(1, requested));
  }

  pump();

  return { id: job.id, folder: outputDir };
}

function pump() {
  while (activeCount < maxActive && pending.length) {
    const job = pending.shift();

    if (!job || job.cancelled) {
      if (job) jobs.delete(job.id);
      continue;
    }

    activeCount += 1;
    job.activeSlot = true;
    job.status = 'running';
    runJob(job);
  }
}

function settleJob(job) {
  if (job.settled) return;
  job.settled = true;
  jobs.delete(job.id);

  if (job.activeSlot) {
    job.activeSlot = false;
    activeCount = Math.max(0, activeCount - 1);
  }

  pump();
}

function runJob(job) {
  const binary = binaries.resolve('yt-dlp');
  const hasFfmpeg = Boolean(binaries.resolve('ffmpeg'));

  if (!binary) {
    job.status = 'error';
    emitSafe(job.onEvent, {
      type: 'error',
      id: job.id,
      message: 'لم يتم العثور على yt-dlp.'
    });
    settleJob(job);
    return;
  }

  const args = buildDownloadArgs(job.options, job.cookieArgs, hasFfmpeg);

  setImmediate(() => {
    if (job.cancelled) {
      job.status = 'cancelled';
      emitSafe(job.onEvent, {
        type: 'cancelled',
        id: job.id,
        message: 'تم إلغاء التحميل.'
      });
      settleJob(job);
      return;
    }

    const child = spawn(binary, args, {
      windowsHide: true,
      env: { ...process.env, PYTHONIOENCODING: 'utf-8', NO_COLOR: '1' }
    });

    job.child = child;

    const stdout = readline.createInterface({ input: child.stdout });
    const stderr = readline.createInterface({ input: child.stderr });

    stdout.on('line', (line) => handleProgressLine(job, line, job.onEvent));
    stderr.on('line', (line) => handleProgressLine(job, line, job.onEvent));

    child.on('error', (error) => {
      if (job.settled) return;
      job.status = 'error';
      emitSafe(job.onEvent, {
        type: 'error',
        id: job.id,
        message: `تعذّر تشغيل yt-dlp: ${error.message}`
      });
      settleJob(job);
    });

    child.on('close', (code) => {
      if (job.settled) return;

      const finalPath = job.finalPath
        || job.lastDestination
        || findNewestMedia(job.folder, job.startedAt);

      if (job.cancelled) {
        job.status = 'cancelled';
        emitSafe(job.onEvent, {
          type: 'cancelled',
          id: job.id,
          message: 'تم إلغاء التحميل.'
        });
        settleJob(job);
        return;
      }

      if (code === 0) {
        job.status = 'done';
        emitSafe(job.onEvent, {
          type: 'done',
          id: job.id,
          finalPath: finalPath || null,
          folder: job.folder,
          item: job.playlistItem || null,
          totalItems: job.playlistTotal || null
        });
        settleJob(job);
        return;
      }

      job.status = 'error';
      const message = cleanError(job.logTail)
        || `فشل التحميل (رمز الخروج ${code}).`;

      emitSafe(job.onEvent, {
        type: 'error',
        id: job.id,
        message
      });
      settleJob(job);
    });
  });
}

function pauseDownload(id) {
  const job = jobs.get(String(id));
  if (!job || !job.child) return false;
  try {
    if (process.platform === 'win32') {
      // Windows: suspend via taskkill? Use SIGSTOP not available, emulate by killing and re-queue
      job.paused = true;
      killTree(job.child);
      return true;
    } else {
      job.child.kill('SIGSTOP');
      job.paused = true;
      return true;
    }
  } catch { return false; }
}

function resumeDownload(id) {
  const job = jobs.get(String(id));
  if (!job) return false;
  job.paused = false;
  if (job.child && process.platform !== 'win32') {
    try { job.child.kill('SIGCONT'); return true; } catch { return false; }
  }
  // Windows restart: re-run job (yt-dlp supports --continue)
  if (job.child) {
    try { job.child.kill('SIGTERM'); } catch {}
  }
  setTimeout(() => { if (job && !job.settled) runJob(job); }, 300);
  return true;
}

function cancelDownload(id) {
  const job = jobs.get(String(id));
  if (!job) return false;

  job.cancelled = true;

  if (job.status === 'queued') {
    const index = pending.indexOf(job);
    if (index >= 0) pending.splice(index, 1);

    job.status = 'cancelled';
    emitSafe(job.onEvent, {
      type: 'cancelled',
      id: job.id,
      message: 'تم إلغاء التحميل.'
    });
    settleJob(job);
    return true;
  }

  killTree(job.child);
  return true;
}

module.exports = {
  getInfo,
  startDownload,
  cancelDownload,
  pauseDownload,
  resumeDownload
};
