// Автообновление клиента через electron-updater (из electron-builder).
//
// Источник обновлений — GitHub Releases (репозиторий из build.publish в
// package.json). Клиент читает latest*.yml из последнего релиза.
//
// Два разных сценария (по режиму проверки):
//   • 'startup'  — проверка при запуске. Если есть апдейт: полноэкранная страница
//                  «проверка/загрузка/установка», ставим и перезапускаемся ДО
//                  открытия сервера. Управляется main через onStatus (phase:'startup').
//   • 'runtime'  — периодическая фоновая проверка во время работы. Тихо качаем, но
//                  НЕ ставим сами: показываем нижний баннер «готово» с кнопкой.
//   • 'manual'   — ручная проверка из меню. Ведёт себя как runtime (баннер + кнопка).
//
// Установка скачанного в режимах runtime/manual — только по кнопке (installStaged)
// или автоматически при следующем перезапуске клиента (autoInstallOnAppQuit).
//
// Платформы: Windows (NSIS) и Linux (AppImage) — полноценно. macOS — отключено
// (Squirrel.Mac требует платной подписи Apple), .dmg ставится вручную.
const { app } = require('electron');

// electron-updater — runtime-зависимость (bundle'ится в asar). В портативной
// dev-сборке node_modules нет — тогда апдейтер молча отключается.
let autoUpdater = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch {
  autoUpdater = null;
}

let emitStatus = () => {};
let markQuitting = () => {};
let wired = false;
let busy = false; // идёт проверка/загрузка
let activeMode = 'startup'; // режим текущей проверки: startup | runtime | manual
let stagedVersion = null; // версия скачанного, но не установленного апдейта (runtime/manual)

function initUpdater({ onStatus, quitting } = {}) {
  if (typeof onStatus === 'function') emitStatus = onStatus;
  if (typeof quitting === 'function') markQuitting = quitting;
}

// Отправляет статус в UI, добавляя текущий режим как phase (по нему renderer
// решает: полноэкранная страница обновления или нижний баннер).
function status(obj) {
  try {
    emitStatus({ phase: activeMode, ...obj });
  } catch {
    /* ignore */
  }
}

function updatesSupported() {
  if (!autoUpdater) return false; // модуль не подгрузился (портативная сборка)
  if (!app.isPackaged) return false; // dev-режим (electron .)
  if (process.platform === 'darwin') return false; // macOS без подписи — нельзя
  return true;
}

function hasStagedUpdate() {
  return !!stagedVersion;
}

// Ставит скачанное обновление и перезапускает клиент (тихо).
function quitAndInstall() {
  markQuitting();
  setTimeout(() => {
    try {
      autoUpdater.quitAndInstall(true, true); // isSilent, isForceRunAfter
    } catch (e) {
      console.error('[updater] quitAndInstall:', (e && e.message) || e);
    }
  }, 500);
}

// Однократно привязывает события electron-updater к нашему UI.
function wireEvents() {
  if (wired || !autoUpdater) return;
  wired = true;

  autoUpdater.autoDownload = true; // качаем автоматически в любом режиме
  autoUpdater.autoInstallOnAppQuit = true; // перезапуск клиента поставит скачанное
  autoUpdater.logger = console;

  autoUpdater.on('checking-for-update', () => status({ state: 'checking' }));

  autoUpdater.on('update-available', (info) => {
    busy = true;
    status({ state: 'available', version: info.version });
  });

  autoUpdater.on('update-not-available', (info) => {
    busy = false;
    status({ state: 'uptodate', version: info && info.version, current: app.getVersion() });
  });

  autoUpdater.on('download-progress', (p) => {
    status({ state: 'downloading', percent: Math.round(p.percent || 0) });
  });

  autoUpdater.on('update-downloaded', (info) => {
    busy = false;
    if (activeMode === 'startup') {
      // При запуске: ставим сразу и перезапускаемся ДО открытия сервера.
      status({ state: 'installing', version: info.version });
      quitAndInstall();
    } else {
      // Во время работы: НЕ ставим сами — показываем баннер с кнопкой.
      stagedVersion = info.version;
      status({ state: 'ready', version: info.version });
    }
  });

  autoUpdater.on('error', (err) => {
    busy = false;
    const msg = (err && (err.message || String(err))) || 'unknown';
    console.error('[updater] ошибка:', msg);
    status({ state: 'error', error: msg });
  });
}

// Проверка обновлений. force=true → ручная проверка (режим 'manual').
async function checkForUpdates({ mode = 'runtime', force = false } = {}) {
  const m = force ? 'manual' : mode;

  if (!updatesSupported()) {
    activeMode = m;
    const reason =
      process.platform === 'darwin'
        ? 'На macOS обновление ставится вручную: скачайте свежий .dmg со страницы релизов на GitHub.'
        : 'Автообновление работает только в установленном приложении.';
    console.log('[updater] отключено: ' + reason);
    status({ state: 'disabled', reason });
    return;
  }
  // Если уже идёт проверка/загрузка — НЕ трогаем режим текущей операции
  // (иначе события ушли бы не в тот UI).
  if (busy) return;
  if (stagedVersion) {
    // Уже скачано и ждёт установки — просто (пере)покажем баннер с кнопкой.
    activeMode = m;
    status({ state: 'ready', version: stagedVersion });
    return;
  }

  activeMode = m;
  wireEvents();
  try {
    console.log(`[updater] проверка обновлений (${activeMode}), текущая ${app.getVersion()}`);
    await autoUpdater.checkForUpdates();
  } catch (err) {
    busy = false;
    const msg = (err && (err.message || String(err))) || 'unknown';
    console.error('[updater] проверка не удалась:', msg);
    status({ state: 'error', error: msg });
  }
}

// Установить скачанное обновление сейчас (по кнопке в баннере). Возвращает
// false, если ставить нечего.
function installStaged() {
  if (!stagedVersion || !autoUpdater) return false;
  status({ state: 'installing', version: stagedVersion });
  quitAndInstall();
  return true;
}

module.exports = { initUpdater, checkForUpdates, installStaged, updatesSupported, hasStagedUpdate };
