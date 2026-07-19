// Preload для <webview> с веб-приложением Sharkord.
//
// Задача: узнавать состояние голоса (микрофон / звук-deafen / нахождение в
// голосовом канале) и отдавать его main-процессу, чтобы тот менял иконку в трее.
//
// Sharkord — чужой код, «официального» события об этом нет, поэтому наблюдаем:
//   • micMuted / soundMuted — по иконкам lucide в панели пользователя
//     (user-control): mic/mic-off и headphones/headphone-off. Классы иконок
//     (`lucide-mic-off` и т.п.) от локализации не зависят.
//   • currentVoiceChannelId — штатно из window.__SHARKORD_STORE__, который
//     Sharkord безусловно вешает на window (plugin-store).
//
// Наблюдатель работает в MAIN world страницы (через webFrame.executeJavaScript —
// это обходит CSP страницы и даёт доступ к window.__SHARKORD_STORE__), а результат
// шлёт сюда через window.postMessage. Этот preload (isolated world) ловит
// сообщение и ретранслирует его напрямую в main через ipcRenderer.send
// (sendToHost не годится: при contextIsolation DOM-событие ipc-message приходит
// в host без channel/args).
const { ipcRenderer, webFrame } = require('electron');

const MARK = 'sharkord-voice-state';

// --- Код, выполняемый в MAIN world страницы Sharkord ---------------------
// Пишется как отдельная функция и сериализуется в строку (.toString()), поэтому
// не должен ссылаться на переменные модуля, кроме переданного аргумента.
function installVoiceObserver(mark) {
  let last = '';

  // Панель user-control = единственная группа кнопок, где рядом есть иконки
  // микрофона, наушников и настроек. Так отличаем «свои» кнопки от иконок
  // состояния других участников в списке голосового канала.
  function findControlGroup() {
    const settings = document.querySelectorAll('svg.lucide-settings');
    for (const icon of settings) {
      const btn = icon.closest('button');
      const group = btn && btn.parentElement;
      if (!group) continue;
      const hasMic = group.querySelector('.lucide-mic, .lucide-mic-off');
      const hasHead = group.querySelector(
        '.lucide-headphones, .lucide-headphone-off'
      );
      if (hasMic && hasHead) return group;
    }
    return null;
  }

  function compute() {
    let inVoice = false;
    try {
      const store = window.__SHARKORD_STORE__;
      const state = store && store.getState && store.getState();
      inVoice = !!(state && state.currentVoiceChannelId != null);
    } catch {
      /* стор ещё не готов */
    }

    let micMuted = null;
    let soundMuted = null;
    const group = findControlGroup();
    if (group) {
      micMuted = !!group.querySelector('.lucide-mic-off');
      soundMuted = !!group.querySelector('.lucide-headphone-off');
    }

    return { inVoice, micMuted, soundMuted };
  }

  function emit() {
    const state = compute();
    const key = JSON.stringify(state);
    if (key === last) return;
    last = key;
    try {
      window.postMessage({ [mark]: true, state }, '*');
    } catch {
      /* игнорируем */
    }
  }

  // Троттлим пересчёт: перерисовки кнопок и апдейты стора идут пачками.
  let scheduled = false;
  function schedule() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      emit();
    }, 150);
  }

  // Смена голосового канала может не менять DOM панели — ловим её через стор.
  let subscribed = false;
  function trySubscribe() {
    if (subscribed) return;
    const store = window.__SHARKORD_STORE__;
    if (store && store.subscribe) {
      try {
        store.subscribe(schedule);
        subscribed = true;
      } catch {
        /* повторим на следующем тике */
      }
    }
  }

  try {
    const mo = new MutationObserver(schedule);
    mo.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class'],
    });
  } catch {
    /* без MutationObserver останется опрос по таймеру */
  }

  // Стор монтируется не сразу — подписываемся сразу и повторяем в таймере,
  // который также делает страховочный опрос (состояние дедуплицируется).
  trySubscribe();
  setInterval(() => {
    trySubscribe();
    emit();
  }, 2000);

  emit();
}

// --- Мост main world → main-процесс -------------------------------------
window.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || data[MARK] !== true || !data.state) return;
  ipcRenderer.send('voice:state', data.state);
});

function inject() {
  const code = `(${installVoiceObserver.toString()})(${JSON.stringify(MARK)})`;
  webFrame.executeJavaScript(code).catch(() => {
    /* страница может быть не-Sharkord — тогда наблюдать нечего */
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', inject);
} else {
  inject();
}
