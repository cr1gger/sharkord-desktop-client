// Разбор пригласительных / deep-link ссылок вида sharkord://...
//
// Поддерживаемые форматы (все — способы передать «сервер + код инвайта»):
//
//   sharkord://open?url=<полный https-URL Sharkord с ?invite=CODE>
//       — самый надёжный: несёт весь оригинальный веб-адрес целиком.
//
//   sharkord://join?server=<base-url>&invite=<CODE>
//   sharkord://invite?server=<base-url>&code=<CODE>
//       — сервер и код по отдельности.
//
//   sharkord://invite/<CODE>
//   sharkord://join/<CODE>
//       — только код инвайта; сервер берётся текущий/последний.
//
// Возвращает { serverUrl?, invite?, fullUrl? } либо null, если это не наша ссылка.

function decode(v) {
  if (v == null) return v;
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

// Достаёт код инвайта из веб-адреса Sharkord (?invite=CODE или #invite=CODE).
function inviteFromUrl(urlStr) {
  try {
    const u = new URL(urlStr);
    const q = u.searchParams.get('invite');
    if (q) return q;
    const m = /(?:^|[?&#])invite=([^&#]+)/.exec(u.hash || '');
    if (m) return decode(m[1]);
  } catch {
    /* ignore */
  }
  return null;
}

function parseDeepLink(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!/^sharkord:\/\//i.test(trimmed)) return null;

  let url;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }

  // Действие — это host в URL (sharkord://open -> host="open").
  const action = (url.hostname || '').toLowerCase();
  const params = url.searchParams;
  const pathParts = url.pathname.split('/').filter(Boolean).map(decode);

  // 1) sharkord://open?url=<полный URL>
  const embedded = decode(params.get('url'));
  if (embedded) {
    return {
      fullUrl: embedded,
      serverUrl: originOf(embedded),
      invite: inviteFromUrl(embedded),
    };
  }

  // 2) server + invite/code по отдельности
  const server = decode(params.get('server') || params.get('host'));
  const codeParam = decode(params.get('invite') || params.get('code'));
  if (server || codeParam) {
    return {
      serverUrl: server ? normalizeServer(server) : null,
      invite: codeParam || null,
      fullUrl: null,
    };
  }

  // 3) код в пути: sharkord://invite/<CODE>
  // Важно: код берётся ТОЛЬКО из пути (регистрозависим), а не из host —
  // хост в URL нормализуется в нижний регистр и испортил бы код инвайта.
  if ((action === 'invite' || action === 'join') && pathParts.length >= 1) {
    return { serverUrl: null, invite: pathParts[0], fullUrl: null };
  }

  return null;
}

function originOf(urlStr) {
  try {
    return new URL(urlStr).origin;
  } catch {
    return null;
  }
}

// Приводит переданный сервер к валидному базовому URL (добавляет схему при нужде).
function normalizeServer(server) {
  let s = String(server).trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  try {
    return new URL(s).origin;
  } catch {
    return s;
  }
}

// Ищет sharkord:// URL среди аргументов командной строки (для запуска по ссылке).
function deepLinkFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  return argv.find((a) => typeof a === 'string' && /^sharkord:\/\//i.test(a)) || null;
}

module.exports = { parseDeepLink, deepLinkFromArgv, inviteFromUrl, normalizeServer };
