// Gameplay overlay (DOM, above the HUD): on-screen cues for the warnings that are normally only heard (dog barks, bear roar, ice cracking,
// storm wind, shivering, seals) so the game works with sound off, and the DEATH CARD, the only end of the endless game (DESIGN §18): days survived,
// ring, personal record (localStorage sc.best), built / hunted / found, cause of death; «Новая игра» / «Заново тот же мир» (+ «Вернуться на станцию» when not hardcore).
import { G } from './state';
import { on } from './bus';
import { strings, fmt } from '../content/i18n';
import { runStats } from './quest';
import { saveBest } from './seasons';
import { sites } from './locations';
import { respawn } from './player';
import { fauna } from './fauna';
import { body } from './player';

const S = strings('ov', {
  dogBark: 'Север лает {arrow}', bearRoar: 'Рёв медведя {arrow}', bearGrowl: 'Низкое рычание {arrow}', iceCrack: 'Лёд трещит', iceFar: 'Лёд стонет вдали',
  wind: 'Ветер ревёт', storm: 'Пурга: не видно ни зги', shiver: 'Дрожь: тело сдаёт', sealUp: 'Тюлень всплыл у лунки', icebreaker: 'Гудок ледокола',
  scent: 'Ветер несёт твой запах', thin: 'Тонкий лёд!',
  deadH: 'Ты погиб', cause: 'Причина: {c}',
  statDay: 'Дней продержался', statRing: 'Круг', statBest: 'Рекорд', newBest: 'новый рекорд!', statBuilt: 'Построено', statHunted: 'Добыто', statFound: 'Найдено',
  statStorms: 'Пург пережито', statStars: 'Лучшее укрытие',
  unitDays: '{n} дн.',
  again: 'Новая игра', same: 'Заново тот же мир', back: 'Вернуться на станцию', newRun: 'Новый забег', hardDead: 'Хардкор: забег окончен',
});

const CSS = `
#ov{position:fixed;inset:0;z-index:48;pointer-events:none;font-family:'Pixelify Sans','Jura',system-ui,sans-serif;color:#e8f4ff;text-shadow:0 1px 2px #000}
#ov .cues{position:absolute;left:50%;transform:translateX(-50%);top:calc(104px + env(safe-area-inset-top,0px));display:flex;flex-direction:column;align-items:center;gap:4px}
body.touch-ui #ov .cues{top:calc(86px + env(safe-area-inset-top,0px))}
/* phone: the captions sit top-centre under the goal strip (the stick, the compass plate, the chip and the belt stay clear; ui.css keeps the desktop
   column). Specificity beats the ui.css rule for touch. In 'min' mode at most two captions show (cue() caps them). */
html body.touch-ui #ov .cues.cues-top{left:50%;right:auto;bottom:auto;transform:translateX(-50%);top:calc(42px + var(--sa-t,0px));max-width:min(64vw,320px);align-items:center;gap:4px}
html body.touch-ui #ov .cues.cues-top .cue{white-space:nowrap}
#ov .cue{background:rgba(8,16,30,.72);border:1px solid rgba(255,196,110,.55);border-radius:4px;padding:2px 10px;font-size:14px;letter-spacing:.03em;animation:cue .25s ease-out;white-space:nowrap}
#ov .cue.cold{border-color:rgba(124,198,238,.6)}#ov .cue.red{border-color:rgba(255,122,104,.8);color:#ffb0a4}
@keyframes cue{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
#ov .card{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;pointer-events:auto;text-align:center;padding:16px;box-sizing:border-box}
#ov .card.end{background:radial-gradient(ellipse at 50% 100%,rgba(255,190,120,.45),rgba(6,10,22,.86) 70%)}
#ov .card.end.dead{background:radial-gradient(ellipse at 50% 100%,rgba(120,30,30,.4),rgba(120,30,30,0) 75%),rgba(6,10,22,.82);overflow:auto}
#ov .card h2.d{color:#ffd0c8;text-shadow:0 0 24px rgba(255,120,100,.5),0 3px 0 #3a1010}
#ov .card .cause{font-size:clamp(15px,2.6vw,22px);color:#ffb0a4}
#ov h2{margin:0;font-size:clamp(30px,7vw,64px);letter-spacing:.12em;color:#fff4dc;text-shadow:0 0 24px rgba(255,200,120,.6),0 3px 0 #3a2410}
#ov .sub{font-size:clamp(14px,2.4vw,20px);opacity:.9;max-width:560px}
#ov table{border-collapse:collapse;font-size:14px;margin:6px 0}#ov td{padding:2px 12px;text-align:left;border-bottom:1px solid rgba(255,255,255,.1)}#ov td+td{text-align:right;color:#ffc46e}
#ov button{font:inherit;font-size:17px;color:#e8f6ff;background:linear-gradient(180deg,rgba(22,40,66,.92),rgba(10,20,36,.92));border:2px solid rgba(124,198,238,.55);border-radius:4px;padding:8px 16px;margin:3px;cursor:pointer;min-height:44px}
#ov button.pri{border-color:#ffc46e}
#ov .dead{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(18% + env(safe-area-inset-bottom,0px));display:none;pointer-events:auto}
#hud .end{display:none !important}
/* the cold (playtest v13): a blue-white screen edge that grows as the core drops below 34.5 °C (updateOverlay sets the opacity, at most .35) */
#ov .vig{position:fixed;inset:0;pointer-events:none;opacity:0;transition:opacity .8s;background:radial-gradient(ellipse at 50% 50%,rgba(0,0,0,0) 52%,rgba(170,214,255,.85) 100%)}
@media (max-height:480px){#ov .card{gap:4px;padding:6px 12px;justify-content:flex-start}#ov h2{font-size:26px;margin-top:2px}#ov .sub,#ov .cause{font-size:13px}#ov table{font-size:12px;margin:2px 0}#ov td{padding:1px 10px}#ov button{font-size:14px;min-height:40px;padding:4px 12px;margin:2px}}
`;

