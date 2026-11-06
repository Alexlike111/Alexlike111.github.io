// Radial selection wheel (tools / actions). Pure DOM; styled in ui.css (.wheel*). Opens around a point (clamped to the screen),
// closes on tap outside / centre / pick. Three ways to pick:
//   tap      – open (tap on the opener), then tap an item
//   drag     – press the opener, drag onto an item, release (flick)
//   hold     – a key held (Q on PC): the wheel opens at the cursor, the direction from the centre chooses, release picks
export interface WheelItem {
  id: string;
  label: string;
  icon: string;            // inline <svg> markup
  badge?: string;          // small count pill
  bar?: number;            // 0..1 live meter along the item's foot (shovel load, cut progress, fire fuel); absent = none
  sub?: string;            // hub caption while the item is highlighted (or selected, when nothing is)
  cls?: string;            // sel | on | off | empty | urgent
}

export type WheelMode = 'tap' | 'drag' | 'hold';

const N_TICKS = 60;

export class Wheel {
  readonly root: HTMLElement;
  open = false;
  onPick: (id: string) => void = () => {};
  onToggle: (open: boolean) => void = () => {};

  private ring: HTMLElement;
  private hubName: HTMLElement;
  private hubSub: HTMLElement;
  private nodes: { root: HTMLElement; badge: HTMLElement; label: HTMLElement; ico: HTMLElement; bar: HTMLElement }[] = [];
  private items: WheelItem[] = [];
  private title: string;
  private subTitle: string;
  private cx = 0; private cy = 0;      // ring centre, client px
  private R = 86; private S = 60;      // ring radius / item diameter
  private mode: WheelMode = 'tap';
  private pid = -1;
  private sx = 0; private sy = 0;      // press point of the drag
  private dragging = false;
  private hot = -1;
  private tid = 0;

