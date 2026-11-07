// DESIGN §15 extras: the bell (ring to scare the bear, the fox comes to the noise) and the coal cart on the mine rails (push it; on the grade it runs
// away to the west, down the decline, and crashes). Beach barrels and the fox den are ordinary frozen containers (chest looks) placed by stationobjects.ts.
import { G, toast, type Fixture } from './state';
import { emit } from './bus';
import { strings, fmt } from '../content/i18n';
import { TS } from '../engine/grid';
import { spawnDrop } from './inventory';
import { damage } from './player';
import { bridge } from './stationbridge';
import { LOC } from './locations';
import { cen, dd, num, playerDist, clamp } from './stationkit';
import { hintTip } from './fixtures_station';
import { addShake } from '../engine/camera';
import { burstFx } from '../engine/particles';

const S = strings('stw', {
  bellRingW5: 'Ударил в колокол',
  bellBear: 'Медведь уходит от звона',
  bellFar: 'Звон ушёл в темноту. Никто не ответил',
  bellWait: 'Колокол ещё гудит',
  bellFox: 'Лиса подбирается на звук',
  hintBell: 'Колокол: звон пугает медведя на минуту-другую, но на него идёт и лиса: не оставляй еду на виду.',
  hintBellT: 'Колокол: звон пугает медведя',
  lbBell: 'E: ударить',
  lbBellWaitW5: 'Гудит',
  cartCrashW5: 'Вагонетка разбилась внизу',
  cartHit: 'Вагонетка сбила тебя с ног!',
  cartPush: 'Толкни вагонетку плечом: пойдёт по рельсам. Под уклон она убегает',
  hintCart: 'Вагонетка на рельсах: толкай, идя в неё. К западу рельсы идут под уклон: разогнавшаяся вагонетка улетит вниз по спуску и собьёт всё на пути.',
  hintCartT: 'Вагонетка: толкай плечом',
  lbCartW5: 'Толкай плечом',
  lbCartRunW5: 'Катится!',
});

// ---------------------------------------------------------------------------------------------------------------------
// bell
const BELL_CD = 6;
export function bellRing(f: Fixture): boolean {
  const d = dd(f);
  hintTip(f, 'bell', S.hintBellT, S.hintBell);
  if (num(f, 'cd', 0) > 0) { toast(S.bellWait, 'info'); return true; }
  d.cd = BELL_CD;
  const [cx, cy] = cen(f);
  toast(S.bellRingW5, 'good'); emit('bell_ring', { x: cx, y: cy, fixture: f });
  addShake(0.6);
  // the bear leaves for a while when it is within earshot (a gale carries the sound less far)
  const b = bridge.fauna?.bear;
  if (b && b.state !== 'dead' && Math.abs(b.x - cx) < 900 * (1 - 0.35 * G.storm)) {
    const a = bridge.aiOf?.(b);
    if (a && a.mode !== 'flee') { bridge.setAiMode?.(b, 'flee'); a.hold = 55; toast(S.bellBear, 'good'); emit('bell_scared', { bear: true }); }
    else if (a) a.hold = Math.max(a.hold, 55);
  } else toast(S.bellFar, 'info');
  // the fox is curious: it walks toward the sound for a minute
  d.foxT = 60;
  return true;
}
export function bellLabel(f: Fixture): string { return num(f, 'cd', 0) > 0 ? S.lbBellWaitW5 : S.lbBell; }
function bellStep(f: Fixture, dt: number) {
  const d = dd(f);
  if (num(f, 'cd', 0) > 0) d.cd = Math.max(0, num(f, 'cd', 0) - dt);
  const sw = num(f, 'sw', 0);                                  // swing amplitude for the sprite
  d.sw = sw > 0.02 ? sw * Math.pow(0.5, dt / 1.4) : 0;
  if (num(f, 'cd', 0) > BELL_CD - 0.1) d.sw = 1;
  if (num(f, 'foxT', 0) > 0) {
    d.foxT = num(f, 'foxT', 0) - dt;
    const fox = G.animals.find(a => a.kind === 'fox' && a.state !== 'dead');
    const a = fox ? bridge.aiOf?.(fox) : null;
    if (fox && a && !a.carry && Math.abs(fox.x - cen(f)[0]) < 700) {
      a.tx = cen(f)[0] - Math.sign(cen(f)[0] - fox.x) * 22; a.t = 0;
      if (!d.foxSaid && Math.abs(fox.x - cen(f)[0]) < 200) { d.foxSaid = 1; toast(S.bellFox, 'info'); }
    }
  } else if (f.data) delete f.data.foxSaid;
}

