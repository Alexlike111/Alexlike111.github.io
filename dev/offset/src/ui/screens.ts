// Full-screen states laid over the canvas: hub (shop floor), mutation offer, pause, run summary.
// Every screen is a throw-away DOM subtree with its own Scope; the manager swaps them when HudState.mode changes.
import type { UiApi, HudState, OfferOption, Summary } from './api';
import { tr, setLang, getLang, type Lang } from '../core/i18n';
import { FORMS, PROOFS, TIER_MODS, TIER_MAX, type Form, type Settings } from '../meta/meta';
import { UPGRADES, UP_BY_ID, type Upgrade } from '../game/upgrades';
import { el, icon, inkIcon, mis, setMis, setText, kick, btn, emit, Scope, type Kid } from './icons';
import { t, tDyn, roman, pad2, fmtTime, fmtInt, type StrKey } from './strings';

interface Screen { el: HTMLElement; update?(h: HudState, dt: number): void; dispose(): void }
export interface Screens { sync(h: HudState, dt: number): void; rebuild(): void; destroy(): void }
interface Ctx { api: UiApi; /** language was switched: relabel everything */ onLang(): void }

type Tab = 'home' | 'forms' | 'catalog' | 'proofs' | 'settings';
const TABS: { id: Tab; key: StrKey }[] = [
  { id: 'home', key: 'tabHome' }, { id: 'forms', key: 'tabForms' }, { id: 'catalog', key: 'tabCatalog' }, { id: 'proofs', key: 'tabProofs' }, { id: 'settings', key: 'tabSettings' },
];
const TAG_KEY: Record<string, StrKey> = { jump: 'tJump', combat: 'tCombat', body: 'tBody', ink: 'tInk' };
const tagName = (tag: string) => (TAG_KEY[tag] ? t(TAG_KEY[tag]) : tag.toUpperCase());
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
let hubTab: Tab = 'home';
/** dev harness / deep links may preselect a hub tab */
export function setHubTab(tb: string) { if (TABS.some((x) => x.id === tb)) hubTab = tb as Tab; }

// ---------------------------------------------------------------- shared pieces
const swatches = (n: number) => { const s = el('span', 'of-sw'); for (let i = 0; i < 3; i++) s.append(el('i', i < n ? 's' + i : 'e')); return s; };
const pips = (n: number, max: number, cls = '') => { const s = el('span', 'of-pips ' + cls); for (let i = 0; i < max; i++) s.append(el('i', i < n ? 'is-on' : '')); return s; };
const price = (n: number) => el('span', 'of-price', icon('ink'), fmtInt(n));
const scroller = (cls: string, ...kids: Kid[]) => {
  const s = el('div', 'of-scroll ' + cls, ...kids);
  // a scrolling sheet must keep its touches: nothing may reach the canvas underneath
  s.addEventListener('pointerdown', (e) => e.stopPropagation());
  return s;
};

/** two-step destructive action: the trigger turns into a question with YES / CANCEL */
function confirmBox(cls: string, label: string, ask: string, yes: string, onYes: () => void): HTMLElement {
  const box = el('div', 'of-confirm ' + cls);
  const idle = () => { box.textContent = ''; box.classList.remove('is-ask'); box.append(btn('of-btn-line is-danger', [label], armed)); };
  const armed = () => {
    box.textContent = ''; box.classList.add('is-ask');
    box.append(el('p', 'of-confirm-q', ask), el('div', 'of-confirm-b', btn('of-btn-solid is-danger', [yes], onYes, { sound: 'stamp' }), btn('of-btn-line', [t('cancel')], idle)));
    kick(box, 'is-in');
  };
  idle(); return box;
}

