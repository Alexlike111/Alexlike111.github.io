// Career screens: cup list, cup page (next-race briefing with star goals, standings, race list), result extras and the cup podium.
// HTML strings only; the UI class owns the state and the click handling (data-act: career, cCup, cGo, cRestart, cNext, cDone).
import './career.css';
import { t } from '../i18n';
import {
  CUPS, cupById, cupIndex, cupLock, cupMaxStars, cupNames, cupStars, currentCupIndex, maxStars, raceStars, runActive, runFinished, runProgress,
  standings, totalStars, type Goal, type Standing,
} from '../meta/career';
import type { SaveData } from '../types';
import { icon } from './icons';

const esc = (s: string | number): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const STAR_PATH = 'M12 2.2l2.9 6.1 6.6.8-4.9 4.6 1.3 6.6L12 17l-5.9 3.3 1.3-6.6L2.5 9.1l6.6-.8z';
/** A star icon: filled gold when `on`, an outline otherwise. */
export const star = (on: boolean, cls = ''): string =>
  `<svg class="cstar${on ? ' on' : ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${STAR_PATH}"/></svg>`;
const stars3 = (m: readonly boolean[]): string => `<span class="cstars" aria-hidden="true">${m.map((on) => star(on)).join('')}</span>`;

const ordinal = (p: number): string => t('ordinal.' + Math.min(8, Math.max(1, Math.floor(p))));

export function goalText(g: Goal): string {
  switch (g.k) {
    case 'place': return g.n <= 1 ? t('goal.win') : t('goal.top', { n: g.n });
    case 'smash': return t('goal.smash', { n: g.n });
    case 'health': return t('goal.health', { n: Math.round(g.f * 100) });
    case 'noRepair': return t('goal.noRepair');
    default: return '';
  }
}

/** The driver's display name in a cup run: the player is "You", the AIs keep their names for the whole run. */
export function driverName(d: number, seed: number): string { return d === 0 ? t('cup.you') : (cupNames(seed)[d - 1] ?? '?'); }

/** Menu button caption: the cup you are on and the star count. */
export function careerMenuInfo(s: SaveData): { cup: string; stars: number; fresh: boolean } {
  const c = s.career;
  const cup = CUPS[currentCupIndex(c)];
  return { cup: t(cup.nameKey), stars: totalStars(c), fresh: totalStars(c) === 0 && !c.run && Object.keys(c.cups).length === 0 };
}

// ------------------------------------------------------------------ cup list

const CUP_ICON = ['cup-1', 'cup-2', 'cup-3', 'cup-4'];

export function careerHubHtml(s: SaveData, header: string): string {
  const c = s.career;
  const cur = currentCupIndex(c);
  const cards = CUPS.map((cup, i) => {
    const lock = cupLock(c, i);
    const rec = c.cups[cup.id];
    const have = cupStars(c, cup.id), max = cupMaxStars(cup);
    const prog = runProgress(c, cup.id);
    let status: string;
    if (!lock.unlocked) {
      const need: string[] = [];
      if (lock.missingStars > 0) need.push(t('career.lockStars', { n: lock.missingStars }));
      if (lock.needPrev) need.push(t('career.lockPrev'));
      status = `<p class="cup-lock">${icon('lock')}<span>${esc(need.join(' · '))}</span></p>`;
    } else if (runActive(c, cup.id)) {
      status = `<p class="cup-status go">${esc(t('career.progress', { n: prog + 1, total: cup.races.length }))}</p>`;
    } else if (rec?.done) {
      status = `<p class="cup-status ok">${icon('check')}<span>${esc(t('career.completed'))}${rec.best ? ' · ' + esc(t('career.best', { ord: ordinal(rec.best) })) : ''}</span></p>`;
    } else {
      status = `<p class="cup-status">${esc(t('career.races', { n: cup.races.length }))}</p>`;
    }
    const pct = Math.round((have / max) * 100);
    return `<article class="card cup k${i + 1}${lock.unlocked ? '' : ' locked'}${i === cur && lock.unlocked ? ' cur' : ''}" data-act="cCup" data-id="${cup.id}" tabindex="0" role="button" aria-label="${esc(t(cup.nameKey))}">
      <div class="cup-badge ${CUP_ICON[i]}">${lock.unlocked ? icon('trophy') : icon('lock')}<b>${i + 1}</b></div>
      <div class="cup-info">
        <h3 class="tname">${esc(t(cup.nameKey))}</h3>
        ${status}
        <div class="cup-bar"><span class="cup-stars">${star(true)}<b>${have}</b><small>/ ${max}</small></span><i><u style="width:${pct}%"></u></i></div>
      </div>
      <div class="cup-go">${lock.unlocked ? icon('arrowR') : ''}</div>
    </article>`;
  }).join('');
  return `${header}<div class="c-scroll"><div class="c-sum">${careerStarsChip(s)}<p>${esc(t('career.tip'))}</p></div><div class="c-cups">${cards}</div></div>`;
}

