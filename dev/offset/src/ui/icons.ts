// Inline-SVG glyphs (keyed by the `icon` field of mutations / forms) + the tiny DOM toolkit the interface is built with.
// Glyphs are drawn on a 32-unit grid in one ink (currentColor); multi-ink "proof" versions are stacked copies with a register offset.
import { bus, type Events } from '../core/bus';

const F = ' fill="currentColor" stroke="none"';
const G: Record<string, string> = {
  // ---- mutations / forms
  range: `<circle cx="6" cy="25" r="3"/><path d="M10.5 20.5 21 10.5" stroke-dasharray="3 3.6"/><path${F} d="M28.5 3.5 27 14 18 5Z"/>`,
  charge: `<circle cx="16" cy="16" r="8.5"/><path d="M16 2v28M2 16h28"/><circle${F} cx="16" cy="16" r="3.4"/>`,
  recharge: `<path d="M16 5.5A10.5 10.5 0 1 1 5.5 16"/><path${F} d="M.8 17.5h9.4L5.5 10.5Z"/><path d="M16 10.5V16h5"/>`,
  burst: `<circle${F} cx="16" cy="16" r="4.2"/><circle cx="16" cy="16" r="8.8"/><circle cx="16" cy="16" r="13.6" stroke-dasharray="4 4.55"/>`,
  vector: `<path d="M3.5 25.5H18.5V11"/><path${F} d="M18.5 2.5 25 12H12Z"/><path d="M3.5 19.5h7" stroke-dasharray="2 3"/>`,
  heavyR: `<circle cx="16" cy="16" r="10.5"/><path${F} d="M12 12h8v8h-8z"/><path d="M2 8V2h6M24 2h6v6M30 24v6h-6M8 30H2v-6"/>`,
  heavyCost: `<circle cx="16" cy="16" r="12.5"/><path${F} d="M13.4 8.5h5.2v15h-5.2z"/><path d="M10.5 12.5l3-3"/>`,
  portal: `<ellipse cx="7.5" cy="16" rx="3.6" ry="11.5"/><ellipse cx="24.5" cy="16" rx="3.6" ry="11.5"/><path d="M11.5 16h4"/><path${F} d="M21 16l-6-4.8v9.6Z"/>`,
  scar: `<path${F} d="M4.5 27.5Q12.5 12.5 27.5 4.5 19.5 19.5 4.5 27.5Z"/><path d="M8 8l3.5 3.5M20.5 20.5 24 24"/>`,
  echo: `<circle cx="12.5" cy="12.5" r="8.6"/><circle${F} cx="19.5" cy="19.5" r="8.6"/>`,
  inset: `<path d="M3 5h26v22H3z"/><path d="M3 12.3h7M22 12.3h7M3 19.7h7M22 19.7h7M12 5v5M20 22v5"/><circle${F} cx="16" cy="16" r="5.6"/>`,
  turn: `<path d="M26.5 15A10.5 10.5 0 0 0 9 8.6"/><path${F} d="M4.6 4.2 13.6 5.4 7.6 13Z"/><path d="M5.5 17A10.5 10.5 0 0 0 23 23.4"/><path${F} d="M27.4 27.8 18.4 26.6 24.4 19Z"/>`,
  strike: `<path${F} d="M6.5 3.5h19v9.5h-19z"/><path d="M16 13v6"/><path${F} d="M16 25.5 10 17.5h12Z"/><path d="M3.5 29h25"/>`,
  slam: `<circle${F} cx="13.5" cy="16" r="5.6"/><path d="M1.5 10.5h5M1.5 16h3M1.5 21.5h5"/><path d="M22 8.5a10.6 10.6 0 0 1 0 15M26.6 5a15.5 15.5 0 0 1 0 22"/>`,
  chain: `<path d="M3 25 10.5 9.5 18.5 22.5 24 11.5"/><path${F} d="M29 3 28.4 13.6 20 8.6Z"/>`,
  throw: `<path d="M3 24 29 11"/><path${F} d="M16.5 18.5 22 28.5H11Z"/><path${F} d="M2.4 13.8 9.6 10.4 13 17.6 5.8 21Z"/>`,
  quake: `<path d="M1.5 20.5h7l3.2-5.5 4.3 10 4.3-10 3.2 5.5h7"/><path d="M16 2.5v5"/><path${F} d="M16 13.5 11 6.5h10Z"/>`,
  solvent: `<path d="M16 1.5v6.5M16 24v6.5M1.5 16H8M24 16h6.5M5.8 5.8l4.6 4.6M21.6 21.6l4.6 4.6M26.2 5.8l-4.6 4.6M10.4 21.6l-4.6 4.6"/><circle${F} cx="16" cy="16" r="4.6"/>`,
  thorns: `<circle cx="16" cy="16" r="6.2"/><path${F} d="M16 .5 19.4 7h-6.8ZM16 31.5 12.6 25h6.8ZM.5 16 7 12.6v6.8ZM31.5 16 25 19.4v-6.8Z"/>`,
  thin: `<path d="M2.5 19.5 11.5 10.5H29.5L20.5 19.5Z"/><path d="M21.5 26.5h8"/>`,
  hp: `<path${F} d="M2 13.5 9.5 6H30L22.5 13.5Z"/><path d="M3 19.5h19.5L29 13M3 25.5h19.5L29 19"/>`,
  focus: `<path d="M6.5 3h19M6.5 29h19"/><path${F} d="M9 5.5h14L16 15.5Z"/><path d="M16 16.5 23 26.5H9Z"/>`,
  leech: `<path${F} d="M16 2.5C20 8.6 22.2 11.2 22.2 14.4A6.2 6.2 0 0 1 9.8 14.4C9.8 11.2 12 8.6 16 2.5Z"/><path d="M2.5 25h27M8.5 29.5h15"/>`,
  regen: `<path d="M1.5 5.5h29"/><path${F} d="M5.5 7.5h8.5v16H5.5z"/><path d="M19 7v12.5h8V7"/>`,
  dupe: `<path d="M20 9.5V4H4v17h5.5"/><path${F} d="M11 11h17.5v17.5H11z"/>`,
  ink: `<path${F} d="M16 1.5C22.4 11 26.4 15 26.4 20.2A10.4 10.4 0 0 1 5.6 20.2C5.6 15 9.6 11 16 1.5Z"/>`,
  magnet: `<path d="M3 4.5l7.5 7.5M29 4.5 21.5 12M16 1.5v7.5" stroke-dasharray="3 3"/><path${F} d="M16 12.5c3.6 5.2 5.6 7.4 5.6 10.4a5.6 5.6 0 0 1-11.2 0c0-3 2-5.2 5.6-10.4Z"/>`,
  reroll: `<path d="M10.5 8V3.5H28v19.5h-4.5"/><path d="M4 9.5h17V28.5H4z"/><path d="M8 19h4"/><path${F} d="M18 19l-5.6-4.4v8.8Z"/>`,
  // ---- interface marks
  reg: `<circle cx="16" cy="16" r="8.5"/><path d="M16 1.5v29M1.5 16h29"/>`,
  lock: `<path d="M10.5 14V9.5a5.5 5.5 0 0 1 11 0V14"/><path${F} d="M6.5 14h19v14h-19z"/>`,
  check: `<path d="M4.5 17.5 12 25 27.5 6.5" stroke-width="3.6"/>`,
  pause: `<path${F} d="M8 5h5.6v22H8zM18.4 5H24v22h-5.6z"/>`,
  gear: `<circle cx="16" cy="16" r="5"/><path d="M16 2.5v5M16 24.5v5M2.5 16h5M24.5 16h5M6.5 6.5 10 10M22 22l3.5 3.5M25.5 6.5 22 10M10 22l-3.5 3.5"/>`,
  unknown: `<path d="M5 5h22v22H5z"/><path d="M5 5l22 22M27 5 5 27"/>`,
};

