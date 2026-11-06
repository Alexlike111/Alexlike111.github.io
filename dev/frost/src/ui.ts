import './ui.css';
import type { Input, InputButton } from './input';

export interface HudData {
  core: number; food: number; stamina: number; wet: number;   // core °C; others 0..1
  airT: number; feelT: number; wind: number; shelter: number;  // wind m/s signed at player; shelter 0..1
  day: number; clock: string; night: boolean; warning: string | null;
  tool: number; tools: { id: string; name: string; key: string; count?: number; enabled: boolean }[]; // ids: shovel, saw, axe, beam, block, fire
  inv: { logs: number; branches: number; matches: number; food: number; blocks: number; snowshoes: boolean; thermos: number };
  hint: string | null;
  shovelLoad: number; // 0..1
  waiting: boolean;
}

// ---------------------------------------------------------------- icons
// Hand-drawn 24×24 line icons (stroke = currentColor). Deliberately a little uneven.
const ICONS: Record<string, string> = {
  shovel: '<path d="M17.8 3.2l3 3.1M15.3 5.6l3.4 3.4M16.9 4.6L11.2 10.3"/><path d="M11.2 10.3l2.9 2.9-4.3 5.9c-1.1 1.3-3 1.3-4.1.2l-.7-.7c-1.1-1.1-1-3 .3-4.1z"/>',
  saw: '<path d="M2.8 11.6L16.6 8.1l.7 3-1.9.5-1 1.9-2-.7-1.5 2.2-1.9-1-1.8 2.2-1.6-1.2-2.8 1.7z"/><path d="M16.6 8.1l4.3-1.1.8 3.6-4.4 1"/>',
  axe: '<path d="M4.6 20.3L15.7 6.6"/><path d="M13.6 5.4c2.4-2 5.6-1.8 7.2.5l-2 4.1c-1.6-.4-3.3-1.3-5.2-2.4z"/>',
  beam: '<path d="M2.8 8.2h14.4v7.6H2.8z"/><path d="M17.2 8.2c2.2 0 3.9 1.7 3.9 3.8s-1.7 3.8-3.9 3.8"/><path d="M17.2 10.3c1 0 1.8.8 1.8 1.7s-.8 1.7-1.8 1.7"/><path d="M5 11h7.5M5 13.2h5.2"/>',
  block: '<path d="M12 2.8l8 4.5v9.4l-8 4.5-8-4.5V7.3z"/><path d="M4 7.3l8 4.6 8-4.6M12 11.9v9.3"/><path d="M6.4 14.2l1.2.7M16.5 5.9l1 .6" opacity=".6"/>',
  fire: '<path d="M12.2 2.4c.9 3.4 5 5.4 5 9.6a5.1 5.1 0 0 1-10.2.2c0-2 .9-3.4 2-4.5.3 1.5.9 2.2 1.7 2.5-.6-2.4-.2-5.2 1.5-7.8z"/><path d="M12.1 15.5c-1 .8-1.4 1.5-1.4 2.3a1.4 1.4 0 0 0 2.8 0c0-.8-.5-1.5-1.4-2.3z"/><path d="M5.4 21l13.2-2.4M5.6 18.4l12.9 2.7" opacity=".8"/>',
  branches: '<path d="M3.5 20.3L20 5"/><path d="M9.6 14.6l-.8-4.9M13.8 10.8l5.3.8M7 17l-3.3-.7M16 8l.4-3.4"/>',
  matches: '<path d="M5 20L16.3 5.6M10 20l9.5-12"/><circle cx="17.2" cy="4.6" r="1.9"/><circle cx="20.5" cy="6.6" r="1.7"/>',
  food: '<path d="M5 8.2c0-1.2 3.1-2.2 7-2.2s7 1 7 2.2v8.4c0 1.2-3.1 2.2-7 2.2s-7-1-7-2.2z"/><path d="M5 8.2c0 1.2 3.1 2.2 7 2.2s7-1 7-2.2"/><path d="M5.2 13.2c1.7 1 4 1.4 6.8 1.4s5.100-.4 6.800-1.400" opacity=".6"/>',
  snowshoes: '<ellipse cx="12" cy="12" rx="5.2" ry="9.2" transform="rotate(25 12 12)"/><path d="M7.9 6.9l8.200 10.300M16.100 6.900L7.900 17.200M10 4.800l7.600 9.600M6.400 9.600l7.600 9.600" opacity=".65"/>',
  thermos: '<path d="M8.200 6.500h7.600v13a1.600 1.600 0 0 1-1.600 1.600H9.800a1.600 1.600 0 0 1-1.600-1.600z"/><path d="M9 6.500V4.200h6v2.300M8.200 10h7.600"/>',
  put: '<path d="M12 3.800v9.500M7.700 9.300l4.300 4.300 4.300-4.300"/><path d="M4.500 18.800h15M7 20.800h10" />',
  take: '<path d="M12 14.500V4.200M7.700 8.500L12 4.200l4.300 4.300"/><path d="M4.500 18.800h15M7 20.800h10"/>',
  eat: '<path d="M7.200 3v6.200c0 1.600 1 2.800 2.600 2.900V21M5 3v5.600M9.600 3v5.600"/><path d="M16.800 21V3.200c-2.200 1-3.200 3.700-3.200 6.500 0 1.700.8 2.600 2 2.800"/>',
  wait: '<path d="M6.800 3h10.400M6.800 21h10.400M7.800 3.300c0 4.600 8.400 4.800 8.400 8.700s-8.400 4.100-8.400 8.700M16.200 3.300c0 4.600-8.400 4.800-8.400 8.700s8.400 4.100 8.400 8.700"/>',
  rotate: '<path d="M19.200 8.300A8 8 0 1 0 20 14"/><path d="M19.600 3.200v5.300h-5.300"/>',
  xray: '<path d="M2.500 12S6 6 12 6s9.500 6 9.500 6-3.500 6-9.500 6-9.500-6-9.500-6z"/><circle cx="12" cy="12" r="2.800"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  sound: '<path d="M4 9.500h3.200L12 5.500v13l-4.800-4H4z"/><path d="M15.500 9a4.200 4.200 0 0 1 0 6M18 6.500a7.600 7.600 0 0 1 0 11"/>',
  mute: '<path d="M4 9.500h3.200L12 5.500v13l-4.800-4H4z"/><path d="M16 9.500l5 5M21 9.500l-5 5"/>',
  bolt: '<path d="M13.500 2.800L6 13.200h5.200l-1.100 8 7.900-11h-5.500z"/>',
  drop: '<path d="M12 2.800c3.200 4.400 6.200 7.400 6.200 11a6.200 6.200 0 0 1-12.400 0c0-3.600 3-6.600 6.200-11z"/><path d="M9 14.600a3.200 3.200 0 0 0 2.400 2.800" opacity=".7"/>',
  hut: '<path d="M2.800 12.200L12 4l9.200 8.200"/><path d="M5.800 10.800V20h12.400v-9.200"/><path d="M10 20v-5.200h4V20"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2.500v3M12 18.500v3M2.500 12h3M18.500 12h3M5.300 5.300l2.100 2.100M16.600 16.600l2.100 2.100M18.700 5.300l-2.100 2.100M7.400 16.600l-2.100 2.100"/>',
  moon: '<path d="M19.500 14.800A8 8 0 0 1 9.200 4.500a8 8 0 1 0 10.300 10.300z"/>',
  baro: '<path d="M4 17a8 8 0 0 1 16 0"/><path d="M12 17l-3.500-5.200"/><path d="M6 13.500l1 .6M18 13.500l-1 .6M12 8.500v1.100"/><path d="M5 20.500h14"/>',
  phone: '<rect x="6" y="2.500" width="12" height="19" rx="2.200"/><path d="M10.500 18.500h3"/>',
};

