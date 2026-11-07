// Self-tests of the settings menu (ui/menu.ts): the ⚙ and ⛶ buttons, Esc and the pause, the volume / mute / quality / language / interface controls,
// a refused fullscreen request, and the panel at the phone size 810×253 (checked in a same-size iframe, because vh units follow the real window).
// Each test puts back the pause state, the localStorage keys and the audio levels it changes.
import { registerTest } from '../game/selftest';
import { G } from '../game/state';
import { getLang, setLang, LANGS, type Lang } from '../content/i18n';
import { sfx } from '../engine/audio';
import { readVol, applyVol, chooseLanguage, toggleFullscreen, openMenu, closeMenu, menuOpen } from './menu';
import { getUiMode, applyUiMode } from './hudmode';

const KEYS = ['sc.vol', 'sc.q', 'sc.lang', 'sc.ui'] as const;   // sc.ui: hudmode.ts
const $ = <T extends Element = HTMLElement>(s: string) => document.querySelector(s) as T | null;
const panelEl = () => $('#sc-menu');
const panelShown = () => panelEl()?.style.display === 'block';
const ctl = <T extends HTMLElement = HTMLElement>(sel: string) => $<T>('#sc-menu ' + sel);

function keepStore(): Record<string, string | null> {
  const o: Record<string, string | null> = {};
  for (const k of KEYS) { try { o[k] = localStorage.getItem(k); } catch { o[k] = null; } }
  return o;
}
function restoreStore(o: Record<string, string | null>) {
  for (const k of KEYS) { try { if (o[k] === null) localStorage.removeItem(k); else localStorage.setItem(k, o[k]!); } catch { /* ignore */ } }
}
/** Replace the fullscreen request (both the standard and the webkit name: Chromium has both) for one test; the returned function puts them back. */
function stubFs(fn: (() => Promise<void>) | 'missing'): () => void {
  const de = document.documentElement as any;
  const names = ['requestFullscreen', 'webkitRequestFullscreen'];
  const saved = names.map(n => [n, Object.getOwnPropertyDescriptor(de, n)] as const);
  for (const n of names) de[n] = fn === 'missing' ? undefined : fn;
  return () => { for (const [n, d] of saved) { if (d) Object.defineProperty(de, n, d); else delete de[n]; } };
}
/** Shut the menu and put the pause back as it was before the test. */
function reset(paused: boolean) {
  if (menuOpen()) closeMenu();
  G.paused = paused;
}

registerTest('menu', 'на ПК ⚙ и ⛶ видны в правом верхнем углу, по 40 px, левее солнечных часов', async t => {
  if (document.body.classList.contains('touch-ui')) { t.log('касание: пропуск (на телефоне кнопки в сенсорном слое)'); return; }
  const g = $<HTMLElement>('#sc-menubtn'), f = $<HTMLElement>('#sc-fsbtn');
  t.expect(!!g && !!f, 'кнопок нет в DOM');
  if (!g || !f) return;
  const rg = g.getBoundingClientRect(), rf = f.getBoundingClientRect();
  t.expect(Math.round(rg.width) === 40 && Math.round(rg.height) === 40, `⚙ ${rg.width}×${rg.height}, нужно 40×40`);
  t.expect(Math.round(rf.width) === 40 && Math.round(rf.height) === 40, `⛶ ${rf.width}×${rf.height}, нужно 40×40`);
  t.expect(rg.top < 60 && rf.top < 60, `кнопки не вверху: top ${rg.top}`);
  t.expect(rg.left > innerWidth / 2 && rf.left > innerWidth / 2, 'кнопки не справа');
  t.expect(rg.right <= rf.left + 1, '⚙ должна стоять левее ⛶');
  const dial = $<HTMLElement>('#hud .dial');
  if (dial && dial.offsetParent !== null) {
    const rd = dial.getBoundingClientRect();
    const hit = rf.left < rd.right && rf.right > rd.left && rf.top < rd.bottom && rf.bottom > rd.top;
    t.expect(!hit, 'кнопка ⛶ налезает на солнечные часы');
  }
  t.expect(g.getAttribute('aria-label') === 'Настройки', 'aria-label ⚙: ' + g.getAttribute('aria-label'));
});

