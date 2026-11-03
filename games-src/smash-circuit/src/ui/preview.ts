// DEV ONLY (ui-preview.html): shows every UI screen with fake data for screenshots.
// Query: ?screen=menu|tracks|garage|settings|hud|hudTouch|pause|results|resultsDouble|tutorialTouch|tutorialKeys
//        &lang=en|ru  &poor=1 (little money)  &q=1 (nothing else)
import { CONFIG } from '../config';
import { initLang } from '../i18n';
import { InputController } from '../input/input';
import { defaultSave } from '../meta/save';
import type { CarState, ISim, SaveData } from '../types';
import { UI } from './ui';

const params = new URLSearchParams(location.search);
const screen = params.get('screen') ?? 'menu';
const langParam = (params.get('lang') ?? 'en') as 'en' | 'ru';
initLang(langParam, langParam);

const save: SaveData = defaultSave();
save.settings.lang = langParam;
save.money = params.has('poor') ? 120 : 1830;
save.carUpgrades = { scrapper: { engine: 2, grip: 1, armor: 4 } };
save.car = params.get('car') ?? 'scrapper';
save.carRaces = { scrapper: 7, brick: 2 };
save.carWins = { scrapper: 3 };
if (params.get('rivals')) save.settings.rivals = params.get('rivals') as SaveData['settings']['rivals'];
save.unlockedTracks = ['t1', 't2'];
save.bestPlace = { t1: 1, t2: 4 };
save.bestLap = { t1: 71.42, t2: 98.1 };
save.carColor = 1;

function fakeCar(id: number, over: Partial<CarState> = {}): CarState {
  const hp = { front: 100, rear: 100, left: 100, right: 100, engine: 100, wheelFL: 100, wheelFR: 100, wheelRL: 100, wheelRR: 100 };
  return {
    id, isPlayer: id === 0, colorIndex: id, name: 'Car' + id, x: 0, y: 0, angle: 0, vx: 0, vy: 0, angularVel: 0, speed: 31.5, steer: 0,
    throttle: 1, brake: 0, handbrake: false, rpm: 0.6, drifting: false, slip: 0, hp, zoneMaxHp: 100, health: 1,
    effects: { powerMul: 1, topSpeedMul: 1, gripMul: 1, steerPull: 0, smoke: 0, sparks: 0 }, detachedParts: [], wrecked: false,
    lap: 1, progress: 1200, place: id + 1, finished: false, finishTime: 0, lastLapTime: 72.31, bestLapTime: 71.42, onCurb: false, offRoad: false, ...over,
  };
}

function fakeSim(phase: 'countdown' | 'racing', countdown = 2.2): ISim {
  const p = fakeCar(0, {
    place: 3, lap: 1, health: 0.62,
    hp: { front: 30, rear: 70, left: 90, right: 55, engine: 80, wheelFL: 100, wheelFR: 45, wheelRL: 100, wheelRR: 100 },
  });
  const cars = [p, ...Array.from({ length: 7 }, (_, i) => fakeCar(i + 1))];
  return {
    cars, race: { phase, countdown, time: phase === 'racing' ? 83.17 : 0, totalLaps: 3, playerFinished: false, results: [] },
  } as unknown as ISim;
}

const root = document.getElementById('ui')!;
const noop = (): void => undefined;
const ui = new UI(root, {
  start: noop, pause: noop, resume: noop, quit: noop, restart: noop, repair: noop, buy: noop,
  doubleReward: () => new Promise((r) => setTimeout(() => r(true), 600)),
  settings: noop, color: noop, continueAfterResults: noop, selectCar: noop, previewCar: noop,
});

const touch = screen.endsWith('Touch') || params.has('touch');
const input = new InputController(root);
input.setLabels('GAS', 'BRAKE');

switch (screen) {
  case 'menu': ui.showMainMenu(save); break;
  case 'tracks': ui.showTrackSelect(save); break;
  case 'garage': ui.showGarage(save, params.get('show') ?? undefined); break;
  case 'rivals': ui.showTrackSelect(save); (document.querySelector('[data-act="rivals"]') as HTMLElement | null)?.click(); break;
  case 'settings': ui.showSettings(save); break;
  case 'hud':
  case 'hudTouch':
  case 'hudCountdown':
  case 'tutorialTouch':
  case 'tutorialKeys': {
    ui.setTouchMode(touch);
    ui.showHud(save.money);
    const cd = screen === 'hudCountdown' || screen.startsWith('tutorial');
    ui.updateHud(fakeSim(cd ? 'countdown' : 'racing'), 60);
    input.setTouchActive(touch);
    input.setEnabled(touch);
    if (screen.startsWith('tutorial')) ui.showTutorial(touch);
    if (params.has('toast')) ui.toast('Final lap!');
    break;
  }
  case 'pause': ui.showHud(save.money); ui.showPause(params.has('poor') ? 400 : 138, save.money); break;
  case 'results':
  case 'resultsDouble':
    ui.showResults({ place: params.has('p') ? Number(params.get('p')) : 2, time: 231.55, bestLap: 71.42, reward: 420 + 14 * CONFIG.economy.destructionBonus, canDouble: true, unlocked: 't3', newBestLap: true });
    if (screen === 'resultsDouble') setTimeout(() => (document.querySelector('[data-act="double"]') as HTMLElement | null)?.click(), 50);
    break;
  default: ui.showMainMenu(save);
}
(window as unknown as { __ui: UI; __input: InputController }).__ui = ui;
(window as unknown as { __input: InputController }).__input = input;