function seg<T>(opts: { label: string; v: T }[], cur: T, onPick: (v: T) => void): HTMLElement {
  const w = el('div', 'of-seg'); const bs: HTMLButtonElement[] = [];
  opts.forEach((o, i) => {
    const b = btn('of-seg-b' + (o.v === cur ? ' is-on' : ''), [o.label], () => { bs.forEach((x, j) => x.classList.toggle('is-on', j === i)); onPick(o.v); });
    bs.push(b); w.append(b);
  });
  return w;
}
/** stepped slider drawn as a tone wedge (10 patches of rising density) */
function wedge(val: number, onChange: (v: number) => void): HTMLElement {
  const N = 10; const track = el('div', 'of-wedge-t'); const cells: HTMLElement[] = []; const num = el('span', 'of-wedge-n');
  for (let i = 0; i < N; i++) { const c = el('i'); c.style.setProperty('--d', String((i + 1) / N)); cells.push(c); track.append(c); }
  let cur = -1;
  const paint = (v: number) => { const k = Math.round(v * N); if (k === cur) return false; cur = k; cells.forEach((c, i) => c.classList.toggle('is-on', i < k)); num.textContent = pad2(k * 10).padStart(3, '0'); return true; };
  paint(val);
  const at = (e: PointerEvent) => { const r = track.getBoundingClientRect(); const f = (e.clientX - r.left) / r.width; const v = f < 0.03 ? 0 : clamp(Math.ceil(f * N), 1, N) / N; if (paint(v)) { emit('uiClick', {}); onChange(v); } };
  let drag = -1;
  track.addEventListener('pointerdown', (e) => { e.stopPropagation(); drag = e.pointerId; try { track.setPointerCapture(e.pointerId); } catch { /* synthetic */ } at(e); });
  track.addEventListener('pointermove', (e) => { if (e.pointerId === drag) at(e); });
  const end = (e: PointerEvent) => { if (e.pointerId === drag) drag = -1; };
  track.addEventListener('pointerup', end); track.addEventListener('pointercancel', end);
  return el('div', 'of-wedge', track, num);
}

function settingsPanel(ctx: Ctx, withReset: boolean): HTMLElement {
  const { api } = ctx; const s = api.meta.s.settings;
  const commit = () => { api.meta.save(); api.applySettings(); };
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { s[k] = v; commit(); };
  const row = (label: string, ctl: HTMLElement, note = '') => el('div', 'of-set', el('span', 'of-set-l', label, note ? el('small', '', note) : null), ctl);
  const onoff = (k: 'haptics' | 'lefty' | 'autoAim') => seg([{ label: t('off'), v: false }, { label: t('on'), v: true }], s[k], (v) => { set(k, v); if (k === 'haptics' && v) { try { navigator.vibrate?.(18); } catch { /* unsupported */ } } });
  const group = (title: string, ...rows: Kid[]) => el('section', 'of-setg', el('h3', 'of-h3', title), ...rows);
  const g1 = group(t('sLang'),
    row(t('sLang'), seg<Lang>([{ label: 'РУССКИЙ', v: 'ru' }, { label: 'ENGLISH', v: 'en' }], getLang(), (v) => { s.lang = v; setLang(v); commit(); ctx.onLang(); })),
  );
  const g2 = group(t('sSound'),
    row(t('sMaster'), wedge(s.master, (v) => set('master', v))),
    row(t('sSfx'), wedge(s.sfx, (v) => set('sfx', v))),
    row(t('sMusic'), wedge(s.music, (v) => set('music', v))),
  );
  const g3 = group(t('sFeel'),
    row(t('sShake'), seg([{ label: t('sShake0'), v: 0 }, { label: t('sShake1'), v: 0.5 }, { label: t('sShake2'), v: 1 }], s.shake <= 0 ? 0 : s.shake < 0.75 ? 0.5 : 1, (v) => set('shake', v))),
    row(t('sHaptics'), onoff('haptics')),
    row(t('sLefty'), onoff('lefty'), t('sLeftyNote')),
    row(t('sAuto'), onoff('autoAim')),
  );
  const g4 = group(t('sPrint'),
    row(t('sQuality'), seg<0 | 1 | 2>([{ label: t('sQ0'), v: 0 }, { label: t('sQ1'), v: 1 }, { label: t('sQ2'), v: 2 }], s.quality, (v) => set('quality', v))),
    withReset ? confirmBox('of-reset', t('sReset'), t('sResetAsk'), t('sResetYes'), () => {
      const keep = { ...api.meta.s.settings }; api.meta.reset(); api.meta.s.settings = keep; commit(); ctx.onLang();
    }) : null,
  );
  return el('div', 'of-settings', g1, g2, g3, g4);
}

/** one mutation, as listed in the pause sheet and the summary */
function mutRow(id: string, stack: number): HTMLElement | null {
  const u = UP_BY_ID[id]; if (!u) return null;
  return el('div', 'of-mut', inkIcon(u.icon, u.rarity), el('span', 'of-mut-b', el('span', 'of-mut-n', tr(u.name)), el('span', 'of-mut-d', tr(u.desc))), u.max > 1 ? el('span', 'of-mut-s', `${roman(stack)}/${roman(u.max)}`) : null);
}
const sheetHead = (title: string, note: string, right?: Kid) => el('header', 'of-sheet-h', mis('h2', 'of-h2', title), el('p', 'of-sheet-note', note), right ? el('div', 'of-sheet-r', right) : null);