let root: HTMLElement, cues: HTMLElement, endEl: HTMLElement, deadBar: HTMLElement;
let api: { start: (o: { seed?: number; diff?: 0 | 1 | 2; hardcore?: boolean }) => void; restart: () => void } | null = null;
let shown = '';
let windCue: HTMLElement | null = null, shiverT = 0, endDelay = -1;
let vig: HTMLElement | null = null;
void body;

function cue(text: string, cls = '', ms = 3200) {
  if (!cues) return;
  // identical cue already visible: refresh it instead of stacking
  for (const c of Array.from(cues.children) as HTMLElement[]) if (c.dataset.k === text) { clearTimeout(Number(c.dataset.tm)); c.dataset.tm = String(setTimeout(() => c.remove(), ms)); return; }
  const cap = document.body.classList.contains('ui-min') ? 2 : 3;      // 'min' mode: at most two captions on screen (the wind one counts)
  while (cues.children.length >= cap) { const v = (Array.from(cues.children) as HTMLElement[]).find(c => c !== windCue); if (!v) break; v.remove(); }   // never evict the persistent wind warning
  const d = document.createElement('div'); d.className = 'cue ' + cls; d.textContent = text; d.dataset.k = text;
  d.dataset.tm = String(setTimeout(() => d.remove(), ms)); cues.appendChild(d);
}
const arrow = (dir: number) => (dir > 0 ? '▸' : '◂');

