// Ragdoll Lab studio intro + animated menu entrance. Pure SVG/CSS, no assets, ~3 KB gzipped.
// Logo <= 1.9 s, skippable by click/key, runs over the loader while the game boots in parallel.
export interface IntroHooks { sting(): void; unlock(): void; track(name: string, data: Record<string, string | number | boolean>): void; qa: boolean; }

const CSS = `
#rl-intro{position:absolute;inset:0;z-index:95;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2.2vh;background:radial-gradient(circle at 50% 45%,#4a3470,#241a38 70%);cursor:pointer;transition:opacity .35s;overflow:hidden}
#rl-intro.out{opacity:0;pointer-events:none}
#rl-intro .glow{position:absolute;width:60vh;height:60vh;border-radius:50%;background:radial-gradient(var(--gk-accent,#ff5fa2),transparent 65%);opacity:0;animation:rlglow 1.6s .25s ease-out forwards}
#rl-intro svg.head{width:min(22vh,26vw);height:auto;overflow:visible;transform-origin:50% 100%;animation:rldrop .85s cubic-bezier(.3,0,.6,1) both;filter:drop-shadow(0 .8vh 0 #0006)}
#rl-intro .word{font:900 clamp(26px,7.5vh,64px)/1 var(--gk-font,system-ui);color:#fff;letter-spacing:.02em;-webkit-text-stroke:.9vh #1a1228;paint-order:stroke fill;text-shadow:0 .7vh 0 #1a1228;display:flex;gap:.28em;position:relative;overflow:hidden;padding:.1em .25em}
#rl-intro .word b{display:inline-block;opacity:0;transform:translateY(60%) scale(.6);animation:rlpop .45s cubic-bezier(.3,1.6,.5,1) forwards}
#rl-intro .word::after{content:"";position:absolute;top:0;bottom:0;width:30%;left:0;transform:translateX(-140%) skewX(-20deg);background:linear-gradient(100deg,transparent,#fff9,transparent);animation:rlshine .7s 1.0s ease-out forwards}
#rl-intro .sub{font:800 clamp(11px,2.2vh,18px) var(--gk-font,system-ui);color:#d9cdf5;letter-spacing:.35em;text-transform:uppercase;opacity:0;animation:rlfade .4s 1.15s forwards}
@keyframes rldrop{0%{transform:translateY(-70vh) scale(.9,1.1) rotate(-14deg)}45%{transform:translateY(0) scale(1.25,.7) rotate(0)}62%{transform:translateY(-5vh) scale(.92,1.1) rotate(6deg)}80%{transform:translateY(0) scale(1.1,.9)}100%{transform:none}}
@keyframes rlpop{to{opacity:1;transform:none}}
@keyframes rlshine{to{transform:translateX(430%) skewX(-20deg)}}
@keyframes rlfade{to{opacity:.9}}
@keyframes rlglow{0%{opacity:0;transform:scale(.3)}40%{opacity:.5}100%{opacity:.18;transform:scale(1)}}
/* menu entrance: children rise in one by one, title bounces, soft floating sparkles */
#menu.rl-in>*:not(.rl-spark){opacity:0;animation:rlrise .55s cubic-bezier(.2,1.5,.5,1) forwards}
#menu.rl-in>*:nth-child(1){animation:rltitle .8s forwards,rlbob 3.2s 1.2s ease-in-out infinite}
#menu.rl-in>*:nth-child(2){animation-delay:.18s}
#menu.rl-in>*:nth-child(3){animation-delay:.3s}
#menu.rl-in>*:nth-child(4){animation-delay:.42s}
@keyframes rlrise{from{opacity:0;transform:translateY(5vh) scale(.85)}to{opacity:1;transform:none}}
@keyframes rltitle{0%{opacity:0;transform:translateY(-8vh) scale(1.3) rotate(-4deg)}60%{opacity:1;transform:scale(.95) rotate(1deg)}100%{opacity:1;transform:none}}
@keyframes rlbob{50%{transform:translateY(-.8vh) rotate(-.6deg)}}
.rl-spark{position:absolute;bottom:-4vh;border-radius:50%;background:#fff;opacity:0;pointer-events:none;animation:rlfloat linear infinite}
@keyframes rlfloat{0%{opacity:0;transform:translateY(0)}15%{opacity:.55}100%{opacity:0;transform:translateY(-110vh) translateX(4vw)}}
@media (prefers-reduced-motion:reduce){#rl-intro *,#menu *{animation-duration:.01s!important;animation-delay:0s!important}}
`;