registerTest('menu', 'клик по ⚙ открывает панель с паузой; «Продолжить» закрывает и снимает паузу', async t => {
  const was = G.paused;
  try {
    reset(false);
    $<HTMLElement>('#sc-menubtn')?.click();
    await t.frames(2);
    t.expect(panelShown(), 'панель не открылась');
    t.expect(G.paused === true, 'при открытой панели игра не на паузе');
    ctl('[data-k=cont]')?.click();
    await t.frames(3);
    t.expect(!panelShown(), 'панель не закрылась по «Продолжить»');
    t.expect(G.paused === false, 'после «Продолжить» игра осталась на паузе');
    $<HTMLElement>('#sc-menubtn')?.click(); await t.frames(2);
    ctl('.mx')?.click(); await t.frames(3);
    t.expect(!panelShown() && G.paused === false, 'крестик не закрыл панель или не снял паузу');
  } finally { reset(was); }
});

registerTest('menu', 'Esc открывает панель (пауза), второй Esc закрывает и игра идёт дальше', async t => {
  const was = G.paused;
  try {
    reset(false);
    t.sc.key('Escape', true); t.sc.key('Escape', false);
    await t.frames(4);
    t.expect(panelShown() && G.paused, 'первый Esc не открыл панель с паузой');
    t.sc.key('Escape', true); t.sc.key('Escape', false);
    await t.frames(4);
    t.expect(!panelShown() && !G.paused, 'второй Esc не закрыл панель и не снял паузу');
  } finally { reset(was); }
});

registerTest('menu', 'ручная пауза переживает закрытие панели (панель не снимает её)', async t => {
  const was = G.paused;
  try {
    reset(false);
    G.paused = true;                       // paused before the panel opens: the panel must leave it so
    $<HTMLElement>('#sc-menubtn')?.click();
    await t.frames(2);
    ctl('[data-k=cont]')?.click();
    await t.frames(4);
    t.expect(G.paused === true, 'закрытие панели сняло ручную паузу');
    t.expect(!panelShown(), 'панель открылась сама после закрытия');
  } finally { reset(was); }
});

registerTest('menu', 'sc:menu (сенсорный ⚙) открывает и закрывает ту же панель', async t => {
  const was = G.paused;
  try {
    reset(false);
    window.dispatchEvent(new Event('sc:menu')); await t.frames(2);
    t.expect(panelShown(), 'sc:menu не открыл панель');
    window.dispatchEvent(new Event('sc:menu')); await t.frames(2);
    t.expect(!panelShown() && !G.paused, 'второй sc:menu не закрыл панель');
  } finally { reset(was); }
});

registerTest('menu', 'на телефоне (touch-ui) кнопки ⚙ и ⛶ на ПК скрыты: нет дубля', async t => {
  const had = document.body.classList.contains('touch-ui');
  try {
    document.body.classList.add('touch-ui'); await t.frames(1);
    const g = $<HTMLElement>('#sc-menubtn'), f = $<HTMLElement>('#sc-fsbtn');
    t.expect(!!g && getComputedStyle(g).display === 'none', '⚙ виден на телефоне (дубль)');
    t.expect(!!f && getComputedStyle(f).display === 'none', '⛶ виден на телефоне');
  } finally { if (!had) document.body.classList.remove('touch-ui'); }
});

registerTest('menu', 'громкость: ползунок и выключатель звука меняют звук и пишутся в sc.vol', async t => {
  const store = keepStore(), was = G.paused;
  try {
    reset(false); openMenu(); await t.frames(2);
    const rng = ctl<HTMLInputElement>('[data-k=vol]');
    t.expect(!!rng, 'ползунка громкости нет');
    if (rng) { rng.value = '40'; rng.dispatchEvent(new Event('input')); }
    t.expect(readVol().v === 40, 'громкость не записалась: ' + readVol().v);
    t.expect(Math.abs(sfx.stats().vMaster - 0.4) < 1e-6, 'звук: master ' + sfx.stats().vMaster + ', нужно 0.4');
    ctl('[data-k=sound]')?.click();
    t.expect(readVol().m === true && sfx.stats().muted === true, 'выключатель не выключил звук');
    ctl('[data-k=sound]')?.click();
    t.expect(readVol().m === false && sfx.stats().muted === false, 'выключатель не включил звук обратно');
  } finally {
    restoreStore(store); applyVol(readVol()); reset(was);
  }
});

