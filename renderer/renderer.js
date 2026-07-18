// Логика UI клиента: переключение экранов (приветствие → подключение → сервер),
// управление списком серверов и загрузка веб-приложения сервера в <webview>.

const $ = (id) => document.getElementById(id);
const screens = {
  updating: $('screen-updating'),
  welcome: $('screen-welcome'),
  connect: $('screen-connect'),
  app: $('screen-app'),
};

let currentServer = null; // сервер, открытый сейчас в webview
let pendingInvite = null; // код инвайта из deep-link, ждущий применения

/* ------------------------- утилиты ------------------------- */

function show(screen) {
  for (const key of Object.keys(screens)) {
    screens[key].classList.toggle('active', key === screen);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

// Достаёт код инвайта из строки, если пользователь вставил полную ссылку.
function inviteFromRaw(raw) {
  const m = /[?&#]invite=([^&#\s]+)/.exec(raw || '');
  return m ? decodeURIComponent(m[1]) : null;
}

function buildUrl(base, invite) {
  const clean = base.replace(/\/+$/, '');
  return invite ? `${clean}/?invite=${encodeURIComponent(invite)}` : clean;
}

function errorText(code) {
  const map = {
    empty: 'Введите адрес сервера.',
    timeout: 'Сервер не ответил вовремя. Проверьте адрес и доступность.',
    'bad-url': 'Некорректный адрес. Пример: http://192.168.1.50:4991',
    ENOTFOUND: 'Хост не найден. Проверьте адрес сервера.',
    ECONNREFUSED: 'Соединение отклонено. Сервер выключен или закрыт порт.',
    ECONNRESET: 'Соединение сброшено сервером.',
    EHOSTUNREACH: 'Хост недоступен из вашей сети.',
    unreachable: 'Не удалось подключиться к серверу.',
  };
  return map[code] || `Не удалось подключиться (${code}).`;
}

/* ------------------------- маршрутизация ------------------------- */

async function init() {
  wireStaticEvents();
  wireWebview();

  // Автообновление: подписка до всего остального, чтобы не пропустить события.
  window.sharkord.onUpdateStatus(handleUpdate);
  window.sharkord.getVersion().then((v) => {
    const el = $('app-version');
    if (el) el.textContent = 'Версия ' + v;
  });

  // Сначала показываем экран обновления и ждём, пока main завершит стартовую
  // проверку (и при наличии апдейта — установку с перезапуском). Только потом
  // открываем сервер.
  show('updating');
  await window.sharkord.awaitStartupUpdate();

  const route = await window.sharkord.getInitialRoute();
  applyRoute(route);
  window.sharkord.onRoute(applyRoute);
}

function applyRoute(route) {
  if (!route) return;
  if (route.screen === 'app' && route.url) {
    openApp(route.server, route.url);
  } else if (route.screen === 'connect') {
    if (route.invite) pendingInvite = route.invite;
    showConnect();
  } else {
    show('welcome');
  }
}

/* ------------------------- экран подключения ------------------------- */

async function showConnect() {
  const servers = await window.sharkord.listServers();
  const select = $('server-select');
  const list = $('server-list');

  select.innerHTML = '';
  list.innerHTML = '';

  if (servers.length) {
    $('saved-block').classList.remove('hidden');
    for (const s of servers) {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} — ${s.url}`;
      if (currentServer && s.id === currentServer.id) opt.selected = true;
      select.appendChild(opt);
      list.appendChild(serverRow(s));
    }
  } else {
    $('saved-block').classList.add('hidden');
  }

  $('btn-back').classList.toggle('hidden', !currentServer);
  $('invite-note').classList.toggle('hidden', !pendingInvite);
  hideError();
  $('url-input').value = '';
  $('name-input').value = '';
  show('connect');
  $('url-input').focus();
}

function serverRow(s) {
  const row = document.createElement('div');
  row.className = 'srv-row';
  row.innerHTML = `
    <div class="srv-info">
      <span class="srv-name">${escapeHtml(s.name)}</span>
      <span class="srv-url">${escapeHtml(s.url)}</span>
    </div>
    <div class="srv-actions">
      <button class="mini" data-act="rename" title="Переименовать">✎</button>
      <button class="mini danger" data-act="delete" title="Удалить">🗑</button>
    </div>`;

  row.querySelector('[data-act="rename"]').addEventListener('click', () => startRename(row, s));
  row.querySelector('[data-act="delete"]').addEventListener('click', async () => {
    if (confirm(`Удалить сервер «${s.name}»?`)) {
      await window.sharkord.removeServer(s.id);
      if (currentServer && currentServer.id === s.id) currentServer = null;
      showConnect();
    }
  });
  return row;
}

// Инлайновое переименование (window.prompt в Electron недоступен).
function startRename(row, s) {
  const info = row.querySelector('.srv-info');
  info.innerHTML = `<input class="rename-input" type="text" />`;
  const input = info.querySelector('input');
  input.value = s.name;
  input.focus();
  input.select();

  let done = false;
  const commit = async () => {
    if (done) return;
    done = true;
    const name = input.value.trim();
    if (name && name !== s.name) await window.sharkord.renameServer(s.id, name);
    showConnect();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') commit();
    else if (e.key === 'Escape') { done = true; showConnect(); }
  });
  input.addEventListener('blur', commit);
}

async function connectNew() {
  const raw = $('url-input').value.trim();
  if (!raw) { showError(errorText('empty')); return; }

  setBusy(true);
  hideError();
  const test = await window.sharkord.testConnection(raw);
  if (!test.ok) {
    setBusy(false);
    showError(errorText(test.error));
    return;
  }
  const name = $('name-input').value.trim();
  const res = await window.sharkord.connect({ url: test.url, name });
  setBusy(false);

  const invite = pendingInvite || inviteFromRaw(raw);
  pendingInvite = null;
  openApp(res.server, buildUrl(res.url, invite));
}

async function connectSaved() {
  const id = $('server-select').value;
  if (!id) return;
  setBusy(true);
  const res = await window.sharkord.connect(id);
  setBusy(false);
  const invite = pendingInvite;
  pendingInvite = null;
  openApp(res.server, buildUrl(res.url, invite));
}

function setBusy(busy) {
  for (const id of ['btn-connect', 'btn-connect-saved', 'btn-back']) {
    const el = $(id);
    if (el) el.disabled = busy;
  }
  $('btn-connect').textContent = busy ? 'Подключение…' : 'Подключиться';
}

function showError(text) {
  const el = $('connect-error');
  el.textContent = text;
  el.classList.remove('hidden');
}
function hideError() { $('connect-error').classList.add('hidden'); }

/* ------------------------- рабочий экран (webview) ------------------------- */

function openApp(server, url) {
  currentServer = server || currentServer;
  $('current-name').textContent = currentServer ? currentServer.name : '';
  $('current-url').textContent = currentServer ? currentServer.url : '';
  setDot('');
  hideWvError();

  const view = $('view');
  view.src = url; // навигация webview (перезагрузит, даже если адрес тот же)
  show('app');
}

function wireWebview() {
  const view = $('view');

  view.addEventListener('did-start-loading', () => {
    $('wv-loading').classList.remove('hidden');
  });
  view.addEventListener('did-stop-loading', () => {
    $('wv-loading').classList.add('hidden');
  });
  view.addEventListener('dom-ready', () => setDot('ok'));
  view.addEventListener('did-finish-load', () => { setDot('ok'); hideWvError(); });

  view.addEventListener('did-fail-load', (e) => {
    if (e.isMainFrame === false) return; // ошибка подресурса — игнорируем
    if (e.errorCode === -3) return; // ERR_ABORTED (обычная смена страницы)
    setDot('err');
    $('wv-loading').classList.add('hidden');
    showWvError(`${e.errorDescription || 'ошибка'} (${e.errorCode})`);
  });

  view.addEventListener('render-process-gone', () => {
    setDot('err');
    showWvError('Процесс страницы аварийно завершился.');
  });
}

function setDot(state) {
  const dot = $('conn-dot');
  dot.classList.remove('ok', 'err');
  if (state) dot.classList.add(state);
}

function showWvError(text) {
  $('wv-error-text').textContent = text;
  $('wv-error').classList.remove('hidden');
}
function hideWvError() { $('wv-error').classList.add('hidden'); }

/* ------------------------- статические обработчики ------------------------- */

function wireStaticEvents() {
  $('btn-start').addEventListener('click', () => showConnect());

  $('btn-connect').addEventListener('click', connectNew);
  $('btn-connect-saved').addEventListener('click', connectSaved);
  $('btn-back').addEventListener('click', () => {
    if (currentServer) openApp(currentServer, currentServer.url);
  });

  // Enter в полях формы = подключиться
  for (const id of ['url-input', 'name-input']) {
    $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') connectNew(); });
  }

  $('btn-switch').addEventListener('click', () => showConnect());
  $('btn-switch2').addEventListener('click', () => showConnect());
  $('btn-reload').addEventListener('click', () => $('view').reload());
  $('btn-retry').addEventListener('click', () => {
    hideWvError();
    $('view').reload();
  });

  // Кнопка «Обновить» в баннере: ставит скачанное обновление и перезапускает клиент.
  $('ub-action').addEventListener('click', () => {
    $('ub-action').disabled = true;
    window.sharkord.installUpdate();
  });
}

/* ------------------------- автообновление ------------------------- */

let ubHideTimer = null;

// Разводим апдейт-статусы по двум местам в зависимости от фазы:
//   phase 'startup'          → полноэкранный экран обновления (при запуске);
//   phase 'runtime'/'manual' → нижний баннер (апдейт вышел во время работы).
function handleUpdate(st) {
  if (!st || !st.state) return;
  if (st.phase === 'startup') handleStartupUpdate(st);
  else handleRuntimeUpdate(st);
}

/* --- при запуске: полноэкранный экран --- */
function handleStartupUpdate(st) {
  switch (st.state) {
    case 'checking':
      upScreen('Проверка обновлений…', '', { spinner: true });
      break;
    case 'available':
      upScreen('Найдено обновление ' + (st.version || ''), 'Подготовка к загрузке…', { progress: 0 });
      break;
    case 'downloading':
      upScreen('Загрузка обновления ' + (st.version || ''), (st.percent || 0) + '%', { progress: st.percent || 0 });
      break;
    case 'installing':
      upScreen('Установка обновления…', 'Клиент перезапустится', { spinner: true });
      break;
    // uptodate / error / disabled → main отпускает гейт, экран сменится на сервер
  }
}

function upScreen(title, sub, opts = {}) {
  $('up-title').textContent = title;
  $('up-sub').textContent = sub || '';
  const spin = $('up-spinner');
  const prog = $('up-progress');
  if (typeof opts.progress === 'number') {
    prog.classList.remove('hidden');
    $('up-bar').style.width = opts.progress + '%';
    spin.classList.add('hidden');
  } else {
    prog.classList.add('hidden');
    spin.classList.toggle('hidden', !opts.spinner);
  }
}

/* --- во время работы: нижний баннер --- */
function handleRuntimeUpdate(st) {
  const manual = st.phase === 'manual';
  switch (st.state) {
    case 'checking':
      if (manual) banner('Проверка обновлений…', '', { spinner: true });
      break;
    case 'available':
      if (manual) banner('Обновление ' + (st.version || ''), 'Загрузка…', { progress: 0 });
      break;
    case 'downloading':
      banner('Обновление ' + (st.version || ''), 'Скачивание… ' + (st.percent || 0) + '%', { progress: st.percent || 0 });
      break;
    case 'ready':
      banner('Обновление ' + (st.version || '') + ' готово', 'Установить и перезапустить', { action: true });
      break;
    case 'installing':
      banner('Установка обновления…', 'Клиент перезапустится', { spinner: true });
      break;
    case 'uptodate':
      if (manual) banner('Установлена последняя версия', 'Текущая: ' + (st.current || ''), { autohide: 4000 });
      break;
    case 'disabled':
      if (manual) banner('Автообновление недоступно', st.reason || 'Работает только в установленном приложении.', { autohide: 7000 });
      break;
    case 'error':
      if (manual) banner('Не удалось обновиться', st.error || 'Неизвестная ошибка', { autohide: 6000, error: true });
      break;
    // фоновые (runtime) uptodate/error — молчим, чтобы не мешать работе
  }
}

function banner(title, sub, opts = {}) {
  const el = $('update-banner');
  $('ub-title').textContent = title;
  $('ub-sub').textContent = sub || '';
  el.classList.toggle('error', !!opts.error);

  const spinner = $('ub-spinner');
  const progress = $('ub-progress');
  const action = $('ub-action');
  if (typeof opts.progress === 'number') {
    progress.classList.remove('hidden');
    $('ub-bar').style.width = opts.progress + '%';
    spinner.classList.add('hidden');
  } else {
    progress.classList.add('hidden');
    spinner.classList.toggle('hidden', !opts.spinner);
  }
  action.classList.toggle('hidden', !opts.action);
  if (opts.action) action.disabled = false;

  el.classList.remove('hidden');
  clearTimeout(ubHideTimer);
  if (opts.autohide) ubHideTimer = setTimeout(() => el.classList.add('hidden'), opts.autohide);
}

init();
