// One toast at a time, kept small: <= 35% of the width, <= 12% of the height, 2.5 s, never over the play field.
// Big messages belong in a panel on pause / result, not here.
let host: HTMLElement | null = null;
const queue: { html: string; ms: number }[] = [];
let busy = false;

function ensure(): HTMLElement {
  if (host) return host;
  host = document.createElement('div');
  host.id = 'toasts';
  // top-right corner, outside the centre of the field; clicks pass through
  host.style.cssText =
    'position:absolute;top:calc(64px + env(safe-area-inset-top,0px));right:8px;z-index:60;pointer-events:none;max-width:35%;display:flex;justify-content:flex-end';
  document.getElementById('app')!.appendChild(host);
  return host;
}

function next(): void {
  const item = queue.shift();
  if (!item) {
    busy = false;
    return;
  }
  busy = true;
  const el = document.createElement('div');
  el.className = 'gk-toast';
  // smaller than the default kit toast so two lines fit in 12% of a phone screen
  el.style.cssText = 'font-size:clamp(11px,1.6vw,16px);padding:6px 12px 8px;max-height:12vh;overflow:hidden;overflow-wrap:anywhere';
  el.innerHTML = item.html;
  ensure().appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .25s';
    el.style.opacity = '0';
    setTimeout(() => {
      el.remove();
      next();
    }, 260);
  }, item.ms);
}

/** html may hold an ic() icon; never put player text in it. */
export function toast(html: string, ms = 2500): void {
  if (queue.length >= 3) queue.shift(); // old news is not worth waiting for
  queue.push({ html, ms: Math.min(3000, Math.max(1800, ms)) });
  if (!busy) next();
}
