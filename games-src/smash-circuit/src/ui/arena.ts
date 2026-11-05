// Demolition Arena overlay: score / timer / combo / cars-left strip during the round, and the results panel.
// Self-contained DOM (own styles); the race HUD below keeps showing speed, damage, item and touch controls.
import { t } from '../i18n';
import type { ArenaEndReason, ArenaMatch } from '../sim/arena';

const CSS = `
.arena-hud{position:fixed;left:50%;top:calc(env(safe-area-inset-top,0px) + 54px);transform:translateX(-50%);z-index:40;pointer-events:none;
  display:flex;gap:8px;align-items:stretch;font-family:inherit;color:#fff;text-shadow:0 2px 0 #14213d;}
.arena-hud .ah-box{background:rgba(20,33,61,.82);border:2px solid #14213d;border-radius:12px;padding:4px 10px;text-align:center;min-width:64px;}
.arena-hud .ah-l{font-size:10px;opacity:.8;text-transform:uppercase;letter-spacing:.06em;}
.arena-hud .ah-v{font-size:22px;font-weight:900;line-height:1.05;font-variant-numeric:tabular-nums;}
.arena-hud .ah-score .ah-v{color:#ffd23f;}
.arena-hud .ah-combo{position:absolute;left:50%;top:100%;margin-top:6px;transform:translateX(-50%);white-space:nowrap;background:#ff5a36;border:2px solid #14213d;border-radius:10px;
  padding:2px 10px;font-weight:900;font-size:16px;opacity:0;transition:opacity .15s;}
.arena-hud .ah-combo.on{opacity:1;}
.arena-hud .ah-goal{position:absolute;left:50%;top:100%;margin-top:40px;transform:translateX(-50%);width:min(86vw,360px);text-align:center;font-weight:800;font-size:15px;
  background:rgba(20,33,61,.82);border-radius:10px;padding:6px 10px;transition:opacity .4s;}
.arena-res{position:fixed;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(10,16,32,.6);font-family:inherit;color:#fff;}
.arena-res .ar-card{width:min(92vw,380px);background:#1d2b53;border:3px solid #14213d;border-radius:18px;padding:16px;box-shadow:0 8px 0 #14213d;text-align:center;}
.arena-res h2{margin:0 0 4px;font-size:24px;font-weight:900;color:#ffd23f;text-shadow:0 2px 0 #14213d;}
.arena-res .ar-why{font-size:15px;opacity:.9;margin-bottom:10px;}
.arena-res .ar-score{font-size:46px;font-weight:900;line-height:1;margin:6px 0 10px;text-shadow:0 3px 0 #14213d;}
.arena-res .ar-rows{display:grid;grid-template-columns:1fr auto;gap:4px 12px;text-align:left;font-size:15px;margin-bottom:14px;}
.arena-res .ar-rows b{text-align:right;font-variant-numeric:tabular-nums;}
.arena-res .ar-coins{color:#ffd23f;}
.arena-res .ar-btns{display:flex;gap:10px;justify-content:center;}
.arena-res button{flex:1;min-height:48px;border-radius:14px;border:3px solid #14213d;font:inherit;font-weight:900;font-size:18px;color:#fff;cursor:pointer;box-shadow:0 4px 0 #14213d;}
.arena-res .ar-again{background:#ff5a36;}
.arena-res .ar-menu{background:#5b6b8c;}
`;

export interface ArenaResult { reason: ArenaEndReason; score: number; coins: number; wrecks: number; damage: number; props: number; best: number }

export class ArenaUi {
  private hud: HTMLElement | null = null;
  private res: HTMLElement | null = null;
  private last = { score: -1, time: '', left: -1, combo: -1 };
  private goalT = 0;

