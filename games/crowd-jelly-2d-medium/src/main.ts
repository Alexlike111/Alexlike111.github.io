import './ui-kit/ui-kit.css';
import './feedback/feedback.css';
import { mountIcons, ic, setLocale, fmt } from './ui-kit/ui-kit';
import { createFeedback, type Feedback } from './feedback/feedback';
import { platform, QA } from './kit/bridge';
import { BUILD_VERSION, GAME } from './kit/config';
import { deviceClass } from './kit/device';
import { audio } from './kit/audio';
import { afterResult, rewarded, onAdPause, adShowing } from './kit/ads';
import { loadSave, persist } from './kit/save';
import { getLang, onLang, pickLang, setLang, t } from './kit/i18n';
import './kit/strings';
import './strings';
import { toast } from './kit/toast';
import { playIntro, menuEntrance } from './kit/intro';
import { closeAllPanels, latestVersion, modalOpen, openLanguage, openNews, openPanel, openSettings } from './kit/ui';
import { Game, type RunResult } from './game';
import { DEFAULTS, type Save } from './state';
import { LEVEL_COUNT, MAX_CROWD, MIN_CROWD, REQ, afterDefeat, compact, THEMES } from './levels';

mountIcons();
document.documentElement.style.setProperty('--gk-accent', GAME.accent);
document.documentElement.style.setProperty('--gk-accent-dark', GAME.accentDark);

const canvas = document.getElementById('c') as HTMLCanvasElement;
const ui = document.getElementById('ui')!;
let save: Save = { ...DEFAULTS };
let feedback: Feedback;
let screen: 'menu' | 'play' | 'result' = 'menu';
let runStartedAt = 0;
// studio intro starts at once and plays over the loader; the game boots underneath
let booted = false;
let introDone = false;
let entrance = false;
void playIntro(document.getElementById('app')!, { sting: () => audio.sting(), unlock: () => audio.unlock(), track: (n, d) => platform.track(n, d), qa: QA }).then(() => {
  introDone = true;
  entrance = true;
  if (booted && screen === 'menu') renderChrome();
});

const store = (now = false) => persist(save, now);
const newsBadge = () => save.newsSeen !== latestVersion() && (save.newsSeen !== '' || save.runs >= 3);

// ---------------------------------------------------------------- progress rules
/** Highest map the current crowd opens. */
const highest = (crowd = save.crowd): number => {
  let h = 0;
  for (let k = 0; k < LEVEL_COUNT; k++) if (crowd >= REQ[k]) h = k;
  return h;
};
const unlockedMap = (k: number): boolean => save.crowd >= REQ[k];
/** The map for the next round: the picked one if the crowd still opens it, else the best open one. */
const selLevel = (): number => (unlockedMap(save.sel) ? save.sel : highest());
const themeName = (k: number) => t(`theme${k % THEMES}`);

// ---------------------------------------------------------------- game
const game = new Game(canvas, {
  onCell(i) {
    audio.gate(i.good, i.kind === 'mul');
    updateHud();
  },
  onBoss(win) {
    if (win) audio.boom();
    else audio.lose();
  },
  onEnd(r) {
    finishRun(r);
  },
});

function finishRun(r: RunResult): void {
  const before = save.crowd;
  const prevHigh = highest(before);
  let after = r.win ? r.end : afterDefeat(before);
  after = Math.max(MIN_CROWD, Math.min(MAX_CROWD, after));
  save.crowd = after;
  save.topCrowd = Math.max(save.topCrowd, after);
  save.runs += 1;
  if (r.win) save.best[r.level] = Math.max(save.best[r.level] ?? 0, after);
  if (r.maxed) save.maxed = true;
  const newHigh = highest(after);
  const opened: number[] = [];
  for (let k = prevHigh + 1; k <= newHigh; k++) opened.push(k);
  if (opened.length && save.sel === prevHigh) save.sel = newHigh;
  store(true);
  platform.track('run_end', {
    level: r.level + 1, win: r.win, crowd_start: r.start, crowd_end: after, mistakes: r.mistakes, maps_open: newHigh + 1,
    duration_s: Math.round((performance.now() - runStartedAt) / 1000),
  });
  for (const k of opened) platform.track('map_unlocked', { level: k + 1, crowd: after });
  void platform.sendScore(after);
  (r.win ? audio.win : audio.lose)();
  feedback.runEnded();
  showResult(r, before, after, opened);
}

