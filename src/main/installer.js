'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const https = require('https');
const { spawn, spawnSync, execFileSync } = require('child_process');
const AdmZip = require('adm-zip');
const binaries = require('./binaries');
const spotify = require('./spotify');

const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_REDIRECTS = 8;
const USER_AGENT = 'Wasel-Downloader/2.0 (+https://github.com)';

let binDir = binaries.getUserBinDir();

function setBinDir(dir) {
  binDir = dir ? path.resolve(dir) : null;
  if (binDir) binaries.setUserBinDir(binDir);
  return binDir;
}

function getBinDir() {
  // Always honour the latest directory known to binaries.js — it may be set
  // after this module loads (main.js sets <userData>/bin on startup).
  const current = binaries.getUserBinDir();
  if (current) binDir = current;
  else if (!binDir) setBinDir(path.join(os.homedir(), '.wasel-downloader', 'bin'));

  fs.mkdirSync(binDir, { recursive: true });
  return binDir;
}

function ytDlpAssets() {
  const base = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download';

  if (process.platform === 'win32') {
    return [
      { url: `${base}/yt-dlp.exe`, archive: 'file', name: 'yt-dlp.exe' }
    ];
  }

  if (process.platform === 'darwin') {
    return [
      { url: `${base}/yt-dlp_macos`, archive: 'file', name: 'yt-dlp' }
    ];
  }

  if (process.arch === 'arm64') {
    return [
      { url: `${base}/yt-dlp_linux_aarch64`, archive: 'file', name: 'yt-dlp' },
      { url: `${base}/yt-dlp`, archive: 'file', name: 'yt-dlp' }
    ];
  }

  return [
    { url: `${base}/yt-dlp_linux`, archive: 'file', name: 'yt-dlp' },
    { url: `${base}/yt-dlp`, archive: 'file', name: 'yt-dlp' }
  ];
}

function ffmpegAssets() {
  if (process.platform === 'win32') {
    const suffix = process.arch === 'ia32' ? 'win32' : 'win64';
    return [
      {
        url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-${suffix}-gpl.zip`,
        archive: 'zip',
        name: 'ffmpeg'
      }
    ];
  }

  if (process.platform === 'darwin') {
    const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
    return [
      {
        url: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/${arch === 'arm64' ? 'release' : 'snapshot'}/ffmpeg.zip`,
        archive: 'zip',
        name: 'ffmpeg'
      },
      {
        url: `https://ffmpeg.martin-riedl.de/redirect/latest/macos/${arch}/${arch === 'arm64' ? 'snapshot' : 'release'}/ffmpeg.zip`,
        archive: 'zip',
        name: 'ffmpeg'
      }
    ];
  }

  const arch = process.arch === 'arm64' ? 'arm64' : 'amd64';
  return [
    {
      url: `https://ffmpeg.martin-riedl.de/redirect/latest/linux/${arch}/${arch === 'arm64' ? 'release' : 'snapshot'}/ffmpeg.zip`,
      archive: 'zip',
      name: 'ffmpeg'
    },
    {
      url: `https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux${arch === 'arm64' ? 'arm64' : '64'}-gpl.tar.xz`,
      archive: 'tar',
      name: 'ffmpeg'
    }
  ];
}

function assetsFor(target) {
  if (target === 'yt-dlp') return ytDlpAssets();
  if (target === 'ffmpeg') return ffmpegAssets();
  // spotdl is installed through pip, not by downloading a release asset.
  if (target === 'spotdl') return [];
  throw new Error(`أداة غير معروفة: ${target}`);
}

function describeAssets(target) {
  if (target === 'spotdl') return ['python -m pip install --upgrade spotdl'];
  return assetsFor(target).map((asset) => asset.url);
}