export function careerStarsChip(s: SaveData): string {
  return `<div class="chip cstar-chip">${star(true)}<b>${totalStars(s.career)}</b><small>/ ${maxStars()}</small></div>`;
}

// ------------------------------------------------------------------ cup page

function standingsHtml(rows: Standing[], seed: number): string {
  return `<div class="c-table" role="table">${rows.map((r) => {
    const you = r.driver === 0;
    return `<div class="c-row${you ? ' you' : ''}${r.pos <= 3 ? ' p' + r.pos : ''}" role="row"><i class="pos">${r.pos}</i><span class="nm">${esc(driverName(r.driver, seed))}</span><b>${r.points}<small> ${esc(t('cup.pts'))}</small></b></div>`;
  }).join('')}</div>`;
}

/**
 * The cup page. `map(trackId)` returns the little track map svg (owned by ui.ts). `header` is the shared screen header.
 * Layout: the next-race briefing (map, star goals, GO) and, beside/below it, the standings and the race list.
 */
export function cupPageHtml(s: SaveData, cupId: string, header: string, map: (track: string) => string, trackName: (track: string) => string): string {
  const cup = cupById(cupId);
  if (!cup) return header;
  const c = s.career;
  const ci = cupIndex(cupId);
  const mine = !!c.run && c.run.cup === cupId;
  const done = runProgress(c, cupId);
  const finished = runFinished(c, cupId);
  const nextIdx = Math.min(done, cup.races.length - 1);
  const race = cup.races[nextIdx];
  const rowsData = mine ? standings(c.run!.results) : null;
  const seed = c.run?.seed ?? 1;
  const other = !!c.run && c.run.cup !== cupId && runActive(c, c.run.cup);

  const goals = race.goals.map((g, i) => {
    const earned = raceStars(c, cupId, nextIdx)[i];
    return `<li class="${earned ? 'got' : ''}">${star(earned)}<span>${esc(goalText(g))}</span></li>`;
  }).join('');

  const brief = finished
    ? `<section class="panel c-brief done">
        <div class="c-brief-h"><span class="ph">${esc(t('career.completed'))}</span></div>
        <p class="c-big">${icon('trophy')}<span>${esc(t('career.podium.you', { ord: ordinal(rowsData!.find((r) => r.driver === 0)!.pos) }))}</span></p>
        <button class="btn big green" data-act="cRestart">${icon('restart')}<span>${esc(t('cup.again'))}</span></button>
      </section>`
    : `<section class="panel c-brief">
        <div class="c-brief-h"><span class="ph">${esc(t('career.race', { n: nextIdx + 1, total: cup.races.length }))}</span></div>
        <div class="c-race">
          <div class="c-map th-${esc(race.track)}">${map(race.track)}</div>
          <div class="c-race-i"><h3>${esc(trackName(race.track))}</h3><p>${esc(t('cup.laps', { n: race.laps }))}</p></div>
        </div>
        <div class="c-goals"><span class="ph">${esc(t('cup.goals'))}</span><ul>${goals}</ul></div>
        <button class="btn big orange" data-act="cGo">${icon('play')}<span>${esc(t('cup.go', { n: nextIdx + 1 }))}</span></button>
        ${other ? `<p class="c-warn">${esc(t('career.runElsewhere', { cup: t(cupById(c.run!.cup)?.nameKey ?? '') }))}</p>` : ''}
      </section>`;

  const table = rowsData
    ? `<section class="panel c-stand"><span class="ph">${esc(finished ? t('cup.final') : t('cup.standings'))}</span>${standingsHtml(rowsData, seed)}</section>`
    : `<section class="panel c-stand"><span class="ph">${esc(t('cup.standings'))}</span><p class="c-pts">${esc(t('cup.points'))}</p></section>`;

  const list = cup.races.map((r, i) => {
    const res = mine ? c.run!.results[i] : undefined;
    const place = res ? res[0] : 0;
    return `<li class="${i === nextIdx && !finished ? 'next' : ''}${res ? ' played' : ''}">
      <i class="n">${i + 1}</i><span class="tn">${esc(trackName(r.track))}<small>${esc(t('cup.laps', { n: r.laps }))}</small></span>
      ${stars3(raceStars(c, cupId, i))}
      <b class="pl${place ? ' p' + Math.min(place, 4) : ''}">${place ? place : ''}</b>
    </li>`;
  }).join('');
  const races = `<section class="panel c-races"><span class="ph">${esc(t('cup.races'))}</span><ol>${list}</ol></section>`;
  const colour = `k${ci + 1}`;
  return `${header}<div class="c-scroll c-page ${colour}"><div class="c-col a">${brief}</div><div class="c-col b">${table}${races}</div></div>`;
}

