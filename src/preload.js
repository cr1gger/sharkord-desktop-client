// Preload главного окна. Пробрасывает в наш UI (renderer) безопасный API поверх
// IPC. nodeIntegration выключен, contextIsolation включён — renderer не имеет
// прямого доступа к Node/Electron, только к перечисленным ниже методам.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sharkord', {
  // --- Запрос текущего состояния для выбора стартового экрана ---
  getInitialRoute: () => ipcRenderer.invoke('app:getInitialRoute'),

  // --- Управление серверами ---
  listServers: () => ipcRenderer.invoke('servers:list'),
  testConnection: (url) => ipcRenderer.invoke('servers:test', url),
  connect: (payload) => ipcRenderer.invoke('servers:connect', payload),
  removeServer: (id) => ipcRenderer.invoke('servers:remove', id),
  renameServer: (id, name) => ipcRenderer.invoke('servers:rename', { id, name }),

  // --- Действия приложения ---
  openExternal: (url) => ipcRenderer.invoke('app:openExternal', url),
  quit: () => ipcRenderer.invoke('app:quit'),

  // --- Обновления ---
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  checkUpdates: () => ipcRenderer.invoke('app:checkUpdates'),
  // Ждёт завершения стартовой проверки обновления (перед открытием сервера).
  awaitStartupUpdate: () => ipcRenderer.invoke('app:awaitStartupUpdate'),
  // Установить уже скачанное обновление сейчас (кнопка в баннере).
  installUpdate: () => ipcRenderer.invoke('app:installUpdate'),
  getSetting: (key) => ipcRenderer.invoke('app:getSetting', key),
  setSetting: (key, value) => ipcRenderer.invoke('app:setSetting', { key, value }),

  // --- События от main-процесса ---
  onRoute: (callback) => {
    const listener = (_e, route) => callback(route);
    ipcRenderer.on('route', listener);
    return () => ipcRenderer.removeListener('route', listener);
  },
  onUpdateStatus: (callback) => {
    const listener = (_e, status) => callback(status);
    ipcRenderer.on('update-status', listener);
    return () => ipcRenderer.removeListener('update-status', listener);
  },
});
