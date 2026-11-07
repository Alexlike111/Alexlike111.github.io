// Fills stationbridge.ts. Imported by sfxhooks.ts (loaded late by main.ts) and by station.selftest.ts; never from fixtures*.ts.
import { bridge } from './stationbridge';
import { journal, questState } from './quest';
import { fauna, aiOf, setAiMode, scent } from './fauna';
import { driftState } from './drift';

bridge.journal = journal;
bridge.quest = questState;
bridge.fauna = fauna;
bridge.aiOf = aiOf as never;
bridge.setAiMode = setAiMode;
bridge.scent = scent;
bridge.drift = driftState as never;
import { artHooks } from '../art/fixtures_station';
import { boxStateOf } from './search';
artHooks.thawed = (f) => boxStateOf('f' + f.id).thawed;
export const wired = true;
