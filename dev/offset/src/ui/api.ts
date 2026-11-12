// CONTRACT between the game core (implements UiApi) and the DOM interface (src/ui/*).
// The UI never reaches into game internals: it polls hud() every frame and listens to `bus` for moments.
import type { L } from '../core/i18n';
import type { Meta, Proof } from '../meta/meta';

export type Mode = 'boot' | 'hub' | 'run' | 'offer' | 'summary';
export type ObjectiveKind = 'purge' | 'survive' | 'demolish' | 'boss' | 'tutorial';

export interface HudState {
  mode: Mode; paused: boolean;
  hp: number; maxHp: number;
  charges: number; maxCharges: number; /** 0..1 progress of the charge being restored */ chargeT: number;
  /** 0..1 slow-motion reserve */ focus: number;
  heavyArmed: boolean; heavyCost: number; canHeavy: boolean;
  /** what the action button will do right now */ action: 'strike' | 'grab' | 'throw';
  combo: number; comboMult: number; /** 0..1 time left before the combo drops */ comboT: number;
  /** ink collected in this run */ ink: number;
  room: number; rooms: number; biome: string; roomName: L;
  objective: { kind: ObjectiveKind; text: L; /** 0..1 */ progress: number; count: string };
  wave: number; waves: number; enemiesLeft: number;
  boss: { name: L; /** 0..1 */ hp: number; phase: number } | null;
  /** true when the last input came from a touch screen → show on-screen buttons */ touch: boolean;
  aiming: boolean; /** hero stands inside an anchor field: jumping is impossible */ jammed: boolean;
  /** contextual teaching line, or null */ hint: L | null;
  tier: number; daily: boolean; /** seconds in current run */ time: number;
}
export interface OfferOption { id: string; name: L; desc: L; rarity: 1 | 2 | 3; tag: string; icon: string; /** stacks already owned */ stack: number; max: number; isNew: boolean }
export interface OfferState { options: OfferOption[]; rerolls: number; /** sheet just cleared */ room: number; rooms: number }
export interface Summary {
  won: boolean; room: number; rooms: number; time: number; tier: number; daily: boolean;
  kills: number; killsByCause: Record<string, number>; bestCombo: number; chunks: number; jumps: number;
  /** itemised ink: base + bonuses; inkTotal is what was added to the bank */ inkLines: { label: L; amount: number }[]; inkTotal: number;
  newProofs: Proof[]; /** >0 when a new tirage tier was just unlocked */ unlockedTier: number;
  mutations: { id: string; stack: number }[];
  /** daily streak after this run (0 if not a daily) */ streak: number;
}
export interface UiApi {
  meta: Meta;
  hud(): HudState;
  offer(): OfferState | null;
  summary(): Summary | null;
  runMutations(): { id: string; stack: number }[];
  startRun(o: { tier: number; daily: boolean }): void;
  pickUpgrade(id: string): void;
  reroll(): void;
  pause(on: boolean): void;
  abandonRun(): void;
  toHub(): void;
  /** on-screen buttons (touch) */
  actionDown(): void; actionUp(): void; heavyTap(): void;
  /** call after mutating meta.s.settings */
  applySettings(): void;
}