function ico(name: string, cls = ''): string {
  return `<svg class="ico ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', html = ''): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html) e.innerHTML = html;
  return e;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const MINUS = '−';
const fmtDeg = (v: number) => { const r = Math.round(v); return (r < 0 ? MINUS : r > 0 ? '' : '') + Math.abs(r) + '°'; };
const fmtCore = (v: number) => v.toFixed(1).replace('.', ',');

// ---------------------------------------------------------------- thermometer geometry
const T_MIN = 28, T_MAX = 38;
const TY0 = 214, TY1 = 26; // y of 28 and 38 in the SVG
const tY = (t: number) => TY0 - ((clamp(t, T_MIN, T_MAX) - T_MIN) / (T_MAX - T_MIN)) * (TY0 - TY1);

function thermoSVG(): string {
  let ticks = '';
  for (let i = 0; i <= 20; i++) {
    const t = T_MIN + i * 0.5, y = tY(t).toFixed(1), major = i % 2 === 0;
    ticks += `<line x1="43" x2="${major ? 52 : 47.5}" y1="${y}" y2="${y}" class="${major ? 'tk-major' : 'tk-minor'}"/>`;
    if (major && (t % 2 === 0)) ticks += `<text x="56" y="${(+y + 3.6).toFixed(1)}" class="tk-num">${t}</text>`;
  }
  const y35 = tY(35).toFixed(1), y366 = tY(36.6).toFixed(1);
  return `
  <svg class="thermo-svg" viewBox="-12 0 96 252" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id="gl-glass" x1="0" x2="1"><stop offset="0" stop-color="var(--glass-lo)"/><stop offset=".45" stop-color="var(--glass-hi)"/><stop offset="1" stop-color="var(--glass-lo)"/></linearGradient>
    </defs>
    <rect x="29" y="${y35}" width="10" height="${(TY0 - +y35 + 4).toFixed(1)}" class="cold-band"/>
    <path class="tube" d="M29 31A5 5 0 0 1 39 31V215.100A14 14 0 1 1 29 215.100Z" fill="url(#gl-glass)"/>
    <rect id="merc" class="merc" x="32" y="120" width="4" height="120" rx="2"/>
    <circle id="merc-bulb" class="merc-bulb" cx="34" cy="229" r="10.500"/>
    <path class="tube-hi" d="M31.600 34V210"/>
    ${ticks}
    <g class="mark mark-35"><line x1="13" x2="27" y1="${y35}" y2="${y35}"/><text x="11" y="${(+y35 + 3.6).toFixed(1)}">35</text></g>
    <g class="mark mark-366"><line x1="13" x2="27" y1="${y366}" y2="${y366}"/><text x="11" y="${(+y366 + 3.6).toFixed(1)}">36,6</text></g>
    <text x="34" y="14" class="tk-unit" text-anchor="middle">°C</text>
  </svg>`;
}

function dialSVG(): string {
  const cx = 60, cy = 60;
  const ang = (v: number) => 135 + (v / 30) * 270;
  const pt = (a: number, r: number) => `${(cx + Math.cos((a * Math.PI) / 180) * r).toFixed(2)} ${(cy + Math.sin((a * Math.PI) / 180) * r).toFixed(2)}`;
  let ticks = '';
  for (let v = 0; v <= 30; v++) {
    const a = ang(v), major = v % 5 === 0;
    const [x1, y1] = pt(a, major ? 38 : 42).split(' '), [x2, y2] = pt(a, 47).split(' ');
    ticks += `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" class="${major ? 'dk-major' : 'dk-minor'}${v >= 18 ? ' dk-hot' : ''}"/>`;
    if (v % 10 === 0) { const [tx, ty] = pt(a, 30).split(' '); ticks += `<text x="${tx}" y="${(+ty + 3).toFixed(1)}" class="dk-num" text-anchor="middle">${v}</text>`; }
  }
  const arc = (a0: number, a1: number, r: number) => `M${pt(a0, r)} A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${pt(a1, r)}`;
  return `
  <svg class="dial-svg" viewBox="0 0 120 120" aria-hidden="true" focusable="false">
    <circle cx="60" cy="60" r="57" class="dial-bezel"/>
    <circle cx="60" cy="60" r="52" class="dial-face"/>
    <path d="${arc(ang(18), ang(30), 50)}" class="dial-zone"/>
    ${ticks}
    <text x="60" y="42" class="dial-cap" text-anchor="middle">ВЕТЕР</text>
    <g id="dial-dir" class="dial-dir"><path d="M49 52.500h22M65.500 48.500l5.500 4-5.500 4"/></g>
    <g id="dial-needle" class="dial-needle"><path d="M-9 0H41" class="nd-line"/><path d="M41 0l-8-2.600v5.200z" class="nd-tip"/><circle r="4.600" class="nd-hub"/><circle r="1.600" class="nd-pin"/></g>
    <text id="dial-val" x="60" y="94" class="dial-val" text-anchor="middle">0</text>
    <text x="60" y="104" class="dial-unit" text-anchor="middle">м/с</text>
  </svg>`;
}

