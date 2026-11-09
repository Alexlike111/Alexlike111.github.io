// DESIGN §15: the radio as a receiver (tuning-dial minigame: weather bulletin -> precise forecast, a numbers station, the echo of the 1890s
// expedition, the icebreaker's dispatcher) and the weather balloon (assemble, release -> precise storm forecast + the cracks of the pack ice marked
// for a day). The repair / ending flow of the radio itself stays in fixtures.ts (interactRadioRepair) and is untouched.
// State lives in the fixtures' `data` (saved with them): radio {heard[], fcUntil}, sonde {st, fly, until}.
import { G, toast, type Fixture } from './state';
import { emit } from './bus';
import { strings, fmt } from '../content/i18n';
import { input } from '../engine/input';
import { SEA, worldInfo } from './locations';
import { count, remove } from './inventory';
import { itemName } from './items';
import { wxHooks, nextStorm } from './weather';
import { bridge } from './stationbridge';
import { addLayer } from '../engine/render';
import { cen, dd, num, clamp, logJournal, playerDist, clockText } from './stationkit';
import { showDial, dialInput, type DialView } from './stationui';
import { isPowered, hintTip } from './fixtures_station';

const S = strings('rad', {
  noPowerW5: 'Нет тока: запусти генератор',
  tune: 'Настройка: ←/→ (Shift — точно) · действие или ✕ — выключить',
  tuneTouch: 'Настройка: ◀ ▶ или стик · ✕ — выключить',
  titleW5: 'Рация',
  off: 'Приёмник выключен',
  lostPower: 'Ток пропал: приёмник стих',
  noise: '…шипение, треск…',
  stWx: 'Метео', stNum: 'Числа', stEcho: 'Эхо', stIce: 'Диспетчер',
  hint: 'Три станции отмечены на шкале. Держи стрелку на метке, пока не поймаешь.',
  hintRadioT: 'Рация: приёмник от генератора',
  hintNight: 'Днём эфир глух: одни помехи. Лучше ловить ночью.',
  wx: 'Метео: {text}',
  wxCalm: 'Метео: в ближайшие сутки штормов не ждут. Давление ровное.',
  fcRadio: 'пурга №{n} придёт около {when} (через ~{h} ч), {kind}, продлится ~{dur} ч',
  fcSonde: 'пурга №{n} начнётся в {when} (через {h} ч), {kind}, пик {peak}%, до {dur} ч',
  kindMild: 'умеренная', kindBig: 'сильная', kindHuge: 'самая большая',
  day: 'день',
  num1: '«…сорок один… сорок четыре… сорок шесть…»',
  num2: '«…ноль, ноль, двенадцать… ноль, ноль, двенадцать… повторяю…»',
  num3: '«…не ищи тех, кто идёт по льду на дым… ноль, ноль, двенадцать…»',
  echo1: 'Сквозь шум, очень далеко: «…огонь не бросать… снег — дом, жир — жизнь…»',
  echo2: '«…дым лампы тонкий, как нитка, и ровный… они живы…»',
  echo3: '«…Фома, не бегите мокрыми… не бегите…»',
  echo4: '«…выхожу к вам. Если слышите — греться, не спешить… Вельский…»',
  echoDay: 'Эфир глух: днём этот голос не пробивается',
  iceNo1: '«Мурманск-радио вызывает «Мыс Безмолвия». Не слышим вас…»',
  iceNo2: '«…Повторите, как слышите. Передатчик станции не отвечает…»',
  iceYes1: '«Мурманск-радио: ваш сигнал принят. Ледокол вышел к мысу.»',
  iceEta: '«Ожидайте через {d}. Держитесь, зажгите сигнальный огонь на холме мыса.»',
  iceHere: '«Ледокол в виду берега. Огонь на холме — немедленно!»',
  etaH: '{n} ч', etaD: '{n} дн.',
  jWx: 'Радио: {text}',
  jNum: 'Радио: на частоте чисел читают номера записей журнала смотрителя — сорок один, сорок четыре, сорок шесть. И «ноль-ноль-двенадцать».',
  jEcho: 'Радио, ночью: голос из 1890-х, будто запись во льду. «Огонь не бросать».',
  jIce: 'Радио: диспетчер ледокола на связи. Передатчик станции пока не отвечает.',
  hintRadio: 'Рация: приёмник работает от генератора. Метео даёт точный прогноз на сутки; ночью в эфире есть и другие голоса.',
  sondeNeed: 'Для зонда нужны: {list}',
  sondeBuiltW5: 'Зонд собран. Действие — выпустить',
  sondeGoW5: 'Зонд ушёл в небо',
  sondeDataT: 'Зонд передал данные',
  sondeCracks: 'Трещины льда отмечены',
  sondeFlying: 'Зонд ещё поднимается…',
  sondeData: 'Зонд передал данные: {text}',
  sondeCalm: 'Зонд передал данные: штормов в ближайшее время нет',
  sondeDrift: 'Следующий сдвиг льдов через ~{h} ч. Трещины отмечены на карте льда',
  sondeEmpty: 'Площадка метеозонда: шар и зонд ещё не собраны',
  sondeReady: 'Зонд собран. Действие — выпустить',
  hintSonde: 'Метеозонд: шар + радиозонд + верёвка. Выпусти зонд — получишь точный прогноз и увидишь трещины льда на сутки.',
  hintSondeT: 'Метеозонд: шар, радиозонд, верёвка',
  lbSondeW5: 'Ждёт сборки', lbReadyW5: 'Собран', lbFlyW5: 'В полёте', lbActiveW5: 'Данные есть',
  lbRadioOn: 'Слушать эфир', lbRadioOffW5: 'Нужен ток',
});

