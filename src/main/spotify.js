'use strict';

/*
 * Spotify support through spotdl.
 *
 * spotdl is a Python tool (not a standalone binary), so this module knows how
 * to find either:
 *   - an installed `spotdl` executable, or
 *   - a Python interpreter able to run `python -m spotdl`
 *     (including the copy installed by the in-app installer into <bin>/spotdl-lib).
 *
 * Metadata is read from Spotify's public oEmbed endpoint; the actual audio is
 * downloaded by spotdl (it searches a music provider such as YouTube and then
 * writes tagged audio files with FFmpeg).
 */

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { execFileSync } = require('child_process');
const binaries = require('./binaries');

const INFO_TIMEOUT_MS = 20000;
const REDIRECT_LIMIT = 4;
const CACHE_MS = 30000;

const FORMATS = new Set(['mp3', 'flac', 'ogg', 'opus', 'm4a', 'wav']);
const LIST_TYPES = new Set(['playlist', 'album', 'artist', 'show', 'episode']);

let cachedCommand = null;
let cachedAt = 0;

function libraryDir() {
  return path.join(binaries.getUserBinDir(), 'spotdl-lib');
}

function isSpotifyUrl(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || '').trim());
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    return host === 'spotify.com'
      || host === 'spotify.link'
      || host.endsWith('.spotify.com');
  } catch {
    return false;
  }
}

function withPythonPath(env, extraDir) {
  const dir = extraDir || libraryDir();
  const existing = env && env.PYTHONPATH ? String(env.PYTHONPATH) : '';
  return {
    ...(env || process.env),
    PYTHONPATH: existing ? `${existing}${path.delimiter}${dir}` : dir
  };
}

function stringCandidate(command, prefixArgs, seen) {
  if (!command) return;
  const key = `${command}|${(prefixArgs || []).join(' ')}`;
  if (seen.has(key)) return;
  seen.add(key);
  return { command, prefixArgs: prefixArgs || [] };
}

function pythonCandidates() {
  const seen = new Set();
  const candidates = [];
  const add = (command, prefixArgs) => {
    const candidate = stringCandidate(command, prefixArgs, seen);
    if (candidate) candidates.push(candidate);
  };

  add(binaries.resolve('python'), []);
  add(binaries.resolve('python3'), []);

  const py = binaries.which('py');
  if (py) add(py, ['-3']);

  if (process.platform !== 'win32') {
    add('/usr/bin/python3', []);
    add('/usr/local/bin/python3', []);
  } else {
    // Winget / the official installer put Python under LOCALAPPDATA or Program Files.
    const roots = [
      process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Programs', 'Python') : null,
      'C:\\Program Files\\Python312',
      'C:\\Program Files\\Python311',
      'C:\\Program Files\\Python310'
    ].filter(Boolean);

    for (const root of roots) {
      try {
        for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
          if (entry.isDirectory() && /^Python3\d{2}$/i.test(entry.name)) {
            add(path.join(root, entry.name, 'python.exe'), []);
          }
        }
      } catch {
        /* optional location */
      }
    }
  }

  return candidates;
}

function runCheck(candidate, args, env) {
  try {
    const output = execFileSync(candidate.command, [...candidate.prefixArgs, ...args], {
      encoding: 'utf8',
      timeout: 12000,
      windowsHide: true,
      maxBuffer: 1024 * 512,
      env: env || process.env
    });

    return String(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || null;
  } catch {
    return null;
  }
}

function findPython() {
  for (const candidate of pythonCandidates()) {
    const version = runCheck(candidate, ['-c', 'import sys; print(sys.version.split()[0])']);
    if (version && /\d/.test(version)) {
      return { ...candidate, version };
    }
  }
  return null;
}

function resolveCommand(force) {
  if (!force && cachedCommand && Date.now() - cachedAt < CACHE_MS) return cachedCommand;

  let found = null;

  // Prefer the in-app pip installation so an upgrade always takes effect,
  // then fall back to a system-wide spotdl executable.
  for (const candidate of pythonCandidates()) {
    const env = withPythonPath(process.env);
    const version = runCheck(candidate, ['-m', 'spotdl', '--version'], env);
    if (version && /\d/.test(version)) {
      found = {
        command: candidate.command,
        prefixArgs: [...candidate.prefixArgs, '-m', 'spotdl'],
        env,
        version
      };
      break;
    }
  }

  if (!found) {
    const direct = binaries.resolve('spotdl');
    if (direct) {
      const version = runCheck({ command: direct, prefixArgs: [] }, ['--version']);
      if (version && /\d/.test(version)) {
        found = {
          command: direct,
          prefixArgs: [],
          env: {},
          version
        };
      }
    }
  }

  cachedCommand = found;
  cachedAt = Date.now();
  return found;
}

function clearCache() {
  cachedCommand = null;
  cachedAt = 0;
}

function version() {
  const command = resolveCommand();
  return command ? command.version : null;
}

function status() {
  const command = resolveCommand();
  return {
    available: Boolean(command),
    command: command ? command.command : null,
    version: command ? command.version : null
  };
}

function requestJson(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('عنوان Spotify غير صالح.'));
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.get(url, {
      headers: {
        'User-Agent': 'Wasel-Downloader/2.0 (+https://github.com)',
        Accept: 'application/json'
      }
    }, (response) => {
      const statusCode = response.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(statusCode)) {
        response.resume();
        const location = response.headers.location;
        if (!location || redirectsLeft <= 0) {
          reject(new Error('تعذّر متابعة رابط Spotify.'));
          return;
        }
        requestJson(new URL(location, url).toString(), redirectsLeft - 1).then(resolve, reject);
        return;
      }

      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 512 * 1024) request.destroy();
      });
      response.on('end', () => {
        if (statusCode !== 200) {
          reject(new Error(`فشل قراءة بيانات Spotify (HTTP ${statusCode}).`));
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          reject(new Error('تعذّر قراءة بيانات Spotify.'));
        }
      });
    });

    request.setTimeout(INFO_TIMEOUT_MS, () => {
      request.destroy(new Error('انتهت مهلة قراءة بيانات Spotify.'));
    });
    request.on('error', reject);
  });
}

