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

// Внутренности базового логотипа (без обёртки <svg>) — переиспользуются для
// вариантов иконки трея, чтобы бейджи состояний рисовались поверх того же лого.
const baseInner = fs
  .readFileSync(path.join(assets, 'icon.svg'), 'utf8')
  .replace(/<svg[^>]*>/, '')
  .replace(/<\/svg>\s*$/, '');

const DK = '#0d1117';
const R = 6; // полутолщина обводки (тёмного ободка вокруг белых глифов)

function renderPngFrom(svgSource, size) {
  const resvg = new Resvg(svgSource, { fitTo: { mode: 'width', value: size } });
  return resvg.render().asPng();
}

function renderPng(size) {
  return renderPngFrom(svg, size);
}

// «В голосовом канале, всё включено» — крупная зелёная точка поверх логотипа.
const LIVE_BADGE = `
  <circle cx="196" cy="196" r="52" fill="#22c55e" stroke="${DK}" stroke-width="12"/>`;

function variantSvg(overlay) {
  return `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg">${baseInner}${overlay}</svg>`;
}

// Иконки «микрофон/звук выключен» полностью заменяют логотип крупным белым
// перечёркнутым глифом. Подложки нет — читаемость даёт тёмная обводка (тёмная
// копия глифа под белой), поэтому состояние видно и на тёмной, и на светлой
// панели задач.
function MIC(col, lw, rs) {
  return `
    <rect x="104" y="48" width="48" height="98" rx="24" fill="${col}" stroke="${col}" stroke-width="${rs}"/>
    <path d="M74 132 a54 54 0 0 0 108 0" fill="none" stroke="${col}" stroke-width="${lw}" stroke-linecap="round"/>
    <line x1="128" y1="182" x2="128" y2="210" stroke="${col}" stroke-width="${lw}" stroke-linecap="round"/>
    <line x1="94" y1="210" x2="162" y2="210" stroke="${col}" stroke-width="${lw}" stroke-linecap="round"/>`;
}
function HEAD(col, lw, rs) {
  return `
    <path d="M68 152 a60 60 0 0 1 120 0" fill="none" stroke="${col}" stroke-width="${lw}" stroke-linecap="round"/>
    <rect x="56" y="148" width="32" height="60" rx="15" fill="${col}" stroke="${col}" stroke-width="${rs}"/>
    <rect x="168" y="148" width="32" height="60" rx="15" fill="${col}" stroke="${col}" stroke-width="${rs}"/>`;
}
// Диагональ «выключено»: тёмный штрих + белая линия поверх.
const SLASH = `
  <line x1="52" y1="52" x2="204" y2="204" stroke="${DK}" stroke-width="30" stroke-linecap="round"/>
  <line x1="52" y1="52" x2="204" y2="204" stroke="#ffffff" stroke-width="14" stroke-linecap="round"/>`;

// Глиф целиком: тёмная копия (обводка) + белая заливка + диагональ. Крупнее на
// 20% относительно поля 256, по центру.
function glyphSvg(inner) {
  return `<svg width="256" height="256" viewBox="0 0 256 256" xmlns="http://www.w3.org/2000/svg"><g transform="translate(128 128) scale(1.2) translate(-128 -128)">${inner}</g></svg>`;
}
const MIC_OFF = glyphSvg(`${MIC(DK, 14 + 2 * R, 2 * R)}${MIC('#fff', 14, 0)}${SLASH}`);
const DEAFEN = glyphSvg(`${HEAD(DK, 16 + 2 * R, 2 * R)}${HEAD('#fff', 16, 0)}${SLASH}`);

async function main() {
  // Иконка приложения / окна и иконка Linux (electron-builder берёт linux.icon
  // из этого PNG). 512px хватает для окна, дока и AppImage.
  fs.writeFileSync(path.join(assets, 'icon.png'), renderPng(512));

  // Иконки трея (@1x и @2x для HiDPI). Базовая + варианты состояний голоса:
  // tray-live (в канале), tray-mic-off (микрофон выкл), tray-deafen (звук выкл).
  const trayVariants = {
    tray: svg,
    'tray-live': variantSvg(LIVE_BADGE),
    'tray-mic-off': MIC_OFF,
    'tray-deafen': DEAFEN,
  };
  for (const [name, source] of Object.entries(trayVariants)) {
    fs.writeFileSync(path.join(assets, `${name}.png`), renderPngFrom(source, 32));
    fs.writeFileSync(path.join(assets, `${name}@2x.png`), renderPngFrom(source, 64));
  }

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
    [
      'icon.png',
      'tray.png', 'tray@2x.png',
      'tray-live.png', 'tray-mic-off.png', 'tray-deafen.png (+@2x)',
      'icon.ico', 'icon.icns',
    ].join(', ')
  );
}

main().catch((err) => {
  console.error('Ошибка генерации иконок:', err);
  process.exit(1);
});