const svg = (key: string) => `<svg viewBox="0 0 32 32" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${G[key] ?? G.unknown}</svg>`;
export const hasIcon = (key: string) => key in G;

/** single-ink glyph */
export function icon(key: string, cls = ''): HTMLElement {
  const s = document.createElement('span'); s.className = 'of-ic' + (cls ? ' ' + cls : '');
  s.innerHTML = svg(key); // static markup from the table above, never user data
  return s;
}
/** proof glyph printed in 1–3 inks: the plates are deliberately out of register */
export function inkIcon(key: string, inks: 1 | 2 | 3, cls = ''): HTMLElement {
  const w = document.createElement('span'); w.className = `of-ink-ic of-inks${inks}` + (cls ? ' ' + cls : '');
  const m = svg(key);
  w.innerHTML = (inks >= 3 ? `<i class="l3">${m}</i>` : '') + (inks >= 2 ? `<i class="l2">${m}</i>` : '') + `<i class="l1">${m}</i>`;
  return w;
}

// ---------------------------------------------------------------- DOM toolkit
export type Kid = Node | string | null | undefined | false;
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag); if (cls) e.className = cls;
  for (const k of kids) if (k !== null && k !== undefined && k !== false) e.append(k);
  return e;
}
/** set text only when it changed (HUD diffing) */
export function setText(n: HTMLElement, s: string) { if (n.textContent !== s) n.textContent = s; }
/** text printed twice: the element itself + a shifted second ink (CSS reads data-t) */
export function mis(tag: keyof HTMLElementTagNameMap, cls: string, text: string): HTMLElement {
  const e = el(tag, 'of-mis ' + cls, text); e.dataset.t = text; return e;
}
export function setMis(e: HTMLElement, text: string) { if (e.dataset.t !== text) { e.textContent = text; e.dataset.t = text; } }
/** restart a one-shot CSS animation class */
export function kick(e: HTMLElement, cls: string) { e.classList.remove(cls); void e.offsetWidth; e.classList.add(cls); }
export const emit = <K extends keyof Events>(k: K, p: Events[K]) => bus.emit(k, p);

