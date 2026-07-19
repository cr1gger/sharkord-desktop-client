// Сборка портативной версии для Windows напрямую из бинарника Electron
// (node_modules/electron/dist), без electron-builder. Нужна потому, что
// electron-builder на Windows без Developer Mode падает на распаковке winCodeSign
// (симлинки macOS-библиотек). У приложения нет runtime-зависимостей, поэтому
// достаточно скопировать исходники в resources/app.
//
// Результат: <outBase>/Sharkord-win32-x64/Sharkord.exe — запускается двойным
// кликом, Node на машине не требуется. Протокол sharkord:// приложение
// регистрирует само при первом запуске.
//
// Папка назначения — первым аргументом (по умолчанию dist):
//   node scripts/pack-portable.js          -> dist/     (dev-сборка)
//   node scripts/pack-portable.js release  -> release/  (релизная сборка)
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const outBase = process.argv[2] || 'dist';
const out = path.join(root, outBase, 'Sharkord-win32-x64');
const electronDist = path.join(root, 'node_modules', 'electron', 'dist');

if (!fs.existsSync(path.join(electronDist, 'electron.exe'))) {
  console.error('Не найден node_modules/electron/dist. Сначала выполните npm install.');
  process.exit(1);
}

console.log('Очистка', out);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

console.log('Копирование среды Electron...');
fs.cpSync(electronDist, out, { recursive: true });

// electron.exe -> Sharkord.exe
fs.renameSync(path.join(out, 'electron.exe'), path.join(out, 'Sharkord.exe'));

// Убираем встроенное демо-приложение Electron (наш app/ имеет приоритет и без этого).
fs.rmSync(path.join(out, 'resources', 'default_app.asar'), { force: true });

// Копируем приложение в resources/app.
const appDir = path.join(out, 'resources', 'app');
fs.mkdirSync(appDir, { recursive: true });
fs.copyFileSync(path.join(root, 'package.json'), path.join(appDir, 'package.json'));
fs.cpSync(path.join(root, 'src'), path.join(appDir, 'src'), { recursive: true });
fs.cpSync(path.join(root, 'renderer'), path.join(appDir, 'renderer'), { recursive: true });

const assetsOut = path.join(appDir, 'assets');
fs.mkdirSync(assetsOut, { recursive: true });
for (const f of [
  'icon.png', 'icon.ico',
  'tray.png', 'tray@2x.png',
  'tray-live.png', 'tray-live@2x.png',
  'tray-mic-off.png', 'tray-mic-off@2x.png',
  'tray-deafen.png', 'tray-deafen@2x.png',
]) {
  fs.copyFileSync(path.join(root, 'assets', f), path.join(assetsOut, f));
}

console.log('\nПортативная сборка готова:');
console.log(' ', path.join(out, 'Sharkord.exe'));