export const STATIONS = [
  { id: 'wx', c: 0.15, w: 0.034 },
  { id: 'num', c: 0.37, w: 0.03 },
  { id: 'echo', c: 0.61, w: 0.03 },
  { id: 'ice', c: 0.85, w: 0.034 },
] as const;
const stName = (id: string) => (id === 'wx' ? S.stWx : id === 'num' ? S.stNum : id === 'echo' ? S.stEcho : S.stIce);

export const radio = {
  on: false, f: null as Fixture | null, freq: 0.5, lock: 0, locked: -1, msg: [] as string[], lineI: 0, lineT: 0, cool: 0, line: '',
  px: 0, noiseT: 0, quality: 0, best: -1,
};
export const radioOn = () => radio.on;

// ---------------------------------------------------------------------------------------------------------------------
let hooked = false;
/** Wire the precise-forecast hooks into weather.ts (called at runtime, never at import: weather.ts must be evaluated first). */
export function installRadioHooks() {
  if (hooked) return; hooked = true;
  wxHooks.knows = () => forecastKnown();
  wxHooks.forecast = (t) => applyForecast(t);
}
export function forecastKnown(): boolean {
  for (const f of G.fixtures) {
    if (f.kind === 'radio' && num(f, 'fcUntil', -1) > G.time) return true;
    if (f.kind === 'sonde' && num(f, 'until', -1) > G.time) return true;
  }
  return false;
}
function kindText(peak: number) { return peak >= 1 ? S.kindHuge : peak >= 0.75 ? S.kindBig : S.kindMild; }
/** Precise forecast text of the next storm (`sonde` = exact minute and strength, radio = rounded to half an hour), or ''. */
export function preciseForecast(t: number, sonde: boolean): string {
  const s = nextStorm(); if (!s || t >= s.start) return '';
  const hrs = Math.max(1, Math.round((s.start - t) / 60));
  const start = sonde ? s.start : Math.round(s.start / 30) * 30;
  const a = { n: s.n, when: clockText(start, S.day), h: hrs, kind: kindText(s.peak), dur: Math.round(s.dur / 60), peak: Math.round(s.peak * 100) };
  return fmt(sonde ? S.fcSonde : S.fcRadio, a);
}
function applyForecast(t: number) {
  let sonde = false, radioK = false;
  for (const f of G.fixtures) {
    if (f.kind === 'sonde' && num(f, 'until', -1) > t) sonde = true;
    else if (f.kind === 'radio' && num(f, 'fcUntil', -1) > t) radioK = true;
  }
  if (!sonde && !radioK) return;
  const s = nextStorm(); if (!s || t >= s.start) return;
  G.forecast.stormAt = s.start; G.forecast.text = preciseForecast(t, sonde);
}

