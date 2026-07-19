// Главный процесс Electron-клиента Sharkord.
// Отвечает за: окно, трей, меню, регистрацию протокола sharkord://,
// single-instance, проверку подключения к серверу и маршрутизацию UI.
const path = require('path');
const http = require('http');
const https = require('https');
const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  nativeImage,
  ipcMain,
  shell,
} = require('electron');

const store = require('./store');
const { setupMedia } = require('./media');
const { parseDeepLink, deepLinkFromArgv } = require('./deeplink');
const updater = require('./updater');

const PARTITION = 'persist:sharkord'; // отдельная сессия для веб-приложения сервера
const ASSETS = path.join(__dirname, '..', 'assets');

let mainWindow = null;
let tray = null;
let appReady = false;
let isQuitting = false;
// Deep-link, с которым запустили приложение (холодный старт). Забирается renderer'ом.
let pendingDeepLink = deepLinkFromArgv(process.argv);

// Гейт стартового обновления: renderer ждёт его перед открытием сервера, чтобы
// апдейт при запуске успел установиться ДО загрузки страницы сервера.
let startupTimeout = null;
let startupGateDone = false;
let releaseStartupGateFn = null;
const startupUpdateGate = new Promise((resolve) => {
  releaseStartupGateFn = resolve;
});

/* ------------------------------------------------------------------ */
/*  Single instance + протокол sharkord://                            */
/* ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Уже есть запущенная копия — эта передаст ей аргументы (в т.ч. deep-link) и выйдет.
  app.quit();
} else {
  registerProtocol();

  app.on('second-instance', (_event, argv) => {
    const link = deepLinkFromArgv(argv);
    if (link) handleDeepLink(link);
    else showWindow();
  });

  // macOS: приложение открыли по ссылке sharkord://
  app.on('open-url', (event, url) => {
    event.preventDefault();
    if (appReady) handleDeepLink(url);
    else pendingDeepLink = url;
  });

  app.whenReady().then(onReady);
}

// Регистрирует приложение как обработчик схемы sharkord:// в ОС.
function registerProtocol() {
  if (process.defaultApp) {
    // Режим разработки (electron .): нужно явно указать путь к скрипту.
    if (process.argv.length >= 2) {
      app.setAsDefaultProtocolClient('sharkord', process.execPath, [
        path.resolve(process.argv[1]),
      ]);
    }
  } else {
    app.setAsDefaultProtocolClient('sharkord');
  }
}

/* ------------------------------------------------------------------ */
/*  Инициализация                                                      */
/* ------------------------------------------------------------------ */

function onReady() {
  appReady = true;
  if (process.platform === 'win32') app.setAppUserModelId('com.sharkord.client');

  setupMedia(PARTITION); // разрешения на камеру/микрофон/экран для webview
  setupWebContentsPolicy();
  createWindow();
  createTray();
  buildMenu();

  // Автообновление: initUpdater + стартовая проверка (гейтит открытие сервера) +
  // периодическая фоновая проверка во время работы.
  updater.initUpdater({
    onStatus: onUpdateStatus,
    quitting: () => {
      isQuitting = true;
    },
  });
  runStartupUpdate();
  startPeriodicUpdateCheck();

  app.on('activate', () => showWindow()); // клик по иконке в доке (macOS)

  console.log(`[main] Готов. Платформа: ${process.platform}, deep-link при старте: ${pendingDeepLink || 'нет'}`);

  // Хук авто-теста: SHARKORD_SMOKE=1 — приложение само закрывается через 6 сек.
  if (process.env.SHARKORD_SMOKE) {
    setTimeout(() => {
      console.log('[main] SMOKE: авто-завершение');
      isQuitting = true;
      app.quit();
    }, 6000);
  }
}

// Не завершаем приложение при закрытии окна — оно живёт в трее.
app.on('window-all-closed', () => {});
app.on('before-quit', () => {
  isQuitting = true;
});