function startRun(): void {
  closeAllPanels();
  const level = selLevel();
  if (!unlockedMap(level)) return;
  screen = 'play';
  runStartedAt = performance.now();
  audio.setMood(level % THEMES);
  game.start(level, save.crowd);
  platform.track('run_start', { level: level + 1, crowd: save.crowd, runs_total: save.runs });
  renderChrome();
  if (!save.hintShown) { save.hintShown = true; store(); showHint(); }
}

// ---------------------------------------------------------------- chrome (HUD, menu)
function renderChrome(): void {
  ui.querySelectorAll('#hud, #menu, #hint').forEach((e) => e.remove());
  if (screen === 'play') renderHud();
  if (screen === 'menu') renderMenu();
}

function renderHud(): void {
  const hud = document.createElement('div');
  hud.id = 'hud';
  hud.style.cssText = 'position:absolute;left:0;right:0;top:0;display:flex;align-items:center;gap:8px;padding:8px 10px;pointer-events:none';
  hud.innerHTML = `<button id="pauseBtn" class="gk-btn round small" aria-label="${t('pause')}" style="pointer-events:auto;width:46px;min-height:46px">${ic('pause')}</button>
    <span class="gk-pill" style="min-width:0">${ic('hero')}<span class="gk-num" id="hudCrowd"></span></span>
    <span style="flex:1"></span>
    <span class="gk-pill" style="min-width:0"><span class="gk-num" id="hudMap"></span></span>`;
  ui.appendChild(hud);
  hud.querySelector('#pauseBtn')!.addEventListener('click', () => pausePanel());
  updateHud();
}

function updateHud(): void {
  const s = (id: string, v: string) => { const e = document.getElementById(id); if (e) e.textContent = v; };
  s('hudCrowd', fmt(Math.round(game.shown)));
  s('hudMap', t('mapN', { n: (game.level?.index ?? 0) + 1 }));
}
setInterval(() => screen === 'play' && updateHud(), 80);