async function resolveShortLink(rawUrl) {
  const parsed = new URL(rawUrl);
  if (parsed.hostname.toLowerCase().replace(/^www\./, '') !== 'spotify.link') return rawUrl;

  try {
    const json = await requestJson(`https://open.spotify.com/oembed?url=${encodeURIComponent(rawUrl)}`, REDIRECT_LIMIT);
    const match = String(json.iframe_url || json.html || '').match(/https:\/\/open\.spotify\.com\/embed\/[a-z]+\/([A-Za-z0-9]+)/i);
    if (match) return `https://open.spotify.com/track/${match[1]}`;
  } catch {
    /* fall through: spotdl may still understand the original link */
  }
  return rawUrl;
}

async function fetchMetadata(rawUrl) {
  try {
    const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(rawUrl)}`;
    return await requestJson(endpoint, REDIRECT_LIMIT);
  } catch {
    return null;
  }
}

async function getInfo(rawUrl) {
  const url = await resolveShortLink(rawUrl);
  const parsed = new URL(url);
  let parts = parsed.pathname.split('/').filter(Boolean);

  // Spotify serves regional URLs such as /intl-ar/track/<id> and embed URLs
  // such as /embed/track/<id>. Normalise both before reading the type and id.
  if (/^intl-[a-z]{2,}/i.test(parts[0] || '')) parts = parts.slice(1);
  if ((parts[0] || '').toLowerCase() === 'embed') parts = parts.slice(1);

  const type = (parts[0] || 'track').toLowerCase();
  const id = parts[1] || null;
  const isList = LIST_TYPES.has(type) || /\/playlist\//i.test(parsed.pathname);
  const metadata = await fetchMetadata(url);

  return {
    id: id ? `${type}-${id}` : 'spotify',
    title: metadata && metadata.title ? metadata.title : `Spotify ${type}`,
    thumbnail: metadata && metadata.thumbnail_url ? metadata.thumbnail_url : null,
    duration: null,
    uploader: metadata && metadata.author_name ? metadata.author_name : null,
    webpageUrl: url,
    extractor: 'spotdl',
    description: null,
    isLive: false,
    isPlaylist: isList,
    playlistCount: 0,
    heights: [],
    subtitleLangs: [],
    hasAudio: true,
    hasVideo: false,
    backend: 'spotdl',
    infoDegraded: !metadata
  };
}

function buildDownloadArgs(options) {
  const requestedFormat = String(options.audioFormat || '').toLowerCase();
  const format = FORMATS.has(requestedFormat) ? requestedFormat : 'mp3';

  const templateParts = [options.outputDir];
  if (options.playlist && options.outputSubfolder) templateParts.push('{list-name}');
  templateParts.push('{artists} - {title}.{output-ext}');

  const args = [
    'download',
    // spotdl's positional `query` (nargs="+") must come before any options;
    // putting it at the end makes argparse reject the URL as unrecognized.
    options.url,
    '--simple-tui',
    '--log-level', 'INFO',
    '--headless',
    '--format', format,
    '--output', path.join(...templateParts),
    '--restrict', 'strict',
    '--max-filename-length', '150',
    '--overwrite', 'skip',
    '--threads', '1'
  ];

  if (options.ffmpegPath) args.push('--ffmpeg', options.ffmpegPath);
  if (options.proxy) args.push('--proxy', options.proxy);

  return args;
}

module.exports = {
  isSpotifyUrl,
  getInfo,
  resolveCommand,
  clearCache,
  version,
  status,
  findPython,
  pythonCandidates,
  withPythonPath,
  libraryDir,
  buildDownloadArgs
};
