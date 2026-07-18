// Разрешения на медиа (камера/микрофон/уведомления) и выбор источника для
// демонстрации экрана. Sharkord использует WebRTC (Mediasoup), поэтому без этого
// голос, видео и screen sharing не работают внутри Electron-обёртки.
const path = require('path');
const {
  session,
  desktopCapturer,
  BrowserWindow,
  ipcMain,
  screen,
} = require('electron');

// Разрешения, которые выдаём веб-приложению сервера автоматически.
const ALLOWED = new Set([
  'media', // getUserMedia (камера + микрофон)
  'audioCapture',
  'videoCapture',
  'display-capture', // getDisplayMedia (демонстрация экрана)
  'fullscreen',
  'notifications',
  'clipboard-read',
  'clipboard-sanitized-write',
  'pointerLock',
]);

let pickerPromise = null;

function setupMedia(partition) {
  const ses = session.fromPartition(partition);

  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED.has(permission));
  });

  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED.has(permission));

  // Обработчик демонстрации экрана: показываем свой пикер источников.
  ses.setDisplayMediaRequestHandler((_request, callback) => {
    chooseSource()
      .then((source) => {
        if (source) {
          // audio: 'loopback' — захват системного звука вместе с экраном (Windows).
          callback({ video: source, audio: 'loopback' });
        } else {
          // Пользователь отменил выбор — отклоняем запрос.
          callback({});
        }
      })
      .catch(() => callback({}));
  });
}

// Открывает модальное окно выбора экрана/окна и резолвит выбранный источник.
function chooseSource() {
  if (pickerPromise) return pickerPromise;

  pickerPromise = (async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen', 'window'],
      thumbnailSize: { width: 320, height: 180 },
      fetchWindowIcons: true,
    });

    const items = sources.map((s) => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL(),
      appIcon: s.appIcon && !s.appIcon.isEmpty() ? s.appIcon.toDataURL() : null,
      isScreen: s.id.startsWith('screen:'),
    }));

    return await new Promise((resolve) => {
      const win = new BrowserWindow({
        width: 820,
        height: 600,
        minWidth: 300,
        minHeight: 320,
        resizable: true, // содержимое адаптивно реагирует на ресайз
        minimizable: false,
        maximizable: true,
        fullscreenable: false,
        title: 'Выбор источника для демонстрации',
        backgroundColor: '#0d1117',
        webPreferences: {
          preload: path.join(__dirname, 'picker-preload.js'),
          contextIsolation: true,
          nodeIntegration: false,
        },
      });
      win.setMenuBarVisibility(false);

      let settled = false;
      const finish = (sourceId) => {
        if (settled) return;
        settled = true;
        ipcMain.removeHandler('picker:list');
        ipcMain.removeAllListeners('picker:choose');
        ipcMain.removeAllListeners('picker:fit');
        if (!win.isDestroyed()) win.destroy();
        const chosen = sourceId ? sources.find((s) => s.id === sourceId) : null;
        resolve(chosen || null);
      };

      ipcMain.handle('picker:list', () => items);
      ipcMain.once('picker:choose', (_e, sourceId) => finish(sourceId));

      // Подгоняем высоту окна под содержимое (ширину не трогаем — раскладка
      // реагирует на неё сама). Ограничиваем рабочей областью экрана.
      ipcMain.on('picker:fit', (e, desiredHeight) => {
        if (settled || win.isDestroyed() || e.sender !== win.webContents) return;
        const work = screen.getDisplayMatching(win.getBounds()).workAreaSize;
        const [curW] = win.getContentSize();
        const h = Math.min(Math.max(Math.round(desiredHeight), 260), work.height - 80);
        win.setContentSize(curW, h);
        win.center();
      });

      win.on('closed', () => finish(null));

      win.loadFile(path.join(__dirname, '..', 'renderer', 'picker.html'));
    });
  })().finally(() => {
    pickerPromise = null;
  });

  return pickerPromise;
}

module.exports = { setupMedia };