function requestStream(url, redirectsLeft) {
  return new Promise((resolve, reject) => {
    let parsed;

    try {
      parsed = new URL(url);
    } catch {
      reject(new Error('عنوان تنزيل غير صالح.'));
      return;
    }

    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'application/octet-stream,*/*'
      }
    }, (response) => {
      const status = response.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(status)) {
        response.resume();
        const location = response.headers.location;

        if (!location) {
          reject(new Error('إعادة توجيه غير صالحة من الخادم.'));
          return;
        }

        if (redirectsLeft <= 0) {
          reject(new Error('عدد كبير جدًا من إعادة التوجيه.'));
          return;
        }

        requestStream(new URL(location, url).toString(), redirectsLeft - 1)
          .then(resolve, reject);
        return;
      }

      if (status !== 200) {
        response.resume();
        reject(new Error(`فشل التنزيل (HTTP ${status}).`));
        return;
      }

      resolve(response);
    });

    request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
      request.destroy(new Error('انتهت مهلة التنزيل. تحقّق من اتصالك بالإنترنت.'));
    });

    request.on('error', reject);
  });
}

async function downloadFile(url, destination, onProgress) {
  const response = await requestStream(url, MAX_REDIRECTS);
  const total = Number(response.headers['content-length'] || 0);
  let downloaded = 0;
  let lastReport = 0;

  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination);

    response.on('data', (chunk) => {
      downloaded += chunk.length;
      const now = Date.now();

      if (now - lastReport < 180) return;
      lastReport = now;

      const percent = total > 0 ? Math.min(100, (downloaded / total) * 100) : null;
      safeProgress(onProgress, {
        phase: 'download',
        percent,
        downloaded,
        total
      });
    });

    response.on('error', (error) => {
      output.destroy();
      reject(error);
    });

    output.on('error', reject);
    output.on('finish', resolve);
    response.pipe(output);
  });

  return { downloaded, total };
}

function safeProgress(onProgress, payload) {
  if (typeof onProgress !== 'function') return;
  try {
    onProgress(payload);
  } catch {
    /* progress callbacks must never break an install */
  }
}

function safeEntryName(entryName) {
  const normalized = String(entryName || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.includes('..')) return null;
  return normalized;
}

function extractFromZip(archive, destination, wantedNames) {
  let zip;

  try {
    zip = new AdmZip(archive);
  } catch {
    throw new Error('تعذّر قراءة الأرشيف المضغوط.');
  }

  const wanted = new Set(wantedNames.map((name) => name.toLowerCase()));
  let extracted = 0;

  for (const entry of zip.getEntries()) {
    if (entry.isDirectory) continue;

    const entryName = safeEntryName(entry.entryName);
    if (!entryName) continue;

    const baseName = path.basename(entryName).toLowerCase();
    if (!wanted.has(baseName)) continue;

    const target = path.join(destination, path.basename(entryName));
    fs.writeFileSync(target, entry.getData());
    extracted += 1;
  }

  if (!extracted) {
    throw new Error('لم يتم العثور على الملف التنفيذي داخل الأرشيف.');
  }

  return extracted;
}

function extractFromTar(archive, destination, wantedNames) {
  fs.mkdirSync(destination, { recursive: true });

  const patterns = wantedNames.flatMap((name) => [`*/bin/${name}`, `bin/${name}`]);
  const result = spawnSync('tar', ['-xf', archive, '-C', destination, ...patterns], {
    timeout: 180000,
    windowsHide: true
  });

  if (result.error || result.status !== 0) {
    throw new Error('تعذّر فك ضغط أرشيف FFmpeg.');
  }
}

function walkFiles(directory) {
  const files = [];

  try {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        files.push(...walkFiles(fullPath));
      } else if (entry.isFile()) {
        files.push(fullPath);
      }
    }
  } catch {
    /* ignore unreadable folders */
  }

  return files;
}

function findExtracted(directory, wantedNames) {
  const wanted = new Set(wantedNames.map((name) => name.toLowerCase()));
  return walkFiles(directory).filter((file) => wanted.has(path.basename(file).toLowerCase()));
}

function makeExecutable(file) {
  if (process.platform === 'win32') return;

  try {
    fs.chmodSync(file, 0o755);
  } catch {
    /* ignore permission errors */
  }

  if (process.platform === 'darwin') {
    try {
      execFileSync('xattr', ['-dr', 'com.apple.quarantine', file], {
        timeout: 5000,
        windowsHide: true
      });
    } catch {
      /* xattr is optional */
    }
  }
}