// ---------------------------------------------------------------------------------------------------------------------
// coal cart on the rails: position = tile + data.ox (cells); velocity data.v (cells/s, + east)
const CART_W = 16, GRADE = 2.0, FRIC = 1.6, V_MAX = 60;       // a standstill holds while GRADE < the stiction (2.4): a push is needed to start it
const cartX = (f: Fixture) => f.tx * TS + num(f, 'ox', 0);
/** Floor row under a cart at x: the flat adit, then the stairs of the decline further west. */
function floorAt(x: number): number {
  const { floorA, rampTop } = LOC.mine;
  return x >= rampTop ? floorA : floorA + 4 * Math.floor((rampTop - x) / 5);
}
export function cartLabel(f: Fixture): string { return Math.abs(num(f, 'v', 0)) > 3 ? S.lbCartRunW5 : S.lbCartW5; }
function setCartX(f: Fixture, x: number) {
  const tx = Math.floor(x / TS); f.tx = tx; dd(f).ox = x - tx * TS;
}
export function pushCart(f: Fixture, v: number) { dd(f).v = clamp(v, -V_MAX, V_MAX); dd(f).moved = 1; }
function cartStep(f: Fixture, dt: number, gm: number) {
  const d = dd(f);
  if (d.broken) return;
  let v = num(f, 'v', 0), x = cartX(f);
  const p = G.player;
  const rolling = Math.abs(v) > 0.05;
  // the shoulder push: the player walking into the side of the cart carries it ahead of him
  if (p && p.alive && !p.sleeping) {
    const cy = f.ty * TS, lo = cy - 4, hi = cy + f.th * TS + 20;
    if (p.y > lo && p.y - p.h < hi + 2 && p.y - 2 < cy + f.th * TS + 2) {
      const half = CART_W / 2 + 4, rel = p.x - (x + CART_W / 2);
      if (Math.abs(rel) < half && Math.abs(p.vx) > 3 && Math.sign(p.vx) === -Math.sign(rel)) {
        const dir = Math.sign(p.vx);
        v = dir * Math.max(Math.abs(p.vx) * 0.92, Math.abs(v)); p.x = x + CART_W / 2 - dir * half; d.moved = 1;
        hintTip(f, 'cart', S.hintCartT, S.hintCart);
      } else if (Math.abs(rel) < half - 1 && Math.abs(v) > 6 && rolling) {
        // a rolling cart hits a player standing in its way
        damage(18 + Math.min(20, Math.abs(v) * 0.4), 'collapse'); toast(S.cartHit, 'bad');
        p.vx = Math.sign(v) * 90; p.vy = -60; v *= 0.4; addShake(4);
      }
    }
  }
  // physics on the rails: a grade pulls it west (down toward the decline); friction and a standstill threshold hold it still
  if (Math.abs(v) > 0.05) {
    const dir = Math.sign(v);
    v += (-GRADE - dir * FRIC) * dt;                        // the grade pulls west; friction opposes the motion
    if (Math.sign(v) !== dir) v = 0;                        // coming to rest on the grade: the standstill threshold (GRADE < STICTION) holds it
  } else v = 0;
  // other carts: a collision hands the speed on
  for (const o of G.fixtures) {
    if (o === f || o.kind !== 'cart' || o.data?.broken) continue;
    const ox = cartX(o); const gap = (x + CART_W / 2) - (ox + CART_W / 2);
    if (Math.abs(gap) < CART_W && Math.sign(v) === -Math.sign(gap) && Math.abs(v) > 0.3) {
      const ov = num(o, 'v', 0); dd(o).v = ov + v * 0.9; v *= 0.1; x = ox + Math.sign(gap) * CART_W; emit('cart_bump', { x });
    }
  }
  x += v * dt;
  // west of the rails the cart tumbles down the stairs, east of the apron it stops
  const east = LOC.mine.portalX + 62;
  if (x > east) { x = east; v = 0; }
  // crash: the decline is blocked by the rubble of the cave-in
  if (x < LOC.mine.collapse[1] + 6) {
    d.broken = true; v = 0;
    const cx = x + CART_W / 2, cy = floorAt(x) - 4;
    burstFx('debris', cx, cy, 14, 60, 0.9); burstFx('dust', cx, cy, 10, 40, 1.1, 0xb8bcc8, 8);
    spawnDrop('coal', 4, cx, cy - 4, 12, -30); spawnDrop('scrap', 2, cx, cy - 4, -10, -30);
    emit('cart_crash', { x: cx, y: cy }); addShake(Math.max(0, 6 - playerDist(f) / 60));
    if (playerDist(f) < 500) toast(S.cartCrashW5, 'warn');
    d.loaded = '';
  }
  setCartX(f, x);
  d.v = v;
  // follow the floor: stairs of the decline
  const want = Math.floor(floorAt(x + CART_W / 2) / TS) - f.th;
  if (f.ty !== want) f.ty = want;
  if (Math.abs(v) > 4 && (G.frame & 7) === 0) emit('cart_roll', { x, v });
  void gm;
}

export function worldStep(dt: number, gm: number) {
  for (const f of G.fixtures) {
    if (f.kind === 'bell') bellStep(f, dt);
    else if (f.kind === 'cart' && f.data?.pushable) cartStep(f, dt, gm);
  }
}
void fmt;