function renderMenu(): void {
  const lv = selLevel();
  game.setIdle(lv % THEMES, save.crowd);
  const next = REQ.findIndex((r) => r > save.crowd);
  const goal = next === -1 ? t('allOpen') : t('goal', { n: fmt(REQ[next]) });
  const pct = next === -1 ? 100 : Math.min(100, Math.round(((save.crowd - (REQ[next - 1] ?? 0)) / (REQ[next] - (REQ[next - 1] ?? 0))) * 100));
  const m = document.createElement('div');
  m.id = 'menu';
  m.style.cssText = 'position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:flex-start;gap:clamp(8px,2.2vh,18px);padding:clamp(16px,6vh,56px) 16px 16px;pointer-events:none;text-align:center';
  m.innerHTML = `<h1 style="margin:0;max-width:100%;overflow-wrap:anywhere;font:900 clamp(30px,min(9vh,11vw),76px)/1.05 var(--gk-font);color:#fff;-webkit-text-stroke:6px var(--gk-ink);paint-order:stroke fill;text-shadow:0 6px 0 var(--gk-ink)">${t('title')}</h1>
    <div style="font:900 clamp(15px,2.6vh,22px) var(--gk-font);color:#fff;text-shadow:0 2px 0 var(--gk-ink)">${t('mapN', { n: lv + 1 })} · ${themeName(lv)}</div>
    <div style="width:min(78vw,320px)" aria-label="${goal}">
      <div style="height:12px;border-radius:8px;background:rgba(42,31,61,.55);padding:2px"><div style="height:100%;width:${pct}%;border-radius:6px;background:#ffd23c"></div></div>
      <div style="margin-top:4px;font:800 clamp(12px,2vh,16px) var(--gk-font);color:#fff;text-shadow:0 2px 0 var(--gk-ink)">${goal}</div>
    </div>
    <div style="flex:1;min-height:clamp(20px,22vh,200px)"></div>
    <button id="playBtn" class="gk-btn big idle-pulse" style="pointer-events:auto">${ic('play')} ${t('play')}</button>
    <div style="display:flex;gap:12px;pointer-events:auto">
      <button id="mapBtn" class="gk-btn round gold" aria-label="${t('map')}">${ic('map')}</button>
      <button id="setBtn" class="gk-btn round blue" aria-label="${t('settings')}">${ic('settings')}</button>
      <button id="langBtn" class="gk-btn round blue" aria-label="${t('language')}">${ic('globe')}</button>
      <button id="newsBtn" class="gk-btn round purple" aria-label="${t('whatsNew')}" style="position:relative">${ic('gift')}${newsBadge() ? '<span class="gk-badge">!</span>' : ''}</button>
    </div>`;
  ui.appendChild(m);
  if (!introDone) m.style.visibility = 'hidden';
  else if (entrance) { entrance = false; menuEntrance(m); }
  m.querySelector('#playBtn')!.addEventListener('click', () => { audio.unlock(); audio.click(); startRun(); });
  m.querySelector('#mapBtn')!.addEventListener('click', () => { audio.unlock(); audio.click(); mapPanel(); });
  m.querySelector('#setBtn')!.addEventListener('click', () => { audio.unlock(); audio.click(); settingsPanel(); });
  m.querySelector('#langBtn')!.addEventListener('click', () => { audio.click(); openLanguage(); });
  m.querySelector('#newsBtn')!.addEventListener('click', () => { audio.click(); newsPanel(); });
}

function showHint(): void {
  const h = document.createElement('div');
  h.id = 'hint';
  h.style.cssText = 'position:absolute;left:50%;bottom:14px;transform:translateX(-50%);max-width:min(90%,520px);padding:8px 16px 10px;border-radius:14px;background:rgba(42,31,61,.78);color:#fff;font:800 15px/1.25 var(--gk-font);text-align:center;pointer-events:none;transition:opacity .4s';
  h.textContent = t(deviceClass() === 'touch' ? 'hintTouch' : 'hintMouse');
  ui.appendChild(h);
  setTimeout(() => { h.style.opacity = '0'; setTimeout(() => h.remove(), 500); }, 7000);
}

// ---------------------------------------------------------------- panels
function pausePanel(): void {
  if (screen !== 'play' || modalOpen()) return;
  game.pause();
  audio.click();
  const h = openPanel(t('pause'), `<div style="display:grid;gap:12px;margin-top:8px">
      <button class="gk-btn big" data-a="resume">${ic('play')} ${t('resume')}</button>
      <button class="gk-btn blue" data-a="settings">${ic('settings')} ${t('settings')}</button>
      <button class="gk-btn red small" data-a="menu">${ic('home')} ${t('menu')}</button></div>`, { onClose: () => { if (!modalOpen() && screen === 'play') game.resume(); } });
  h.body.addEventListener('click', (e) => {
    const a = (e.target as HTMLElement).closest('button')?.getAttribute('data-a');
    if (a === 'resume') h.close();
    if (a === 'settings') { settingsPanel(); }
    if (a === 'menu') { game.stop(); screen = 'menu'; h.close(); renderChrome(); }
  });
}