// ---------------------------------------------------------------- UI
interface Gauge { root: HTMLElement; fill: HTMLElement; val: HTMLElement }
type Cached<T extends HTMLElement = HTMLElement> = T & { _t?: string };

const TOOL_ICON: Record<string, string> = { shovel: 'shovel', saw: 'saw', axe: 'axe', beam: 'beam', block: 'block', fire: 'fire' };

export class UI {
  onSound: (on: boolean) => void = () => {};

  private root: HTMLElement;
  private input: Input;
  private hud: HTMLElement;
  private memo: Record<string, string | number | boolean> = {};
  private last = 0;
  private soundOn = true;
  private overlay: HTMLElement | null = null;
  private overlayTimer = 0;
  private toasts!: HTMLElement;
  private hintCard: HTMLElement;
  private hintText: HTMLElement;
  private warnLine!: Cached;
  private warnText!: Cached;
  private reticleEl: HTMLElement;
  private mercCold = [93, 180, 255];
  private mercWarm = [240, 71, 58];

  private mercury!: SVGElement;
  private mercuryBulb!: SVGElement;
  private coreVal!: Cached;
  private coreState!: Cached;
  private thermo!: HTMLElement;
  private gauges: Record<'food' | 'stamina' | 'wet' | 'shelter', Gauge> = {} as never;
  private needle!: SVGElement;
  private dialDir!: SVGElement;
  private dialVal!: SVGElement;
  private feel!: Cached;
  private air!: Cached;
  private feelRow!: HTMLElement;
  private clockDay!: Cached;
  private clockTime!: Cached;
  private clockIcon!: HTMLElement;
  private clockWait!: HTMLElement;
  private chips: Record<string, { root: HTMLElement; n: Cached }> = {};
  private belt!: HTMLElement;
  private tags: { root: HTMLElement; name: Cached; key: Cached; count: Cached; load: HTMLElement }[] = [];
  private beltSig = '';
  private btnWait!: HTMLElement;

  // joystick
  private stick!: HTMLElement;
  private knob!: HTMLElement;
  private stickId: number | null = null;
  private stickOx = 0;
  private stickOy = 0;

  constructor(root: HTMLElement, input: Input) {
    this.root = root;
    this.input = input;
    root.classList.add('ui-root');
    this.readColours();

    this.hud = el('div', 'hud');
    root.appendChild(this.hud);

    this.buildTopLeft();
    this.buildTopCentre();
    this.buildTopRight();
    this.buildBottom();
    this.buildTouch();

    this.toasts.setAttribute('aria-live', 'polite');

    this.hintCard = el('div', 'hint');
    this.hintText = el('span', 'hint-text');
    this.hintCard.appendChild(this.hintText);
    this.hintCard.setAttribute('aria-live', 'polite');
    this.hud.appendChild(this.hintCard);

    this.reticleEl = el('div', 'reticle', '<i></i><i></i><i></i><i></i><b></b>');
    root.appendChild(this.reticleEl);

    root.appendChild(el('div', 'rotate-lock', `<div class="rl-card">${ico('phone', 'rl-phone')}<p class="rl-title">Поверни телефон горизонтально</p><p class="rl-sub">Белая Мгла играется только в ландшафте</p></div>`));
  }