function verifyBinary(file, args) {
  try {
    const output = execFileSync(file, args, {
      encoding: 'utf8',
      timeout: 15000,
      windowsHide: true
    });

    return String(output)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || null;
  } catch {
    return null;
  }
}

function pipFailure(tail) {
  const lines = String(tail || '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const errorLine = [...lines].reverse().find((line) => /error|failed|could not/i.test(line));
  const message = errorLine || lines[lines.length - 1] || 'خطأ غير معروف.';
  return message.length > 400 ? `${message.slice(0, 400)}…` : message;
}

function ensurePip(python, env) {
  const options = {
    encoding: 'utf8',
    timeout: 20000,
    windowsHide: true,
    env
  };

  const check = spawnSync(python.command, [...python.prefixArgs, '-m', 'pip', '--version'], options);
  if (check.status === 0) return;

  const bootstrap = spawnSync(
    python.command,
    [...python.prefixArgs, '-m', 'ensurepip', '--upgrade'],
    options
  );

  if (bootstrap.status !== 0) {
    throw new Error('Python مثبّت لكن pip غير متاح. ثبّت pip ثم أعد المحاولة.');
  }
}

async function installSpotdl(onProgress) {
  const python = spotify.findPython();
  if (!python) {
    throw new Error('لم يتم العثور على Python. ثبّت Python 3.9 أو أحدث من python.org ثم أعد المحاولة.');
  }

  const libDir = path.join(getBinDir(), 'spotdl-lib');
  fs.mkdirSync(libDir, { recursive: true });

  const env = spotify.withPythonPath(process.env, libDir);
  env.PYTHONIOENCODING = 'utf-8';
  env.PYTHONUTF8 = '1';
  env.PIP_DISABLE_PIP_VERSION_CHECK = '1';

  safeProgress(onProgress, {
    phase: 'start',
    percent: 0,
    target: 'spotdl',
    message: 'جارٍ تجهيز تثبيت spotdl…'
  });

  ensurePip(python, env);

  const args = [
    ...python.prefixArgs,
    '-m', 'pip', 'install', '--upgrade',
    // Never wait for an interactive prompt — that leaves the UI stuck on
    // "جارٍ التثبيت" forever when pip hits a conflict.
    '--no-input', '--disable-pip-version-check',
    '--target', libDir,
    'spotdl'
  ];

  const result = await new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(python.command, args, { windowsHide: true, env, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (error) {
      reject(error);
      return;
    }

    let tail = '';
    let lastPercent = null;
    let timedOut = false;
    // A stalled network must not leave the installer busy indefinitely.
    const watchdog = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* already exited */ }
    }, DOWNLOAD_TIMEOUT_MS);

    const consume = (chunk) => {
      const text = chunk.toString('utf8');
      tail = `${tail}${text}`.slice(-12000);

      for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line) continue;

        const percentMatch = line.match(/(\d{1,3})\s*%/);
        if (percentMatch) lastPercent = Number(percentMatch[1]);

        if (/^Collecting\b/i.test(line)) {
          safeProgress(onProgress, {
            phase: 'download',
            percent: lastPercent,
            target: 'spotdl',
            message: line.slice(0, 120)
          });
        } else if (/^Downloading\b/i.test(line)) {
          safeProgress(onProgress, {
            phase: 'download',
            percent: lastPercent,
            target: 'spotdl',
            message: line.slice(0, 120)
          });
        } else if (/Installing collected packages/i.test(line)) {
          safeProgress(onProgress, {
            phase: 'extract',
            percent: 100,
            target: 'spotdl',
            message: 'جارٍ تثبيت الحزم…'
          });
        }
      }
    };

    child.stdout.on('data', consume);
    child.stderr.on('data', consume);
    child.on('error', (error) => {
      clearTimeout(watchdog);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(watchdog);
      resolve({ code, tail, lastPercent, timedOut });
    });
  });

  if (result.timedOut) {
    throw new Error('انتهت مهلة تثبيت spotdl. تحقق من الاتصال بالإنترنت ثم أعد المحاولة.');
  }

  if (result.code !== 0) {
    throw new Error(`تعذّر تثبيت spotdl: ${pipFailure(result.tail)}`);
  }

  spotify.clearCache();
  const command = spotify.resolveCommand(true);
  if (!command) {
    throw new Error('تم تنزيل spotdl لكن تعذّر تشغيله. جرّب إعادة التثبيت.');
  }

  safeProgress(onProgress, {
    phase: 'done',
    percent: 100,
    target: 'spotdl',
    message: 'تم تثبيت spotdl بنجاح.',
    version: command.version
  });

  return {
    target: 'spotdl',
    path: command.command,
    version: command.version,
    installed: true
  };
}

