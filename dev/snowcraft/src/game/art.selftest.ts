// Self-tests of the art pass (SPEC §11): every item has an icon, every FixtureKind / AnimalKind / player pose draws without throwing.
import { registerTest } from './selftest';
import { ITEMS } from './items';
import type { Fixture, FixtureKind, Animal, AnimalKind, Player, View } from './state';
import { drawFixture, drawFixtureEmissive, drawAnimal, drawPlayer, drawDrop, drawTarget, drawSled, setPlayerLook, uiIcon, ANIMAL_STATES } from './draw';
import { hasSprite } from '../engine/sprites';
import { FIXTURE_SHEET } from '../art/fixtures';
import { UI_KEYS, moonIcon } from '../art/icons';
import { states, ANIMAL_KINDS } from '../art/animals';
import { HELD } from '../art/tools';

const KINDS: FixtureKind[] = ['campfire', 'fat_lamp', 'brazier', 'pot', 'drying_rack', 'skin_bed', 'hide_door', 'cache', 'snare', 'torch', 'stove', 'table', 'shelf', 'chest', 'radio', 'drum', 'bed', 'door', 'mast', 'barometer', 'flag', 'cairn', 'cart', 'kennel', 'signal_fire', 'workbench', 'furnace', 'anvil', 'helipad', 'sign', 'lantern'];
const AKINDS: AnimalKind[] = ['seal', 'fox', 'ptarmigan', 'bear', 'dog', 'fish', 'hare', 'wolf'];
const view = (): { ctx: CanvasRenderingContext2D; v: View } => {
  const c = document.createElement('canvas'); c.width = 240; c.height = 160;
  return { ctx: c.getContext('2d')!, v: { x0: 0, y0: 0, w: 240, h: 160, scale: 1, t: 1.7 } };
};
const opaque = (ctx: CanvasRenderingContext2D) => { const d = ctx.getImageData(0, 0, 240, 160).data; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) return true; return false; };

