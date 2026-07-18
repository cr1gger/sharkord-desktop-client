// Постоянное хранилище конфигурации клиента.
// Хранит список серверов и id последнего выбранного в config.json внутри
// userData (папка профиля приложения ОС). Данные переживают перезапуск и
// обновление приложения — этим закрывается требование «сервер сохраняется навсегда».
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

let cache = null;

function file() {
  return path.join(app.getPath('userData'), 'config.json');
}

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(file(), 'utf8');
    const data = JSON.parse(raw);
    cache = {
      servers: Array.isArray(data.servers) ? data.servers : [],
      lastServerId: data.lastServerId || null,
      settings: data.settings && typeof data.settings === 'object' ? data.settings : {},
    };
  } catch {
    cache = { servers: [], lastServerId: null, settings: {} };
  }
  return cache;
}

function getSetting(key, defaultValue) {
  const data = load();
  return key in data.settings ? data.settings[key] : defaultValue;
}

function setSetting(key, value) {
  const data = load();
  data.settings[key] = value;
  save();
  return value;
}

function save() {
  const data = load();
  try {
    fs.writeFileSync(file(), JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.error('Не удалось сохранить конфигурацию:', err);
  }
}

// Нормализует базовый URL сервера: убирает пробелы и хвостовой слэш.
function normalizeBase(url) {
  return String(url || '').trim().replace(/\/+$/, '');
}

function listServers() {
  return load().servers.slice();
}

function getServer(id) {
  return load().servers.find((s) => s.id === id) || null;
}

function findByUrl(url) {
  const base = normalizeBase(url);
  return load().servers.find((s) => normalizeBase(s.url) === base) || null;
}

// Добавляет сервер либо возвращает уже существующий с таким же URL (без дублей).
// Если у существующего не было имени, а новое передано — обновляет имя.
function addServer({ url, name }) {
  const data = load();
  const base = normalizeBase(url);
  const cleanName = (name || '').trim();

  const existing = findByUrl(base);
  if (existing) {
    if (cleanName && cleanName !== existing.name) {
      existing.name = cleanName;
      save();
    }
    return existing;
  }

  const server = {
    id: crypto.randomUUID(),
    url: base,
    name: cleanName || hostLabel(base),
    addedAt: Date.now(),
  };
  data.servers.push(server);
  save();
  return server;
}

function renameServer(id, name) {
  const server = getServer(id);
  if (!server) return null;
  server.name = (name || '').trim() || hostLabel(server.url);
  save();
  return server;
}

function removeServer(id) {
  const data = load();
  data.servers = data.servers.filter((s) => s.id !== id);
  if (data.lastServerId === id) {
    data.lastServerId = data.servers.length ? data.servers[0].id : null;
  }
  save();
}

function setLastServer(id) {
  const data = load();
  data.lastServerId = id;
  save();
}

function getLastServer() {
  const data = load();
  if (!data.lastServerId) return null;
  return getServer(data.lastServerId);
}

// Человекочитаемая метка по URL, когда пользователь не задал имя (host:port).
function hostLabel(url) {
  try {
    const u = new URL(url);
    return u.port ? `${u.hostname}:${u.port}` : u.hostname;
  } catch {
    return url;
  }
}

module.exports = {
  normalizeBase,
  hostLabel,
  listServers,
  getServer,
  findByUrl,
  addServer,
  renameServer,
  removeServer,
  setLastServer,
  getLastServer,
  getSetting,
  setSetting,
};