function stat(k: string, v: string | number) { return `<tr><td>${k}</td><td>${v}</td></tr>`; }
function showDeath() {
  const best = saveBest(), p = G.player;
  const found = sites.filter(x => x.found).length + runStats.notes, built = runStats.placed + runStats.blocks;
  const stars = '★'.repeat(runStats.bestStars) + '☆'.repeat(Math.max(0, 4 - runStats.bestStars));
  endEl.className = 'card end dead';
  endEl.innerHTML = `<h2 class="d">${S.deadH}</h2><div class="cause">${fmt(S.cause, { c: p?.cause || '—' })}</div><table>` +
    stat(S.statDay, fmt(S.unitDays, { n: G.day })) + stat(S.statRing, G.cycle + 1) +
    stat(S.statBest, fmt(S.unitDays, { n: best.best.day }) + (best.isNew ? ' · ' + S.newBest : '')) +
    stat(S.statBuilt, built) + stat(S.statHunted, runStats.hunted) + stat(S.statFound, found) +
    stat(S.statStorms, runStats.storms) + stat(S.statStars, stars) +
    `</table><div><button class="pri" data-a="again">${S.again}</button><button data-a="same">${S.same}</button>` +
    (G.diff.hardcore ? '' : `<button data-a="back">${S.back}</button>`) + `</div>` + (G.diff.hardcore ? `<div class="sub">${S.hardDead}</div>` : '');
  endEl.style.display = 'flex'; shown = 'dead';
}
/** Is the death card on screen (tests). */
export const deathCardShown = () => shown === 'dead';
export function initOverlay(host: HTMLElement, a: NonNullable<typeof api>) {
  api = a;
  if (document.getElementById('ov')) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'ov'; host.appendChild(root);
  cues = document.createElement('div'); cues.className = 'cues cues-top'; root.appendChild(cues);
  vig = document.createElement('div'); vig.className = 'vig'; root.appendChild(vig);
  endEl = document.createElement('div'); endEl.className = 'card'; root.appendChild(endEl);
  deadBar = document.createElement('div'); deadBar.className = 'dead'; root.appendChild(deadBar);
  deadBar.innerHTML = `<button class="pri" data-a="again">${S.newRun}</button>`;
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    const a = b.dataset.a;
    if (a === 'back') { endEl.style.display = 'none'; shown = ''; respawn(); }
    else if (a === 'same') { endEl.style.display = 'none'; shown = ''; deadBar.style.display = 'none'; api?.restart(); }
    else if (a === 'again') { endEl.style.display = 'none'; shown = ''; deadBar.style.display = 'none'; api?.start({ seed: 1 + ((Math.random() * 900) | 0), diff: G.diff.level, hardcore: G.diff.hardcore }); }
  });
  on('new_game', () => { endEl.style.display = 'none'; shown = ''; endDelay = -1; deadBar.style.display = 'none'; cues.innerHTML = ''; });
  on('respawn', () => { endEl.style.display = 'none'; shown = ''; endDelay = -1; });
  on('died', () => { saveBest(); endDelay = 1.3; });
  on('day', () => { saveBest(); });                  // the record survives a closed tab
  on('dog_bark', (d: { dir: number }) => cue(fmt(S.dogBark, { arrow: arrow(d.dir) }), 'cold'));
  on('bear_roar', () => { const b = fauna.bear; cue(fmt(S.bearRoar, { arrow: arrow(b && G.player ? b.x - G.player.x : 1) }), 'red', 4000); });
  on('bear_growl', () => { const b = fauna.bear; if (b && G.player && Math.abs(b.x - G.player.x) < 380) cue(fmt(S.bearGrowl, { arrow: arrow(b.x - G.player.x) }), 'red', 3500); });
  on('ice_crack', (d: { near: boolean }) => cue(d.near ? S.iceCrack : S.iceFar, 'cold'));
  on('ice_thin', () => cue(S.thin, 'red', 2500));
  on('seal_surface', () => cue(S.sealUp, 'cold', 2500));
  on('icebreaker_arrived', () => cue(S.icebreaker, 'cold', 6000));
}

export function updateOverlay(dt: number) {
  if (!root) return;
  const p = G.player;
  // wind / storm roar cue (persistent while it lasts)
  const roar = Math.abs(G.wind) > 15 || G.storm > 0.55;
  if (roar && !windCue) { windCue = document.createElement('div'); windCue.className = 'cue cold'; windCue.textContent = G.storm > 0.55 ? S.storm : S.wind; cues.appendChild(windCue); }
  else if (!roar && windCue) { windCue.remove(); windCue = null; }
  if (windCue) windCue.textContent = G.storm > 0.55 ? S.storm : S.wind;
  if (vig) vig.style.opacity = String(p && p.alive && p.core < 34.5 ? Math.min(0.35, (34.5 - p.core) * 0.15) : 0);
  if (p && p.alive && p.core < 35.4) { shiverT -= dt; if (shiverT <= 0) { shiverT = 9; cue(S.shiver, 'cold', 3000); } }
  if (endDelay > 0) { endDelay -= dt; if (endDelay <= 0 && !shown && p && !p.alive) showDeath(); }
  deadBar.style.display = 'none';
  if (shown === 'dead' && p && p.alive) { endEl.style.display = 'none'; shown = ''; }
}