registerTest('art', 'у каждого предмета есть иконка', t => {
  const missing = Object.values(ITEMS).filter(d => !hasSprite(d.icon)).map(d => d.id);
  t.expect(missing.length === 0, 'нет иконок: ' + missing.join(', '));
  t.expect(hasSprite('note'), 'иконка записки');
  t.metric('иконок', Object.keys(ITEMS).length);
});
registerTest('art', 'иконки интерфейса и фазы луны', t => {
  for (const k of ['sun', 'wind_arrow', 'drop', 'food', 'energy', 'co', 'star_full', 'star_empty', 'warning', 'lock', 'storm', 'scent', 'dog', 'body_head', 'body_torso', 'body_hands', 'body_feet'])
    t.expect(UI_KEYS.includes(k), 'ui: ' + k);
  for (let i = 0; i < 8; i++) t.expect(moonIcon(i / 8).width > 0, 'луна ' + i);
  t.expect(uiIcon('body_head', '#aabbcc').height === 24, 'тинт фигурки');
});
registerTest('art', 'все фикстуры рисуются (все состояния)', t => {
  const seen = new Set<string>();
  for (const e of FIXTURE_SHEET) for (const vr of e.variants) {
    const { ctx, v } = view();
    const f: Fixture = { id: 2, kind: e.kind, tx: 8, ty: 8, tw: (vr.patch.tw as number) ?? e.tw, th: (vr.patch.th as number) ?? e.th, ...vr.patch };
    try { drawFixture(ctx, v, f, v.t); drawFixtureEmissive(ctx, v, f, v.t); } catch (err) { t.expect(false, `${e.kind}/${vr.name}: ${(err as Error).message}`); }
    seen.add(e.kind);
  }
  for (const k of KINDS) {
    const { ctx, v } = view();
    try { drawFixture(ctx, v, { id: 1, kind: k, tx: 8, ty: 8, tw: 2, th: 2 }, v.t); } catch (err) { t.expect(false, `${k}: ${(err as Error).message}`); }
    if (!['anvil', 'helipad'].includes(k)) t.expect(seen.has(k), 'нет в листе: ' + k);
  }
  const { ctx, v } = view(); drawFixture(ctx, v, { id: 9, kind: 'campfire', tx: 8, ty: 8, tw: 2, th: 1, lit: true, fuel: 100 }, 1);
  t.expect(opaque(ctx), 'костёр что-то рисует');
});
registerTest('art', 'все животные рисуются (все состояния)', t => {
  for (const k of AKINDS) for (const st of [...ANIMAL_STATES, 'weird_state']) {
    const { ctx, v } = view();
    const a: Animal = { id: 4, kind: k, x: 100, y: 100, vx: 5, vy: 0, w: 16, h: 10, face: 1, hp: 10, state: st, t: 0.3, onGround: true };
    try { drawAnimal(ctx, v, a, 1.3); a.face = -1; drawAnimal(ctx, v, a, 2.1); } catch (err) { t.expect(false, `${k}/${st}: ${(err as Error).message}`); }
  }
  for (const k of ANIMAL_KINDS) t.expect(states(k).length > 0, 'состояния ' + k);
  const { ctx, v } = view(); drawAnimal(ctx, v, { id: 4, kind: 'bear', x: 100, y: 100, vx: 0, vy: 0, w: 28, h: 16, face: 1, hp: 10, state: 'walk', t: 0, onGround: true }, 1); t.expect(opaque(ctx), 'медведь рисуется');
});
registerTest('art', 'игрок: позы, одежда, инструменты в руке', t => {
  const mk = (o: Partial<Player> = {}): Player => ({ x: 100, y: 100, vx: 0, vy: 0, w: 8, h: 20, face: 1, onGround: true, inWater: 0, hp: 100, maxHp: 100, core: 37, food: 80, stamina: 80, wet: 0, insul: 1, airT: -20, feelT: -30, shelter: 0, alive: true, cause: '', anim: { state: 'idle', t: 0 }, hurtT: 0, water: 80, energy: 80, frost: { hands: 0, feet: 0, face: 0 }, co: 0, parkaOpen: false, carry: 0, sleeping: false, ...o } as Player);
  const states: Partial<Player>[] = [{}, { vx: 30, anim: { state: 'walk', t: 0 } }, { vx: 80, anim: { state: 'run', t: 0 } }, { onGround: false, vy: -50 }, { onGround: false, vy: 50 }, { inWater: 0.7, anim: { state: 'swim', t: 0 } },
    { hurtT: 0.4 }, { alive: false }, { sleeping: true }, { core: 34 }, { core: 32, frost: { hands: 0, feet: 0, face: 80 } }, { face: -1 }];
  for (const look of [null, { parka: 'fur', head: 'fur', hands: 'fur', feet: 'kamik' } as const]) {
    setPlayerLook(look as never);
    for (const s of states) {
      const { ctx, v } = view();
      for (const item of [null, ...Object.keys(HELD), 'snow_block', 'cooked_meat']) {
        try { drawPlayer(ctx, v, mk(s), { item, aim: -0.6, swing: 0.5, using: item === 'snow_knife', load: 0.6 }); } catch (err) { t.expect(false, `поза ${JSON.stringify(s)} / ${item}: ${(err as Error).message}`); return; }
      }
    }
  }
  setPlayerLook(null);
  const { ctx, v } = view(); drawPlayer(ctx, v, mk(), { item: null, aim: 0, swing: 0, using: false }); t.expect(opaque(ctx), 'игрок что-то рисует');
});
registerTest('art', 'цель, ghost, предметы на земле, нарты', t => {
  const { ctx, v } = view();
  for (const mode of ['dig', 'cut', 'place', 'attack', 'use', 'chisel', 'none'] as const) for (const ok of [true, false])
    for (const ghost of [undefined, 'snow_block', 'campfire', 'fat_lamp', 'log'])
      try { drawTarget(ctx, v, { tx: 5, ty: 5, tw: 2, th: 1, mode, ok, progress: 0.5, ghostItem: ghost, margin: 0.5, lean: 1 }); } catch (err) { t.expect(false, `target ${mode}: ${(err as Error).message}`); }
  for (const id of Object.keys(ITEMS).concat(['note_n1', 'unknown_item'])) try { drawDrop(ctx, v, { id: 1, item: id, n: 1, x: 50, y: 50, vx: 0, vy: 0, age: 1 }, 0.5); } catch (err) { t.expect(false, `drop ${id}: ${(err as Error).message}`); }
  for (const l of [0, 0.5, 1]) drawSled(ctx, v, 100, 100, l);
  t.expect(true, 'ok');
});