registerTest('menu', 'качество графики: кнопки меняют G.quality (0/1/2), выбор пишется в sc.q', async t => {
  const store = keepStore(), was = G.paused, q0 = G.quality;
  try {
    reset(false); openMenu(); await t.frames(2);
    ctl('[data-k=q][data-v="0"]')?.click();
    t.expect(G.quality === 0, 'качество не стало низким: ' + G.quality);
    t.expect(localStorage.getItem('sc.q') === '0', 'sc.q не записан');
    t.expect(!!ctl('[data-k=q][data-v="0"]')?.classList.contains('on'), 'кнопка «Низкое» не отмечена');
    ctl('[data-k=q][data-v="2"]')?.click();
    t.expect(G.quality === 2, 'качество не стало высоким: ' + G.quality);
  } finally {
    ctl(`[data-k=q][data-v="${q0}"]`)?.click();          // through the button: it also re-fits the canvas (resize)
    restoreStore(store); reset(was);
  }
});

registerTest('menu', 'язык: выбор ставит язык и пишет sc.lang (без перезагрузки в этом тесте); список из 10 языков', async t => {
  const store = keepStore(), was = G.paused, prev = getLang();
  try {
    reset(false); openMenu(); await t.frames(2);
    const opts = document.querySelectorAll('#sc-menu [data-k=lang] option');
    t.expect(opts.length === LANGS.length && LANGS.length === 10, 'вариантов языка: ' + opts.length);
    chooseLanguage('en' as Lang, false);
    t.expect(getLang() === 'en', 'язык не стал en');
    t.expect(localStorage.getItem('sc.lang') === 'en', 'sc.lang не записан');
    setLang('ru');
  } finally {
    restoreStore(store); setLang(prev as Lang); reset(was);
  }
});

registerTest('menu', 'интерфейс: выбор режима шлёт sc:uimode и пишет sc.ui', async t => {
  const store = keepStore(), was = G.paused;
  let seen = '';
  const onMode = (e: Event) => { seen = String((e as CustomEvent<{ mode: string }>).detail?.mode); };
  window.addEventListener('sc:uimode', onMode);
  try {
    reset(false); openMenu(); await t.frames(2);
    ctl('[data-k=ui][data-v="min"]')?.click();
    t.expect(seen === 'min', 'событие sc:uimode не пришло: ' + seen);
    t.expect(getUiMode() === 'min' && localStorage.getItem('sc.ui') === 'min', 'режим не сохранён');
    t.expect(document.body.classList.contains('ui-min'), 'класс ui-min не выставлен');
    ctl('[data-k=ui][data-v="full"]')?.click();
    t.expect(seen === 'full' && getUiMode() === 'full', 'обратный режим не применён');
  } finally {
    window.removeEventListener('sc:uimode', onMode);
    restoreStore(store); applyUiMode(); reset(was);
  }
});

registerTest('menu', 'полный экран: отказ браузера не бросает исключений и показывает подсказку', async t => {
  const was = G.paused;
  let restore = () => {};
  try {
    reset(false);
    restore = stubFs(() => Promise.reject(new Error('denied by iframe policy')));
    $<HTMLElement>('#sc-fsbtn')?.click();
    await t.frames(3);
    const note = ctl('[data-k=fsnote]');
    t.expect(!!note && note.style.display === 'block', 'подсказка о полном экране не показана');
    // a synchronous throw, then a browser without the API: toggleFullscreen must absorb both (an escaping error fails the test through the runner)
    restore(); restore = stubFs(() => { throw new Error('sync refusal'); });
    await toggleFullscreen();
    restore(); restore = stubFs('missing');
    await toggleFullscreen();
    t.expect(!!ctl('[data-k=fsnote]') && ctl('[data-k=fsnote]')!.style.display === 'block', 'подсказка пропала после отказа');
  } finally { restore(); reset(was); }
});

