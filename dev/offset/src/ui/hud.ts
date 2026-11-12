// In-run HUD: the "slug" of the press sheet. Colour control strip = durability, registration crosses = jump charges,
// signature line = sheet / objective. Polls HudState every frame and touches the DOM only where a value changed.
import type { UiApi, HudState } from './api';
import { tr } from '../core/i18n';
import { PROOFS } from '../meta/meta';
import { el, icon, setText, setMis, mis, kick, Scope, emit } from './icons';
import { t, tDyn, roman, pad2, fmtTime, fmtInt } from './strings';

const CROSS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path class="x" d="M12 .5v23M.5 12h23"/><circle class="b" cx="12" cy="12" r="7.2"/><circle class="d" cx="12" cy="12" r="7.2"/><path class="k" d="M12 7v10M7 12h10"/><circle class="p" cx="12" cy="12" r="7.2" pathLength="100" transform="rotate(-90 12 12)"/></svg>';

export interface Hud { el: HTMLElement; update(h: HudState, dt: number): void; relabel(): void; destroy(): void }

export function createHud(root: HTMLElement, api: UiApi): Hud {
  const scope = new Scope();
  // ---------------------------------------------------------------- build
  const hpLabel = el('span', 'of-lbl');
  const hpRow = el('div', 'of-pts');
  const hpBox = el('div', 'of-hp', hpLabel, hpRow);
  const chRow = el('div', 'of-crs');
  const focusFill = el('i');
  const jamTag = el('span', 'of-jam');
  const chBox = el('div', 'of-ch', chRow, el('div', 'of-focus', focusFill), jamTag);
  const sigA = el('span', 'of-sig-a'); const sigB = el('span', 'of-sig-b');
  const objText = el('span', 'of-obj-t'); const objCount = el('span', 'of-obj-n'); const objFill = el('i'); const objWaves = el('span', 'of-obj-w');
  const center = el('div', 'of-slug-c', el('div', 'of-sig', sigA, sigB), el('div', 'of-obj', objText, objCount, el('span', 'of-obj-bar', objFill), objWaves));
  const inkLabel = el('span', 'of-lbl'); const inkVal = mis('span', 'of-ink-v', '0');
  const inkBox = el('div', 'of-inkbox', inkLabel, inkVal);
  const pauseBtn = el('button', 'of-pausebtn', icon('pause')); pauseBtn.type = 'button';
  const slug = el('div', 'of-slug of-paper', el('div', 'of-slug-l', hpBox, chBox), center, el('div', 'of-slug-r', inkBox, pauseBtn));

  const bossName = el('span', 'of-boss-n'); const bossPips = el('span', 'of-boss-p'); const bossFill = el('i', 'f'); const bossLag = el('i', 'g');
  const boss = el('div', 'of-boss', el('div', 'of-boss-h', bossName, bossPips), el('div', 'of-boss-bar', bossLag, bossFill));

  const comboN = mis('span', 'of-combo-n', '');
  const comboLbl = el('span', 'of-combo-l'); const comboMult = el('span', 'of-combo-m'); const comboFill = el('i');
  const combo = el('div', 'of-combo', comboN, el('div', 'of-combo-meta', comboLbl, comboMult, el('span', 'of-combo-bar', comboFill)));

  const note = el('div', 'of-note');
  const hintText = el('span'); const hint = el('div', 'of-hint of-paper', icon('reg'), hintText);

  const actLabel = el('span', 'of-act-l'); const act = el('button', 'of-act', actLabel); act.type = 'button';
  const heavyLabel = el('span', 'of-heavy-l'); const heavyCost = el('span', 'of-heavy-c');
  const heavy = el('button', 'of-heavy', heavyLabel, heavyCost); heavy.type = 'button';
  const touch = el('div', 'of-touch', heavy, act);

  const cardNo = mis('span', 'of-title-no', ''); const cardOf = el('span', 'of-title-of'); const cardLbl = el('span', 'of-title-lbl');
  const cardName = el('span', 'of-title-name'); const cardSub = el('span', 'of-title-sub');
  const card = el('div', 'of-title of-paper', el('div', 'of-title-in', el('div', 'of-title-l', cardLbl, cardNo, cardOf), el('div', 'of-title-r', cardName, cardSub)));

  const clearT = el('span', 'of-clear-t'); const clearS = el('span', 'of-clear-s');
  const clear = el('div', 'of-clear', el('div', 'of-clear-in', clearT, clearS));
  const wave = el('div', 'of-wave');
  const toasts = el('div', 'of-toasts');
  const smear = el('div', 'of-smear', el('i', 't'), el('i', 'b'), el('i', 'l'), el('i', 'r'));

  const hud = el('div', 'of-hud is-off', smear, slug, boss, combo, note, wave, card, clear, hint, touch, toasts);
  root.append(hud);

  // ---------------------------------------------------------------- touch controls (must never leak to the canvas)
  const eat = (e: Event) => { e.stopPropagation(); e.preventDefault(); };
  let actPtr = -1;
  act.addEventListener('pointerdown', (e) => {
    eat(e); if (actPtr >= 0) return; actPtr = e.pointerId;
    try { act.setPointerCapture(e.pointerId); } catch { /* synthetic pointer */ }
    act.classList.add('is-down'); api.actionDown();
  });
  const actEnd = (e: PointerEvent) => { eat(e); if (e.pointerId !== actPtr) return; actPtr = -1; act.classList.remove('is-down'); api.actionUp(); };
  act.addEventListener('pointerup', actEnd); act.addEventListener('pointercancel', actEnd);
  act.addEventListener('lostpointercapture', (e) => { if (e.pointerId === actPtr) { actPtr = -1; act.classList.remove('is-down'); api.actionUp(); } });
  heavy.addEventListener('pointerdown', (e) => { eat(e); kick(heavy, 'is-tap'); api.heavyTap(); });
  pauseBtn.addEventListener('pointerdown', (e) => { eat(e); pauseBtn.blur(); emit('uiClick', {}); api.pause(true); });
  for (const b of [act, heavy, pauseBtn]) {
    b.addEventListener('pointermove', eat); b.addEventListener('click', eat); b.addEventListener('contextmenu', eat);
    b.tabIndex = -1; // gameplay keys must never "click" a focused HUD button
  }
  const releaseAction = () => { if (actPtr >= 0) { actPtr = -1; act.classList.remove('is-down'); api.actionUp(); } };

  // ---------------------------------------------------------------- timed marks (driven by real frame time, so they also run in slow-mo)
  const timers = new Map<HTMLElement, number>();
  const show = (e: HTMLElement, sec: number) => { e.classList.remove('is-out'); kick(e, 'is-on'); timers.set(e, sec); };
  const hide = (e: HTMLElement) => { if (e.classList.contains('is-on')) { e.classList.remove('is-on'); e.classList.add('is-out'); } timers.delete(e); };

  // ---------------------------------------------------------------- state cache
  let pts: HTMLElement[] = []; let crs: { root: HTMLElement; ring: SVGCircleElement }[] = [];
  const P = {
    vis: false, paused: false, hp: -1, maxHp: -1, ch: -1, maxCh: -1, chQ: -1, foQ: -1, low: false,
    armed: false, hCost: -1, canHeavy: true, action: '', combo: 0, mult: -1, coQ: -1, ink: -1,
    room: -1, rooms: -1, biome: '', tier: -1, daily: false, timeS: -1, objT: '', objN: '', objQ: -1, wave: -1, waves: -1,
    bossOn: false, bossN: '', bossQ: -1, bossPh: -1, touch: false, jam: false, hint: '', lefty: false, lang: '',
  };
  let lastHud: HudState | null = null;

  function buildPts(n: number) {
    hpRow.textContent = ''; pts = [];
    for (let i = 0; i < n; i++) { const p = el('i', 'of-pt c' + (i % 6)); pts.push(p); hpRow.append(p); }
    hpRow.classList.toggle('is-many', n > 8);
  }
  function buildCrs(n: number) {
    chRow.textContent = ''; crs = [];
    for (let i = 0; i < n; i++) {
      const c = el('span', 'of-cr'); c.innerHTML = CROSS; // static markup
      crs.push({ root: c, ring: c.querySelector('.p') as SVGCircleElement }); chRow.append(c);
    }
    chRow.classList.toggle('is-many', n > 5);
  }
  function relabel() {
    hpLabel.textContent = t('durability'); inkLabel.textContent = t('ink'); comboLbl.textContent = t('combo');
    heavyLabel.textContent = t('heavy'); jamTag.textContent = t('anchor').split(':')[0]; cardLbl.textContent = t('sheet');
    pauseBtn.setAttribute('aria-label', t('pause'));
    P.lang = ''; P.action = ''; P.room = -1; P.objT = '\u0000'; P.bossN = '\u0000'; P.hint = '\u0000'; P.mult = -1; P.wave = -1;
  }
  relabel();

  // ---------------------------------------------------------------- per-frame diff
  function update(h: HudState, dt: number) {
    lastHud = h;
    const vis = h.mode === 'run';
    if (vis !== P.vis) {
      P.vis = vis; hud.classList.toggle('is-off', !vis);
      if (!vis) { releaseAction(); hide(card); hide(clear); hide(wave); hide(note); }
    }
    // timed marks keep ticking even when hidden so nothing is left hanging
    if (timers.size) for (const [e, left] of timers) { const v = left - dt; if (v <= 0) hide(e); else timers.set(e, v); }
    if (toastList.length) for (let i = toastList.length - 1; i >= 0; i--) { const o = toastList[i]; o.t -= dt; if (o.t <= 0) { o.el.remove(); toastList.splice(i, 1); } else if (o.t < 0.14 && !o.out) { o.out = true; o.el.classList.add('is-out'); } }
    if (!vis) return;
    if (h.paused !== P.paused) { P.paused = h.paused; hud.classList.toggle('is-paused', h.paused); if (h.paused) releaseAction(); }
    const lefty = api.meta.s.settings.lefty;
    if (lefty !== P.lefty) { P.lefty = lefty; hud.classList.toggle('is-lefty', lefty); }

    // durability: colour control strip
    if (h.maxHp !== P.maxHp) { P.maxHp = h.maxHp; buildPts(h.maxHp); P.hp = -1; }
    if (h.hp !== P.hp) {
      const prev = P.hp; P.hp = h.hp;
      for (let i = 0; i < pts.length; i++) {
        const on = i < h.hp; const p = pts[i]; const was = p.classList.contains('is-on');
        if (on === was && prev >= 0) continue;
        p.classList.toggle('is-on', on);
        if (prev >= 0) { p.classList.remove('is-rip', 'is-in'); kick(p, on ? 'is-in' : 'is-rip'); }
      }
      const low = h.hp <= 1 && h.maxHp > 1; if (low !== P.low) { P.low = low; hud.classList.toggle('is-low', low); }
    }
    // charges: registration crosses
    if (h.maxCharges !== P.maxCh) { P.maxCh = h.maxCharges; buildCrs(h.maxCharges); P.ch = -1; P.chQ = -1; }
    if (h.charges !== P.ch) {
      const prev = P.ch; P.ch = h.charges; P.chQ = -1;
      for (let i = 0; i < crs.length; i++) {
        const c = crs[i].root; const full = i < h.charges;
        if (full && !c.classList.contains('is-full') && prev >= 0) kick(c, 'is-in');
        c.classList.toggle('is-full', full); c.classList.toggle('is-next', i === h.charges);
      }
    }
    if (h.charges < crs.length) { const q = Math.round(h.chargeT * 50) * 2; if (q !== P.chQ) { P.chQ = q; crs[h.charges].ring.style.strokeDasharray = q + ' 100'; } }
    const fq = Math.round(h.focus * 60); if (fq !== P.foQ) { P.foQ = fq; focusFill.style.transform = `scaleX(${fq / 60})`; focusFill.classList.toggle('is-lo', fq < 15); }
    if (h.jammed !== P.jam) { P.jam = h.jammed; chBox.classList.toggle('is-jam', h.jammed); }

    // signature + objective
    if (h.room !== P.room || h.rooms !== P.rooms || h.biome !== P.biome) {
      P.room = h.room; P.rooms = h.rooms; P.biome = h.biome;
      setText(sigA, `${t('sheet')} ${pad2(h.room)}/${pad2(h.rooms)} · ${tDyn('b_', h.biome)}`);
    }
    const ts = Math.floor(h.time);
    if (ts !== P.timeS || h.tier !== P.tier || h.daily !== P.daily) {
      P.timeS = ts; P.tier = h.tier; P.daily = h.daily;
      setText(sigB, `${h.daily ? t('daily') : t('tier') + ' ' + roman(h.tier)} · ${fmtTime(ts)}`);
    }
    const ot = tr(h.objective.text); if (ot !== P.objT) { P.objT = ot; setText(objText, ot); }
    if (h.objective.count !== P.objN) { P.objN = h.objective.count; setText(objCount, h.objective.count); }
    const oq = Math.round(h.objective.progress * 100); if (oq !== P.objQ) { P.objQ = oq; objFill.style.transform = `scaleX(${oq / 100})`; }
    if (h.wave !== P.wave || h.waves !== P.waves) {
      P.wave = h.wave; P.waves = h.waves; objWaves.textContent = '';
      if (h.waves > 1) for (let i = 1; i <= h.waves; i++) objWaves.append(el('i', i < h.wave ? 'is-done' : i === h.wave ? 'is-cur' : ''));
    }
    // ink
    if (h.ink !== P.ink) { const up = P.ink >= 0 && h.ink > P.ink; P.ink = h.ink; setMis(inkVal, fmtInt(h.ink)); if (up) kick(inkBox, 'is-bump'); }
    // combo stamp
    if (h.combo !== P.combo) {
      const prev = P.combo; P.combo = h.combo; const on = h.combo >= 2;
      if (on) { setMis(comboN, '×' + h.combo); combo.classList.remove('is-out'); if (h.combo > prev) kick(combo, 'is-hit'); combo.classList.add('is-on'); }
      else if (combo.classList.contains('is-on')) { combo.classList.remove('is-on', 'is-hit'); combo.classList.add('is-out'); }
    }
    if (h.combo >= 2) {
      const mq = Math.round(h.comboMult * 100);
      if (mq !== P.mult) { P.mult = mq; setText(comboMult, `×${(mq / 100).toFixed(mq % 100 === 0 ? 0 : mq % 10 === 0 ? 1 : 2)} ${t('comboInk')}`); }
      const cq = Math.round(h.comboT * 50); if (cq !== P.coQ) { P.coQ = cq; comboFill.style.transform = `scaleX(${cq / 50})`; combo.classList.toggle('is-ending', cq < 12); }
    }
    // boss
    const b = h.boss;
    if (!!b !== P.bossOn) { P.bossOn = !!b; boss.classList.toggle('is-on', !!b); hud.classList.toggle('has-boss', !!b); P.bossQ = -1; P.bossPh = -1; P.bossN = '\u0000'; }
    if (b) {
      const bn = tr(b.name); if (bn !== P.bossN) { P.bossN = bn; setText(bossName, bn); }
      const bq = Math.round(b.hp * 200); if (bq !== P.bossQ) { P.bossQ = bq; const s = `scaleX(${bq / 200})`; bossFill.style.transform = s; bossLag.style.transform = s; }
      if (b.phase !== P.bossPh) { P.bossPh = b.phase; setText(bossPips, `${t('phase')} ${roman(Math.max(1, b.phase))}`); }
    }
    // hint
    const hi = h.hint ? tr(h.hint) : '';
    if (hi !== P.hint) { P.hint = hi; if (hi) { setText(hintText, hi); kick(hint, 'is-on'); } else hint.classList.remove('is-on'); }
    // touch controls
    if (h.touch !== P.touch) { P.touch = h.touch; hud.classList.toggle('is-touch', h.touch); if (!h.touch) releaseAction(); }
    if (h.touch) {
      if (h.action !== P.action) { P.action = h.action; setText(actLabel, t(h.action === 'grab' ? 'actGrab' : h.action === 'throw' ? 'actThrow' : 'actStrike')); act.dataset.a = h.action; kick(actLabel, 'is-swap'); }
      if (h.heavyArmed !== P.armed) { P.armed = h.heavyArmed; heavy.classList.toggle('is-armed', h.heavyArmed); }
      if (h.canHeavy !== P.canHeavy) { P.canHeavy = h.canHeavy; heavy.classList.toggle('is-dim', !h.canHeavy); }
      if (h.heavyCost !== P.hCost) { P.hCost = h.heavyCost; heavyCost.textContent = ''; for (let i = 0; i < h.heavyCost; i++) heavyCost.append(icon('reg')); }
    }
  }

  // ---------------------------------------------------------------- moments
  const toastList: { el: HTMLElement; t: number; out: boolean }[] = [];
  function toast(label: string, text: string, extra: string, glyph = 'check') {
    const e = el('div', 'of-toast of-paper', el('span', 'of-toast-i', icon(glyph)), el('span', 'of-toast-b', el('span', 'of-lbl', label), el('span', 'of-toast-t', text)), extra ? el('span', 'of-toast-x', extra) : null);
    toasts.append(e); toastList.push({ el: e, t: 3.4, out: false });
    while (toastList.length > 3) { const o = toastList.shift()!; o.el.remove(); }
  }
  const say = (text: string, sec = 1.3) => { setText(note, text); show(note, sec); };

  scope.bus('playerHurt', () => { kick(hpBox, 'is-hurt'); kick(smear, 'is-on'); });
  scope.bus('jumpDenied', (p) => {
    kick(chBox, 'is-deny');
    if (p.reason === 'anchor') say(t('anchor'), 1.5); else if (p.reason === 'charges') say(t('noCharge'), 0.7);
  });
  scope.bus('roomStart', (p) => {
    const h = lastHud; const name = p.name || (h ? tr(h.roomName) : '');
    setMis(cardNo, pad2(p.index)); setText(cardOf, '/' + pad2(p.total));
    setText(cardName, name); setText(cardSub, `${tDyn('b_', p.biome)} · ${tDyn('k_', p.kind)}`);
    hide(clear); show(card, 1.6); emit('uiStamp', {});
  });
  scope.bus('roomClear', (p) => {
    setText(clearT, t('sheetOk')); setText(clearS, `${t('time')} ${fmtTime(p.time)}${p.flawless ? ' · ' + t('flawless') : ''}`);
    clear.classList.toggle('is-flawless', p.flawless); hide(card); show(clear, 1.9); emit('uiStamp', {});
  });
  scope.bus('waveStart', (p) => { if (p.total > 1 && p.n > 1) { setText(wave, `${t('pass')} ${p.n}/${p.total}`); show(wave, 1.2); } });
  scope.bus('achievement', (p) => { const pr = PROOFS.find((x) => x.id === p.id); toast(t('proofToast'), pr ? tr(pr.name) : p.id, pr ? '+' + pr.reward : ''); });
  scope.bus('bossPhase', (p) => { kick(boss, 'is-phase'); say(`${t('phase')} ${roman(Math.max(1, p.phase))}`, 1.1); });
  scope.bus('pickup', (p) => { if (p.kind === 'hp') kick(hpBox, 'is-heal'); else if (p.kind === 'charge') kick(chBox, 'is-gain'); else kick(inkBox, 'is-bump'); });
  scope.on(window, 'blur', releaseAction);

  return { el: hud, update, relabel, destroy() { scope.dispose(); releaseAction(); hud.remove(); } };
}
