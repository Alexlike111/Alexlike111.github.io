// One place that clears per-run gameplay state which lives in module scope (so a new game / restart never inherits it from the previous run).
import { held, dropDur, backpacks, inv } from './inventory';
import { toolState, sinterQ } from './tools';
import { body } from './player';
import { G } from './state';
import { resetSearch } from './search';

export function resetRun() {
  held.torchLit = held.lanternLit = false; held.load = 0; held.swing = 0; held.using = false;
  toolState.flares.length = 0; toolState.fish.state = 'idle'; toolState.fish.t = 0; toolState.eatP = 0; toolState.throwing = false;
  toolState.dig.p = 0; toolState.dig.tx = -1; toolState.cut.p = 0; toolState.cut.tx = -1; toolState.blockRefund = 0; toolState.blockDens = 0; toolState.tampT = 0;
  toolState.dome = false; toolState.smart = false;
  sinterQ.length = 0;
  dropDur.clear(); backpacks.clear(); resetSearch();
  inv.sled = null;
  body.stats.daysSurvived = 0; body.stats.deaths = 0; body.sleepFix = null; body.sleptMin = 0; body.bedKind = '';
  G.timeScale = 1; G.paused = false;
}
