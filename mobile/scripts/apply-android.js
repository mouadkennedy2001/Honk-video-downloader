'use strict';

/**
 * Copy theWasel Android native layer into the Capacitor-generated project and
 * patch Gradle for Chaquopy + yt-dlp. Safe to run repeatedly.
 *
 * Run from anywhere: node mobile/scripts/apply-android.js
 */
const fs = require('fs');
const path = require('path');

const mobileDir = path.resolve(__dirname, '..');
const templateDir = path.join(mobileDir, 'android-template');
const androidDir = path.join(mobileDir, 'android');

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function read(file) {
  if (!fs.existsSync(file)) fail(`missing file: ${file}`);
  return fs.readFileSync(file, 'utf8');
}

function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.copyFileSync(file, file + '.bak');
  fs.writeFileSync(file, text);
}

function copyFile(from, to) {
  if (!fs.existsSync(from)) fail(`template file missing: ${from}`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  if (!fs.existsSync(from)) fail(`template directory missing: ${from}`);
  fs.mkdirSync(to, { recursive: true });

  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(source, target);
    else fs.copyFileSync(source, target);
  }
}

function copyWebAssets() {
  const www = path.join(mobileDir, 'www');
  const assets = path.join(androidDir, 'app', 'src', 'main', 'assets', 'public');
  if (!fs.existsSync(www)) fail(`web assets not found: ${www}. Run: npm run sync:web`);
  // Keep the Android project self-contained even when assembleDebug is run
  // directly instead of through `npm run build:apk`.
  copyDir(www, assets);
}

function copyTemplate() {
  const main = path.join(androidDir, 'app', 'src', 'main');
  const tpl = path.join(templateDir, 'app', 'src', 'main');

  for (const name of ['ProgressBridge.java', 'YtdlpPlugin.java', 'MainActivity.java']) {
    copyFile(
      path.join(tpl, 'java', 'app', 'wasel', 'downloader', name),
      path.join(main, 'java', 'app', 'wasel', 'downloader', name)
    );
  }
  copyFile(path.join(tpl, 'python', 'wasel_engine.py'), path.join(main, 'python', 'wasel_engine.py'));
  copyFile(path.join(tpl, 'AndroidManifest.xml'), path.join(main, 'AndroidManifest.xml'));
  copyFile(path.join(tpl, 'res', 'xml', 'file_paths.xml'), path.join(main, 'res', 'xml', 'file_paths.xml'));
  copyFile(path.join(tpl, 'res', 'values', 'strings.xml'), path.join(main, 'res', 'values', 'strings.xml'));
  copyFile(path.join(tpl, 'res', 'values', 'styles.xml'), path.join(main, 'res', 'values', 'styles.xml'));
  copyFile(path.join(tpl, 'res', 'values', 'ic_launcher_background.xml'), path.join(main, 'res', 'values', 'ic_launcher_background.xml'));
  copyDir(path.join(tpl, 'res', 'drawable-v24'), path.join(main, 'res', 'drawable-v24'));
  copyDir(path.join(tpl, 'res', 'mipmap-anydpi-v26'), path.join(main, 'res', 'mipmap-anydpi-v26'));
  for (const density of ['mdpi', 'hdpi', 'xhdpi', 'xxhdpi', 'xxxhdpi']) {
    copyDir(path.join(tpl, 'res', `mipmap-${density}`), path.join(main, 'res', `mipmap-${density}`));
  }
}

function pick(file, ktsFile) {
  if (fs.existsSync(file)) return file;
  if (fs.existsSync(ktsFile)) return ktsFile;
  fail(`neither ${path.basename(file)} nor ${path.basename(ktsFile)} found in ${path.dirname(file)}`);
}

