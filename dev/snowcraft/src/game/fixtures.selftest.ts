// Self-tests of the fixture state words (wave 5, AGENTS_W5 §1): tooltips and the E toast of fires, the pot and the kettle show words, never numbers
// (the exact hours and litres stay in the bag and the journal). Each test restores the world it changes (sandbox).
import { registerTest } from './selftest';
import type { TestCtx } from './selftest';
import { G, type Fixture } from './state';
import { sandbox } from './testkit';
import { placeFixture, fixtureLabel, interact } from './fixtures';
import { clearInventory } from './inventory';

const sayDigits = (s: string) => /\d/.test(s);

registerTest('fixtures', 'огонь: подсказка словом (горит, скоро погаснет, потухла, нет топлива, не горит), без цифр', async (t: TestCtx) => {
  await sandbox(() => {
    const f = placeFixture('campfire', 300, 200, { force: true, fuel: 120, lit: true }) as Fixture;
    const label = () => fixtureLabel(f);
    t.expect(/Горит/.test(label()) && !sayDigits(label()), 'горит: ' + label());
    f.fuel = 5; t.expect(/Скоро погаснет/.test(label()), 'мало топлива: ' + label());
    f.fuel = 200; f.lit = false; f.data = { ...(f.data ?? {}), age: 9 }; t.expect(/Потухла/.test(label()), 'погас с топливом: ' + label());
    f.fuel = 0; t.expect(/Нет топлива/.test(label()) && !sayDigits(label()), 'без топлива: ' + label());
    const g = placeFixture('campfire', 310, 200, { force: true, fuel: 60 }) as Fixture;
    t.expect(/Не горит/.test(fixtureLabel(g)) && !sayDigits(fixtureLabel(g)), 'не зажигали: ' + fixtureLabel(g));
  });
});

registerTest('fixtures', 'E у горящего костра: тост «Костёр: Горит», без часов', async (t: TestCtx) => {
  await sandbox(() => {
    clearInventory();
    const f = placeFixture('campfire', 320, 200, { force: true, fuel: 50, lit: true }) as Fixture;
    G.toasts.length = 0;
    interact(f);
    const last = G.toasts[G.toasts.length - 1]?.text ?? '';
    t.expect(/Горит/.test(last) && !sayDigits(last), 'тост: ' + last);
  });
});

registerTest('fixtures', 'котёл и печь: вода и снег словами; полный котёл; горячая вода у огня', async (t: TestCtx) => {
  await sandbox(() => {
    const pot = placeFixture('pot', 340, 200, { force: true }) as Fixture;
    pot.data = { ...(pot.data ?? {}), snow: 2, ice: 0, water: 0, prog: 0 };
    t.expect(/Холодный снег/.test(fixtureLabel(pot)) && !sayDigits(fixtureLabel(pot)), 'снег холодный: ' + fixtureLabel(pot));
    pot.data!.snow = 6; t.expect(/Полный/.test(fixtureLabel(pot)), 'котёл полон: ' + fixtureLabel(pot));
    pot.data!.snow = 0; pot.data!.water = 2; t.expect(/Холодная вода/.test(fixtureLabel(pot)) && !sayDigits(fixtureLabel(pot)), 'вода холодная: ' + fixtureLabel(pot));
    placeFixture('campfire', 342, 200, { force: true, fuel: 100, lit: true });
    t.expect(/Горячая вода/.test(fixtureLabel(pot)) && !sayDigits(fixtureLabel(pot)), 'вода у огня: ' + fixtureLabel(pot));
  });
});