/* ------------------------------------------------------------------ */
/*  Окно и трей                                                        */
/* ------------------------------------------------------------------ */

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    backgroundColor: '#0d1117',
    title: 'Sharkord',
    icon: path.join(ASSETS, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // разрешаем <webview> для встраивания веб-приложения сервера
      spellcheck: false,
    },
  });

  // Прикрепляем preload к встраиваемому <webview> с Sharkord: он наблюдает за
  // состоянием голоса (микрофон/звук/канал) и шлёт его сюда для иконки в трее.
  mainWindow.webContents.on('will-attach-webview', (_e, webPreferences) => {
    webPreferences.preload = path.join(__dirname, 'webview-preload.js');
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

  mainWindow.webContents.on('did-finish-load', () => {
    console.log('[main] UI загружен');
  });

  // Закрытие окна крестиком → сворачиваем в трей, а не выходим.
  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });
}

function showWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  const icon = nativeImage.createFromPath(path.join(ASSETS, 'tray.png'));
  tray = new Tray(icon);
  tray.setToolTip('Sharkord');

  const menu = Menu.buildFromTemplate([
    { label: 'Показать', click: showWindow },
    { type: 'separator' },
    {
      label: 'Сменить сервер',
      click: () => {
        showWindow();
        sendRoute({ screen: 'connect' });
      },
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('double-click', showWindow);
}

/* ------------------------------------------------------------------ */
/*  Состояние голоса → иконка трея                                     */
/* ------------------------------------------------------------------ */

const trayIconCache = {};
// nativeImage.createFromPath сам подхватывает вариант @2x рядом (HiDPI).
function trayIcon(name) {
  if (!trayIconCache[name]) {
    trayIconCache[name] = nativeImage.createFromPath(
      path.join(ASSETS, `${name}.png`)
    );
  }
  return trayIconCache[name];
}

function voiceTooltip(s) {
  if (!s || !s.inVoice) return 'Sharkord';
  let detail = 'в голосовом канале';
  if (s.soundMuted) detail = 'звук и микрофон выкл';
  else if (s.micMuted) detail = 'микрофон выкл';
  return `Sharkord — ${detail}`;
}

let lastVoiceKey = null;
// Вне голосового канала — базовая иконка (mic/sound не важны). В канале:
// звук выкл (deafen) → наушники, иначе микрофон выкл → микрофон, иначе → кружок.
function applyVoiceState(state) {
  if (!tray || tray.isDestroyed()) return;
  const s = state || {};

  const key = JSON.stringify([!!s.inVoice, !!s.micMuted, !!s.soundMuted]);
  if (key === lastVoiceKey) return;
  lastVoiceKey = key;

  let icon = 'tray';
  if (s.inVoice) {
    if (s.soundMuted) icon = 'tray-deafen';
    else if (s.micMuted) icon = 'tray-mic-off';
    else icon = 'tray-live';
  }

  tray.setImage(trayIcon(icon));
  tray.setToolTip(voiceTooltip(s));
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const template = [
    {
      label: 'Сервер',
      submenu: [
        {
          label: 'Сменить / добавить сервер',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => {
            showWindow();
            sendRoute({ screen: 'connect' });
          },
        },
        { type: 'separator' },
        {
          label: 'Проверить обновления',
          click: () => {
            showWindow();
            manualCheck();
          },
        },
        {
          label: 'Обновлять автоматически',
          type: 'checkbox',
          checked: store.getSetting('autoUpdate', true),
          click: (item) => store.setSetting('autoUpdate', item.checked),
        },
        { type: 'separator' },
        { label: 'Свернуть в трей', click: () => mainWindow && mainWindow.hide() },
        {
          label: 'Выход',
          accelerator: isMac ? 'Cmd+Q' : 'Ctrl+Q',
          click: () => {
            isQuitting = true;
            app.quit();
          },
        },
      ],
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' },
        { role: 'redo', label: 'Повторить' },
        { type: 'separator' },
        { role: 'cut', label: 'Вырезать' },
        { role: 'copy', label: 'Копировать' },
        { role: 'paste', label: 'Вставить' },
        { role: 'selectAll', label: 'Выделить всё' },
      ],
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Обновить' },
        { role: 'forceReload', label: 'Обновить принудительно' },
        { role: 'toggleDevTools', label: 'Инструменты разработчика' },
        { type: 'separator' },
        { role: 'resetZoom', label: 'Сбросить масштаб' },
        { role: 'zoomIn', label: 'Увеличить' },
        { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Полный экран' },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* ------------------------------------------------------------------ */
/*  Политики безопасности для веб-контента                            */
/* ------------------------------------------------------------------ */

function setupWebContentsPolicy() {
  // Внешние ссылки открываем в системном браузере, а не внутри клиента.
  app.on('web-contents-created', (_e, contents) => {
    contents.setWindowOpenHandler(({ url }) => {
      if (/^https?:\/\//i.test(url) && !isKnownServerUrl(url)) {
        shell.openExternal(url);
        return { action: 'deny' };
      }
      return { action: 'allow' };
    });
  });

  // Разрешаем самоподписанные сертификаты только для добавленных пользователем
  // серверов (частый случай для self-hosted в локальной сети).
  app.on('certificate-error', (event, _wc, url, _error, _cert, callback) => {
    if (isKnownServerUrl(url)) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });
}

function isKnownServerUrl(url) {
  let host;
  try {
    host = new URL(url).host;
  } catch {
    return false;
  }
  return store.listServers().some((s) => {
    try {
      return new URL(s.url).host === host;
    } catch {
      return false;
    }
  });
}

/* ------------------------------------------------------------------ */
/*  Deep-link → маршрут UI                                             */
/* ------------------------------------------------------------------ */

function sendRoute(route) {
  sendToRenderer('route', route);
}

function sendToRenderer(channel, payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload);
  }
}

// Отпускает гейт стартового обновления (renderer после этого открывает сервер).
function releaseStartupGate() {
  if (startupGateDone) return;
  startupGateDone = true;
  clearTimeout(startupTimeout);
  if (releaseStartupGateFn) releaseStartupGateFn();
}

// Приёмник статусов апдейтера: шлём в UI и на стартовой фазе управляем гейтом.
function onUpdateStatus(s) {
  sendToRenderer('update-status', s);
  if (s && s.phase === 'startup') {
    if (s.state === 'available' || s.state === 'downloading') {
      clearTimeout(startupTimeout); // апдейт найден — ждём загрузку/установку, не по таймауту
    } else if (s.state === 'uptodate' || s.state === 'error' || s.state === 'disabled') {
      releaseStartupGate(); // обновлять нечего / ошибка — открываем сервер
    }
    // installing → клиент перезапустится, гейт трогать не нужно
  }
}

// Стартовая проверка обновления. Если апдейт есть — апдейтер сам поставит и
// перезапустит клиент (ДО открытия сервера). Если нет / выключено / ошибка /
// таймаут — отпускаем гейт, и renderer открывает сервер.
function runStartupUpdate() {
  if (!store.getSetting('autoUpdate', true) || !updater.updatesSupported()) {
    releaseStartupGate();
    return;
  }
  // Фоллбэк: если проверка зависла (сеть) — не держим пользователя на экране.
  startupTimeout = setTimeout(releaseStartupGate, 8000);
  updater.checkForUpdates({ mode: 'startup' });
}

// Периодическая фоновая проверка во время работы (каждые 30 мин). Найдя апдейт,
// апдейтер тихо его качает и показывает нижний баннер с кнопкой (сам не ставит).
function startPeriodicUpdateCheck() {
  setInterval(() => {
    if (store.getSetting('autoUpdate', true)) {
      updater.checkForUpdates({ mode: 'runtime' });
    }
  }, 30 * 60 * 1000);
}

// Ручная проверка из меню / UI (режим manual): баннер + кнопка, без перезапуска.
function manualCheck() {
  updater.checkForUpdates({ force: true });
}

// Превращает разобранный deep-link в маршрут для renderer.
function routeFromDeepLink(link) {
  const parsed = parseDeepLink(link);
  if (!parsed) return null;

  let server = null;
  if (parsed.serverUrl) {
    server = store.addServer({ url: parsed.serverUrl });
  } else {
    server = store.getLastServer();
  }

  // Сервер неизвестен, но есть код инвайта — отправляем на экран подключения,
  // код применим после того, как пользователь выберет/добавит сервер.
  if (!server) {
    return { screen: 'connect', invite: parsed.invite || null };
  }

  store.setLastServer(server.id);
  const base = store.normalizeBase(server.url);
  let url = base;
  if (parsed.fullUrl) url = parsed.fullUrl;
  else if (parsed.invite) url = `${base}/?invite=${encodeURIComponent(parsed.invite)}`;

  return { screen: 'app', server, url };
}

function handleDeepLink(link) {
  const route = routeFromDeepLink(link);
  showWindow();
  if (route) sendRoute(route);
}

/* ------------------------------------------------------------------ */
/*  Проверка подключения к серверу                                    */
/* ------------------------------------------------------------------ */

// Кандидаты URL: если схема не указана — пробуем http, затем https.
function schemeCandidates(raw) {
  const s = String(raw || '').trim();
  if (!s) return [];
  if (/^https?:\/\//i.test(s)) return [s];
  return [`http://${s}`, `https://${s}`];
}

// Проверяет доступность сервера GET-запросом к корню. Любой HTTP-ответ < 500
// означает, что сервер жив (200/302/401/403 и т.п.). Самоподписанные TLS
// сертификаты не считаются ошибкой (rejectUnauthorized: false).
function probe(originUrl, timeoutMs = 9000) {
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(originUrl);
    } catch {
      resolve({ ok: false, error: 'bad-url' });
      return;
    }
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      url,
      { method: 'GET', timeout: timeoutMs, rejectUnauthorized: false },
      (res) => {
        res.resume(); // сливаем тело
        resolve({ ok: res.statusCode > 0 && res.statusCode < 500, status: res.statusCode });
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'timeout' });
    });
    req.on('error', (err) => resolve({ ok: false, error: err.code || err.message }));
    req.end();
  });
}

