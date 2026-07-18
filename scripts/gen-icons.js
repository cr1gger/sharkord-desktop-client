// Генерация растровых иконок (PNG + многоразмерный ICO + macOS ICNS) из assets/icon.svg.
// Запускается перед сборкой (`npm run gen-icons`, входит в `pack`/`dist`).
// Использует @resvg/resvg-js (SVG->PNG), png-to-ico (PNG->ICO) и png2icons
// (PNG->ICNS). Все зависимости — чистый JS/prebuilt, без нативной компиляции,
// поэтому одинаково работают на Windows/macOS/Linux-раннерах CI.
const fs = require('fs');
const path = require('path');
const { Resvg } = require('@resvg/resvg-js');
const pngToIco = require('png-to-ico');
const png2icons = require('png2icons');

const assets = path.join(__dirname, '..', 'assets');
const svg = fs.readFileSync(path.join(assets, 'icon.svg'));

function renderPng(size) {
  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

async function main() {
  // Иконка приложения / окна и иконка Linux (electron-builder берёт linux.icon
  // из этого PNG). 512px хватает для окна, дока и AppImage.
  fs.writeFileSync(path.join(assets, 'icon.png'), renderPng(512));

  // Иконки трея (@1x и @2x для HiDPI)
  fs.writeFileSync(path.join(assets, 'tray.png'), renderPng(32));
  fs.writeFileSync(path.join(assets, 'tray@2x.png'), renderPng(64));

  // Многоразмерный .ico для установщика Windows
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const buffers = sizes.map(renderPng);
  const ico = await pngToIco(buffers);
  fs.writeFileSync(path.join(assets, 'icon.ico'), ico);

  // .icns для сборки macOS (генерируем из 1024px PNG — так icns получает все
  // размеры вплоть до Retina). png2icons — чистый JS, работает и на Windows.
  const big = renderPng(1024);
  const icns = png2icons.createICNS(big, png2icons.BILINEAR, 0);
  if (!icns) throw new Error('png2icons.createICNS вернул пусто');
  fs.writeFileSync(path.join(assets, 'icon.icns'), icns);

  console.log(
    'Иконки сгенерированы:',
    ['icon.png', 'tray.png', 'tray@2x.png', 'icon.ico', 'icon.icns'].join(', ')
  );
}

main().catch((err) => {
  console.error('Ошибка генерации иконок:', err);
  process.exit(1);
});