/** owns everything that must be undone when a screen goes away: bus subscriptions, global listeners, timers */
export class Scope {
  private offs: (() => void)[] = [];
  dead = false;
  add(off: () => void) { if (this.dead) off(); else this.offs.push(off); }
  on<K extends keyof WindowEventMap>(target: Window, type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions): void;
  on(target: EventTarget, type: string, fn: (e: Event) => void, opts?: AddEventListenerOptions): void;
  on(target: EventTarget, type: string, fn: (e: any) => void, opts?: AddEventListenerOptions) {
    target.addEventListener(type, fn, opts); this.add(() => target.removeEventListener(type, fn, opts));
  }
  bus<K extends keyof Events>(k: K, fn: (p: Events[K]) => void) { this.add(bus.on(k, fn)); }
  timeout(fn: () => void, ms: number) { const id = window.setTimeout(() => { if (!this.dead) fn(); }, ms); this.add(() => clearTimeout(id)); }
  dispose() { if (this.dead) return; this.dead = true; for (const f of this.offs) { try { f(); } catch (e) { console.error(e); } } this.offs.length = 0; }
}

export interface BtnOpts { hover?: boolean; sound?: 'click' | 'stamp' | 'none'; title?: string }
/** menu button: `click` for activation (mouse, touch, keyboard), never lets the pointer reach the canvas, drops focus so Space/Enter go back to the game */
export function btn(cls: string, kids: Kid[], onTap: (b: HTMLButtonElement) => void, o: BtnOpts = {}): HTMLButtonElement {
  const b = el('button', 'of-btn ' + cls, ...kids); b.type = 'button';
  if (o.title) b.setAttribute('aria-label', o.title);
  b.addEventListener('pointerdown', (e) => { e.stopPropagation(); });
  b.addEventListener('click', (e) => {
    e.stopPropagation(); b.blur();
    if (o.sound !== 'none') emit(o.sound === 'stamp' ? 'uiStamp' : 'uiClick', {});
    onTap(b);
  });
  if (o.hover !== false) b.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') emit('uiHover', {}); });
  return b;
}