  // ------------------------------------------------------------ build
  private readColours(): void {
    try {
      const cs = getComputedStyle(document.documentElement);
      const parse = (v: string, fb: number[]) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
        return m ? [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)) : fb;
      };
      this.mercCold = parse(cs.getPropertyValue('--merc-cold'), this.mercCold);
      this.mercWarm = parse(cs.getPropertyValue('--merc-warm'), this.mercWarm);
    } catch { /* keep defaults */ }
  }

  private gauge(key: 'food' | 'stamina' | 'wet' | 'shelter', label: string, icon: string): HTMLElement {
    const root = el('div', `plate gauge g-${key}`);
    root.innerHTML = `<span class="g-ico">${ico(icon)}</span><span class="g-lab">${label}</span><span class="g-val"></span><span class="g-track"><i class="g-fill"></i></span>`;
    this.gauges[key] = { root, fill: root.querySelector('.g-fill') as HTMLElement, val: root.querySelector('.g-val') as HTMLElement };
    return root;
  }

  private buildTopLeft(): void {
    const box = el('div', 'hud-tl');
    this.thermo = el('div', 'plate thermo');
    this.thermo.innerHTML = `
      <div class="thermo-head"><span class="cap">ТЕЛО</span><span class="thermo-val mono"></span></div>
      <div class="thermo-body">${thermoSVG()}</div>
      <div class="thermo-state"></div>
      <i class="rivet r1"></i><i class="rivet r2"></i><i class="rivet r3"></i><i class="rivet r4"></i>`;
    this.mercury = this.thermo.querySelector('#merc') as SVGElement;
    this.mercuryBulb = this.thermo.querySelector('#merc-bulb') as SVGElement;
    this.coreVal = this.thermo.querySelector('.thermo-val') as Cached;
    this.coreState = this.thermo.querySelector('.thermo-state') as Cached;
    box.appendChild(this.thermo);

    const col = el('div', 'gauges');
    col.appendChild(this.gauge('food', 'СЫТОСТЬ', 'food'));
    col.appendChild(this.gauge('stamina', 'СИЛЫ', 'bolt'));
    col.appendChild(this.gauge('wet', 'СЫРОСТЬ', 'drop'));
    col.appendChild(this.gauge('shelter', 'УКРЫТИЕ', 'hut'));
    box.appendChild(col);
    this.hud.appendChild(box);
  }

  private buildTopCentre(): void {
    const box = el('div', 'hud-tc');
    const chips = el('div', 'chips');
    const defs: [string, string, string][] = [
      ['logs', 'beam', 'брёвна'], ['branches', 'branches', 'хворост'], ['matches', 'matches', 'спички'],
      ['food', 'food', 'еда'], ['blocks', 'block', 'блоки'], ['snowshoes', 'snowshoes', 'снегоступы'], ['thermos', 'thermos', 'термос'],
    ];
    for (const [k, icon, lab] of defs) {
      const root = el('div', `chip c-${k}`);
      root.title = lab;
      root.innerHTML = `${ico(icon)}<span class="chip-n mono"></span><span class="chip-l">${lab}</span>`;
      chips.appendChild(root);
      this.chips[k] = { root, n: root.querySelector('.chip-n') as Cached };
    }
    box.appendChild(chips);

    this.warnLine = el('div', 'warn-line') as Cached;
    this.warnLine.innerHTML = `${ico('baro')}<span class="warn-text"></span>`;
    this.warnText = this.warnLine.querySelector('.warn-text') as Cached;
    this.warnLine.setAttribute('role', 'status');
    box.appendChild(this.warnLine);
    this.toasts = el('div', 'toasts');
    box.appendChild(this.toasts);
    this.hud.appendChild(box);
  }

  private buildTopRight(): void {
    const box = el('div', 'hud-tr');
    const row = el('div', 'tr-row');

    const clock = el('div', 'plate clock');
    clock.innerHTML = `<span class="clock-ico">${ico('sun')}</span><span class="clock-day"></span><span class="clock-time mono"></span><span class="clock-wait">ЖДЁМ</span>`;
    this.clockIcon = clock.querySelector('.clock-ico') as HTMLElement;
    this.clockDay = clock.querySelector('.clock-day') as Cached;
    this.clockTime = clock.querySelector('.clock-time') as Cached;
    this.clockWait = clock.querySelector('.clock-wait') as HTMLElement;
    row.appendChild(clock);

    const pause = el('button', 'round-btn pause-btn', ico('pause'));
    pause.type = 'button';
    pause.tabIndex = -1;
    pause.setAttribute('aria-label', 'Пауза');
    this.bindPress(pause, () => this.input.press('pause'));
    row.appendChild(pause);
    box.appendChild(row);

    const dial = el('div', 'plate dial');
    dial.innerHTML = `${dialSVG()}<i class="rivet r1"></i><i class="rivet r2"></i><i class="rivet r3"></i><i class="rivet r4"></i>`;
    this.needle = dial.querySelector('#dial-needle') as SVGElement;
    this.dialDir = dial.querySelector('#dial-dir') as SVGElement;
    this.dialVal = dial.querySelector('#dial-val') as SVGElement;
    box.appendChild(dial);

    const temps = el('div', 'plate temps');
    temps.innerHTML = `<div class="t-row t-air"><span>воздух</span><b class="mono"></b></div><div class="t-row t-feel"><span>ощущается</span><b class="mono"></b></div>`;
    this.air = temps.querySelector('.t-air b') as Cached;
    this.feel = temps.querySelector('.t-feel b') as Cached;
    this.feelRow = temps.querySelector('.t-feel') as HTMLElement;
    box.appendChild(temps);
    this.hud.appendChild(box);
  }

  private buildBottom(): void {
    this.belt = el('div', 'belt');
    this.belt.setAttribute('role', 'toolbar');
    this.belt.setAttribute('aria-label', 'Инструменты');
    this.hud.appendChild(this.belt);
  }

  private buildTags(tools: HudData['tools']): void {
    this.belt.textContent = '';
    this.tags = [];
    tools.forEach((t, i) => {
      const root = el('button', `tag tag-${t.id}`);
      root.type = 'button';
      root.tabIndex = -1;
      root.innerHTML = `<i class="tag-hole"></i><span class="tag-key mono"></span>${ico(TOOL_ICON[t.id] ?? 'block', 'tag-ico')}<span class="tag-name"></span><span class="tag-count mono"></span><span class="tag-load"><i></i></span>`;
      root.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); this.input.pressTool(i); });
      root.addEventListener('mousedown', (e) => e.preventDefault());
      this.belt.appendChild(root);
      this.tags.push({
        root, name: root.querySelector('.tag-name') as Cached, key: root.querySelector('.tag-key') as Cached,
        count: root.querySelector('.tag-count') as Cached, load: root.querySelector('.tag-load i') as HTMLElement,
      });
    });
    this.input.toolCount = tools.length || 6;
  }

  private bindPress(b: HTMLElement, fn: () => void): void {
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); e.stopPropagation(); b.classList.add('down'); fn(); });
    const up = () => b.classList.remove('down');
    b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
    b.addEventListener('mousedown', (e) => e.preventDefault());
    b.addEventListener('click', (e) => e.preventDefault());
  }

  private buildTouch(): void {
    const touch = el('div', 'touch');

    // floating joystick
    const zone = el('div', 'stick-zone');
    this.stick = el('div', 'stick', '<i class="stick-ring"></i><i class="stick-up"></i><i class="stick-knob"></i>');
    this.knob = this.stick.querySelector('.stick-knob') as HTMLElement;
    zone.appendChild(this.stick);
    touch.appendChild(zone);
    zone.addEventListener('pointerdown', (e) => {
      if (this.stickId !== null) return;
      e.preventDefault(); e.stopPropagation();
      this.stickId = e.pointerId;
      try { zone.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      this.stickOx = e.clientX; this.stickOy = e.clientY;
      this.stick.classList.add('active');
      this.stick.style.transform = `translate3d(${e.clientX - zone.getBoundingClientRect().left}px, ${e.clientY - zone.getBoundingClientRect().top}px, 0)`;
      this.stickMove(e.clientX, e.clientY);
    });
    zone.addEventListener('pointermove', (e) => { if (e.pointerId === this.stickId) this.stickMove(e.clientX, e.clientY); });
    const end = (e: PointerEvent) => {
      if (e.pointerId !== this.stickId) return;
      this.stickId = null;
      this.stick.classList.remove('active');
      this.stick.style.transform = '';
      this.knob.style.transform = '';
      this.input.setStick(0, false, false);
    };
    zone.addEventListener('pointerup', end); zone.addEventListener('pointercancel', end);

    // action buttons
    const pad = el('div', 'actions');
    const defs: [string, string, string, () => void][] = [
      ['put', 'Положить', 'put', () => this.input.press('secondary')],
      ['take', 'Взять', 'take', () => this.input.press('interact')],
      ['eat', 'Съесть', 'eat', () => this.input.press('eat')],
      ['wait', 'Ждать', 'wait', () => this.input.toggleWait()],
      ['rotate', 'Повернуть', 'rotate', () => this.input.press('rotate' as InputButton)],
      ['xray', 'Рентген', 'xray', () => this.input.press('xray')],
    ];
    for (const [id, label, icon, fn] of defs) {
      const b = el('button', `abtn ab-${id}`, `${ico(icon)}<span>${label}</span>`);
      b.type = 'button';
      b.tabIndex = -1;
      b.setAttribute('aria-label', label);
      this.bindPress(b, fn);
      pad.appendChild(b);
      if (id === 'wait') { this.btnWait = b; b.setAttribute('aria-pressed', 'false'); }
    }
    touch.appendChild(pad);
    this.hud.appendChild(touch);
  }

  private stickMove(cx: number, cy: number): void {
    const R = Math.max(40, Math.min(64, window.innerHeight * 0.14));
    let dx = cx - this.stickOx, dy = cy - this.stickOy;
    const len = Math.hypot(dx, dy);
    if (len > R) { dx = (dx / len) * R; dy = (dy / len) * R; }
    this.knob.style.transform = `translate3d(${dx}px, ${dy}px, 0)`;
    let x = dx / R; const up = -dy / R;
    x = Math.abs(x) < 0.16 ? 0 : (x - Math.sign(x) * 0.16) / 0.84;
    this.input.setStick(x, up > 0.6, Math.abs(dx / R) > 0.85);
  }

  // ------------------------------------------------------------ helpers
  private txt(e: Cached, s: string): void { if (e._t !== s) { e._t = s; e.textContent = s; } }
  private m(key: string, v: string | number | boolean, apply: () => void): void {
    if (this.memo[key] === v) return;
    this.memo[key] = v; apply();
  }

  // ------------------------------------------------------------ update
  update(h: HudData): void {
    const inp = this.input;
    inp.currentTool = h.tool;
    this.updateReticle();

    const now = performance.now();
    if (now - this.last < 95) return;
    this.last = now;

    // belt (rebuild only when the set of tools changes)
    const sig = h.tools.map((t) => t.id).join(',');
    if (sig !== this.beltSig) { this.beltSig = sig; this.buildTags(h.tools); }

    // ---- core temperature
    const core = clamp(h.core, T_MIN - 1, T_MAX + 1);
    const q = Math.round(core * 20) / 20;
    this.m('core', q, () => {
      const y = tY(q);
      this.mercury.setAttribute('y', y.toFixed(1));
      this.mercury.setAttribute('height', (232 - y).toFixed(1));
      const k = clamp((q - 35) / 1.6, 0, 1);
      const c = this.mercCold.map((a, i) => Math.round(a + (this.mercWarm[i] - a) * k));
      const col = `rgb(${c[0]},${c[1]},${c[2]})`;
      this.mercury.setAttribute('fill', col);
      this.mercuryBulb.setAttribute('fill', col);
      this.thermo.style.setProperty('--merc', col);
    });
    this.txt(this.coreVal, fmtCore(h.core) + '°');
    const st = h.core >= 36.6 ? 'норма' : h.core >= 35 ? 'дрожь' : h.core >= 32 ? 'гипотермия' : 'критично';
    this.txt(this.coreState, st);
    this.m('core-lvl', h.core >= 36.6 ? 0 : h.core >= 35 ? 1 : h.core >= 32 ? 2 : 3, () => {
      this.thermo.dataset.level = String(h.core >= 36.6 ? 0 : h.core >= 35 ? 1 : h.core >= 32 ? 2 : 3);
    });

    // ---- gauges
    this.setGauge('food', h.food, false);
    this.setGauge('stamina', h.stamina, false);
    this.setGauge('wet', h.wet, true);
    this.setGauge('shelter', h.shelter, false, true);

    // ---- wind dial
    const w = Math.abs(h.wind);
    const wa = Math.round(clamp(w, 0, 30) * 9) / 9; // 0.11 m/s steps
    this.m('wind', wa, () => this.needle.style.transform = `translate(60px, 60px) rotate(${135 + (wa / 30) * 270}deg)`);
    this.m('wdir', Math.abs(h.wind) < 0.5 ? 0 : Math.sign(h.wind), () => {
      const s = Math.abs(h.wind) < 0.5 ? 0 : Math.sign(h.wind);
      this.dialDir.style.opacity = s === 0 ? '0' : '1';
      this.dialDir.style.transform = `translate(60px, 0) scaleX(${s || 1}) translate(-60px, 0)`;
    });
    const wt = String(Math.round(w));
    this.m('wtxt', wt, () => { this.dialVal.textContent = wt; });
    this.txt(this.air, fmtDeg(h.airT));
    this.txt(this.feel, fmtDeg(h.feelT));
    this.m('feelhot', h.feelT < -40, () => this.feelRow.classList.toggle('danger', h.feelT < -40));

    // ---- clock
    this.txt(this.clockDay, 'ДЕНЬ ' + h.day);
    this.txt(this.clockTime, h.clock);
    this.m('night', h.night, () => {
      this.clockIcon.innerHTML = ico(h.night ? 'moon' : 'sun');
      this.root.classList.toggle('is-night', h.night);
    });
    const waiting = h.waiting || inp.state.waitHeld;
    this.m('wait', waiting, () => {
      this.clockWait.classList.toggle('on', waiting);
      this.btnWait?.classList.toggle('on', waiting);
      this.btnWait?.setAttribute('aria-pressed', String(waiting));
    });

    // ---- warning (barometer)
    const warn = h.warning ?? '';
    this.m('warn', warn, () => {
      if (warn) this.warnText.textContent = warn;
      this.warnLine.classList.toggle('on', !!warn);
    });

    // ---- inventory
    const inv = h.inv;
    this.setChip('logs', inv.logs); this.setChip('branches', inv.branches); this.setChip('matches', inv.matches);
    this.setChip('food', inv.food); this.setChip('blocks', inv.blocks);
    this.setChip('snowshoes', inv.snowshoes ? 1 : 0, inv.snowshoes ? 'есть' : 'нет');
    this.setChip('thermos', inv.thermos, undefined, inv.thermos > 0);
    this.m('lowmatch', inv.matches, () => this.chips.matches.root.classList.toggle('warn', inv.matches <= 1));

    // ---- tool tags
    h.tools.forEach((t, i) => {
      const g = this.tags[i]; if (!g) return;
      this.txt(g.name, t.name); this.txt(g.key, t.key);
      this.txt(g.count, t.count === undefined ? '' : String(t.count));
      this.m('tag' + i, (i === h.tool ? 1 : 0) + (t.enabled ? 2 : 0) + ((t.count ?? 1) === 0 ? 4 : 0), () => {
        g.root.classList.toggle('sel', i === h.tool);
        g.root.classList.toggle('off', !t.enabled);
        g.root.classList.toggle('empty', t.count === 0);
        g.root.setAttribute('aria-pressed', String(i === h.tool));
      });
      if (t.id === 'shovel') {
        const l = Math.round(clamp(h.shovelLoad, 0, 1) * 40) / 40;
        this.m('load', l, () => {
          g.load.style.transform = `scaleX(${l})`;
          g.root.classList.toggle('loaded', l > 0.02);
          g.root.classList.toggle('full', l > 0.85);
        });
      }
    });

    // ---- hint
    const hint = h.hint ?? '';
    this.m('hint', hint, () => {
      if (hint) this.hintText.textContent = hint;
      this.hintCard.classList.toggle('on', !!hint);
    });
  }

  private setGauge(k: 'food' | 'stamina' | 'wet' | 'shelter', v: number, invert: boolean, calm = false): void {
    const g = this.gauges[k];
    const q = Math.round(clamp(v, 0, 1) * 48) / 48;
    this.m('g' + k, q, () => {
      g.fill.style.transform = `scaleX(${q})`;
      const pct = Math.round(q * 100) + '%';
      g.val.textContent = pct;
      const lvl = calm ? 'calm' : (invert ? (q > 0.6 ? 'bad' : q > 0.35 ? 'mid' : 'ok') : (q < 0.2 ? 'bad' : q < 0.4 ? 'mid' : 'ok'));
      g.root.dataset.level = lvl;
    });
  }

  private setChip(k: string, n: number, label?: string, visible = true): void {
    const c = this.chips[k]; if (!c) return;
    this.txt(c.n, label ?? String(n));
    this.m('chip' + k, (n > 0 ? 1 : 0) + (visible ? 2 : 0), () => {
      c.root.classList.toggle('zero', n <= 0);
      c.root.classList.toggle('hidden', !visible);
    });
  }

  private updateReticle(): void {
    const s = this.input.state;
    const show = this.input.mobile && s.hasAim;
    this.m('ret-show', show, () => this.reticleEl.classList.toggle('on', show));
    if (!show) return;
    this.m('ret-down', s.primary, () => this.reticleEl.classList.toggle('down', s.primary));
    const x = Math.round(s.aimX), y = Math.round(s.aimY);
    this.m('ret-pos', x * 10000 + y, () => { this.reticleEl.style.transform = `translate3d(${x}px, ${y}px, 0)`; });
  }

  // ------------------------------------------------------------ toasts
  toast(msg: string, kind: 'info' | 'warn' | 'good' = 'info'): void {
    const existing = Array.from(this.toasts.children).find((c) => c.getAttribute('data-msg') === msg) as HTMLElement | undefined;
    if (existing) { existing.classList.remove('out'); window.clearTimeout(Number(existing.dataset.tid)); existing.dataset.tid = String(this.scheduleToast(existing)); return; }
    const t = el('div', `toast ${kind}`, `<i class="toast-bar"></i><span></span>`);
    (t.querySelector('span') as HTMLElement).textContent = msg;
    t.setAttribute('data-msg', msg);
    this.toasts.appendChild(t);
    while (this.toasts.children.length > 3) this.toasts.firstElementChild?.remove();
    t.dataset.tid = String(this.scheduleToast(t));
  }

  private scheduleToast(t: HTMLElement): number {
    return window.setTimeout(() => {
      t.classList.add('out');
      window.setTimeout(() => t.remove(), 500);
    }, 3800);
  }

  // ------------------------------------------------------------ overlays
  private setOverlay(node: HTMLElement, mode: 'title' | 'pause' | 'end'): void {
    window.clearTimeout(this.overlayTimer);
    this.overlay?.remove();
    this.overlay = node;
    this.root.appendChild(node);
    this.root.classList.remove('ov-title', 'ov-pause', 'ov-end');
    this.root.classList.add('has-overlay', 'ov-' + mode);
    document.documentElement.dataset.overlay = '1';
    requestAnimationFrame(() => node.classList.add('in'));
  }

  hide(): void {
    const ov = this.overlay;
    this.overlay = null;
    this.root.classList.remove('has-overlay', 'ov-title', 'ov-pause', 'ov-end');
    document.documentElement.dataset.overlay = '0';
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (!ov) return;
    ov.classList.remove('in');
    ov.classList.add('leaving');
    this.overlayTimer = window.setTimeout(() => ov.remove(), 450);
  }

  private btn(label: string, cls: string, fn: () => void): HTMLButtonElement {
    const b = el('button', `btn ${cls}`, `<span>${label}</span>`);
    b.type = 'button';
    b.addEventListener('click', () => { fn(); });
    return b;
  }

  showTitle(onStart: () => void): void {
    const ov = el('div', 'overlay title');
    const keys = (arr: string[]) => arr.map((k) => `<kbd>${k}</kbd>`).join('');
    ov.innerHTML = `
      <svg class="title-rings" viewBox="0 0 400 400" aria-hidden="true" focusable="false">
        <circle cx="200" cy="200" r="196"/><circle cx="200" cy="200" r="168"/><circle cx="200" cy="200" r="120" class="dash"/>
        ${Array.from({ length: 72 }, (_, i) => { const a = (i * 5 * Math.PI) / 180, r1 = i % 6 === 0 ? 176 : 184; return `<line x1="${(200 + Math.cos(a) * r1).toFixed(1)}" y1="${(200 + Math.sin(a) * r1).toFixed(1)}" x2="${(200 + Math.cos(a) * 192).toFixed(1)}" y2="${(200 + Math.sin(a) * 192).toFixed(1)}"/>`; }).join('')}
      </svg>
      <div class="title-frame">
        <div class="kicker"><i></i><span>Полевой журнал · плато</span><i></i></div>
        <h1 class="title-name"><span>БЕЛАЯ</span><span>МГЛА</span></h1>
        <p class="premise">Метель отрезала тебя от лагеря: вокруг только снег, ветер и мороз.<br>Копай, руби, строй укрытие, береги огонь и сухую одежду.</p>
        <div class="goal"><span class="goal-moons">${ico('moon')}${ico('moon')}${ico('moon')}</span><span class="goal-text">Цель: <b>переживи 3 ночи</b></span></div>
        <div class="controls controls-pc">
          <div><span class="kk">${keys(['A', 'D'])}</span><em>идти</em></div>
          <div><span class="kk">${keys(['Shift'])}</span><em>бежать</em></div>
          <div><span class="kk">${keys(['W'])}${keys(['Пробел'])}</span><em>прыжок</em></div>
          <div><span class="kk"><kbd class="m">Мышь</kbd></span><em>прицел</em></div>
          <div><span class="kk"><kbd class="m">ЛКМ</kbd></span><em>работа инструментом</em></div>
          <div><span class="kk"><kbd class="m">ПКМ</kbd></span><em>положить, бросить</em></div>
          <div><span class="kk">${keys(['1'])}<b>–</b>${keys(['6'])}</span><em>инструменты, колесо</em></div>
          <div><span class="kk">${keys(['E'])}${keys(['Q'])}</span><em>взять, съесть</em></div>
          <div><span class="kk">${keys(['F'])}${keys(['R'])}</span><em>костёр, повернуть брус</em></div>
          <div><span class="kk">${keys(['T'])}</span><em>ждать в укрытии</em></div>
          <div><span class="kk">${keys(['X'])}</span><em>рентген снега</em></div>
          <div><span class="kk">${keys(['Esc'])}</span><em>пауза</em></div>
        </div>
        <div class="controls controls-touch">
          <div><span class="tk">${ico('take')}</span><em>Левый стик: ход. Вверх: прыжок. Сильный наклон: бег</em></div>
          <div><span class="tk">${ico('shovel')}</span><em>Коснись мира: прицел и работа. Держи палец, чтобы продолжать</em></div>
          <div><span class="tk">${ico('put')}</span><em>Справа: положить, взять, съесть, ждать, повернуть, рентген</em></div>
          <div><span class="tk">${ico('axe')}</span><em>Снизу полоса инструментов. Только в ландшафте</em></div>
        </div>
        <div class="title-actions"></div>
      </div>
      <div class="ground" aria-hidden="true"></div>`;
    const actions = ov.querySelector('.title-actions') as HTMLElement;
    const start = this.btn('В путь', 'btn-primary btn-start', () => { onStart(); });
    const snd = el('button', 'btn btn-ghost btn-sound', `${ico('sound')}<span>Звук: вкл</span>`);
    snd.type = 'button';
    snd.setAttribute('aria-pressed', 'true');
    snd.addEventListener('click', () => {
      this.soundOn = !this.soundOn;
      snd.innerHTML = `${ico(this.soundOn ? 'sound' : 'mute')}<span>Звук: ${this.soundOn ? 'вкл' : 'выкл'}</span>`;
      snd.setAttribute('aria-pressed', String(this.soundOn));
      this.onSound(this.soundOn);
      snd.blur();
    });
    actions.append(start, snd);
    this.setOverlay(ov, 'title');
    window.setTimeout(() => start.focus({ preventScroll: true }), 60);
  }

  showPause(onResume: () => void, onRestart: () => void): void {
    const ov = el('div', 'overlay pause');
    const card = el('div', 'card');
    card.innerHTML = `<div class="kicker"><i></i><span>Привал</span><i></i></div><h2 class="card-title">Пауза</h2><p class="card-sub">Время стоит. Мороз подождёт.</p><div class="card-actions"></div>`;
    const acts = card.querySelector('.card-actions') as HTMLElement;
    const resume = this.btn('Продолжить', 'btn-primary', () => { onResume(); });
    let armed = false, tid = 0;
    const restart = this.btn('Начать заново', 'btn-ghost', () => {
      if (!armed) {
        armed = true;
        (restart.firstElementChild as HTMLElement).textContent = 'Точно? Прогресс пропадёт';
        restart.classList.add('armed');
        tid = window.setTimeout(() => { armed = false; restart.classList.remove('armed'); (restart.firstElementChild as HTMLElement).textContent = 'Начать заново'; }, 3000);
        return;
      }
      window.clearTimeout(tid);
      onRestart();
    });
    acts.append(resume, restart);
    ov.appendChild(card);
    this.setOverlay(ov, 'pause');
    window.setTimeout(() => resume.focus({ preventScroll: true }), 60);
  }

  showEnd(win: boolean, cause: string, stats: { days: number; hours: number; built: string[] }, onRestart: () => void): void {
    const ov = el('div', `overlay end ${win ? 'win' : 'lose'}`);
    const card = el('div', 'card');
    const built = stats.built.length
      ? `<ul class="built">${stats.built.map((b) => `<li></li>`).join('')}</ul>`
      : '<p class="built-none">Ничего не построено</p>';
    card.innerHTML = `
      <div class="kicker"><i></i><span>${win ? 'Рассвет' : 'Конец записей'}</span><i></i></div>
      <h2 class="card-title">${win ? 'Ты пережил три ночи' : 'Мгла победила'}</h2>
      <p class="card-sub cause"></p>
      <div class="stats">
        <div><b class="mono">${stats.days}</b><span>${plural(stats.days, 'день', 'дня', 'дней')}</span></div>
        <div><b class="mono">${stats.hours}</b><span>${plural(stats.hours, 'час', 'часа', 'часов')} в пути</span></div>
        <div><b class="mono">${stats.built.length}</b><span>${plural(stats.built.length, 'постройка', 'постройки', 'построек')}</span></div>
      </div>
      <div class="built-wrap"><span class="cap">Построено</span>${built}</div>
      <div class="card-actions"></div>`;
    (card.querySelector('.cause') as HTMLElement).textContent = cause;
    card.querySelectorAll('.built li').forEach((li, i) => { li.textContent = stats.built[i]; });
    const again = this.btn(win ? 'Ещё раз' : 'Попробовать снова', 'btn-primary', () => { onRestart(); });
    (card.querySelector('.card-actions') as HTMLElement).appendChild(again);
    ov.appendChild(card);
    this.setOverlay(ov, 'end');
    window.setTimeout(() => again.focus({ preventScroll: true }), 400);
  }
}

function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