/* ------------------------------------------------------------------ */
/*  IPC handlers                                                       */
/* ------------------------------------------------------------------ */

ipcMain.handle('app:getInitialRoute', () => {
  // 1) Запуск по deep-link (холодный старт)
  if (pendingDeepLink) {
    const link = pendingDeepLink;
    pendingDeepLink = null;
    const route = routeFromDeepLink(link);
    if (route) return route;
  }
  // 2) Есть сохранённый последний сервер → сразу открываем его
  const last = store.getLastServer();
  if (last) {
    return { screen: 'app', server: last, url: store.normalizeBase(last.url) };
  }
  // 3) Первый запуск → приветственный экран
  console.log('[main] Стартовый экран: приветствие (серверов нет)');
  return { screen: 'welcome' };
});

ipcMain.handle('servers:list', () => store.listServers());

ipcMain.handle('servers:test', async (_e, raw) => {
  const cands = schemeCandidates(raw);
  if (!cands.length) return { ok: false, error: 'empty' };

  let lastErr = 'unreachable';
  for (const c of cands) {
    let origin;
    try {
      origin = new URL(c).origin;
    } catch {
      lastErr = 'bad-url';
      continue;
    }
    const r = await probe(origin);
    if (r.ok) return { ok: true, url: origin, status: r.status };
    lastErr = r.error || lastErr;
  }
  return { ok: false, error: lastErr };
});