// ---------------------------------------------------------------- print patterns (data-URI, installed once as CSS variables)
const uri = (s: string) => `url("data:image/svg+xml,${encodeURIComponent(s)}")`;
/** halftone edge: a solid that dissolves into shrinking dots. dir = side the dots fade toward */
function edge(dir: 'b' | 't' | 'r' | 'l'): string {
  const P = 6, R = [3.5, 2.9, 2.3, 1.7, 1.1]; const len = P * R.length; let c = '';
  for (let i = 0; i < R.length; i++) {
    const along = P / 2 + P * i; const offs = i % 2 ? [0, P] : [P / 2];
    for (const o of offs) {
      const a = dir === 'b' || dir === 'r' ? along : len - along;
      c += dir === 'b' || dir === 't' ? `<circle cx="${o}" cy="${a}" r="${R[i]}"/>` : `<circle cx="${a}" cy="${o}" r="${R[i]}"/>`;
    }
  }
  const [w, h] = dir === 'b' || dir === 't' ? [P, len] : [len, P];
  return uri(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">${c}</svg>`);
}
/** paper fibre / roller grain, tinted with the key ink */
function grain(rgb: [number, number, number]): string {
  const [r, g, b] = rgb.map((v) => (v / 255).toFixed(3));
  return uri(`<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240"><filter id="n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".82" numOctaves="2" seed="7" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 ${r} 0 0 0 0 ${g} 0 0 0 0 ${b} 0 0 0 .62 -.2"/></filter><rect width="240" height="240" filter="url(#n)"/></svg>`);
}
/** worn rubber-stamp mask: mostly opaque with dropouts */
function wear(): string {
  return uri(`<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><filter id="w" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency=".035 .5" numOctaves="2" seed="11" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 -7 4.9"/></filter><rect width="200" height="200" filter="url(#w)"/></svg>`);
}
const hex = (h: string): [number, number, number] => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const toHex = (c: number[]) => '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
const mul = (a: number[], b: number[]) => a.map((v, i) => (v * b[i]) / 255);

export interface Inks { a: string; b: string; c: string; paper: string }
export const BASE_INKS: Inks = { a: '#252A7C', b: '#FF4F3F', c: '#F5B915', paper: '#EDE3CF' };
/** per-biome ink sets (mirror of the level generator's palettes; unknown ids fall back to the base set) */
export const BIOME_INKS: Record<string, Inks> = {
  press: BASE_INKS,
  archive: { a: '#173F3B', b: '#FF4A5E', c: '#E9A23B', paper: '#E7E2CC' },
  tower: { a: '#2B1B45', b: '#FF3D2E', c: '#38B6BD', paper: '#E8E3DA' },
};
let curInks = '';
/** write the ink set (and its overprints) to CSS variables on the UI root */
export function applyInks(root: HTMLElement, k: Inks) {
  const sig = k.a + k.b + k.c + k.paper; if (sig === curInks) return; curInks = sig;
  const a = hex(k.a), b = hex(k.b), c = hex(k.c), p = hex(k.paper); const s = root.style;
  s.setProperty('--paper', k.paper); s.setProperty('--a', k.a); s.setProperty('--b', k.b); s.setProperty('--c', k.c);
  // overprints as they come out on this paper
  s.setProperty('--ab', toHex(mul(mul(a, b), p))); s.setProperty('--bc', toHex(mul(mul(b, c), p))); s.setProperty('--ac', toHex(mul(mul(a, c), p)));
  s.setProperty('--a-rgb', a.join(' ')); s.setProperty('--b-rgb', b.join(' ')); s.setProperty('--p-rgb', p.join(' '));
  s.setProperty('--of-grain', grain(a));
  if (!s.getPropertyValue('--of-wear')) {
    s.setProperty('--of-edge-b', edge('b')); s.setProperty('--of-edge-t', edge('t')); s.setProperty('--of-edge-r', edge('r')); s.setProperty('--of-edge-l', edge('l'));
    s.setProperty('--of-wear', wear());
  }
}