// ---------------------------------------------------------------- HUB
function hubScreen(ctx: Ctx): Screen {
  const { api } = ctx; const meta = api.meta; const scope = new Scope();
  let tier = clamp(meta.s.tier || 1, 1, meta.maxTier);
  const bankVal = mis('span', 'of-bank-v', '');
  const bank = el('div', 'of-bank', el('span', 'of-lbl', t('bank')), el('span', 'of-bank-n', icon('ink'), bankVal));
  const tabBtns = new Map<Tab, HTMLButtonElement>();
  const tabs = el('nav', 'of-tabs');
  for (const tb of TABS) { const b = btn('of-tab', [el('span', '', t(tb.key))], () => setTab(tb.id)); tabBtns.set(tb.id, b); tabs.append(b); }
  const brand = el('div', 'of-brand', mis('span', 'of-brand-t', t('logoA')), el('span', 'of-brand-s', icon('reg')));
  const bar = el('div', 'of-bar of-paper', brand, tabs, bank);
  const body = el('div', 'of-hub-body');
  const root = el('div', 'of-screen of-hub', body, bar);
  let shownInk = -1;
  const renderBank = (bump = false) => { if (meta.ink !== shownInk) { shownInk = meta.ink; setMis(bankVal, fmtInt(meta.ink)); if (bump) kick(bank, 'is-bump'); } };

  function setTab(tb: Tab, silent = false) {
    hubTab = tb; for (const [id, b] of tabBtns) b.classList.toggle('is-on', id === tb);
    root.dataset.tab = tb; body.textContent = '';
    body.append(tb === 'home' ? home() : sheet(tb));
    if (!silent) emit('uiOpen', { screen: tb });
  }

  // ---- home: logo, tier wedge, start, daily, next goal
  function home(): HTMLElement {
    const logo = el('div', 'of-logo'); const word = t('logoA');
    logo.append(el('span', 'l3', word), el('span', 'l2', word), el('span', 'l1', word)); logo.setAttribute('aria-label', word);
    const logoBox = el('div', 'of-logo-box', logo, el('div', 'of-logo-sub', el('b', '', '/ ' + t('logoB')), el('span', '', t('tagline'))), el('span', 'of-logo-spec', `${t('proofCopy')} · 3+0 · ${t('notForSale')}`));

    const tierName = el('span', 'of-tier-cur'); const mods = el('div', 'of-mods'); const startSub = el('span', 'of-start-s');
    const tierBtns: HTMLButtonElement[] = [];
    const paintTier = () => {
      tierBtns.forEach((b, i) => b.classList.toggle('is-on', i + 1 === tier));
      setText(tierName, `${t('tier')} ${roman(tier)}`); setText(startSub, `${t('tier')} ${roman(tier)}`);
      mods.textContent = '';
      if (tier === 1) mods.append(el('span', 'is-cur', tr(TIER_MODS[0])));
      else for (let i = 1; i < tier; i++) mods.append(el('span', i === tier - 1 ? 'is-cur' : '', el('i', '', roman(i + 1)), tr(TIER_MODS[i] ?? TIER_MODS[0])));
      mods.dataset.n = String(Math.max(0, tier - 2));
    };
    const wedgeRow = el('div', 'of-tiers');
    for (let i = 1; i <= TIER_MAX; i++) {
      const open = i <= meta.maxTier;
      const b = btn('of-tier' + (open ? '' : ' is-locked'), [el('span', 'of-tier-sw'), el('span', 'of-tier-n', roman(i)), open ? null : icon('lock')], () => {
        if (!open) { emit('uiDeny', {}); kick(b, 'is-deny'); setText(tierName, `${t('tierLocked')} ${roman(i - 1)}`); return; }
        tier = i; meta.s.tier = i; meta.save(); paintTier(); kick(b, 'is-hit');
      }, { title: `${t('tier')} ${roman(i)}` });
      b.style.setProperty('--d', String(i / TIER_MAX)); tierBtns.push(b); wedgeRow.append(b);
    }
    const tierBox = el('div', 'of-tierbox', el('div', 'of-tier-h', el('span', 'of-lbl', t('tierPick')), tierName), wedgeRow, mods);
    const start = btn('of-start', [mis('span', 'of-start-t', t('start')), startSub, icon('reg')], () => api.startRun({ tier, daily: false }), { sound: 'stamp' });
    paintTier();

    const d = meta.s.daily;
    const daily = el('div', 'of-daily of-paper of-crop',
      el('div', 'of-daily-h', el('span', 'of-lbl', t('dailySheet')), el('span', 'of-lbl is-dim', `${t('seed')} ${d.day}`)),
      el('div', 'of-daily-m',
        el('span', 'of-stampmark' + (d.done ? ' is-done' : ''), d.done ? t('dailyDone') : t('dailyOpen')),
        el('span', 'of-streak', el('span', 'of-lbl', t('streak')), el('b', '', String(d.streak)), pips(Math.min(7, d.streak), 7))),
      el('p', 'of-daily-note', t('dailyNote')),
      btn('of-btn-solid of-daily-go', [d.done ? t('dailyAgain') : t('dailyGo')], () => api.startRun({ tier, daily: true }), { sound: 'stamp' }),
    );
    const g = meta.nextGoal(); let goal: HTMLElement;
    if (g) {
      const have = Math.min(meta.ink, g.cost); const ok = meta.ink >= g.cost; const fill = el('i'); fill.style.transform = `scaleX(${g.cost > 0 ? have / g.cost : 1})`;
      const isForm = FORMS.some((f) => f.name === g.name);
      goal = btn('of-goal of-paper' + (ok ? ' is-ok' : ''), [
        el('span', 'of-goal-h', el('span', 'of-lbl', t('nextGoal')), el('span', 'of-lbl ' + (ok ? 'is-ok' : 'is-dim'), ok ? t('goalReady') : `${t('goalMore')} ${fmtInt(g.cost - meta.ink)}`)),
        el('span', 'of-goal-m', el('b', '', tr(g.name)), price(g.cost)),
        el('span', 'of-meter', fill),
      ], () => setTab(isForm ? 'forms' : 'catalog'));
    } else goal = el('div', 'of-goal of-paper', el('span', 'of-lbl', t('nextGoal')), el('p', 'of-daily-note', t('goalNone')));
    const st = meta.s.stats;
    const stats = el('div', 'of-statline', el('span', '', `${t('runs')} ${st.runs}`), el('span', '', `${t('wins')} ${st.wins}`), el('span', '', `${t('bestSheet')} ${pad2(st.bestRoom)}`));
    return el('div', 'of-home', el('div', 'of-home-sheet of-paper', logoBox, tierBox, start), el('div', 'of-home-side', daily, goal, stats));
  }

  // ---- tab sheets
  function sheet(tb: Tab): HTMLElement {
    let head: HTMLElement; let content: HTMLElement;
    if (tb === 'forms') { head = sheetHead(t('tabForms'), t('formsNote')); content = el('div', 'of-forms'); fillForms(content); }
    else if (tb === 'catalog') {
      const cnt = el('span', 'of-count'); head = sheetHead(t('tabCatalog'), t('catNote'), cnt); content = el('div', 'of-cat'); fillCatalog(content, cnt);
    } else if (tb === 'proofs') {
      head = sheetHead(t('tabProofs'), t('proofsNote'), el('span', 'of-count', `${t('pulledN')} ${pad2(meta.s.proofs.length)}/${pad2(PROOFS.length)}`));
      content = el('div', 'of-proofs'); for (const p of PROOFS) content.append(proofCell(p.id));
    } else { head = sheetHead(t('tabSettings'), ''); content = settingsPanel(ctx, true); }
    return el('div', 'of-sheet of-paper of-crop is-' + tb, head, scroller('', content));
  }
  function fillForms(host: HTMLElement) {
    host.textContent = '';
    const branches: { id: Form['branch']; name: StrKey; note: StrKey }[] = [{ id: 'jump', name: 'brJump', note: 'brJumpNote' }, { id: 'press', name: 'brPress', note: 'brPressNote' }, { id: 'paper', name: 'brPaper', note: 'brPaperNote' }];
    for (const br of branches) {
      const sec = el('section', 'of-branch br-' + br.id, el('header', 'of-branch-h', el('i', 'of-branch-sw'), el('h3', 'of-h3', t(br.name)), el('span', 'of-lbl is-dim', t(br.note))));
      for (const f of FORMS) if (f.branch === br.id) {
        const lvl = meta.formLevel(f.id); const cost = meta.formCost(f.id); const maxed = cost < 0; const poor = !maxed && meta.ink < cost;
        const rowEl = el('div', 'of-form' + (maxed ? ' is-max' : '') + (poor ? ' is-poor' : ''));
        const buy = maxed ? el('span', 'of-buy is-max', t('max')) : btn('of-buy', [price(cost)], () => {
          if (meta.buyForm(f.id)) { const sc = host.closest('.of-scroll'); const y = sc ? sc.scrollTop : 0; fillForms(host); if (sc) sc.scrollTop = y; renderBank(true); const again = host.querySelector(`[data-id="${f.id}"]`) as HTMLElement | null; if (again) kick(again, 'is-bought'); }
          else kick(rowEl, 'is-deny');
        }, { sound: 'none', title: `${t('buy')} ${tr(f.name)}` });
        rowEl.dataset.id = f.id;
        rowEl.append(inkIcon(f.icon, 1), el('span', 'of-form-b', el('span', 'of-form-n', tr(f.name)), el('span', 'of-form-d', tr(f.desc))), pips(lvl, f.max, 'of-form-lv'), buy);
        sec.append(rowEl);
      }
      host.append(sec);
    }
  }
  function fillCatalog(host: HTMLElement, cnt: HTMLElement) {
    host.textContent = '';
    const open = UPGRADES.filter((u) => !u.locked || meta.isUnlocked(u.id)).length;
    setText(cnt, `${t('opened')} ${pad2(open)}/${pad2(UPGRADES.length)}`);
    let tag = ''; let grid: HTMLElement | null = null;
    for (const u of UPGRADES) {
      if (u.tag !== tag || !grid) { tag = u.tag; grid = el('div', 'of-cat-g'); host.append(el('section', 'of-cat-s', el('h3', 'of-h3', tagName(u.tag)), grid)); }
      grid.append(catCell(u, host, cnt));
    }
  }
  function catCell(u: Upgrade, host: HTMLElement, cnt: HTMLElement): HTMLElement {
    const locked = !!u.locked && !meta.isUnlocked(u.id); const cost = u.unlockCost ?? 0;
    const c = el('div', `of-up r${u.rarity}` + (locked ? ' is-locked' : ''));
    c.dataset.id = u.id;
    c.append(
      el('span', 'of-up-art', inkIcon(u.icon, u.rarity), locked ? el('span', 'of-up-lock', icon('lock')) : null),
      el('span', 'of-up-b',
        el('span', 'of-up-n', tr(u.name)),
        el('span', 'of-up-d', tr(u.desc)),
        el('span', 'of-up-m', swatches(u.rarity), u.max > 1 ? el('span', 'of-lbl is-dim', `${t('stackUpTo')} ${roman(u.max)}`) : null)),
    );
    if (locked) c.append(btn('of-buy' + (meta.ink < cost ? ' is-poor' : ''), [el('span', 'of-lbl', t('unlock')), price(cost)], () => {
      if (meta.buyUnlock(u.id)) { const sc = host.closest('.of-scroll'); const y = sc ? sc.scrollTop : 0; fillCatalog(host, cnt); if (sc) sc.scrollTop = y; renderBank(true); const again = host.querySelector(`[data-id="${u.id}"]`) as HTMLElement | null; if (again) kick(again, 'is-bought'); }
      else kick(c, 'is-deny');
    }, { sound: 'none', title: `${t('unlock')} ${tr(u.name)}` }));
    return c;
  }
  function proofCell(id: string): HTMLElement {
    const p = PROOFS.find((x) => x.id === id)!; const got = meta.s.proofs.includes(id); const n = got ? p.goal : meta.proofProgress(p);
    const fill = el('i'); fill.style.transform = `scaleX(${p.goal > 0 ? n / p.goal : 0})`;
    return el('div', 'of-proof' + (got ? ' is-got' : ''),
      el('span', 'of-proof-seal', got ? icon('check') : el('b', '', Math.floor((n / Math.max(1, p.goal)) * 100) + '%')),
      el('span', 'of-proof-b', el('span', 'of-proof-n', tr(p.name)), el('span', 'of-proof-d', tr(p.desc)), el('span', 'of-proof-p', el('span', 'of-meter', fill), el('span', 'of-lbl', `${fmtInt(n)}/${fmtInt(p.goal)}`))),
      el('span', 'of-proof-r', got ? el('span', 'of-stampmark is-done', t('pulled')) : price(p.reward)));
  }

  setTab(hubTab, true); renderBank();
  emit('uiOpen', { screen: 'hub' });
  return { el: root, update() { renderBank(true); }, dispose() { scope.dispose(); } };
}