// ---------------------------------------------------------------------------------------------------------------------
// the receiver
export function stationRadio(f: Fixture): boolean {
  installRadioHooks();
  if (radio.on && radio.f === f) { closeRadio(); return true; }
  if (!isPowered()) { toast(S.noPowerW5, 'info'); return !!f.data?.fixed; }
  openRadio(f); return true;
}
export function openRadio(f: Fixture) {
  const p = G.player;
  radio.on = true; radio.f = f; radio.lock = 0; radio.locked = -1; radio.msg = []; radio.lineI = 0; radio.lineT = 0; radio.cool = 0; radio.line = ''; radio.px = p.x;
  if (radio.freq <= 0 || radio.freq >= 1) radio.freq = 0.5;
  dd(f).live = true;
  hintTip(f, 'radio', S.hintRadioT, S.hintRadio);
  emit('radio_on', { fixture: f });
}
export function closeRadio() {
  if (!radio.on) return;
  radio.on = false; if (radio.f) dd(radio.f).live = false; radio.f = null; radio.msg = []; radio.line = ''; radio.locked = -1; radio.lock = 0;
  showDial(null); emit('radio_off', {});
}
function weatherLine(f: Fixture): string {
  const t = G.time, txt = preciseForecast(t, false);
  dd(f).fcUntil = t + 24 * 60;
  applyForecast(t);
  if (!txt) return S.wxCalm;
  return fmt(S.wx, { text: txt });
}
function etaText(): string {
  const left = (bridge.quest?.icebreakerAt ?? -1) - G.time;
  return left > 1440 ? fmt(S.etaD, { n: Math.ceil(left / 1440) }) : fmt(S.etaH, { n: Math.max(1, Math.ceil(left / 60)) });
}
/** The lines of a station's message (also the first-hearing journal text). */
export function messageFor(id: string, f: Fixture): string[] {
  switch (id) {
    case 'wx': return [weatherLine(f)];
    case 'num': return [S.num1, S.num2, S.num3];
    case 'echo': return [S.echo1, S.echo2, S.echo3, S.echo4];
    default:
      if (!f.data?.fixed) return [S.iceNo1, S.iceNo2];
      if ((bridge.quest?.iceArrivedAt ?? -1) > 0 && (bridge.quest?.iceDeadline ?? -1) > G.time) return [S.iceYes1, S.iceHere];
      return [S.iceYes1, (bridge.quest?.icebreakerAt ?? -1) > 0 ? fmt(S.iceEta, { d: etaText() }) : S.iceHere];
  }
}
function noteHeard(f: Fixture, id: string) {
  const d = dd(f), h = (d.heard as string[] | undefined) ?? (d.heard = []);
  if (h.includes(id)) return;
  h.push(id);
  if (id === 'num') logJournal(S.jNum); else if (id === 'echo') logJournal(S.jEcho); else if (id === 'ice') logJournal(S.jIce);
}
/** Quality 0..1 of the best station under the needle (for tests and the dial). */
export function tuneQuality(freq: number): { q: number; k: number } {
  let q = 0, k = -1;
  for (let i = 0; i < STATIONS.length; i++) {
    const s = STATIONS[i];
    let w = s.w;
    if (s.id === 'echo') w *= G.daylight < 0.45 ? 1 : 0.2;                        // the old voice only comes through at night
    w *= 1 - 0.35 * G.storm - 0.25 * G.aurora;                                     // storms and aurora add static
    const c = clamp(1 - Math.abs(freq - s.c) / w, 0, 1);
    if (c > q) { q = c; k = i; }
  }
  return { q, k };
}
const lineDur = (s: string) => clamp(2.6 + s.length * 0.045, 3.4, 8);