function settingsPanel(): void {
  const wasRunning = screen === 'play';
  if (wasRunning) game.pause();
  openSettings({
    sound: save.sound, music: save.music,
    onSound: (on) => { save.sound = on; audio.setSound(on); store(); },
    onMusic: (on) => { save.music = on; audio.setMusic(on); store(); },
    onLanguage: () => openLanguage(),
    onNews: () => newsPanel(),
    onFeedback: { label: feedback.label(), prize: feedback.canSend() ? ic('hero') + ' 50' : undefined, run: () => feedback.open('menu') },
    newsBadge: newsBadge(),
  });
}

function newsPanel(): void {
  openNews(() => { save.newsSeen = latestVersion(); store(); renderChrome(); });
}

/** Map list: a map opens only when the crowd is big enough. */
function mapPanel(): void {
  const hi = highest();
  const cur = selLevel();
  const cards = Array.from({ length: LEVEL_COUNT }, (_, k) => {
    const open = unlockedMap(k);
    const tag = !open ? '' : k === hi ? t('recommended') : save.crowd > REQ[k] * 4 && k > 0 ? t('tooEasy') : '';
    const status = open
      ? (save.best[k] ? t('cleared', { n: compact(save.best[k]) }) : tag || ' ')
      : `${ic('lock')} ${t('need', { n: compact(REQ[k]) })}`;
    const line2 = open && save.best[k] && tag ? tag : '';
    return `<button class="gk-btn small ${open ? (k === cur ? '' : 'blue') : 'grey'}" data-map="${k}" ${open ? '' : 'disabled aria-disabled="true"'} title="${open ? '' : t('locked', { n: fmt(REQ[k]) })}" style="min-width:0;padding:8px 6px;min-height:68px;flex-direction:column;gap:2px;line-height:1.15;${open ? '' : 'opacity:.62;'}">
      <span style="font-weight:900">${t('mapN', { n: k + 1 })}</span>
      <span style="font-size:.7em;font-weight:800;opacity:.9">${themeName(k)}</span>
      <span style="font-size:.72em;font-weight:900">${status}</span>${line2 ? `<span style="font-size:.66em;font-weight:900">${line2}</span>` : ''}</button>`;
  }).join('');
  const h = openPanel(t('map'), `<div style="text-align:center;font:900 18px var(--gk-font);margin:4px 0 8px">${ic('hero')} ${fmt(save.crowd)}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;max-height:56vh;overflow:auto;padding:2px">${cards}</div>`);
  setTimeout(() => h.body.querySelector(`[data-map="${cur}"]`)?.scrollIntoView({ block: 'center' }), 60);
  h.body.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button[data-map]') as HTMLButtonElement | null;
    if (!b || b.disabled) return;
    const k = Number(b.getAttribute('data-map'));
    if (!unlockedMap(k)) return;
    audio.click();
    save.sel = k;
    store();
    h.close();
    if (screen === 'menu') startRun();
  });
}