ipcMain.handle('servers:connect', (_e, payload) => {
  let server = null;
  if (typeof payload === 'string') {
    server = store.getServer(payload);
  } else if (payload && payload.id) {
    server = store.getServer(payload.id);
  } else if (payload && payload.url) {
    server = store.addServer({ url: payload.url, name: payload.name });
  }
  if (!server) throw new Error('server-not-found');

  store.setLastServer(server.id);
  return { server, url: store.normalizeBase(server.url) };
});

ipcMain.handle('servers:remove', (_e, id) => {
  store.removeServer(id);
  return store.listServers();
});

ipcMain.handle('servers:rename', (_e, { id, name }) => store.renameServer(id, name));

ipcMain.handle('app:openExternal', (_e, url) => shell.openExternal(url));

ipcMain.handle('app:quit', () => {
  isQuitting = true;
  app.quit();
});

ipcMain.handle('app:getVersion', () => app.getVersion());

ipcMain.handle('app:checkUpdates', () => manualCheck());

// Renderer ждёт завершения стартовой проверки обновления перед открытием сервера.
ipcMain.handle('app:awaitStartupUpdate', () => startupUpdateGate);

// Установить скачанное обновление сейчас (кнопка в баннере).
ipcMain.handle('app:installUpdate', () => updater.installStaged());

ipcMain.handle('app:getSetting', (_e, key) =>
  store.getSetting(key, key === 'autoUpdate' ? true : null)
);

ipcMain.handle('app:setSetting', (_e, { key, value }) => store.setSetting(key, value));

// Состояние голоса приходит напрямую из webview-preload (Sharkord) —
// обновляем иконку и тултип трея.
ipcMain.on('voice:state', (_e, state) => applyVoiceState(state));