export function radioStep(dt: number) {
  if (!radio.on || !radio.f) { if (dialInput.dir || dialInput.close) { dialInput.dir = 0; dialInput.close = false; } return; }
  const p = G.player, f = radio.f;
  if (!p || !p.alive || !G.fixtures.includes(f) || playerDist(f) > 64) { closeRadio(); return; }
  if (!isPowered()) { toast(S.lostPower, 'warn'); closeRadio(); return; }
  if (dialInput.close || input.jumpPressed) { dialInput.close = false; closeRadio(); return; }
  // the player stays at the set while tuning
  p.vx = 0; p.x = radio.px;
  const dir = dialInput.dir || (Math.abs(input.moveX) > 0.25 ? Math.sign(input.moveX) : 0);
  const fine = input.run;
  const old = radio.freq;
  radio.freq = clamp(radio.freq + dir * (fine ? 0.028 : 0.12) * dt, 0.02, 0.98);
  const { q, k } = tuneQuality(radio.freq);
  radio.quality = q; radio.best = k;
  if (q > 0.5 && k >= 0) radio.lock = Math.min(1, radio.lock + dt / 2.0); else radio.lock = Math.max(0, radio.lock - dt * 1.4);
  // a message starts when the lock is full and plays while the lock holds
  if (radio.msg.length === 0 && radio.lock >= 1 && k >= 0 && radio.cool <= 0) {
    const id = STATIONS[k].id;
    if (id === 'echo' && G.daylight >= 0.45) { radio.line = S.echoDay; radio.cool = 4; }
    else {
      radio.locked = k; radio.msg = messageFor(id, f); radio.lineI = 0; radio.lineT = 0; radio.line = radio.msg[0];
      noteHeard(f, id);
      if (id === 'wx') logJournal(fmt(S.jWx, { text: radio.msg[0].replace(/^Метео:\s*/, '') }));
      emit('radio_voice', { id, x: p.x });
    }
  }
  if (radio.msg.length) {
    if (radio.lock >= 0.45) {
      radio.lineT += dt;
      if (radio.lineT >= lineDur(radio.msg[radio.lineI])) {
        radio.lineI++; radio.lineT = 0;
        if (radio.lineI >= radio.msg.length) { radio.msg = []; radio.cool = 7; radio.locked = -1; }
        else { radio.line = radio.msg[radio.lineI]; emit('radio_voice', { id: STATIONS[radio.locked].id, x: p.x }); }
      }
    } else { radio.line = S.noise; }
  } else {
    radio.cool = Math.max(0, radio.cool - dt);
    if (radio.lock < 0.5 && !radio.msg.length) radio.line = q > 0.2 ? '…' : S.noise;
  }
  // static / tuning sounds
  radio.noiseT -= dt;
  if (radio.noiseT <= 0) { radio.noiseT = 1.3; emit('radio_noise', { vol: 0.1 + 0.3 * (1 - q) * (radio.msg.length ? 0.3 : 1), x: p.x }); }
  if (Math.abs(radio.freq - old) > 0.0004 && Math.random() < dt * 5) emit('radio_tune', { f: radio.freq });
  const view: DialView = {
    freq: radio.freq, quality: q, lock: radio.lock, locked: radio.locked, noise: 1 - q * (radio.msg.length ? 0.7 : 0.35),
    stations: STATIONS.map(s => ({ c: s.c, w: s.w, name: stName(s.id), heard: ((f.data?.heard as string[] | undefined) ?? []).includes(s.id) })),
    title: S.titleW5 + (radio.best >= 0 && q > 0.5 ? ' · ' + stName(STATIONS[radio.best].id) : ''), line: radio.line,
    hint: G.mobile ? S.tuneTouch : S.tune, fine,
  };
  showDial(view);
}