function showResult(r: RunResult, before: number, after: number, opened: number[]): void {
  screen = 'result';
  renderChrome();
  const d = after - before;
  const dTxt = `${d >= 0 ? '+' : '−'}${fmt(Math.abs(d))}`;
  const notes = [
    r.win ? '' : `<div style="font:800 15px/1.3 var(--gk-font);margin-top:6px">${t('retreat')}</div>`,
    ...opened.map((k) => `<div class="gk-pill" style="margin-top:8px;min-width:0">${ic('lock')}<span class="gk-num">${t('unlocked', { n: k + 1 })}</span></div>`),
    r.maxed ? `<div style="font:900 18px/1.3 var(--gk-font);margin-top:8px;color:var(--gk-accent-dark)">${t('kingdom')}</div>` : '',
  ].join('');
  const h = openPanel(r.win ? t('win') : t('defeat'), `<div style="text-align:center;margin:8px 0 14px;font:900 20px/1.4 var(--gk-font)">
      <div>${t('before')}: ${fmt(before)}</div>
      <div id="resNow">${t('now')}: ${fmt(after)} <span style="color:${d >= 0 ? '#1fa97a' : '#cc3a3a'}">(${dTxt})</span></div>
      ${notes}</div>
    <div style="display:grid;gap:12px">
      ${after < MAX_CROWD ? `<button class="gk-btn purple" data-a="bonus">${ic('video-ad')} ${t('bonus')}</button>` : ''}
      <button class="gk-btn big" data-a="next">${ic(r.win ? 'arrow-right' : 'restart')} ${r.win ? t('next') : t('again')}</button>
      <div style="display:flex;gap:10px"><button class="gk-btn gold small" data-a="maps" style="flex:1;min-width:0">${ic('map')} ${t('map')}</button>
      <button class="gk-btn blue small" data-a="menu" style="flex:1;min-width:0">${ic('home')} ${t('menu')}</button></div></div>`, { onClose: () => { if (screen === 'result') { game.stop(); screen = 'menu'; renderChrome(); } } });
  let busy = false;
  h.body.addEventListener('click', async (e) => {
    const btn = (e.target as HTMLElement).closest('button');
    const a = btn?.getAttribute('data-a');
    if (!btn || !a || busy) return;
    audio.click();
    busy = true;
    if (a === 'bonus') {
      if (await rewarded('bonus_jellies')) {
        const old = save.crowd;
        save.crowd = Math.min(MAX_CROWD, Math.floor(save.crowd * 1.25));
        save.topCrowd = Math.max(save.topCrowd, save.crowd);
        store(true);
        btn.remove();
        audio.coin();
        const now = h.body.querySelector('#resNow');
        if (now) now.innerHTML = `${t('now')}: ${fmt(save.crowd)} <span style="color:#1fa97a">(+${fmt(save.crowd - old)})</span>`;
        for (const k of Array.from({ length: LEVEL_COUNT }, (_, i) => i)) if (REQ[k] > old && REQ[k] <= save.crowd) { toast(t('unlocked', { n: k + 1 })); platform.track('map_unlocked', { level: k + 1, crowd: save.crowd }); }
      }
      busy = false;
    } else if (a === 'next') {
      // the only place an interstitial may run: the tap on Next / Try again, after the result
      await afterResult();
      startRun();
      feedback.maybePrompt();
    } else if (a === 'maps') {
      h.close();
      busy = false;
      mapPanel();
    } else if (a === 'menu') {
      h.close(); game.stop(); screen = 'menu'; renderChrome();
      feedback.maybePrompt();
    }
  });
}

// ---------------------------------------------------------------- input: mouse and keyboard first
function canvasPoint(e: PointerEvent): [number, number] {
  const r = canvas.getBoundingClientRect();
  return [e.clientX - r.left, e.clientY - r.top];
}
canvas.addEventListener('pointerdown', (e) => {
  audio.unlock();
  if (screen === 'play' && !modalOpen()) game.pointer(...canvasPoint(e));
});
window.addEventListener('keydown', (e) => {
  if (e.repeat || modalOpen() || adShowing()) return;
  const k = e.key.toLowerCase();
  if (screen === 'menu' && (k === 'enter' || k === ' ')) { e.preventDefault(); audio.unlock(); startRun(); return; }
  if (screen !== 'play') return;
  if (k === 'arrowup' || k === 'w') { e.preventDefault(); game.moveLane(-1); }
  else if (k === 'arrowdown' || k === 's') { e.preventDefault(); game.moveLane(1); }
  else if (k === '1' || k === '2' || k === '3') game.setLane(Number(k) - 1);
  else if (k === 'p' || k === 'escape') pausePanel();
  else if (k === 'm') { save.sound = !save.sound; audio.setSound(save.sound); store(); toast(ic(save.sound ? 'sound-on' : 'sound-off')); }
});