  constructor(parent: HTMLElement, title: string, subTitle: string, cls: string) {
    this.title = title; this.subTitle = subTitle;
    const root = document.createElement('div');
    root.className = `wheel ${cls}`;
    root.setAttribute('role', 'menu');
    root.setAttribute('aria-label', title);
    let ticks = '';
    for (let i = 0; i < N_TICKS; i++) {
      const a = (i / N_TICKS) * Math.PI * 2, r1 = i % 5 === 0 ? 93 : 95.5, r2 = 98;
      ticks += `<line x1="${(100 + Math.cos(a) * r1).toFixed(2)}" y1="${(100 + Math.sin(a) * r1).toFixed(2)}" x2="${(100 + Math.cos(a) * r2).toFixed(2)}" y2="${(100 + Math.sin(a) * r2).toFixed(2)}" class="${i % 5 === 0 ? 'wt-maj' : 'wt-min'}"/>`;
    }
    root.innerHTML = `
      <div class="wheel-scrim"></div>
      <div class="wheel-ring">
        <svg class="wheel-dial" viewBox="0 0 200 200" aria-hidden="true" focusable="false">
          ${ticks}
        </svg>
        <div class="wheel-hub"><b class="wh-name"></b><i class="wh-sub"></i></div>
      </div>`;
    this.root = root;
    this.ring = root.querySelector('.wheel-ring') as HTMLElement;
    this.hubName = root.querySelector('.wh-name') as HTMLElement;
    this.hubSub = root.querySelector('.wh-sub') as HTMLElement;
    this.paintHub(-1);
    parent.appendChild(root);

    root.addEventListener('pointerdown', (e) => {
      if (!this.open) return;
      e.preventDefault(); e.stopPropagation();
      if (e.pointerId === this.pid) return;
      const i = this.pickNear(e.clientX, e.clientY);
      if (i >= 0) this.choose(i); else this.close();
    });
    root.addEventListener('pointermove', (e) => { if (this.open && this.mode !== 'drag') this.hover(this.mode === 'hold' ? this.pickSector(e.clientX, e.clientY) : this.pickNear(e.clientX, e.clientY)); });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** (Re)build items. Cheap diff when the set of ids is unchanged. */
  setItems(items: WheelItem[]): void {
    const same = items.length === this.items.length && items.every((it, i) => it.id === this.items[i].id);
    if (!same) {
      for (const n of this.nodes) n.root.remove();
      this.nodes = [];
      items.forEach((it, i) => {
        const a = -Math.PI / 2 + (i / items.length) * Math.PI * 2;
        const b = document.createElement('div');
        b.className = 'wheel-item';
        b.setAttribute('role', 'menuitem');
        b.style.setProperty('--ux', Math.cos(a).toFixed(4));
        b.style.setProperty('--uy', Math.sin(a).toFixed(4));
        b.style.setProperty('--d', `${i * 6}ms`);
        b.innerHTML = '<span class="wi-ico"></span><span class="wi-label"></span><span class="wi-badge mono"></span><span class="wi-bar"><i></i></span>';
        this.ring.appendChild(b);
        this.nodes.push({
          root: b, badge: b.querySelector('.wi-badge') as HTMLElement, label: b.querySelector('.wi-label') as HTMLElement,
          ico: b.querySelector('.wi-ico') as HTMLElement, bar: b.querySelector('.wi-bar') as HTMLElement,
        });
      });
      this.items = items.map((x) => ({ ...x, icon: '', label: '', badge: undefined, cls: undefined, bar: undefined }));
      this.items.forEach((x, i) => { x.id = items[i].id; });
    }
    items.forEach((it, i) => {
      const n = this.nodes[i], o = this.items[i];
      if (o.icon !== it.icon) { n.ico.innerHTML = it.icon; o.icon = it.icon; }
      if (o.label !== it.label) { n.label.textContent = it.label; o.label = it.label; }
      const bd = it.badge ?? '';
      if ((o.badge ?? '') !== bd) { n.badge.textContent = bd; n.badge.style.display = bd ? '' : 'none'; o.badge = bd; }
      const bar = it.bar === undefined ? -1 : Math.round(Math.min(1, Math.max(0, it.bar)) * 40) / 40;
      if ((o.bar ?? -1) !== bar) {
        o.bar = bar < 0 ? undefined : bar;
        n.bar.style.display = bar < 0 || bar <= 0.02 ? 'none' : 'block';
        (n.bar.firstElementChild as HTMLElement).style.transform = `scaleX(${Math.max(0, bar)})`;
      }
      o.sub = it.sub;
      const c = it.cls ?? '';
      if ((o.cls ?? '') !== c) {
        n.root.className = 'wheel-item' + (c ? ' ' + c : '') + (i === this.hot ? ' hot' : '');
        o.cls = c;
      }
    });
    if (this.open) this.paintHub(this.hot);
  }

  /** Open around (px, py); `from` = where the finger / cursor is now (the opener), used as the origin of the grow animation. */
  show(px: number, py: number, mode: WheelMode, pointerId = -1): void {
    if (this.open) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    const cs = getComputedStyle(document.documentElement);
    const sat = parseFloat(cs.getPropertyValue('--sa-t')) || 0, sab = parseFloat(cs.getPropertyValue('--sa-b')) || 0;
    const sal = parseFloat(cs.getPropertyValue('--sa-l')) || 0, sar = parseFloat(cs.getPropertyValue('--sa-r')) || 0;
    const S = Math.round(Math.max(62, Math.min(68, vh * 0.185)));
    const R = Math.round(Math.max(74, Math.min(98, vh * 0.24)));
    this.R = R; this.S = S;
    const ext = R + S / 2 + 8;
    const cx = Math.min(Math.max(px, sal + ext + 4), vw - sar - ext - 4);
    const cy = Math.min(Math.max(py, sat + ext + 4), vh - sab - ext - 4);
    this.cx = cx; this.cy = cy;
    this.root.style.setProperty('--R', R + 'px');
    this.root.style.setProperty('--S', S + 'px');
    this.ring.style.left = cx.toFixed(1) + 'px';
    this.ring.style.top = cy.toFixed(1) + 'px';
    this.ring.style.setProperty('--ox', (px - cx).toFixed(1) + 'px');
    this.ring.style.setProperty('--oy', (py - cy).toFixed(1) + 'px');
    this.mode = mode; this.pid = pointerId; this.sx = px; this.sy = py; this.dragging = false;
    this.hot = -1;
    for (const n of this.nodes) n.root.classList.remove('hot');
    this.paintHub(-1);
    window.clearTimeout(this.tid);
    this.open = true;
    this.root.classList.add('open');
    if (mode === 'drag' || mode === 'hold') {
      window.addEventListener('pointermove', this.onMove);
      if (mode === 'drag') { window.addEventListener('pointerup', this.onUp); window.addEventListener('pointercancel', this.onUp); }
    }
    this.onToggle(true);
  }

  /** hold mode: key released -> pick what is highlighted */
  release(): void {
    if (!this.open) return;
    if (this.hot >= 0) this.choose(this.hot); else this.close();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('open');
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.pid = -1;
    this.onToggle(false);
  }

  private choose(i: number): void {
    const id = this.items[i]?.id;
    this.close();
    if (id) this.onPick(id);
  }

  private onMove = (e: PointerEvent): void => {
    if (!this.open) return;
    if (this.mode === 'hold') { this.hover(this.pickSector(e.clientX, e.clientY)); return; }
    if (e.pointerId !== this.pid) return;
    if (!this.dragging && Math.hypot(e.clientX - this.sx, e.clientY - this.sy) > 10) this.dragging = true;
    if (this.dragging) this.hover(this.pickNear(e.clientX, e.clientY));
  };

  private onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.pid) return;
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.pid = -1;
    if (!this.open) return;
    if (!this.dragging) { this.mode = 'tap'; return; }   // plain tap on the opener: the wheel stays open for the second tap
    if (e.type === 'pointercancel') { this.close(); return; }
    const i = this.pickNear(e.clientX, e.clientY);
    if (i >= 0) this.choose(i); else this.close();
  };

  /** item whose circle is under the point (a bit of slack so thumbs don't miss) */
  private pickNear(x: number, y: number): number {
    let best = -1, bd = this.S * 0.62;
    for (let i = 0; i < this.items.length; i++) {
      const a = -Math.PI / 2 + (i / this.items.length) * Math.PI * 2;
      const d = Math.hypot(x - (this.cx + Math.cos(a) * this.R), y - (this.cy + Math.sin(a) * this.R));
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /** direction from the centre decides (pie menu); inside the hub = nothing */
  private pickSector(x: number, y: number): number {
    const dx = x - this.cx, dy = y - this.cy;
    if (Math.hypot(dx, dy) < this.S * 0.45) return -1;
    const n = this.items.length;
    let a = Math.atan2(dy, dx) + Math.PI / 2;             // 0 = straight up
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.round((a / (Math.PI * 2)) * n) % n;
  }

  private hover(i: number): void {
    if (i === this.hot) return;
    if (this.hot >= 0) this.nodes[this.hot]?.root.classList.remove('hot');
    this.hot = i;
    if (i >= 0) this.nodes[i]?.root.classList.add('hot');
    this.paintHub(i);
  }

  private paintHub(i: number): void {
    const it = i >= 0 ? this.items[i] : null;
    // nothing highlighted: the selected item's name and caption (the beam's shape, a fire's fuel) rather than the generic title
    const sel = it ? null : this.items.find((x) => (x.cls ?? '').split(' ').includes('sel')) ?? null;
    this.hubName.textContent = it ? it.label : sel ? sel.label : this.title;
    this.hubSub.textContent = it ? (it.sub ?? '') : sel ? (sel.sub || this.subTitle) : this.subTitle;
  }
}
