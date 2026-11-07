// Self-tests of the sound-off captions (overlay.ts, wave 5): in 'min' mode at most two captions are on screen and each is at most 22 characters;
// the full layout keeps up to three. Each test restores the mode it changes.
import { registerTest } from './selftest';
import type { TestCtx } from './selftest';
import { emit } from './bus';
import { sandbox } from './testkit';
import { wx } from './weather';
import { G } from './state';
import { getUiMode, setUiMode } from '../ui/hudmode';

const cues = () => [...document.querySelectorAll('#ov .cue')] as HTMLElement[];

registerTest('overlay', 'подписи: в режиме «мин» не больше двух, каждая до 22 знаков; в полном режиме до трёх', async (t: TestCtx) => {
  const prev = getUiMode();
  await sandbox(async () => {
    wx.override = { wind: 0, storm: 0, snowfall: 0 }; Object.assign(G, wx.override);
    for (const mode of ['min', 'full'] as const) {
      setUiMode(mode); await t.wait(40);
      document.querySelectorAll('#ov .cue').forEach(e => e.remove());
      emit('ice_crack', { near: true }); emit('dog_bark', { dir: 1 }); emit('seal_surface', {}); emit('ice_crack', { near: false });
      await t.wait(40);
      const shown = cues(), cap = mode === 'min' ? 2 : 3;
      t.expect(shown.length <= cap && shown.length >= 1, `${mode}: на экране ${shown.length}, нужно не больше ${cap}`);
      if (mode === 'min') t.expect(shown.every(c => [...(c.textContent ?? '')].length <= 22), 'min: подпись длиннее 22 знаков: ' + shown.map(c => c.textContent).join(' | '));
      document.querySelectorAll('#ov .cue').forEach(e => e.remove());
    }
  });
  setUiMode(prev);
});