// ---------------------------------------------------------------- OFFER
function offerScreen(ctx: Ctx): Screen {
  const { api } = ctx; const scope = new Scope();
  const sig = el('span', 'of-lbl'); const cards = el('div', 'of-cards'); const foot = el('div', 'of-offer-f');
  const root = el('div', 'of-screen of-offer', el('div', 'of-veil'),
    el('div', 'of-offer-in',
      el('header', 'of-offer-h', sig, mis('h2', 'of-h1', t('offerTitle')), el('p', 'of-sheet-note', t('offerSub'))),
      cards, foot));
  let ids = ''; let rerolls = -1; let picked = false; let opts: OfferOption[] = []; const cardEls: HTMLButtonElement[] = [];

  function pick(i: number) {
    if (picked || !opts[i]) return; picked = true; const o = opts[i];
    cardEls.forEach((c, j) => c.classList.add(j === i ? 'is-picked' : 'is-passed'));
    emit('uiStamp', {});
    scope.timeout(() => api.pickUpgrade(o.id), 230);
  }
  function card(o: OfferOption, i: number): HTMLButtonElement {
    const b = btn(`of-card of-paper r${o.rarity}`, [
      el('span', 'of-card-h', el('span', 'of-lbl', '№ ' + (i + 1)), el('span', 'of-lbl is-dim', tagName(o.tag)), swatches(o.rarity)),
      el('span', 'of-card-art', inkIcon(o.icon, o.rarity), o.rarity === 3 ? el('span', 'of-seal', t('r3stamp')) : null),
      el('span', 'of-card-b', el('span', 'of-card-n', tr(o.name)), el('span', 'of-card-d', tr(o.desc))),
      el('span', 'of-card-f', el('span', 'of-lbl', t(o.rarity === 3 ? 'r3' : o.rarity === 2 ? 'r2' : 'r1')), o.max > 1 ? el('span', 'of-card-st', `${roman(o.stack + 1)}/${roman(o.max)}`) : null),
      o.isNew ? el('span', 'of-flag', t('isNew')) : null,
      el('span', 'of-card-pick', t('take')),
    ], () => pick(i), { sound: 'none', title: tr(o.name) });
    b.style.setProperty('--i', String(i)); return b;
  }
  function render() {
    const st = api.offer(); if (!st) return;
    opts = st.options; rerolls = st.rerolls; ids = opts.map((o) => o.id).join('|'); picked = false;
    setText(sig, `${t('sheet')} ${pad2(st.room)}/${pad2(st.rooms)} · ${t('sheetOk')}`);
    cards.textContent = ''; cardEls.length = 0; cards.dataset.n = String(opts.length);
    opts.forEach((o, i) => { const c = card(o, i); cardEls.push(c); cards.append(c); });
    foot.textContent = '';
    foot.append(st.rerolls > 0
      ? btn('of-btn-line of-reroll', [icon('reroll'), el('span', '', t('reroll')), el('b', '', '×' + st.rerolls)], () => { if (picked) return; api.reroll(); render(); kick(cards, 'is-reroll'); })
      : el('span', 'of-lbl is-dim of-reroll-none', t('rerollNone')));
  }
  render(); emit('uiOpen', { screen: 'offer' });
  scope.bus('upgradeOffer', render);
  scope.on(window, 'keydown', (e) => { const k = e.code; if (k === 'Digit1' || k === 'Numpad1') pick(0); else if (k === 'Digit2' || k === 'Numpad2') pick(1); else if (k === 'Digit3' || k === 'Numpad3') pick(2); });
  return {
    el: root,
    update() { // the core may swap the offer under us (reroll resolved a frame later)
      if (picked) return; const st = api.offer(); if (!st) return;
      if (st.rerolls !== rerolls || st.options.length !== opts.length) { render(); return; }
      for (let i = 0; i < st.options.length; i++) if (st.options[i].id !== opts[i].id) { render(); return; }
    },
    dispose() { scope.dispose(); },
  };
}

