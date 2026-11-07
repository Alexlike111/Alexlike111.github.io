// DOM widget of the radio tuning dial (DESIGN §15). Pure view: fixtures_radio.ts feeds it a DialView every step and reads `dialInput` back
// (the ◀ ▶ buttons are for the mouse and the phone; the keys ←/→ A/D are read by the logic itself). Self-contained CSS, nothing else of the UI is touched.
export interface DialStation { c: number; w: number; name: string; heard: boolean }
export interface DialView {
  freq: number; quality: number; lock: number; locked: number; stations: DialStation[];
  title: string; line: string; hint: string; fine: boolean; noise: number;
}
export const dialInput = { dir: 0 as -1 | 0 | 1, close: false };

const CSS = `
#stn-dial{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(132px + env(safe-area-inset-bottom,0px));z-index:47;width:min(94vw,470px);box-sizing:border-box;
 background:linear-gradient(180deg,rgba(26,30,22,.95),rgba(12,16,12,.95));border:2px solid #6f7d58;border-radius:6px;padding:8px 10px 9px;color:#dfe8c8;
 font-family:'Pixelify Sans','Jura',system-ui,sans-serif;display:none;box-shadow:0 4px 18px rgba(0,0,0,.6);user-select:none;-webkit-user-select:none;touch-action:none}
body.touch-ui #stn-dial{bottom:calc(86px + env(safe-area-inset-bottom,0px));width:min(66vw,430px);padding:5px 8px 6px}
#stn-dial .row{display:flex;align-items:center;gap:8px}
#stn-dial .t{font-size:15px;letter-spacing:.06em;color:#ffd88a;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#stn-dial canvas{display:block;width:100%;height:46px;margin:5px 0 4px;image-rendering:pixelated;border-radius:3px}
#stn-dial .line{min-height:2.5em;font-family:'Jura','Pixelify Sans',system-ui,sans-serif;font-size:14px;line-height:1.25;color:#c9f2c4;text-shadow:0 0 6px rgba(120,255,140,.35)}
body.touch-ui #stn-dial .line{min-height:2.35em;font-size:13px}
#stn-dial .hint{font-size:12px;opacity:.7;margin-top:2px}
#stn-dial button{font:inherit;font-size:18px;color:#e8f6ff;background:linear-gradient(180deg,#34402a,#1c2416);border:2px solid #7d8d62;border-radius:4px;min-width:48px;min-height:40px;cursor:pointer;touch-action:none}
#stn-dial button:active{background:#4a5b38}
#stn-dial button.x{min-width:40px;border-color:#a06a5a}
`;
let root: HTMLElement | null = null, cv: HTMLCanvasElement | null = null, titleEl: HTMLElement, lineEl: HTMLElement, hintEl: HTMLElement;

function build() {
  if (root || typeof document === 'undefined') return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'stn-dial';
  root.innerHTML = '<div class="row"><button data-d="-1" aria-label="◀">◀</button><div class="t"></div><button data-d="1" aria-label="▶">▶</button><button class="x" data-x="1" aria-label="x">✕</button></div><canvas width="440" height="46"></canvas><div class="line"></div><div class="hint"></div>';
  document.body.appendChild(root);
  cv = root.querySelector('canvas'); titleEl = root.querySelector('.t')!; lineEl = root.querySelector('.line')!; hintEl = root.querySelector('.hint')!;
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  root.addEventListener('pointerdown', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    stop(e);
    if (b.dataset.x) { dialInput.close = true; return; }
    dialInput.dir = Number(b.dataset.d) as -1 | 1;
  });
  const up = () => { dialInput.dir = 0; };
  addEventListener('pointerup', up); addEventListener('pointercancel', up); root.addEventListener('pointerleave', up);
  root.addEventListener('contextmenu', stop);
}

let last = '';
export function showDial(v: DialView | null) {
  build(); if (!root || !cv) return;
  if (!v) { if (root.style.display !== 'none') root.style.display = 'none'; dialInput.dir = 0; return; }
  if (root.style.display !== 'block') root.style.display = 'block';
  if (v.title !== last) { titleEl.textContent = v.title; last = v.title; }
  if (lineEl.textContent !== v.line) lineEl.textContent = v.line;
  if (hintEl.textContent !== v.hint) hintEl.textContent = v.hint;
  const c = cv.getContext('2d')!, W = cv.width, H = cv.height;
  c.fillStyle = '#0d120b'; c.fillRect(0, 0, W, H);
  // static noise band (louder when detuned)
  const t = performance.now() * 0.001;
  for (let i = 0; i < 90; i++) {
    const x = (i * 97 + Math.floor(t * 40) * 31) % W, a = (0.15 + 0.5 * v.noise) * (((i * 7919 + Math.floor(t * 30)) % 13) / 13);
    c.fillStyle = `rgba(190,230,170,${a.toFixed(3)})`; c.fillRect(x, 3 + ((i * 13) % 12), 2, 1 + ((i * 5) % 3));
  }
  // scale
  for (let i = 0; i <= 60; i++) {
    const x = 10 + (W - 20) * i / 60, major = i % 10 === 0;
    c.fillStyle = major ? '#b8c89a' : '#6d7a56'; c.fillRect(Math.round(x), 26, 1, major ? 12 : 6);
  }
  // stations: small marks, bright when heard before, glow near the needle
  for (let k = 0; k < v.stations.length; k++) {
    const s = v.stations[k], x = 10 + (W - 20) * s.c, near = Math.max(0, 1 - Math.abs(v.freq - s.c) / (s.w * 3));
    c.fillStyle = s.heard ? '#ffd88a' : '#7c8566'; c.fillRect(Math.round(x) - 1, 20, 3, 4);
    if (near > 0) { c.fillStyle = `rgba(255,216,138,${(0.12 + 0.4 * near).toFixed(3)})`; c.fillRect(Math.round(x) - 7, 12, 15, 8); }
  }
  // needle
  const nx = Math.round(10 + (W - 20) * v.freq);
  c.fillStyle = '#ff5a40'; c.fillRect(nx - 1, 4, 3, 40); c.fillStyle = '#ffb0a0'; c.fillRect(nx, 4, 1, 40);
  // lock bar
  c.fillStyle = '#1c2616'; c.fillRect(10, 41, W - 20, 3);
  c.fillStyle = v.lock >= 1 ? '#8cf0a0' : '#c9b060'; c.fillRect(10, 41, Math.round((W - 20) * Math.min(1, v.lock)), 3);
}
export function dialVisible(): boolean { return !!root && root.style.display === 'block'; }
