'use strict';

const http = require('http');

const DEFAULT_PORT = 47821;
const PORT_ATTEMPTS = 5;
const MAX_BODY_BYTES = 256 * 1024;
const RATE_LIMIT_WINDOW_MS = 60000;
const RATE_LIMIT_MAX = 40;

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Honk-Client',
  'Access-Control-Allow-Private-Network': 'true',
  'Access-Control-Max-Age': '86400',
  'Cache-Control': 'no-store'
};

function text(value, max) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, max);
}

function cleanUrl(value) {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw || raw.length > 4096) return null;

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    ...CORS_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  response.end(body);
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];

    request.on('data', (chunk) => {
      size += chunk.length;

      if (size > MAX_BODY_BYTES) {
        reject(new Error('الطلب كبير جدًا.'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });

    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

function normalizePayload(input) {
  if (!input || typeof input !== 'object') return null;

  const url = cleanUrl(input.url);
  if (!url) return null;

  return {
    url,
    title: text(input.title, 300) || null,
    pageUrl: cleanUrl(input.pageUrl),
    referer: cleanUrl(input.referer),
    mode: input.mode === 'audio' ? 'audio' : 'video',
    quality: text(input.quality, 16) || null,
    audioFormat: text(input.audioFormat, 16) || null,
    source: 'extension',
    receivedAt: Date.now()
  };
}

function createRateLimiter() {
  const hits = new Map();

  return function allow(key) {
    const now = Date.now();
    const timestamps = (hits.get(key) || []).filter((time) => now - time < RATE_LIMIT_WINDOW_MS);

    if (timestamps.length >= RATE_LIMIT_MAX) {
      hits.set(key, timestamps);
      return false;
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    return true;
  };
}

function listen(server, port) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.removeListener('listening', onListening);
      reject(error);
    };

    const onListening = () => {
      server.removeListener('error', onError);
      resolve(server.address().port);
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

async function start(options = {}) {
  const onSend = typeof options.onSend === 'function' ? options.onSend : null;
  const version = text(options.version, 32) || '1.0.0';
  const limit = createRateLimiter();
  const startedAt = Date.now();
  const preferredPort = Number.isInteger(options.port) ? options.port : DEFAULT_PORT;
  const state = { port: null, startedAt };

  const server = http.createServer(async (request, response) => {
    const remote = request.socket.remoteAddress || 'local';

    if (!limit(remote)) {
      sendJson(response, 429, { ok: false, error: 'too_many_requests' });
      return;
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204, CORS_HEADERS);
      response.end();
      return;
    }

    let pathname = '/';

    try {
      pathname = new URL(request.url || '/', `http://127.0.0.1:${state.port}`).pathname;
    } catch {
      pathname = '/';
    }

    if (request.method === 'GET' && (pathname === '/ping' || pathname === '/status')) {
      sendJson(response, 200, {
        ok: true,
        app: 'honk-downloader',
        version,
        port: state.port,
        uptime: Math.floor((Date.now() - startedAt) / 1000)
      });
      return;
    }

    if (request.method === 'POST' && pathname === '/send') {
      try {
        const raw = await readBody(request);
        const parsed = JSON.parse(raw || '{}');
        const payload = normalizePayload(parsed);

        if (!payload) {
          sendJson(response, 400, { ok: false, error: 'invalid_url' });
          return;
        }

        if (!onSend) {
          sendJson(response, 503, { ok: false, error: 'receiver_not_ready' });
          return;
        }

        const result = await onSend(payload);
        sendJson(response, 200, { ok: true, ...(result || {}) });
      } catch (error) {
        sendJson(response, 400, {
          ok: false,
          error: error && error.message ? error.message : 'bad_request'
        });
      }
      return;
    }

    sendJson(response, 404, { ok: false, error: 'not_found' });
  });

  let lastError = null;

  for (let attempt = 0; attempt < PORT_ATTEMPTS; attempt += 1) {
    const port = preferredPort + attempt;

    try {
      state.port = await listen(server, port);
      return {
        port: state.port,
        startedAt,
        close: () => new Promise((resolve) => server.close(() => resolve())),
        server
      };
    } catch (error) {
      lastError = error;

      if (error && error.code !== 'EADDRINUSE') break;
    }
  }

  throw new Error(
    `تعذّر تشغيل منفذ الإضافة: ${lastError && lastError.message ? lastError.message : 'خطأ غير معروف.'}`
  );
}

module.exports = {
  start,
  DEFAULT_PORT,
  normalizePayload
};
