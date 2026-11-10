// Pickup floaters (TERRARIA_CONTROLS): a small «+2 Уголь» rises from the spot where a loose item was picked up. Listens to the bus event
// 'pickup_float' {x, y, id, n} (world cells; tools.ts and nearby.ts emit it for every pickup). Repeated pickups of one item within 1 s merge
// into one text; at most 4 texts live; each fades out over 1.2 s and follows its world point. Pointer-events none, so phone and desktop both work.
import { on } from '../game/bus';
import { itemName } from '../game/items';
import { worldToScreen } from '../engine/render';
import { strings, fmt } from '../content/i18n';

const S = strings('float', { plus: '+{n} {name}' });
const LIFE = 1.2, MERGE = 1.0, MAX = 4, RISE = 26;          // seconds, seconds, live texts, px per second

interface Float { id: string; n: number; x: number; y: number; age: number; el: HTMLDivElement; label?: string }   // label: a fixed text (the «−снег» of digging) instead of «+n name»
const live: Float[] = [];
let host: HTMLDivElement | null = null, raf = 0, last = 0;

function ensureHost(): HTMLDivElement | null {
  if (host) return host;
  if (typeof document === 'undefined' || !document.body) return null;
  host = document.createElement('div');
  host.id = 'sc-floats';
  host.setAttribute('aria-hidden', 'true');
  host.style.cssText = 'position:fixed;inset:0;pointer-events:none;overflow:hidden;z-index:30';
  document.body.appendChild(host);
  return host;
}
const text = (f: Pick<Float, 'id' | 'n' | 'label'>) => f.label ?? fmt(S.plus, { n: f.n, name: itemName(f.id) });

function frame(now: number) {
  const dt = last ? Math.min(0.1, (now - last) / 1000) : 0;
  last = now;
  for (let i = live.length - 1; i >= 0; i--) {
    const f = live[i];
    f.age += dt;
    if (f.age >= LIFE) { f.el.remove(); live.splice(i, 1); continue; }
    const [sx, sy] = worldToScreen(f.x, f.y);
    f.el.style.transform = `translate(${sx.toFixed(1)}px, ${(sy - f.age * RISE).toFixed(1)}px) translate(-50%, -100%)`;
    f.el.style.opacity = String(Math.max(0, 1 - f.age / LIFE).toFixed(3));
  }
  if (live.length) raf = requestAnimationFrame(frame);
  else { raf = 0; last = 0; }
}

function show(d: { x: number; y: number; id: string; n: number; label?: string }) {
  const h = ensureHost(); if (!h || !(d.n > 0)) return;
  const burst = live.find(f => f.id === d.id && f.age < MERGE && f.label === d.label);
  if (burst) {                                              // the same item again: one text, counting up
    burst.n += d.n; burst.age = 0; burst.x = d.x; burst.y = d.y;
    burst.el.textContent = text(burst);
  } else {
    if (live.length >= MAX) { const old = live.shift(); old?.el.remove(); }
    const el = document.createElement('div');
    el.className = 'sc-float';
    el.style.cssText = 'position:absolute;left:0;top:0;white-space:nowrap;font:700 15px/1 "Pixelify Sans",Jura,system-ui,sans-serif;color:#fff1c2;text-shadow:0 1px 0 #05080f,0 0 6px rgba(5,8,15,.85);will-change:transform,opacity';
    const f: Float = { id: d.id, n: d.n, x: d.x, y: d.y, age: 0, el, label: d.label };
    el.textContent = text(f);
    h.appendChild(el);
    live.push(f);
  }
  if (!raf) raf = requestAnimationFrame(frame);
}

on('pickup_float', (d: { x: number; y: number; id: string; n: number; label?: string }) => { try { show(d); } catch { /* a floater is decoration: never break a pickup */ } });