function patchRootGradle() {
  const file = pick(path.join(androidDir, 'build.gradle'), path.join(androidDir, 'build.gradle.kts'));
  let text = read(file);
  const isKts = file.endsWith('.kts');
  const marker = 'com.chaquo.python';
  if (text.includes(marker)) return file;

  const classpath = isKts
    ? 'classpath("com.chaquo.python:gradle:17.2.0")'
    : "classpath 'com.chaquo.python:gradle:17.2.0'";

  const googleServices = isKts
    ? 'classpath("com.google.gms:google-services:4.4.4")'
    : "classpath 'com.google.gms:google-services:4.4.4'";

  if (text.includes(googleServices)) {
    text = text.replace(googleServices, `${googleServices}\n        ${classpath}`);
  } else if (text.includes('buildscript') || text.includes('buildScript')) {
    text = text.replace(/(\bdependencies\s*\{)/, `$1\n        ${classpath}`);
  } else {
    const plugins = isKts
      ? `plugins {\n    id("com.chaquo.python") version "17.2.0" apply false\n}\n\n`
      : `plugins {\n    id 'com.chaquo.python' version '17.2.0' apply false\n}\n\n`;
    text = plugins + text;
  }
  write(file, text);
  return file;
}

function patchAppGradle() {
  const appDir = path.join(androidDir, 'app');
  const file = pick(path.join(appDir, 'build.gradle'), path.join(appDir, 'build.gradle.kts'));
  let text = read(file);
  const isKts = file.endsWith('.kts');
  if (text.includes('com.chaquo.python') || text.includes('chaquopy {')) return file;

  // Apply the plugin after the Android plugin.
  const androidPlugin = isKts
    ? 'id("com.android.application")'
    : "apply plugin: 'com.android.application'";
  if (text.includes(androidPlugin)) {
    const line = isKts ? '    id("com.chaquo.python")' : "apply plugin: 'com.chaquo.python'";
    text = text.replace(androidPlugin, `${androidPlugin}\n${line}`);
  } else {
    text = (isKts ? 'plugins {\n    id("com.chaquo.python")\n}\n\n'
      : "apply plugin: 'com.chaquo.python'\n\n") + text;
  }

  // Capacitor 8 defaults to minSdk 23; Chaquopy needs 24+.
  const minSdkKts = 'minSdk = rootProject.ext.minSdkVersion';
  const minSdkGroovy = 'minSdkVersion rootProject.ext.minSdkVersion';
  if (text.includes(minSdkKts)) text = text.replace(minSdkKts, 'minSdk = 24');
  else if (text.includes(minSdkGroovy)) text = text.replace(minSdkGroovy, 'minSdkVersion 24');

  // 64-bit ABIs only (Python 3.12 support).
  const defaultConfig = 'defaultConfig {';
  const ndk = isKts
    ? '        ndk {\n            abiFilters += listOf("arm64-v8a", "x86_64")\n        }\n'
    : '        ndk {\n            abiFilters "arm64-v8a", "x86_64"\n        }\n';
  if (text.includes(defaultConfig) && !text.includes('abiFilters')) {
    text = text.replace(defaultConfig, `${defaultConfig}\n${ndk}`);
  }

  const chaquopy = isKts
    ? `
chaquopy {
    defaultConfig {
        version = "3.12"
        pip {
            install("yt-dlp")
        }
    }
}
`
    : `
chaquopy {
    defaultConfig {
        version = "3.12"
        if (System.getProperty("os.name").toLowerCase().contains("windows")) {
            buildPython("py", "-3.12")
        }
        pip {
            install("yt-dlp")
        }
    }
}
`;
  text = text.trimEnd() + '\n' + chaquopy;
  write(file, text);
  return file;
}

function patchSettings() {
  const file = path.join(androidDir, 'settings.gradle');
  if (!fs.existsSync(file)) return;
  let text = read(file);
  if (text.includes('mavenCentral()')) return;
  text = `pluginManagement {\n    repositories {\n        google()\n        mavenCentral()\n    }\n}\n\n${text}`;
  write(file, text);
}

function main() {
  if (!fs.existsSync(androidDir)) {
    fail('mobile/android not found. Run: cd mobile && npm install && npx cap add android');
  }

  copyWebAssets();
  copyTemplate();
  const root = patchRootGradle();
  const app = patchAppGradle();
  patchSettings();

  console.log('✓ Web assets copied into Android project');
  console.log('✓ Android native layer copied');
  console.log(`✓ Patched ${path.relative(mobileDir, root)}`);
  console.log(`✓ Patched ${path.relative(mobileDir, app)}`);
  console.log('✓ Chaquopy 17.2.0 / Python 3.12 / yt-dlp configured');
  console.log('\nNext: cd mobile/android && gradlew assembleDebug');
}

main();