registerTest('menu', 'полный экран недоступен на странице (fullscreenEnabled=false): подсказка, без запроса', async t => {
  const was = G.paused;
  let calls = 0;
  const restore = stubFs(() => { calls++; return Promise.resolve(); });
  const had = Object.getOwnPropertyDescriptor(document, 'fullscreenEnabled');
  try {
    reset(false); openMenu(); await t.frames(2);
    Object.defineProperty(document, 'fullscreenEnabled', { configurable: true, get: () => false });
    $<HTMLElement>('#sc-fsbtn')?.click();
    await t.frames(2);
    t.expect(calls === 0, 'запрос ушёл в браузер, хотя полный экран недоступен');
    const note = ctl('[data-k=fsnote]');
    t.expect(!!note && note.style.display === 'block', 'подсказка не показана');
    t.expect(!!ctl('[data-k=fs]') && ctl('[data-k=fs]')!.textContent!.includes('недоступно'), 'строка состояния не говорит «недоступно»');
  } finally {
    if (had) Object.defineProperty(document, 'fullscreenEnabled', had); else delete (document as any).fullscreenEnabled;
    restore(); reset(was);
  }
});

registerTest('menu', 'Shift+Enter переключает полный экран (запрос уходит в браузер)', async t => {
  const was = G.paused;
  let calls = 0;
  const restore = stubFs(() => { calls++; return Promise.resolve(); });
  try {
    reset(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', shiftKey: true, bubbles: true }));
    await t.frames(2);
    t.expect(calls === 1, 'Shift+Enter не запросил полный экран: ' + calls);
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', key: 'Enter', bubbles: true }));
    await t.frames(2);
    t.expect(calls === 1, 'обычный Enter не должен включать полный экран');
  } finally { restore(); reset(was); }
});

registerTest('menu', 'телефон 810×253: панель помещается без прокрутки, все кнопки не ниже 44 px', async t => {
  const was = G.paused;
  let f: HTMLIFrameElement | null = null;
  try {
    reset(false); openMenu(); await t.frames(2);
    const p = panelEl();
    if (!p) { t.expect(false, 'панели нет'); return; }
    const css = Array.from(document.querySelectorAll('style')).map(s => s.textContent || '').join('\n');
    const clone = p.cloneNode(true) as HTMLElement; clone.style.display = 'block';
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#0b1220;overflow:hidden}${css}</style></head>`
      + `<body class="touch-ui">${clone.outerHTML}</body></html>`;
    f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:0;top:0;width:810px;height:253px;border:0;opacity:0;pointer-events:none;z-index:10000';
    const loaded = new Promise<void>(res => f!.addEventListener('load', () => res(), { once: true }));
    f.srcdoc = html; document.body.appendChild(f);
    await loaded; await t.wait(80);
    const d = f.contentDocument!, w = f.contentWindow!;
    const pp = d.getElementById('sc-menu') as HTMLElement;
    t.expect(pp.scrollHeight <= w.innerHeight, `высота панели ${pp.scrollHeight} больше окна ${w.innerHeight}`);
    t.expect(pp.scrollWidth <= pp.clientWidth + 1, `горизонтальная прокрутка: ${pp.scrollWidth} > ${pp.clientWidth}`);
    const small: string[] = [];
    for (const el of Array.from(d.querySelectorAll<HTMLElement>('#sc-menu button, #sc-menu select, #sc-menu input[type=range]'))) {
      if (el.offsetParent === null) continue;
      const h = el.getBoundingClientRect().height;
      if (h < 43.5) small.push(`${el.dataset.k || el.tagName}:${Math.round(h)}`);
    }
    t.expect(small.length === 0, 'меньше 44 px: ' + small.join(', '));
    t.log(`панель: ${Math.round(pp.scrollHeight)} из ${w.innerHeight} px`);
  } finally {
    f?.remove(); reset(was);
  }
});