// ---------------------------------------------------------------- platform events
let pausedByHost = false;
platform.onPause(() => { pausedByHost = true; audio.pause(); if (screen === 'play') pausePanel(); });
platform.onResume(() => { if (pausedByHost) { pausedByHost = false; audio.resume(); } });
platform.onAudioEnabledChange((on) => audio.setPlatformAudio(on));
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { audio.pause(); if (screen === 'play') pausePanel(); }
  else audio.resume();
});
// an ad pauses the game and the audio; the game goes on only if no panel is open
onAdPause((p) => {
  if (p) { game.pause(); audio.pause(); }
  else { audio.resume(); if (!modalOpen() && screen === 'play') game.resume(); }
});
window.addEventListener('error', () => platform.logError());

// ---------------------------------------------------------------- boot
function sanitize(): void {
  const c = Number(save.crowd);
  save.crowd = Number.isFinite(c) ? Math.max(MIN_CROWD, Math.min(MAX_CROWD, Math.floor(c))) : MIN_CROWD;
  if (!Array.isArray(save.best) || save.best.length !== LEVEL_COUNT) save.best = Array.from({ length: LEVEL_COUNT }, (_, i) => Number(save.best?.[i]) || 0);
  if (!Number.isInteger(save.sel) || save.sel < 0 || save.sel >= LEVEL_COUNT) save.sel = 0;
  save.topCrowd = Math.max(Number(save.topCrowd) || MIN_CROWD, save.crowd);
}

async function boot(): Promise<void> {
  save = await loadSave(DEFAULTS);
  sanitize();
  const lang = save.lang ?? pickLang(await platform.getLanguage());
  setLang(lang);
  setLocale(lang);
  onLang(() => {
    save.lang = getLang();
    setLocale(getLang());
    document.title = t('title');
    store();
    renderChrome();
  });
  audio.setSound(save.sound);
  audio.setMusic(save.music);
  audio.setPlatformAudio(platform.isAudioEnabled());
  document.title = t('title');

  feedback = createFeedback({
    gameVersion: BUILD_VERSION,
    lang: getLang,
    track: (name, data) => platform.track(name, data),
    load: () => save.fb,
    save: (s) => { save.fb = { ...s }; store(true); },
    reward: () => ({ html: `${ic('hero')} 50`, give: () => { save.crowd = Math.min(MAX_CROWD, save.crowd + 50); store(); updateHud(); } }),
    sfx: (k) => (k === 'send' ? audio.coin() : audio.click()),
    onOpen: () => game.pause(),
    onClose: () => { if (!modalOpen() && screen === 'play') game.resume(); },
  });

  booted = true;
  renderChrome();
  game.render();
  document.getElementById('loading')!.style.opacity = '0';
  setTimeout(() => document.getElementById('loading')?.remove(), 350);
  platform.firstFrameReady();
  platform.gameReady();
  platform.track('game_open', { lang, runs_total: save.runs, crowd: save.crowd, maps_open: highest() + 1 });

  if (QA) {
    let bot = 0;
    Object.assign((window.__qa ??= { events: [] }), {
      clockOffset: 0,
      screen: () => screen,
      state: () => ({
        screen, crowd: save.crowd, live: game.crowd, running: game.isRunning, paused: game.isPaused, lane: game.currentLane,
        level: game.level?.index ?? -1, sel: selLevel(), high: highest(), runs: save.runs, best: save.best, lang: getLang(), modal: modalOpen(),
        maxed: save.maxed, boss: game.level?.boss ?? 0, progress: game.progress,
      }),
      next: () => game.qaNext(),
      level: () => (game.level ? { index: game.level.index, scale: game.level.scale, rows: game.level.rows, boss: game.level.boss } : null),
      finish: (win = true) => game.qaFinish(win),
      setCrowd: (n: number) => { save.crowd = n; game.qaSetCrowd(n); store(true); renderChrome(); },
      autoplay: (on: boolean) => {
        clearInterval(bot);
        if (on) bot = window.setInterval(() => { const n = game.qaNext(); if (n) game.setLane(n.best); }, 30);
      },
      toast: (html: string) => toast(html),
      setLang: (l: string) => setLang(pickLang(l)),
    });
  }
}

void boot();