async function install(target, onProgress) {
  if (target === 'spotdl') return installSpotdl(onProgress);

  if (target !== 'yt-dlp' && target !== 'ffmpeg') {
    throw new Error('الأداة المطلوبة غير مدعومة.');
  }

  const destination = getBinDir();
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wasel-install-'));
  const assets = assetsFor(target);
  let lastError = null;

  safeProgress(onProgress, {
    phase: 'start',
    percent: 0,
    message: 'جارٍ تجهيز التنزيل…'
  });

  try {
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index];
      const extension = asset.archive === 'tar' ? '.tar.xz' : asset.archive === 'zip' ? '.zip' : '';
      const archive = path.join(tempDir, `${target}-${index}${extension}`);
      const staging = path.join(tempDir, `staging-${index}`);

      try {
        fs.rmSync(staging, { recursive: true, force: true });
        fs.mkdirSync(staging, { recursive: true });

        await downloadFile(asset.url, archive, (progress) => {
          safeProgress(onProgress, {
            ...progress,
            target,
            message: 'جارٍ تنزيل الملف…'
          });
        });

        safeProgress(onProgress, {
          phase: 'extract',
          percent: 100,
          target,
          message: 'جارٍ فك الضغط…'
        });

        if (asset.archive === 'file') {
          const file = path.join(staging, asset.name);
          fs.copyFileSync(archive, file);
        } else if (asset.archive === 'zip') {
          extractFromZip(archive, staging, target === 'ffmpeg'
            ? ['ffmpeg', 'ffmpeg.exe', 'ffprobe', 'ffprobe.exe']
            : [asset.name, `${asset.name}.exe`]);
        } else {
          extractFromTar(archive, staging, target === 'ffmpeg'
            ? ['ffmpeg', 'ffmpeg.exe', 'ffprobe', 'ffprobe.exe']
            : [asset.name, `${asset.name}.exe`]);
        }

        safeProgress(onProgress, {
          phase: 'install',
          percent: 100,
          target,
          message: 'جارٍ تثبيت الملف…'
        });

        const wanted = target === 'ffmpeg'
          ? ['ffmpeg', 'ffmpeg.exe', 'ffprobe', 'ffprobe.exe']
          : [asset.name, `${asset.name}.exe`];
        const files = findExtracted(staging, wanted);

        if (!files.length) {
          throw new Error('لم يتم العثور على الملف التنفيذي بعد فك الضغط.');
        }

        let mainFile = null;

        for (const file of files) {
          const name = path.basename(file).toLowerCase();
          const isMain = name === `${target}.exe` || name === target;
          const finalPath = path.join(destination, path.basename(file));
          fs.copyFileSync(file, finalPath);
          makeExecutable(finalPath);
          if (isMain) mainFile = finalPath;
        }

        const version = mainFile
          ? verifyBinary(mainFile, target === 'yt-dlp' ? ['--version'] : ['-version'])
          : null;

        if (!version) {
          throw new Error('تم التنزيل لكن تعذّر تشغيل الملف التنفيذي. جرّب إعادة المحاولة.');
        }

        safeProgress(onProgress, {
          phase: 'done',
          percent: 100,
          target,
          message: 'تم التثبيت بنجاح.',
          version
        });

        return {
          target,
          path: mainFile,
          version,
          installed: true
        };
      } catch (error) {
        lastError = error;
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  throw new Error(
    `تعذّر تثبيت ${target}: ${lastError && lastError.message ? lastError.message : 'خطأ غير معروف.'}`
  );
}

module.exports = {
  install,
  setBinDir,
  getBinDir,
  assetsFor,
  describeAssets,
  extractFromZip,
  extractFromTar
};
