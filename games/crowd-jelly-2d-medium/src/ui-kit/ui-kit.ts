// Ragdoll Lab UI kit v1: icons for DOM and canvas, coin fly, number tick.
// Usage: import './ui-kit.css'; import { mountIcons, ic, drawIcon, flyTo, tickNumber } from './ui-kit';
import { ICONS, type IconName } from './icons-data';

export { ICONS };
export type { IconName };

let locale: string | undefined;
/** Set the game language once (e.g. 'ru', 'hi') so numbers use its separators, not the browser's. */
export function setLocale(lang: string | undefined): void { locale = lang || undefined; }
/** Formats a number for the game language: fmt(13424) -> '13 424' in ru, '13,424' in en. */
export function fmt(n: number): string {
  try { return Math.round(n).toLocaleString(locale); } catch { return String(Math.round(n)); }
}

let mounted = false;
/** Puts the SVG sprite into the page once. Call at startup before using ic(). */
export function mountIcons(): void {
  if (mounted) return;
  mounted = true;
  const symbols = Object.entries(ICONS)
    .map(([k, v]) => `<symbol id="gk-${k}" viewBox="0 0 64 64">${v}</symbol>`).join('');
  const div = document.createElement('div');
  div.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
  div.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg">${symbols}</svg>`;
  document.body.prepend(div);
}

/** HTML string for an icon, e.g. btn.innerHTML = ic('coin') + ' 120'. */
export function ic(name: IconName, cls = ''): string {
  return `<svg class="gk-ic ${cls}" aria-hidden="true"><use href="#gk-${name}"/></svg>`;
}

const imgCache = new Map<string, HTMLCanvasElement>();
/** Draws an icon on a canvas (HUD inside the game canvas). Rasterised once per name+size. */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number): void {
  const px = Math.max(8, Math.round(size * (window.devicePixelRatio || 1)));
  const key = name + '@' + px;
  let c = imgCache.get(key);
  if (!c) {
    c = document.createElement('canvas');
    c.width = c.height = px;
    imgCache.set(key, c);
    const img = new Image();
    const target = c;
    img.onload = () => target.getContext('2d')!.drawImage(img, 0, 0, px, px);
    img.src = 'data:image/svg+xml;charset=utf-8,' +
      encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${px}" height="${px}">${ICONS[name]}</svg>`);
  }
  ctx.drawImage(c, x - size / 2, y - size / 2, size, size);
}

/** Preload canvas icons so the first frame is not empty. */
export function preloadIcons(names: IconName[], size: number): void {
  const c = document.createElement('canvas').getContext('2d')!;
  for (const n of names) drawIcon(c, n, 0, 0, size);
}

/** Flies `count` icons from a screen point to an element (coins to the wallet). */
export function flyTo(name: IconName, fromX: number, fromY: number, to: Element, count = 6, onEach?: () => void): void {
  const r = to.getBoundingClientRect();
  const tx = r.left + r.width * 0.2, ty = r.top + r.height / 2;
  for (let i = 0; i < count; i++) {
    const el = document.createElement('div');
    el.innerHTML = ic(name);
    el.style.cssText = `position:fixed;left:0;top:0;z-index:99;pointer-events:none;font-size:22px;will-change:transform`;
    document.body.appendChild(el);
    const sx = fromX + (Math.random() - 0.5) * 60, sy = fromY + (Math.random() - 0.5) * 40;
    const mx = (sx + tx) / 2 + (Math.random() - 0.5) * 120, my = Math.min(sy, ty) - 80 - Math.random() * 60;
    const t0 = performance.now() + i * 55, dur = 520;
    const step = (now: number) => {
      const t = Math.min(1, Math.max(0, (now - t0) / dur));
      const e = t * t * (3 - 2 * t);
      const x = (1 - e) * (1 - e) * sx + 2 * (1 - e) * e * mx + e * e * tx;
      const y = (1 - e) * (1 - e) * sy + 2 * (1 - e) * e * my + e * e * ty;
      const s = 1.3 - 0.5 * e;
      el.style.transform = `translate(${x - 14}px,${y - 14}px) scale(${s})`;
      if (t < 1) requestAnimationFrame(step);
      else {
        el.remove();
        to.classList.remove('bump'); void (to as HTMLElement).offsetWidth; to.classList.add('bump');
        onEach?.();
      }
    };
    requestAnimationFrame(step);
  }
}

/** Counts a number up in an element (reward screens). */
export function tickNumber(el: Element, from: number, to: number, ms = 700): void {
  const t0 = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / ms);
    const e = 1 - Math.pow(1 - t, 3);
    el.textContent = fmt(from + (to - from) * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}