// ---------------------------------------------------------------- PAUSE
function pauseScreen(ctx: Ctx): Screen {
  const { api } = ctx; const scope = new Scope(); const h = api.hud();
  const main = el('div', 'of-pause-main');
  const sheet = el('div', 'of-pause-sheet of-paper of-crop', main);
  const root = el('div', 'of-screen of-pause', el('div', 'of-veil'), sheet);
  function showMain() {
    main.textContent = ''; sheet.classList.remove('is-settings');
    const muts = api.runMutations(); const list = el('div', 'of-muts');
    for (const m of muts) { const r = mutRow(m.id, m.stack); if (r) list.append(r); }
    if (!list.childElementCount) list.append(el('p', 'of-daily-note', t('noMuts')));
    main.append(
      el('div', 'of-pause-l',
        el('span', 'of-lbl', `${t('sheet')} ${pad2(h.room)}/${pad2(h.rooms)} · ${h.daily ? t('daily') : t('tier') + ' ' + roman(h.tier)} · ${fmtTime(h.time)}`),
        mis('h2', 'of-h1', t('pauseTitle')), el('p', 'of-sheet-note', t('pauseSub')),
        el('div', 'of-pause-btns',
          btn('of-btn-solid of-resume', [t('resume'), icon('reg')], () => api.pause(false)),
          btn('of-btn-line', [t('tabSettings')], showSettings),
          confirmBox('of-abandon', t('abandon'), t('abandonAsk'), t('abandonYes'), () => api.abandonRun()))),
      el('div', 'of-pause-r', el('div', 'of-pause-rh', el('h3', 'of-h3', t('runMuts')), el('span', 'of-count', pad2(muts.length))), scroller('', list)),
    );
  }
  function showSettings() {
    main.textContent = ''; sheet.classList.add('is-settings');
    main.append(el('div', 'of-pause-sh', mis('h2', 'of-h2', t('tabSettings')), btn('of-btn-line', [t('back')], showMain)), scroller('', settingsPanel(ctx, false)));
  }
  if (pauseView === 'settings') showSettings(); else showMain();
  pauseView = 'main';
  emit('uiOpen', { screen: 'pause' });
  return { el: root, dispose() { scope.dispose(); } };
}
let pauseView: 'main' | 'settings' = 'main';

