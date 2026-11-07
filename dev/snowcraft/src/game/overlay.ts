// Gameplay overlay (DOM, above the HUD): on-screen cues for the warnings that are normally only heard (dog barks, bear roar, ice cracking,
// storm wind, shivering, seals) so the game works with sound off, the ending card with run statistics (dawn / icebreaker), and the
// "new run" action on the hardcore death card (the HUD's card has no restart there).
import { G } from './state';
import { on } from './bus';
import { strings, fmt } from '../content/i18n';
import { runStats, questState } from './quest';
import { fauna } from './fauna';
import { body } from './player';

const S = strings('ov', {
  dogBark: 'Север лает {arrow}', bearRoar: 'Рёв медведя {arrow}', bearGrowl: 'Низкое рычание {arrow}', iceCrack: 'Лёд трещит', iceFar: 'Лёд стонет вдали',
  wind: 'Ветер ревёт', storm: 'Пурга: не видно ни зги', shiver: 'Дрожь: тело сдаёт', sealUp: 'Тюлень всплыл у лунки', icebreaker: 'Гудок ледокола',
  scent: 'Ветер несёт твой запах', thin: 'Тонкий лёд!',
  dawnH: 'Рассвет', iceH: 'Ледокол', dawnSub: 'Солнце вернулось. Ты пережил полярную ночь.', iceSub: 'Тебя забирают со станции. Зима позади.',
  statDay: 'Дней продержался', statSeals: 'Тюленей добыто', statStorms: 'Пург пережито', statStars: 'Лучшее укрытие', statFires: 'Огней зажжено', statBlocks: 'Снежных блоков вырезано',
  statCold: 'Самая низкая температура тела', statBears: 'Встреч с медведем', statDeaths: 'Смертей', statNotes: 'Записок найдено',
  cont: 'Играть дальше', again: 'Новая игра', newRun: 'Новый забег', hardDead: 'Хардкор: забег окончен',
});

const CSS = `
#ov{position:fixed;inset:0;z-index:48;pointer-events:none;font-family:'Pixelify Sans','Jura',system-ui,sans-serif;color:#e8f4ff;text-shadow:0 1px 2px #000}
#ov .cues{position:absolute;left:50%;transform:translateX(-50%);top:calc(104px + env(safe-area-inset-top,0px));display:flex;flex-direction:column;align-items:center;gap:4px}
body.touch-ui #ov .cues{top:calc(86px + env(safe-area-inset-top,0px))}
#ov .cue{background:rgba(8,16,30,.72);border:1px solid rgba(255,196,110,.55);border-radius:4px;padding:2px 10px;font-size:14px;letter-spacing:.03em;animation:cue .25s ease-out;white-space:nowrap}
#ov .cue.cold{border-color:rgba(124,198,238,.6)}#ov .cue.red{border-color:rgba(255,122,104,.8);color:#ffb0a4}
@keyframes cue{from{opacity:0;transform:translateY(-4px)}to{opacity:1;transform:none}}
#ov .card{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:10px;pointer-events:auto;text-align:center;padding:16px;box-sizing:border-box}
#ov .card.end{background:radial-gradient(ellipse at 50% 100%,rgba(255,190,120,.45),rgba(6,10,22,.86) 70%)}
#ov .card.end.ice{background:radial-gradient(ellipse at 50% 100%,rgba(120,200,255,.4),rgba(6,10,22,.88) 70%)}
#ov h2{margin:0;font-size:clamp(30px,7vw,64px);letter-spacing:.12em;color:#fff4dc;text-shadow:0 0 24px rgba(255,200,120,.6),0 3px 0 #3a2410}
#ov .sub{font-size:clamp(14px,2.4vw,20px);opacity:.9;max-width:560px}
#ov table{border-collapse:collapse;font-size:14px;margin:6px 0}#ov td{padding:2px 12px;text-align:left;border-bottom:1px solid rgba(255,255,255,.1)}#ov td+td{text-align:right;color:#ffc46e}
#ov button{font:inherit;font-size:17px;color:#e8f6ff;background:linear-gradient(180deg,rgba(22,40,66,.92),rgba(10,20,36,.92));border:2px solid rgba(124,198,238,.55);border-radius:4px;padding:8px 16px;margin:3px;cursor:pointer;min-height:44px}
#ov button.pri{border-color:#ffc46e}
#ov .dead{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(18% + env(safe-area-inset-bottom,0px));display:none;pointer-events:auto}
#hud .end{display:none !important}
`;

let root: HTMLElement, cues: HTMLElement, endEl: HTMLElement, deadBar: HTMLElement;
let api: { start: (o: { seed?: number; diff?: 0 | 1 | 2; hardcore?: boolean }) => void; restart: () => void } | null = null;
let shown = '';
let windCue: HTMLElement | null = null, shiverT = 0, endDelay = -1;

function cue(text: string, cls = '', ms = 3200) {
  if (!cues) return;
  // identical cue already visible: refresh it instead of stacking
  for (const c of Array.from(cues.children) as HTMLElement[]) if (c.dataset.k === text) { clearTimeout(Number(c.dataset.tm)); c.dataset.tm = String(setTimeout(() => c.remove(), ms)); return; }
  while (cues.children.length >= 3) { const v = (Array.from(cues.children) as HTMLElement[]).find(c => c !== windCue); if (!v) break; v.remove(); }   // never evict the persistent wind warning
  const d = document.createElement('div'); d.className = 'cue ' + cls; d.textContent = text; d.dataset.k = text;
  d.dataset.tm = String(setTimeout(() => d.remove(), ms)); cues.appendChild(d);
}
const arrow = (dir: number) => (dir > 0 ? '▸' : '◂');