// ------------------------------------------------------------------ results extras

export interface CareerResultsData {
  cupName: string;
  raceNo: number;
  raceTotal: number;
  points: number;
  pos: number;
  totalPoints: number;
  goals: { text: string; earned: boolean; isNew: boolean }[];
  starCoins: number;
  cupCoins: number;
  cupDone: boolean;
  unlockedCup: string | null;
}

/** Cup block of the results card: where you are in the cup, the three star goals, the extra coins, a newly opened cup. */
export function careerResultsHtml(c: CareerResultsData): string {
  const goals = c.goals.map((g) => `<li class="${g.earned ? 'got' : ''}${g.isNew ? ' new' : ''}">${star(g.earned)}<span>${esc(g.text)}</span>${g.isNew ? `<em>${esc(t('career.res.new'))}</em>` : ''}</li>`).join('');
  const coins = (c.starCoins > 0 ? `<div class="rr"><span>${star(true)}${esc(t('career.res.starBonus'))}</span><b>+${Math.floor(c.starCoins).toLocaleString()}</b></div>` : '')
    + (c.cupCoins > 0 ? `<div class="rr"><span>${icon('trophy')}${esc(t('career.res.cupPrize'))}</span><b>+${Math.floor(c.cupCoins).toLocaleString()}</b></div>` : '');
  return `<div class="c-res">
      <div class="c-res-h"><span>${esc(t('career.res.cup', { cup: c.cupName, n: c.raceNo, total: c.raceTotal }))}</span><b>${esc(t('career.res.points', { n: c.points }))}</b></div>
      <div class="c-res-s">${esc(t('career.res.standing', { ord: ordinal(c.pos) }))} · ${c.totalPoints} ${esc(t('cup.pts'))}</div>
      <ul class="c-res-goals">${goals}</ul>
      ${coins}
      ${c.unlockedCup ? `<div class="unlock">${icon('trophy')}<span>${esc(t('career.res.cupUnlocked', { cup: c.unlockedCup }))}</span></div>` : ''}
    </div>`;
}

// ------------------------------------------------------------------ podium

export interface PodiumData {
  cupName: string;
  table: { driver: number; name: string; points: number; pos: number }[];
  playerPos: number;
  cupCoins: number;
  unlockedCup: string | null;
}

export function podiumHtml(d: PodiumData): string {
  const by = (p: number) => d.table.find((r) => r.pos === p);
  const block = (p: number): string => {
    const r = by(p);
    if (!r) return '';
    return `<div class="pd p${p}${r.driver === 0 ? ' you' : ''}"><div class="pd-who"><b>${esc(r.name)}</b><small>${r.points} ${esc(t('cup.pts'))}</small></div><div class="pd-step"><span>${p}</span></div></div>`;
  };
  const rest = d.table.filter((r) => r.pos > 3).slice(0, 5).map((r) => `<div class="c-row${r.driver === 0 ? ' you' : ''}"><i class="pos">${r.pos}</i><span class="nm">${esc(r.name)}</span><b>${r.points}<small> ${esc(t('cup.pts'))}</small></b></div>`).join('');
  return `<div class="pod-wrap"><div class="panel pod">
      <h2 class="title">${esc(t('career.podium.title'))}</h2>
      <p class="pod-cup">${esc(d.cupName)}</p>
      <div class="pods">${block(2)}${block(1)}${block(3)}</div>
      <p class="pod-you">${esc(t('career.podium.you', { ord: ordinal(d.playerPos) }))}</p>
      ${d.playerPos > 3 ? `<div class="c-table slim">${rest}</div>` : ''}
      ${d.cupCoins > 0 ? `<div class="rr reward"><span>${icon('coin')}${esc(t('career.res.cupPrize'))}</span><b>+${Math.floor(d.cupCoins).toLocaleString()}</b></div>` : ''}
      ${d.unlockedCup ? `<div class="unlock">${icon('trophy')}<span>${esc(t('career.res.cupUnlocked', { cup: d.unlockedCup }))}</span></div>` : ''}
      <button class="btn big orange" data-act="cDone">${icon('arrowR')}<span>${esc(t('career.podium.continue'))}</span></button>
    </div></div>`;
}