// ---------------------------------------------------------------- SUMMARY
function summaryScreen(ctx: Ctx): Screen {
  const { api } = ctx; const scope = new Scope(); const meta = api.meta;
  const s: Summary = api.summary() ?? { won: false, room: 0, rooms: 0, time: 0, tier: 1, daily: false, kills: 0, killsByCause: {}, bestCombo: 0, chunks: 0, jumps: 0, inkLines: [], inkTotal: 0, newProofs: [], unlockedTier: 0, mutations: [], streak: 0 };
  // ledger
  const lines = s.inkLines.map((l) => { const v = el('b', '', '0'); const r = el('div', 'of-led-l', el('span', '', tr(l.label)), el('i'), v); return { row: r, val: v, amount: l.amount, shown: false }; });
  const totalV = mis('b', 'of-total-v', '0'); const total = el('div', 'of-total', el('span', 'of-lbl', t('total')), el('span', 'of-total-n', icon('ink'), totalV));
  const ledger = el('section', 'of-led', el('h3', 'of-h3', t('ledger')), el('div', 'of-led-ls', ...lines.map((l) => l.row)), total);
  // bank + next goal teaser: the reason to press "again"
  const g = meta.nextGoal(); let teaser: HTMLElement | null = null;
  if (g) { const ok = meta.ink >= g.cost; const fill = el('i'); fill.style.transform = `scaleX(${g.cost > 0 ? Math.min(1, meta.ink / g.cost) : 1})`;
    teaser = el('div', 'of-teaser' + (ok ? ' is-ok' : ''),
      el('span', 'of-goal-h', el('span', 'of-lbl', `${t('bank')} ${fmtInt(meta.ink)}`), el('span', 'of-lbl ' + (ok ? 'is-ok' : 'is-dim'), ok ? t('goalReady') : `${t('goalMore')} ${fmtInt(g.cost - meta.ink)}`)),
      el('span', 'of-goal-m', el('b', '', tr(g.name)), price(g.cost)), el('span', 'of-meter', fill)); }
  // report
  const causes = Object.entries(s.killsByCause).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).slice(0, 6); const top = causes.length ? causes[0][1] : 1;
  const bars = el('div', 'of-bars');
  for (const [c, n] of causes) { const f = el('i'); f.style.transform = `scaleX(${n / top})`; bars.append(el('div', 'of-bar-r', el('span', 'of-lbl', tDyn('c_', c)), el('span', 'of-bar-t', f), el('b', '', String(n)))); }
  const fig = (label: string, v: string) => el('div', 'of-fig', el('b', '', v), el('span', 'of-lbl', label));
  const report = el('section', 'of-rep', el('h3', 'of-h3', t('report')),
    el('div', 'of-figs', fig(t('retired'), String(s.kills)), fig(t('bestCombo'), '×' + s.bestCombo), fig(t('chunks'), fmtInt(s.chunks)), fig(t('jumps'), fmtInt(s.jumps))),
    causes.length ? bars : null);
  // rewards
  const marks = el('div', 'of-marks');
  if (s.unlockedTier > 0) marks.append(el('div', 'of-mark is-tier', el('span', 'of-lbl', t('tierOpen')), el('b', '', roman(s.unlockedTier))));
  if (s.daily && s.streak > 0) marks.append(el('div', 'of-mark is-streak', el('span', 'of-lbl', t('dailyStreak')), el('b', '', String(s.streak)), pips(Math.min(7, s.streak), 7)));
  for (const p of s.newProofs) marks.append(el('div', 'of-mark is-proof', icon('check'), el('span', 'of-mark-b', el('span', 'of-lbl', t('proofToast')), el('span', 'of-mark-n', tr(p.name))), price(p.reward)));
  const mutsBox = el('div', 'of-sum-muts'); for (const m of s.mutations) { const u = UP_BY_ID[m.id]; if (u) { const c = inkIcon(u.icon, u.rarity); c.title = tr(u.name); mutsBox.append(c); } }

  const again = () => api.startRun({ tier: s.tier, daily: s.daily });
  const btns = el('div', 'of-sum-btns',
    btn('of-start of-again', [mis('span', 'of-start-t', t('again')), el('span', 'of-start-s', s.daily ? t('dailySheet') : `${t('tier')} ${roman(s.tier)}`), icon('reg')], again, { sound: 'stamp' }),
    s.unlockedTier > 0 && !s.daily ? btn('of-btn-solid of-next-tier', [`${t('againUp')} ${roman(s.unlockedTier)}`], () => { meta.s.tier = s.unlockedTier; meta.save(); api.startRun({ tier: s.unlockedTier, daily: false }); }, { sound: 'stamp' }) : null,
    btn('of-btn-line of-tohub', [t('toHub')], () => api.toHub()));
  const stamp = el('div', 'of-verdict', mis('h1', 'of-verdict-t', t(s.won ? 'won' : 'lost')));
  const head = el('header', 'of-sum-h', stamp,
    el('p', 'of-sum-sig', `${s.won ? t('wonSub') : t('lostSub') + ' ' + pad2(s.room) + '/' + pad2(s.rooms)} · ${t('time')} ${fmtTime(s.time)} · ${s.daily ? t('dailySheet') : t('tier') + ' ' + roman(s.tier)}`),
    mutsBox.childElementCount ? mutsBox : null);
  const sheet = el('div', 'of-sum-sheet of-paper of-crop', head,
    scroller('of-sum-body', el('div', 'of-sum-cols', el('div', 'of-sum-a', ledger, teaser), el('div', 'of-sum-b', report, marks.childElementCount ? marks : null))),
    btns);
  const root = el('div', 'of-screen of-sum ' + (s.won ? 'is-won' : 'is-lost'), el('div', 'of-veil'), sheet);

  // counting: one ledger line every ~0.3 s, then the total lands as a stamp. Any tap skips it.
  let tt = 0; let done = false; const STEP = 0.3, LEAD = 0.45; const tEnd = LEAD + lines.length * STEP + 0.75;
  const finish = () => { tt = tEnd + 1; };
  root.addEventListener('pointerdown', () => { if (!done) finish(); });
  emit('uiOpen', { screen: 'summary' }); emit('uiStamp', {});
  return {
    el: root,
    update(_h, dt) {
      if (done) return; tt += dt;
      for (let i = 0; i < lines.length; i++) {
        const l = lines[i]; const k = (tt - LEAD - i * STEP) / 0.26; if (k <= 0) continue;
        if (!l.shown) { l.shown = true; l.row.classList.add('is-on'); if (tt < tEnd) emit('uiClick', {}); }
        setText(l.val, (l.amount >= 0 ? '+' : '−') + fmtInt(Math.abs(l.amount) * clamp(k, 0, 1)));
      }
      const kt = (tt - LEAD - lines.length * STEP - 0.1) / 0.5;
      if (kt > 0) { total.classList.add('is-on'); setMis(totalV, fmtInt(s.inkTotal * clamp(kt, 0, 1))); }
      if (kt >= 1) { done = true; kick(total, 'is-hit'); sheet.classList.add('is-done'); emit('uiStamp', {}); }
    },
    dispose() { scope.dispose(); },
  };
}

