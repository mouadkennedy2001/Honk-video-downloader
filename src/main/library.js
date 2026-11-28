'use strict';

/*
 * Local library helpers for Wasel Downloader.
 *
 * The history view must not become an analytics dashboard. This module only
 * answers one question: which recorded download files are no longer where we
 * saved them? It also returns the files that are still present so the renderer
 * can build the smart library view (clean names + duplicate hints).
 *
 * Paths outside the configured download folder are ignored, so a saved history
 * entry can never be used to probe arbitrary locations on the user's disk.
 */

const fs = require('fs');
const path = require('path');

function isInside(target, root) {
  const full = path.resolve(String(target || ''));
  const base = path.resolve(String(root || ''));
  const relative = path.relative(base, full);

  if (!relative) return true;
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  return true;
}

function fileInfo(fullPath) {
  try {
    const stat = fs.statSync(fullPath);
    if (!stat.isFile()) return null;
    return { size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function describe(entry, info, missing) {
  return {
    url: typeof entry.url === 'string' ? entry.url : '',
    title: typeof entry.title === 'string' && entry.title ? entry.title : (entry.url || ''),
    path: path.resolve(String(entry.path || '')),
    thumb: typeof entry.thumb === 'string' ? entry.thumb : '',
    size: info ? info.size : (Number(entry.size) > 0 ? Number(entry.size) : 0),
    mtimeMs: info ? info.mtimeMs : 0,
    at: Number(entry.completedAt || entry.at) || 0,
    missing: Boolean(missing)
  };
}

function scanLibrary(entries, downloadDir) {
  const missing = [];
  const present = [];
  const seen = new Set();

  for (const raw of Array.isArray(entries) ? entries : []) {
    if (!raw || typeof raw !== 'object') continue;

    const target = String(raw.path || '');
    if (!target || seen.has(target)) continue;
    seen.add(target);

    if (!isInside(target, downloadDir)) continue;

    const full = path.resolve(target);
    const info = fileInfo(full);

    if (info) present.push(describe(raw, info, false));
    else missing.push(describe(raw, null, true));
  }

  return { missing, present };
}

module.exports = {
  isInside,
  scanLibrary
};