export const INTRO_CSS = CSS;
const HEAD = `<svg class="head" viewBox="0 0 120 120" aria-hidden="true">
<ellipse cx="60" cy="112" rx="34" ry="6" fill="#0004"/>
<path d="M30 80q-14 6-18 20M90 80q14 6 18 20" stroke="#1a1228" stroke-width="14" stroke-linecap="round" fill="none"/>
<path d="M30 80q-14 6-18 20M90 80q14 6 18 20" stroke="#ffc93c" stroke-width="7" stroke-linecap="round" fill="none"/>
<circle cx="60" cy="58" r="44" fill="#ffc93c" stroke="#1a1228" stroke-width="6"/>
<path d="M30 30q30-20 62 0" stroke="#fff8" stroke-width="6" stroke-linecap="round" fill="none"/>
<g stroke="#1a1228" stroke-width="6" stroke-linecap="round"><path d="M38 46l16 12M54 46L38 58"/><circle cx="82" cy="52" r="7" fill="#1a1228"/></g>
<path d="M42 78q18 14 36 0" stroke="#1a1228" stroke-width="6" stroke-linecap="round" fill="none"/>
<path d="M60 14v10M56 19h8" stroke="#c92d74" stroke-width="3" stroke-linecap="round"/>
</svg>`;

function addCss(): void {
  if (document.getElementById('rl-css')) return;
  const s = document.createElement('style');
  s.id = 'rl-css';
  s.textContent = CSS;
  document.head.appendChild(s);
}

export function introMarkup(): string {
  const letters = (w: string, from: number) => [...w].map((c, i) => `<b style="animation-delay:${from + i * 0.045}s">${c}</b>`).join('');
  return `<div class="glow"></div>${HEAD}<div class="word"><span>${letters('Ragdoll', 0.55)}</span><span style="color:var(--gk-gold,#ffc93c)">${letters('Lab', 0.9)}</span></div><div class="sub">presents</div>`;
}

export const INTRO_MS = 1900;

/** Shows the studio logo. Resolves when it ends or the player skips it. Skipped in QA unless ?intro=1. */
export function playIntro(app: HTMLElement, h: IntroHooks): Promise<void> {
  const qaSkip = (h.qa || navigator.webdriver) && !new URLSearchParams(location.search).has('intro');
  if (qaSkip) { document.getElementById('rl-intro')?.remove(); return Promise.resolve(); }
  addCss();
  const ms = INTRO_MS;
  // heavy games ship this markup inline in index.html (see introMarkup) so it paints before any JS runs
  let el = document.getElementById('rl-intro');
  if (!el) {
    el = document.createElement('div');
    el.id = 'rl-intro';
    el.innerHTML = introMarkup();
    app.appendChild(el);
  }
  const node = el;
  const t0 = performance.now();
  h.track('intro_shown', { ms });
  return new Promise((resolve) => {
    let done = false;
    const end = (skipped: boolean) => {
      if (done) return;
      done = true;
      window.removeEventListener('keydown', onKey, true);
      h.track('intro_end', { skipped, shown_ms: Math.round(performance.now() - t0) });
      node.classList.add('out');
      setTimeout(() => node.remove(), 380);
      resolve();
    };
    const onKey = (e: KeyboardEvent) => { e.stopPropagation(); end(true); };
    node.addEventListener('pointerdown', () => { h.unlock(); end(true); });
    window.addEventListener('keydown', onKey, true);
    // the clock starts at the first painted frame, so a busy main thread at boot cannot eat the intro
    requestAnimationFrame(() => requestAnimationFrame(() => {
      setTimeout(() => h.sting(), 380);
      setTimeout(() => end(false), ms);
    }));
  });
}

/** Call right after the menu element is in the DOM (after the intro): staggered entrance + floating sparkles. */
export function menuEntrance(menu: HTMLElement): void {
  addCss();
  menu.classList.add('rl-in');
  if (menu.querySelector('.rl-spark')) return;
  for (let i = 0; i < 14; i++) {
    const s = document.createElement('i');
    s.className = 'rl-spark';
    const sz = 3 + Math.random() * 6;
    s.style.cssText = `left:${Math.random() * 100}%;width:${sz}px;height:${sz}px;animation-duration:${5 + Math.random() * 6}s;animation-delay:${Math.random() * 6}s`;
    menu.appendChild(s);
  }
}
