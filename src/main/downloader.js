'use strict';

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const binaries = require('./binaries');
const spotify = require('./spotify');
const { friendlyError } = require('./errors');

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

// Keep only the last meaningful line, then translate it into a message a
// non-technical user can act on. Raw stdout/stderr never reaches the UI.
function cleanError(text, context) {
  const lines = stripAnsi(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const errorLine = [...lines].reverse().find((line) => /error|failed|invalid|unavailable/i.test(line));
  const message = errorLine || lines[lines.length - 1] || '';
  return friendlyError(message, context);
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
  if (spotify.isSpotifyUrl(url)) {
    if (!spotify.resolveCommand()) {
      return Promise.reject(new Error('جارٍ تجهيز محرك التحميل… إذا استمرت المشكلة، ثبّت spotdl من الإعدادات.'));
    }
    return spotify.getInfo(url);
  }

  const binary = binaries.resolve('yt-dlp');
  if (!binary) {
    return Promise.reject(new Error('جارٍ تجهيز محرك التحميل… إذا استمرت المشكلة، ثبّت yt-dlp من الإعدادات.'));
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
      reject(new Error(friendlyError(error, 'info')));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(cleanError(stderr, 'info')));
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

function getPreviewUrl(url, cookieArgs, mode = 'video') {
  if (spotify.isSpotifyUrl(url)) {
    return Promise.reject(new Error('لا تتوفر معاينة فيديو لأغاني Spotify.'));
  }

  const binary = binaries.resolve('yt-dlp');
  if (!binary) {
    return Promise.reject(new Error('لم يتم العثور على yt-dlp.'));
  }

  return new Promise((resolve, reject) => {
    // Use -g to get direct URL, with format selection for preview
    const formatSelector = mode === 'audio'
      ? 'bestaudio[ext=m4a]/bestaudio/best'
      : 'best[height<=720][ext=mp4]/best[height<=720]/best[ext=mp4]/best';

    const args = [
      '-g',
      '--no-warnings',
      '--color', 'no_color',
      '-f', formatSelector,
      '--socket-timeout', '15',
      '--retries', '3',
      '--', url
    ];

    if (Array.isArray(cookieArgs) && cookieArgs.length) {
      args.unshift(...cookieArgs);
    }

    const child = spawn(binary, args, {
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
      reject(new Error('انتهت مهلة الحصول على رابط المعاينة.'));
    }, 20000);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(friendlyError(error, 'info')));
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      if (code !== 0) {
        reject(new Error(cleanError(stderr, 'preview')));
        return;
      }

      const urls = stdout.trim().split('\n').filter(u => u.trim());
      if (urls.length > 0) {
        resolve(urls[0].trim());
      } else {
        reject(new Error('لم يتم العثور على رابط قابل للتشغيل.'));
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
    // NOTE: never pass `--print` / `-O` here — it implies --simulate and the
    // file would never be written (the reported "download finished but the
    // folder is empty" bug).
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

  const visit = (directory, depth) => {
    if (depth > 3) return;

    try {
      for (const name of fs.readdirSync(directory, { withFileTypes: true })) {
        const fullPath = path.join(directory, name.name);

        if (name.isDirectory()) {
          visit(fullPath, depth + 1);
          continue;
        }

        const extension = path.extname(name.name).toLowerCase();
        if (!MEDIA_EXTENSIONS.has(extension)) continue;

        const stat = fs.statSync(fullPath);
        if (!stat.isFile()) continue;
        // ignore incomplete fragments and leftover parts
        if (/\.part$|\.f\d+\.|\.ytdl$/i.test(name.name)) continue;
        if (stat.mtimeMs < startedAt - 5000) continue;

        if (!newest || stat.mtimeMs > newest.mtimeMs) {
          newest = { fullPath, mtimeMs: stat.mtimeMs };
        }
      }
    } catch {
      /* ignore unreadable folders */
    }
  };

  visit(folder, 0);
  return newest ? newest.fullPath : null;
}

// yt-dlp prints Merger/ExtractAudio destinations that may be relative to the
// output folder; resolve them so the UI can always open the real file.
function resolveMaybeRelative(candidate, folder) {
  if (!candidate) return null;
  const trimmed = String(candidate).replace(/^["']|["']$/g, '').trim();
  if (!trimmed) return null;
  if (path.isAbsolute(trimmed)) return fs.existsSync(trimmed) ? trimmed : trimmed;
  const joined = path.join(folder, trimmed);
  return fs.existsSync(joined) ? joined : joined;
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

  if (job.backend === 'spotdl') {
    handleSpotdlLine(job, line, onEvent);
    return;
  }

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
    job.lastPercent = Math.max(0, Math.min(100, Number.parseFloat(percentMatch[1])));
    if (now - job.lastProgressAt < 180) return;
    job.lastProgressAt = now;

    const sizeMatch = line.match(/of\s+(?:~\s*)?([\d.]+\s*[A-Za-z]+)/);
    const speedMatch = line.match(/\bat\s+(\S+)/);
    const etaMatch = line.match(/ETA\s+([\d:]+)/);

    emitSafe(onEvent, {
      type: 'progress',
      id: job.id,
      percent: job.lastPercent,
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

// spotdl's --simple-tui mode logs statuses instead of yt-dlp percentages:
//   "Song: Searching for song" / "...: Downloading" / "2/10 complete".
// Map those statuses onto the same progress payload the renderer already uses.
const SPOTDL_PHASES = [
  { pattern: /searching for song/i, fraction: 0.25, phase: 'searching' },
  { pattern: /getting audio meta/i, fraction: 0.4, phase: 'converting' },
  { pattern: /downloading/i, fraction: 0.7, phase: 'downloading' },
  { pattern: /converting/i, fraction: 0.75, phase: 'converting' },
  { pattern: /embedding metadata/i, fraction: 0.95, phase: 'tagging' },
  { pattern: /^(done|skipped)$/i, fraction: 1, phase: 'downloading' }
];

function handleSpotdlLine(job, line, onEvent) {
  if (!line) return;

  const now = Date.now();
  if (now - job.lastProgressAt < 180) return;

  const completed = line.match(/^(\d+)\s*\/\s*(\d+)\s+complete\b/i);
  if (completed) {
    job.playlistItem = Number(completed[1]);
    job.playlistTotal = Number(completed[2]);
    job.lastPercent = job.playlistTotal
      ? Math.min(100, (job.playlistItem / job.playlistTotal) * 100)
      : 0;
    job.lastProgressAt = now;

    emitSafe(onEvent, {
      type: 'progress',
      id: job.id,
      percent: job.lastPercent,
      phase: 'playlist',
      item: job.playlistItem,
      totalItems: job.playlistTotal,
      size: null,
      speed: null,
      eta: null
    });
    return;
  }

  if (/processing query/i.test(line)) {
    job.lastPercent = 0;
    job.lastProgressAt = now;
    emitSafe(onEvent, {
      type: 'progress',
      id: job.id,
      percent: 0,
      phase: 'searching',
      size: null,
      speed: null,
      eta: null
    });
    return;
  }

  const statusMatch = line.match(/:\s*([^:]+)$/);
  if (!statusMatch) return;

  const status = statusMatch[1].trim();
  const rule = SPOTDL_PHASES.find((entry) => entry.pattern.test(status));
  if (!rule) return;

  const total = job.playlistTotal && job.playlistTotal > 0 ? job.playlistTotal : 1;
  const done = job.playlistItem || 0;
  const percent = Math.max(0, Math.min(100, ((done + rule.fraction) / total) * 100));
  if (percent < job.lastPercent) return;

  job.lastPercent = percent;
  job.lastProgressAt = now;
  emitSafe(onEvent, {
    type: 'progress',
    id: job.id,
    percent,
    phase: rule.phase,
    item: job.playlistTotal ? done || null : null,
    totalItems: job.playlistTotal || null,
    size: null,
    speed: null,
    eta: null
  });
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
  const spotdlJob = spotify.isSpotifyUrl(options.url);

  if (spotdlJob) {
    if (!spotify.resolveCommand()) {
      throw new Error('جارٍ تجهيز محرك التحميل… إذا استمرت المشكلة، ثبّت spotdl من الإعدادات.');
    }
  } else if (!binaries.resolve('yt-dlp')) {
    throw new Error('جارٍ تجهيز محرك التحميل… إذا استمرت المشكلة، ثبّت yt-dlp من الإعدادات.');
  }

  if (!options.outputDir) throw new Error('لم يتم تحديد مجلد التحميل.');

  const ffmpeg = binaries.resolve('ffmpeg');
  const hasFfmpeg = Boolean(ffmpeg);

  if (spotdlJob && !hasFfmpeg) {
    throw new Error('جارٍ تثبيت أدوات المعالجة المطلوبة… أعد بدء التحميل بعد اكتمال التثبيت.');
  }

  if (!spotdlJob && options.mode === 'audio' && !hasFfmpeg) {
    throw new Error('جارٍ تثبيت أدوات المعالجة المطلوبة… أعد بدء التحميل بعد اكتمال التثبيت.');
  }

  if (spotdlJob) options = { ...options, mode: 'audio', ffmpegPath: hasFfmpeg ? ffmpeg : null };

  const outputDir = path.resolve(String(options.outputDir));
  fs.mkdirSync(outputDir, { recursive: true });

  const job = {
    id: options.id,
    backend: spotdlJob ? 'spotdl' : 'ytdlp',
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
  const hasFfmpeg = Boolean(binaries.resolve('ffmpeg'));
  let command = null;
  let binary = null;
  let extraEnv = {};
  let args = [];

  if (job.backend === 'spotdl') {
    command = spotify.resolveCommand();
    if (!command) {
      job.status = 'error';
      emitSafe(job.onEvent, {
        type: 'error',
        id: job.id,
        message: 'جارٍ تجهيز محرك التحميل… أعد المحاولة بعد اكتمال التثبيت.'
      });
      settleJob(job);
      return;
    }

    binary = command.command;
    extraEnv = command.env || {};
    args = [...(command.prefixArgs || []), ...spotify.buildDownloadArgs(job.options, 0)];
  } else {
    binary = binaries.resolve('yt-dlp');
    if (!binary) {
      job.status = 'error';
      emitSafe(job.onEvent, {
        type: 'error',
        id: job.id,
        message: 'جارٍ تجهيز محرك التحميل… أعد المحاولة بعد اكتمال التثبيت.'
      });
      settleJob(job);
      return;
    }

    args = buildDownloadArgs(job.options, job.cookieArgs, hasFfmpeg);
  }

  spawnAttempt(job, { binary, args, extraEnv, command, attempt: 0 });
}

// A single attempt of a queued job. Spotify attempts are retried once with a
// different provider order/bitrate so a source failure stays invisible to the
// user whenever an automatic fallback succeeds.
function spawnAttempt(job, plan) {
  const { binary, args, extraEnv, command, attempt } = plan;

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

    let child;
    try {
      child = spawn(binary, args, {
        windowsHide: true,
        env: {
          ...process.env,
          ...extraEnv,
          PYTHONIOENCODING: 'utf-8',
          PYTHONUTF8: '1',
          NO_COLOR: '1'
        }
      });
    } catch (error) {
      job.status = 'error';
      emitSafe(job.onEvent, {
        type: 'error',
        id: job.id,
        message: friendlyError(error, 'download')
      });
      settleJob(job);
      return;
    }

    job.child = child;

    if (attempt > 0) {
      // Discard the failed attempt's terminal output and show a calm status.
      job.logTail = '';
      job.finalPath = null;
      job.lastDestination = null;
      emitSafe(job.onEvent, {
        type: 'progress',
        id: job.id,
        percent: job.lastPercent || 0,
        phase: 'retrying',
        size: null,
        speed: null,
        eta: null
      });
    }

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
        message: friendlyError(error, 'download')
      });
      settleJob(job);
    });

    child.on('close', (code) => {
      if (job.settled) return;

      // On Windows "pause" kills the process to suspend the download; treat the
      // close as a pause, keep the job alive and let resumeDownload restart it.
      if (job.paused && !job.cancelled) {
        job.child = null;
        job.status = 'paused';
        if (job.activeSlot) {
          job.activeSlot = false;
          activeCount = Math.max(0, activeCount - 1);
          pump();
        }
        emitSafe(job.onEvent, {
          type: 'progress',
          id: job.id,
          percent: job.lastPercent || 0,
          phase: 'paused',
          size: null,
          speed: null,
          eta: null
        });
        return;
      }

      const finalPath = resolveMaybeRelative(
        job.finalPath || job.lastDestination,
        job.folder
      ) || findNewestMedia(job.folder, job.startedAt);

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

      // Silent fallback: try a different set of audio sources before surfacing
      // any error to the user (spotify.js rotates provider order per attempt).
      if (job.backend === 'spotdl' && attempt === 0 && command) {
        job.child = null;
        spawnAttempt(job, {
          ...plan,
          args: [...(command.prefixArgs || []), ...spotify.buildDownloadArgs(job.options, 1)],
          attempt: 1
        });
        return;
      }

      job.status = 'error';
      emitSafe(job.onEvent, {
        type: 'error',
        id: job.id,
        message: cleanError(job.logTail, 'download')
      });
      settleJob(job);
    });
  });
}

function pauseDownload(id) {
  const job = jobs.get(String(id));
  if (!job || !job.child) return false;
  try {
    // Suspending the process tree: Windows has no SIGSTOP, so we kill the
    // process; the close handler keeps the job alive (paused) because
    // yt-dlp resumes partial downloads with `-c`.
    if (process.platform === 'win32') {
      job.paused = true;
      killTree(job.child);
      return true;
    }
    job.child.kill('SIGSTOP');
    job.paused = true;
    job.status = 'paused';
    return true;
  } catch { return false; }
}

function resumeDownload(id) {
  const job = jobs.get(String(id));
  if (!job) return false;

  if (process.platform !== 'win32' && job.child && job.paused) {
    try { job.child.kill('SIGCONT'); job.paused = false; job.status = 'running'; return true; }
    catch { /* fall through to restart */ }
  }

  // Restart the download; yt-dlp continues the partial file thanks to `-c`.
  if (job.child) killTree(job.child);
  job.paused = false;
  job.settled = false;
  job.child = null;
  job.status = 'queued';
  job.startedAt = Date.now() - 60 * 60 * 1000; // keep findNewestMedia valid for the old partial
  pending.unshift(job);
  pump();
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

  if (!job.child) {
    // paused job: nothing is running, settle immediately
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
  resumeDownload,
  getPreviewUrl
};