// ---------------------------------------------------------------------------------------------------------------------
// the weather balloon
export const sondeActive = () => G.fixtures.some(f => f.kind === 'sonde' && num(f, 'until', -1) > G.time);
export function sondeInteract(f: Fixture): boolean {
  installRadioHooks();
  const d = dd(f), st = num(f, 'st', 0);
  if (st === 2) { toast(S.sondeFlying, 'info'); return true; }
  if (st === 0) {
    const need = (['sonde_balloon', 'sonde_probe', 'rope'] as const).filter(i => count(i) <= 0);
    if (need.length) { toast(fmt(S.sondeNeed, { list: need.map(itemName).join(', ') }), 'info'); hintTip(f, 'sonde', S.hintSondeT, S.hintSonde); return true; }
    remove('sonde_balloon', 1); remove('sonde_probe', 1); remove('rope', 1);
    d.st = 1; toast(S.sondeBuiltW5, 'good'); emit('sonde_built', { fixture: f }); return true;
  }
  // release
  release(f); return true;
}
export function release(f: Fixture) {
  const d = dd(f);
  d.st = 2; d.fly = 0; d.until = G.time + 24 * 60;
  const txt = preciseForecast(G.time, true);
  toast(S.sondeGoW5, 'good'); emit('sonde_release', { fixture: f, x: cen(f)[0] });
  d.pend = 1;                    // the data message follows when the balloon is up (stationStep -> sondeStep)
  void txt;
}
/** Per step: the balloon rises, then reports. */
export function sondeStep(dt: number) {
  for (const f of G.fixtures) {
    if (f.kind !== 'sonde') continue;
    const d = dd(f);
    if (num(f, 'st', 0) !== 2) continue;
    d.fly = num(f, 'fly', 0) + dt;
    if (d.pend && Number(d.fly) > 6) {
      d.pend = 0;
      const txt = preciseForecast(G.time, true);
      toast(S.sondeDataT, 'good'); logJournal(txt ? fmt(S.sondeData, { text: txt }) : S.sondeCalm);
      const left = (bridge.drift?.nextAt ?? 0) - G.time;
      if (bridge.drift && left > 0) { logJournal(fmt(S.sondeDrift, { h: Math.max(1, Math.round(left / 60)) })); toast(S.sondeCracks, 'info'); }
    }
    if (Number(d.fly) > 24) { d.st = 0; d.fly = 0; }
  }
}
export function radioLabel(f: Fixture): string {
  return isPowered() ? S.lbRadioOn : S.lbRadioOffW5;
}
export function sondeLabel(f: Fixture): string {
  const st = num(f, 'st', 0), until = num(f, 'until', -1);
  if (st === 2) return S.lbFlyW5;
  if (until > G.time) return S.lbActiveW5;
  return st === 1 ? S.lbReadyW5 : S.lbSondeW5;
}

// the cracks of the pack ice, marked while a balloon has looked at them (unlit, on top of the world)
let layered = false;
export function initRevealLayer() {
  if (layered) return; layered = true;
  addLayer(124, (ctx, v) => {
    if (!sondeActive()) return;
    const info = worldInfo.iceField;
    const pulse = 0.5 + 0.3 * Math.sin(v.t * 3);
    for (const x of info.cracks) {
      const sx = x - v.x0; if (sx < -6 || sx > v.w + 6) continue;
      ctx.fillStyle = `rgba(120,225,255,${pulse.toFixed(3)})`;
      for (let y = SEA - 30; y < SEA - 1; y += 4) ctx.fillRect(sx, y - v.y0, 1, 2);
      ctx.fillStyle = 'rgba(14,26,44,0.8)'; ctx.fillRect(sx - 2, SEA - 36 - v.y0, 5, 3); ctx.fillRect(sx - 1, SEA - 33 - v.y0, 3, 2);
      ctx.fillStyle = '#7fe1ff'; ctx.fillRect(sx - 1, SEA - 35 - v.y0, 3, 1); ctx.fillRect(sx, SEA - 34 - v.y0, 1, 2);
    }
    for (const l of info.leads) {
      const a = Math.max(0, l.x0 - v.x0), b = Math.min(v.w, l.x1 - v.x0 + 1); if (b <= a) continue;
      ctx.fillStyle = l.thin ? 'rgba(255,200,90,0.55)' : 'rgba(110,200,255,0.4)'; ctx.fillRect(a, SEA - 2 - v.y0, b - a, 1);
    }
    const ev = bridge.drift?.pending;
    if (ev && bridge.drift) {
      const fl = bridge.drift.floes, x = ev.dir > 0 ? fl[ev.k1].x1 + 1 : fl[ev.k0].x0 - 1, sx = x - v.x0;
      ctx.fillStyle = `rgba(255,120,80,${(0.5 + 0.4 * Math.sin(v.t * 9)).toFixed(3)})`;
      for (let k = 0; k < 6; k++) ctx.fillRect(sx + ev.dir * (2 + k) - 0, SEA - 14 - v.y0 + (k % 2), 1, 1);
    }
  });
}
