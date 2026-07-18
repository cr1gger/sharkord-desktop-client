// Логика окна выбора источника демонстрации экрана.
(async () => {
  const grid = document.getElementById('grid');
  const sources = await window.picker.list();

  if (!sources.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Нет доступных источников';
    grid.appendChild(empty);
  } else {
    // Экраны показываем первыми, затем окна приложений.
    sources
      .sort((a, b) => Number(b.isScreen) - Number(a.isScreen))
      .forEach((s) => {
        const el = document.createElement('div');
        el.className = 'src';
        el.title = s.name;

        const thumb = document.createElement('img');
        thumb.className = 'thumb';
        thumb.src = s.thumbnail;

        const label = document.createElement('div');
        label.className = 'label';
        if (s.appIcon) {
          const ico = document.createElement('img');
          ico.src = s.appIcon;
          label.appendChild(ico);
        }
        const name = document.createElement('span');
        name.textContent = s.name;
        label.appendChild(name);

        el.appendChild(thumb);
        el.appendChild(label);
        el.addEventListener('click', () => window.picker.choose(s.id));
        grid.appendChild(el);
      });
  }

  document.getElementById('cancel').addEventListener('click', () => window.picker.cancel());

  // Подгоняем высоту окна под содержимое (main обрежет до размеров экрана).
  requestAnimationFrame(() => requestAnimationFrame(reportHeight));
  window.addEventListener('resize', () => {}); // держим окно отзывчивым к ручному ресайзу
})();

// Считает идеальную высоту содержимого и просит main подстроить окно.
function reportHeight() {
  const body = document.body;
  const cs = getComputedStyle(body);
  const padY = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
  const gap = parseFloat(cs.rowGap) || 12;
  const h1 = document.querySelector('h1').offsetHeight;
  const footer = document.querySelector('.footer').offsetHeight;
  const gridH = document.getElementById('grid').scrollHeight; // натуральная высота сетки
  const needed = padY + h1 + gap + gridH + gap + footer;
  window.picker.fit(Math.ceil(needed));
}