function stat(k: string, v: string | number) { return `<tr><td>${k}</td><td>${v}</td></tr>`; }
function showEnding(kind: 'dawn' | 'icebreaker') {
  const ice = kind === 'icebreaker';
  endEl.className = 'card end' + (ice ? ' ice' : '');
  const stars = '★'.repeat(runStats.bestStars) + '☆'.repeat(Math.max(0, 4 - runStats.bestStars));
  endEl.innerHTML = `<h2>${ice ? S.iceH : S.dawnH}</h2><div class="sub">${ice ? S.iceSub : S.dawnSub}</div><table>` +
    stat(S.statDay, `${G.day} / ${G.endDay}`) + stat(S.statSeals, runStats.seals) + stat(S.statStorms, runStats.storms) + stat(S.statStars, stars) +
    stat(S.statFires, runStats.fires) + stat(S.statBlocks, runStats.blocks) + stat(S.statCold, runStats.coldest < 90 ? runStats.coldest.toFixed(1) + '°' : '—') +
    stat(S.statBears, runStats.bears) + stat(S.statNotes, runStats.notes) + stat(S.statDeaths, body.stats.deaths) +
    `</table><div><button class="pri" data-a="cont">${S.cont}</button><button data-a="again">${S.again}</button></div>`;
  endEl.style.display = 'flex'; G.paused = true; shown = kind;
}
export function initOverlay(host: HTMLElement, a: NonNullable<typeof api>) {
  api = a;
  if (document.getElementById('ov')) return;
  const st = document.createElement('style'); st.textContent = CSS; document.head.appendChild(st);
  root = document.createElement('div'); root.id = 'ov'; host.appendChild(root);
  cues = document.createElement('div'); cues.className = 'cues'; root.appendChild(cues);
  endEl = document.createElement('div'); endEl.className = 'card'; root.appendChild(endEl);
  deadBar = document.createElement('div'); deadBar.className = 'dead'; root.appendChild(deadBar);
  deadBar.innerHTML = `<button class="pri" data-a="again">${S.newRun}</button>`;
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.a === 'cont') { endEl.style.display = 'none'; G.paused = false; }
    else if (b.dataset.a === 'again') { endEl.style.display = 'none'; shown = ''; deadBar.style.display = 'none'; api?.restart(); }
  });
  on('new_game', () => { endEl.style.display = 'none'; shown = ''; endDelay = -1; deadBar.style.display = 'none'; cues.innerHTML = ''; });
  on('ending', (d: { kind: 'dawn' | 'icebreaker' }) => { if (shown || endDelay > 0) return; endDelay = d.kind === 'dawn' ? 5 : 3; pendingKind = d.kind; });
  on('dog_bark', (d: { dir: number }) => cue(fmt(S.dogBark, { arrow: arrow(d.dir) }), 'cold'));
  on('bear_roar', () => { const b = fauna.bear; cue(fmt(S.bearRoar, { arrow: arrow(b && G.player ? b.x - G.player.x : 1) }), 'red', 4000); });
  on('bear_growl', () => { const b = fauna.bear; if (b && G.player && Math.abs(b.x - G.player.x) < 380) cue(fmt(S.bearGrowl, { arrow: arrow(b.x - G.player.x) }), 'red', 3500); });
  on('ice_crack', (d: { near: boolean }) => cue(d.near ? S.iceCrack : S.iceFar, 'cold'));
  on('ice_thin', () => cue(S.thin, 'red', 2500));
  on('seal_surface', () => cue(S.sealUp, 'cold', 2500));
  on('icebreaker_arrived', () => cue(S.icebreaker, 'cold', 6000));
}
let pendingKind: 'dawn' | 'icebreaker' = 'dawn';

export function updateOverlay(dt: number) {
  if (!root) return;
  const p = G.player;
  // wind / storm roar cue (persistent while it lasts)
  const roar = Math.abs(G.wind) > 15 || G.storm > 0.55;
  if (roar && !windCue) { windCue = document.createElement('div'); windCue.className = 'cue cold'; windCue.textContent = G.storm > 0.55 ? S.storm : S.wind; cues.appendChild(windCue); }
  else if (!roar && windCue) { windCue.remove(); windCue = null; }
  if (windCue) windCue.textContent = G.storm > 0.55 ? S.storm : S.wind;
  if (p && p.alive && p.core < 35.4) { shiverT -= dt; if (shiverT <= 0) { shiverT = 9; cue(S.shiver, 'cold', 3000); } }
  if (endDelay > 0) { endDelay -= dt; if (endDelay <= 0 && !shown) showEnding(pendingKind); }
  // hardcore death: the HUD's card has no action, so offer a new run
  const dead = !!p && !p.alive && G.diff.hardcore && body.deadT > 1.2;
  deadBar.style.display = dead ? 'block' : 'none';
  if (questState.ended === '' && shown) shown = '';
}