// ---------------------------------------------------------------- manager
export function createScreens(root: HTMLElement, api: UiApi, onLang: () => void): Screens {
  const layer = el('div', 'of-screens'); root.append(layer);
  let cur: Screen | null = null; let key = '';
  const ctx: Ctx = { api, onLang };
  const want = (h: HudState) => (h.mode === 'hub' ? 'hub' : h.mode === 'offer' ? 'offer' : h.mode === 'summary' ? 'summary' : h.mode === 'run' && h.paused ? 'pause' : '');
  function open(k: string) {
    if (cur) { cur.dispose(); cur.el.remove(); cur = null; }
    key = k;
    cur = k === 'hub' ? hubScreen(ctx) : k === 'offer' ? offerScreen(ctx) : k === 'summary' ? summaryScreen(ctx) : k === 'pause' ? pauseScreen(ctx) : null;
    if (cur) layer.append(cur.el);
    else if (document.activeElement instanceof HTMLElement && root.contains(document.activeElement)) document.activeElement.blur();
  }
  return {
    sync(h, dt) { const k = want(h); if (k !== key) open(k); if (cur && cur.update) cur.update(h, dt); },
    rebuild() { if (key === 'pause') pauseView = 'settings'; const k = key; key = '\u0000'; open(k); },
    destroy() { if (cur) { cur.dispose(); cur.el.remove(); cur = null; } layer.remove(); },
  };
}
