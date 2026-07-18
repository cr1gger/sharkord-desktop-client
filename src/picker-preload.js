// Preload для окна выбора источника демонстрации экрана.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('picker', {
  list: () => ipcRenderer.invoke('picker:list'),
  choose: (id) => ipcRenderer.send('picker:choose', id),
  fit: (height) => ipcRenderer.send('picker:fit', height),
  cancel: () => window.close(),
});