  private ensureCss(): void {
    if (document.getElementById('arena-css')) return;
    const s = document.createElement('style');
    s.id = 'arena-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  showHud(): void {
    this.ensureCss();
    this.hideAll();
    const el = document.createElement('div');
    el.className = 'arena-hud';
    el.setAttribute('data-arena', 'hud');
    el.innerHTML = `
      <div class="ah-box ah-score"><div class="ah-l">${t('arena.score')}</div><div class="ah-v" data-k="score">0</div></div>
      <div class="ah-box"><div class="ah-l">${t('arena.time')}</div><div class="ah-v" data-k="time">1:30</div></div>
      <div class="ah-box"><div class="ah-l">${t('arena.left')}</div><div class="ah-v" data-k="left">0</div></div>
      <div class="ah-combo" data-k="combo"></div>
      <div class="ah-goal" data-k="goal">${t('arena.goal')}</div>`;
    document.body.appendChild(el);
    this.hud = el;
    this.last = { score: -1, time: '', left: -1, combo: -1 };
    this.goalT = 6;
  }

  update(m: ArenaMatch, carsLeft: number, dt: number): void {
    const h = this.hud;
    if (!h) return;
    const q = (k: string) => h.querySelector<HTMLElement>(`[data-k="${k}"]`)!;
    if (m.score !== this.last.score) { this.last.score = m.score; q('score').textContent = String(m.score); }
    const tl = Math.ceil(m.timeLeft());
    const ts = `${Math.floor(tl / 60)}:${String(tl % 60).padStart(2, '0')}`;
    if (ts !== this.last.time) { this.last.time = ts; q('time').textContent = ts; }
    if (carsLeft !== this.last.left) { this.last.left = carsLeft; q('left').textContent = String(carsLeft); }
    const c = m.comboT > 0 && m.combo > 1 ? m.combo : 0;
    if (c !== this.last.combo) {
      this.last.combo = c;
      const el = q('combo');
      el.classList.toggle('on', c > 0);
      if (c > 0) el.textContent = t('arena.combo', { n: c });
    }
    if (this.goalT > 0) {
      this.goalT -= dt;
      if (this.goalT <= 0) q('goal').style.opacity = '0';
    }
  }

  showResults(r: ArenaResult, onAgain: () => void, onMenu: () => void): void {
    this.ensureCss();
    this.hideAll();
    const why = r.reason === 'time' ? t('arena.endTime') : r.reason === 'lastStanding' ? t('arena.endLast') : t('arena.endWrecked');
    const el = document.createElement('div');
    el.className = 'arena-res';
    el.setAttribute('data-arena', 'results');
    el.innerHTML = `<div class="ar-card" role="dialog" aria-label="${t('arena.title')}">
      <h2>${t('arena.title')}</h2>
      <div class="ar-why">${why}</div>
      <div class="ar-score" data-k="score">${r.score}</div>
      <div class="ar-rows">
        <span>${t('arena.damage')}</span><b>${Math.round(r.damage * 100)}%</b>
        <span>${t('arena.wrecks')}</span><b>${r.wrecks}</b>
        <span>${t('arena.props')}</span><b>${r.props}</b>
        <span>${t('arena.best')}</span><b>${r.best}</b>
        <span class="ar-coins">${t('arena.coins')}</span><b class="ar-coins" data-k="coins">+${r.coins}</b>
      </div>
      <div class="ar-btns">
        <button class="ar-menu" data-act="arenaMenu">${t('arena.toMenu')}</button>
        <button class="ar-again" data-act="arenaAgain">${t('arena.again')}</button>
      </div></div>`;
    el.querySelector('[data-act="arenaAgain"]')!.addEventListener('click', (e) => { e.stopPropagation(); onAgain(); });
    el.querySelector('[data-act="arenaMenu"]')!.addEventListener('click', (e) => { e.stopPropagation(); onMenu(); });
    document.body.appendChild(el);
    this.res = el;
  }

  hideAll(): void {
    this.hud?.remove(); this.hud = null;
    this.res?.remove(); this.res = null;
  }
}
