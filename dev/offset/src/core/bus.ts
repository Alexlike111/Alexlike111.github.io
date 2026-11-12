// Typed event bus. Gameplay emits, audio / fx / ui / meta listen. Keep payloads small and serialisable.
export interface Events {
  // teleport
  jump: { fromX: number; fromY: number; toX: number; toY: number; heavy: boolean; carried: number; speed: number };
  jumpDenied: { reason: 'charges' | 'anchor' | 'blocked' };
  aimStart: {}; aimEnd: {};
  // physics / destruction
  break: { x: number; y: number; mat: string; area: number; energy: number };
  collapse: { x: number; y: number; mass: number };
  impact: { x: number; y: number; force: number; mat: string };
  explode: { x: number; y: number; r: number };
  // combat
  strike: { x: number; y: number; power: number; kill: boolean };
  enemyHit: { x: number; y: number; dmg: number; kind: string; cause: string };
  enemyDie: { x: number; y: number; kind: string; cause: string; elite: boolean };
  enemyShoot: { x: number; y: number; kind: string };
  enemyAlert: { x: number; y: number; kind: string };
  enemyTelegraph: { x: number; y: number; kind: string };
  playerHurt: { hp: number; maxHp: number; cause: string };
  playerDie: {};
  playerLand: { speed: number; x: number; y: number };
  playerStep: { x: number; y: number };
  playerJump: {};
  grab: { kind: string }; throwIt: { power: number };
  combo: { n: number; mult: number };
  comboEnd: { n: number };
  pickup: { kind: 'ink' | 'hp' | 'charge'; amount: number };
  // run flow
  roomStart: { index: number; total: number; biome: string; kind: string; name: string };
  roomClear: { index: number; time: number; flawless: boolean };
  waveStart: { n: number; total: number };
  upgradeOffer: {}; upgradePicked: { id: string };
  runStart: { seed: number; tier: number; daily: boolean };
  runEnd: { won: boolean; ink: number; rooms: number; time: number };
  bossPhase: { phase: number };
  // ui / meta
  uiClick: {}; uiHover: {}; uiBuy: {}; uiDeny: {}; uiOpen: { screen: string }; uiStamp: {};
  achievement: { id: string };
  pause: { on: boolean };
  hint: { id: string };
}
type Fn<T> = (p: T) => void;
class Bus {
  private m = new Map<string, Fn<any>[]>();
  on<K extends keyof Events>(k: K, f: Fn<Events[K]>): () => void {
    let a = this.m.get(k); if (!a) this.m.set(k, (a = [])); a.push(f);
    return () => { const i = a!.indexOf(f); if (i >= 0) a!.splice(i, 1); };
  }
  emit<K extends keyof Events>(k: K, p: Events[K]): void {
    const a = this.m.get(k); if (!a) return;
    for (let i = 0; i < a.length; i++) { try { a[i](p); } catch (e) { console.error('[bus]', k, e); } }
  }
}
export const bus = new Bus();
