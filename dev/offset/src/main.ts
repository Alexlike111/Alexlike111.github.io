import './ui/ui.css';
import { Renderer } from './gfx/gl';
import { Phys } from './phys/world';
import { Input } from './game/input';
import { Game } from './game/game';
import { T } from './core/tune';

async function boot() {
  const canvas = document.getElementById('c') as HTMLCanvasElement;
  const R = new Renderer(canvas);
  const phys = await Phys.create(T.gravity);
  const input = new Input(canvas);
  const game = new Game(R, phys, input);
  const resize = () => {
    const w = window.innerWidth, h = window.innerHeight; const dpr = Math.min(window.devicePixelRatio || 1, 2);
    R.resize(w, h, dpr); game.cam.resize(R.w, R.h, dpr);
  };
  window.addEventListener('resize', resize); resize();
  game.loadTest();
  let last = performance.now(); let manual = false;
  const tick = (now: number) => {
    if (!manual) { const dt = (now - last) / 1000; last = now; game.frame(dt); game.render(dt); }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  // ---- TEMP prototype HUD (replaced by src/ui later)
  const ui = document.getElementById('ui')!;
  ui.insertAdjacentHTML('beforeend', `<div id="tmpInfo" style="position:absolute;left:12px;top:10px;font:700 12px/1.5 monospace;color:#252A7C;letter-spacing:.06em"></div>
  <div id="tmpHelp" style="position:absolute;left:50%;top:10px;transform:translateX(-50%);font:11px/1.5 monospace;color:#252A7C;text-align:center;max-width:62vw;background:#EDE3CFcc;padding:4px 8px"></div>
  <button id="tmpAct" style="position:absolute;right:calc(18px + env(safe-area-inset-right));bottom:calc(18px + env(safe-area-inset-bottom));width:84px;height:84px;border:3px solid #252A7C;background:#FF4F3F;color:#EDE3CF;font:800 13px monospace;pointer-events:auto;touch-action:none">УДАР</button>
  <button id="tmpHeavy" style="position:absolute;right:calc(112px + env(safe-area-inset-right));bottom:calc(18px + env(safe-area-inset-bottom));width:64px;height:64px;border:3px solid #252A7C;background:#EDE3CF;color:#252A7C;font:800 11px monospace;pointer-events:auto;touch-action:none">ОБЪЁМ</button>`);
  const info = document.getElementById('tmpInfo')!, help = document.getElementById('tmpHelp')!, bA = document.getElementById('tmpAct')!, bH = document.getElementById('tmpHeavy')!;
  const stop = (e: Event) => { e.preventDefault(); e.stopPropagation(); };
  bA.addEventListener('pointerdown', (e) => { stop(e); input.actionDown(); }); bA.addEventListener('pointerup', (e) => { stop(e); input.actionUp(); });
  bH.addEventListener('pointerdown', (e) => { stop(e); input.heavyTap(); });
  setInterval(() => {
    const p = game.player; info.textContent = `ПРОЧНОСТЬ ${'■'.repeat(Math.max(0, p.hp))}${'□'.repeat(Math.max(0, p.s.maxHp - p.hp))}   ЗАРЯДЫ ${'⊕'.repeat(p.charges)}${'○'.repeat(Math.max(0, p.s.charges - p.charges))}   СНЯТО ${game.kills}`;
    bA.textContent = p.held ? 'БРОСОК' : 'УДАР/ХВАТ'; bH.style.background = p.heavyArmed > 0 ? '#F5B915' : '#EDE3CF';
    help.textContent = input.touchMode ? 'Слева — стик (вверх = подпрыгнуть). Справа: тап — прыжок в точку / на врага, тяни — прицел в замедлении. ОБЪЁМ — следующий прыжок уносит всё вокруг.' : 'A/D — бег, Пробел — подпрыгнуть. ЛКМ: клик — прыжок, зажать — прицел в замедлении. ПКМ/E — удар, хват, бросок. Q — ОБЪЁМ (тяжёлый прыжок).';
  }, 120);
  // debug / QA API
  (window as any).__offset = {
    game, T,
    manual(on: boolean) { manual = on; },
    /** deterministic fast-forward: n frames of 1/60 */
    advance(n: number, render = true) { for (let i = 0; i < n; i++) game.frame(1 / 60); if (render) game.render(1 / 60); },
    state() { const p = game.player; return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, hp: p.hp, charges: p.charges, grounded: p.grounded, dyn: game.st.dynCount, statics: game.st.root.chunks.length, particles: game.fx.n, stepMs: phys.stepMsAvg, stepMax: phys.stepMsMax, frameMs: game.frameMs, broken: game.st.broken }; },
  };
}
boot().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;inset:0;padding:20px;background:#EDE3CF;color:#2B2F86;font:14px monospace;white-space:pre-wrap">${String(e && e.stack || e)}</pre>`); });
