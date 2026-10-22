// Shared screens: panels, settings, language switcher, "What's new". Built on the ui-kit (gk- classes).
import { ic } from '../ui-kit/ui-kit';
import { LANGS, LANG_NAMES, getLang, setLang, t, type Lang } from './i18n';
import { CHANGELOG, releaseDate } from '../changelog';
import { BUILD_VERSION } from './config';
import { platform } from './bridge';

const ui = (): HTMLElement => document.getElementById('ui')!;
let open = 0;
const closers: (() => void)[] = [];

/** True while any panel is open: the game ignores keys and pauses its timer. */
export const modalOpen = (): boolean => open > 0;

export interface PanelHandle {
  el: HTMLElement;
  body: HTMLElement;
  close: () => void;
}

export function openPanel(title: string, bodyHtml: string, opts: { onClose?: () => void; closable?: boolean } = {}): PanelHandle {
  const dim = document.createElement('div');
  dim.className = 'gk-dim';
  const closable = opts.closable !== false;
  dim.innerHTML = `<div class="gk-panel" role="dialog" aria-label="${title}"><div class="gk-ribbon"><span class="gk-h">${title}</span></div>${
    closable ? `<button class="gk-btn round red small gk-close" aria-label="${t('close')}" style="width:46px;min-height:46px">${ic('close')}</button>` : ''
  }<div class="gk-panel-body">${bodyHtml}</div></div>`;
  ui().appendChild(dim);
  open++;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    open--;
    closers.splice(closers.indexOf(close), 1);
    dim.remove();
    opts.onClose?.();
  };
  closers.push(close);
  if (closable) dim.querySelector('.gk-close')!.addEventListener('click', close);
  return { el: dim, body: dim.querySelector('.gk-panel-body')!, close };
}

/** Esc closes the top panel. */
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && closers.length) {
    e.stopImmediatePropagation();
    closers[closers.length - 1]();
  }
}, true);

export const closeAllPanels = (): void => [...closers].forEach((f) => f());

// ---- language switcher ----
export function openLanguage(onPick?: (l: Lang) => void): PanelHandle {
  const h = openPanel(t('language'), `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:10px 0 4px">${LANGS.map(
    (l) => `<button class="gk-btn small ${l === getLang() ? '' : 'blue'}" data-lang="${l}" style="min-width:0;padding-inline:8px">${LANG_NAMES[l]}</button>`,
  ).join('')}</div>`);
  h.body.addEventListener('click', (e) => {
    const l = (e.target as HTMLElement).closest('[data-lang]')?.getAttribute('data-lang') as Lang | null;
    if (!l) return;
    setLang(l);
    platform.track('language_changed', { lang: l });
    onPick?.(l);
    h.close();
  });
  return h;
}

// ---- What's new ----
export const latestVersion = (): string => CHANGELOG[0].v;

export function openNews(onSeen: () => void): PanelHandle {
  const lang = getLang();
  const html = CHANGELOG.map(
    (r) => `<div style="margin:6px 0 14px"><div style="font:900 18px var(--gk-font)">v${r.v} <span style="font-weight:700;color:var(--gk-grey-dark);font-size:14px">${releaseDate(r, lang)}</span></div><ul style="margin:6px 0 0;padding-left:20px;font:700 16px/1.35 var(--gk-font)">${(r.lines[lang] ?? r.lines.en)
      .map((s) => `<li>${s}</li>`)
      .join('')}</ul></div>`,
  ).join('');
  onSeen();
  return openPanel(t('whatsNew'), html);
}

export interface SettingsOpts {
  sound: boolean;
  music: boolean;
  onSound: (on: boolean) => void;
  onMusic: (on: boolean) => void;
  onLanguage: () => void;
  onNews: () => void;
  onFeedback?: { label: string; prize?: string; run: () => void };
  newsBadge: boolean;
}

export function openSettings(o: SettingsOpts): PanelHandle {
  const row = (id: string, label: string, on: boolean, icOn: 'sound-on' | 'music', icOff: 'sound-off' | 'music-off') =>
    `<button class="gk-btn small ${on ? 'green' : 'red'}" data-t="${id}" style="width:100%">${ic(on ? icOn : icOff)} ${label}</button>`;
  const h = openPanel(
    t('settings'),
    `<div style="display:grid;gap:12px;margin-top:8px">
      ${row('sound', t('sound'), o.sound, 'sound-on', 'sound-off')}
      ${row('music', t('music'), o.music, 'music', 'music-off')}
      <button class="gk-btn small blue" data-a="lang">${ic('globe')} ${t('language')}: ${(LANG_NAMES as any)[getLang()]}</button>
      <button class="gk-btn small blue" data-a="news" style="position:relative">${ic('info')} ${t('whatsNew')}${o.newsBadge ? '<span class="gk-badge">!</span>' : ''}</button>
      ${o.onFeedback ? `<button class="gk-btn small purple" data-a="fb">${ic('pencil')} ${o.onFeedback.label}${o.onFeedback.prize ? ' ' + o.onFeedback.prize : ''}</button>` : ''}
      <div style="text-align:center;font:700 13px var(--gk-font);color:var(--gk-grey-dark)">v${BUILD_VERSION}</div>
    </div>`,
  );
  const state = { sound: o.sound, music: o.music };
  h.body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    const tg = b.getAttribute('data-t') as 'sound' | 'music' | null;
    if (tg) {
      state[tg] = !state[tg];
      (tg === 'sound' ? o.onSound : o.onMusic)(state[tg]);
      const on = state[tg];
      b.classList.toggle('red', !on);
      b.classList.toggle('green', on);
      b.innerHTML = `${ic(tg === 'sound' ? (on ? 'sound-on' : 'sound-off') : on ? 'music' : 'music-off')} ${t(tg)}`;
      return;
    }
    const a = b.getAttribute('data-a');
    if (a === 'lang') { h.close(); o.onLanguage(); }
    if (a === 'news') { h.close(); o.onNews(); }
    if (a === 'fb') { h.close(); o.onFeedback!.run(); }
  });
  return h;
}
