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
