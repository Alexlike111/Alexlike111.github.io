// Self-tests of the Playgama layer (bridge.ts, store.ts, save.ts): a fake window.bridge-shaped object is attached per test (attachBridge) and
// detached at the end. Storage is in memory, the test fires the platform / advertisement events, the advertisement records its calls.
import { registerTest } from '../game/selftest';
import type { TestCtx } from '../game/selftest';
import { G } from '../game/state';
import { sandbox } from '../game/testkit';
import { mat, aux, flags, bg, W, H } from '../engine/grid';
import { sfx } from '../engine/audio';
import { attachBridge, detachBridge, showInterstitial, gameReady, pgLanguage, platformLanguage, audioEnabled, gateRun } from './bridge';
import { storeKind, storeSet, flush, storeReadMany, storeWriteBatch } from './store';
import { saveGame, loadGame, peekSave, deleteSave, resetSaveGapForTests, lastSaveInfo, autosaveDue } from '../game/save';

type Fire = (evt: string, d: unknown) => void;
function emitter(target: Record<string, unknown>) {
  const h = new Map<string, ((d: unknown) => void)[]>();
  Object.assign(target, {
    on(e: string, f: (d: unknown) => void) { (h.get(e) ?? h.set(e, []).get(e)!).push(f); },
    off(e: string, f: (d: unknown) => void) { const a = h.get(e); if (a) h.set(e, a.filter(x => x !== f)); },
  });
  return ((e: string, d: unknown) => { for (const f of h.get(e) ?? []) f(d); }) as Fire;
}
/** A window.bridge stand-in: storage in memory, every call recorded. */
function fakeBridge(o: { language?: string; audio?: boolean; interstitial?: boolean } = {}) {
  const store = new Map<string, string>();
  const calls = { get: [] as string[][], set: [] as string[][], del: [] as string[][], msgs: [] as string[], ads: [] as string[] };
  const platform: Record<string, unknown> = { language: o.language ?? 'ru', isAudioEnabled: o.audio ?? true, isPaused: false,
    sendMessage: (m: string) => { calls.msgs.push(m); return Promise.resolve(); } };
  const firePlatform = emitter(platform);
  const advertisement: Record<string, unknown> = { isInterstitialSupported: o.interstitial ?? true,
    showInterstitial: (p?: string | null) => { calls.ads.push(p ?? ''); } };
  const fireAd = emitter(advertisement);
  const bridge = {
    initialize: async () => {},
    platform, advertisement,
    storage: {
      get: async (keys: string[]) => { calls.get.push(keys); return keys.map(k => store.get(k) ?? null); },
      set: async (keys: string[], vals: string[]) => { calls.set.push(keys); keys.forEach((k, i) => store.set(k, vals[i])); },
      delete: async (keys: string[]) => { calls.del.push(keys); keys.forEach(k => store.delete(k)); },
    },
    EVENT_NAME: { PAUSE_STATE_CHANGED: 'pause_state_changed', AUDIO_STATE_CHANGED: 'audio_state_changed', INTERSTITIAL_STATE_CHANGED: 'interstitial_state_changed' },
  };
  return { bridge, store, calls, firePlatform, fireAd, platform };
}
const muted = () => !!(sfx as unknown as { stats: () => { muted: boolean } }).stats().muted;
const tick = (ms = 0) => new Promise(r => setTimeout(r, ms));
/** Run fn with a fake bridge attached; always detaches it again and restores the pause flag the test touched. */
async function withBridge<T>(o: Parameters<typeof fakeBridge>[0], fn: (f: ReturnType<typeof fakeBridge>) => Promise<T> | T): Promise<T> {
  const f = fakeBridge(o), keep = G.paused;
  await attachBridge(f.bridge);
  try { return await fn(f); } finally { detachBridge(); G.paused = keep; sfx.setMuted(false); }
}

registerTest('bridge', 'подключение: initialize, хранилище Bridge, язык и звук из платформы', async (t: TestCtx) => {
  await withBridge({ language: 'fr', audio: false }, async () => {
    t.expect(storeKind() === 'bridge', 'хранилище не переключилось на Bridge');
    t.expect(platformLanguage === 'fr', 'язык платформы: ' + platformLanguage);
    t.expect(audioEnabled === false, 'звук платформы не прочитан');
    t.expect(muted(), 'при выключенном звуке игра должна стартовать без звука');
  });
  t.expect(!muted(), 'после отключения Bridge звук снова доступен');
});

registerTest('bridge', 'язык PG-сборки: выбор игрока, затем platform.language по двум буквам, иначе английский', async (t: TestCtx) => {
  await withBridge({ language: 'zh-CN' }, () => {
    t.expect(pgLanguage('fr') === 'fr', 'сохранённый выбор игрока главнее платформы');
    t.expect(pgLanguage(null) === 'zh', 'zh-CN → zh: ' + pgLanguage(null));
    t.expect(pgLanguage('xx') === 'zh', 'неизвестный сохранённый код игнорируется');
  });
  await withBridge({ language: 'de' }, () => t.expect(pgLanguage(null) === 'en', 'язык вне списка → en'));
  await withBridge({ language: '' }, () => t.expect(pgLanguage(null) === 'en', 'пустой язык → en'));
});

registerTest('bridge', 'пауза и звук платформы: игра стоит, звук выключен; после снятия продолжается; ручная пауза сохраняется', async (t: TestCtx) => {
  G.paused = false;
  await withBridge({}, async (f) => {
    f.firePlatform('pause_state_changed', true);
    t.expect(G.paused === true && muted(), 'при паузе платформы игра должна стоять и молчать');
    f.firePlatform('pause_state_changed', false);
    t.expect(G.paused === false && !muted(), 'после снятия паузы игра продолжается со звуком');
    f.firePlatform('audio_state_changed', false);
    t.expect(muted(), 'звук выключен платформой → без звука');
    f.firePlatform('audio_state_changed', true);
    t.expect(!muted(), 'звук включили → звук вернулся');
    sfx.setMuted(true);                                       // the player's own mute
    f.firePlatform('pause_state_changed', true); f.firePlatform('pause_state_changed', false);
    t.expect(muted(), 'выбор игрока «без звука» не снимается паузой платформы');
    sfx.setMuted(false);
    G.paused = true;                                          // the player paused the game by hand
    f.firePlatform('pause_state_changed', true); f.firePlatform('pause_state_changed', false);
    t.expect(G.paused === true, 'ручная пауза игрока не снимается при возврате платформы');
  });
});

registerTest('bridge', 'вкладка скрыта: игра на паузе и без звука; при возврате продолжается без потери состояния', async (t: TestCtx) => {
  G.paused = false;
  await withBridge({}, async () => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    t.expect(G.paused === true && muted(), 'скрытая вкладка: пауза и без звука');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    t.expect(G.paused === false && !muted(), 'вкладка снова видна: игра продолжается');
  });
  delete (document as unknown as Record<string, unknown>).hidden;
});

registerTest('bridge', 'game_ready уходит один раз, когда стартовый экран интерактивен', async (t: TestCtx) => {
  await withBridge({}, async (f) => {
    gameReady(); gameReady();
    t.expect(f.calls.msgs.filter(m => m === 'game_ready').length === 1, 'game_ready отправлен ' + f.calls.msgs.length + ' раз(а)');
  });
});

registerTest('bridge', 'межстраничная реклама: игра стоит, пока реклама открыта, и продолжается после закрытия', async (t: TestCtx) => {
  G.paused = false;
  await withBridge({}, async (f) => {
    const p = showInterstitial('new_run');
    t.expect(f.calls.ads.includes('new_run'), 'showInterstitial с местом new_run не вызван');
    f.fireAd('interstitial_state_changed', 'opened');
    t.expect(G.paused === true && muted(), 'пока открыта реклама, игра стоит и молчит');
    f.fireAd('interstitial_state_changed', 'closed');
    await p;
    t.expect(G.paused === false && !muted(), 'после закрытия рекламы игра продолжается');
  });
});

registerTest('bridge', 'сбой рекламы не задерживает игру; без поддержки рекламы ничего не ждём', async (t: TestCtx) => {
  await withBridge({}, async (f) => {
    const p = showInterstitial('game_over');
    f.fireAd('interstitial_state_changed', 'loading');
    f.fireAd('interstitial_state_changed', 'failed');
    const first = await Promise.race([p.then(() => 'done'), tick(400).then(() => 'late')]);
    t.expect(first === 'done', 'сбой рекламы задержал игру');
  });
  await withBridge({ interstitial: false }, async (f) => {
    const first = await Promise.race([showInterstitial('new_run').then(() => 'done'), tick(400).then(() => 'late')]);
    t.expect(first === 'done' && f.calls.ads.length === 0, 'реклама вызвана там, где не поддерживается');
  });
  await withBridge({}, async (f) => {
    const first = await Promise.race([showInterstitial('new_run').then(() => 'done'), tick(3600).then(() => 'late')]);
    t.expect(first === 'done', 'реклама не показана, игра ждёт дольше 3,5 с');
    void f;
  });
});

registerTest('bridge', 'кнопки экрана смерти: новая игра ждёт рекламу и стартует после её закрытия', async (t: TestCtx) => {
  let went = 0;
  await withBridge({}, async (f) => {
    gateRun('new_run', () => { went++; });                  // the death card's button: the ad comes first, the run starts when it is closed
    t.expect(f.calls.ads.includes('new_run') && went === 0, 'новая игра стартовала до рекламы');
    f.fireAd('interstitial_state_changed', 'opened');
    f.fireAd('interstitial_state_changed', 'closed');
    await tick(0);
    t.expect(went === 1, 'после закрытия рекламы новая игра должна стартовать');
  });
});

registerTest('bridge', 'хранилище: одна запись на все ключи, одно чтение; записи настроек пакетом', async (t: TestCtx) => {
  await withBridge({}, async (f) => {
    storeSet('sc.test.a', '1'); storeSet('sc.test.b', '2');
    await flush();
    t.expect(f.calls.set.length === 1 && f.calls.set[0].includes('sc.test.a') && f.calls.set[0].includes('sc.test.b'), 'настройки записаны ' + f.calls.set.length + ' вызовами');
    const ok = await storeWriteBatch([['sc.test.c', 'x'], ['sc.test.d', 'y']], []);
    t.expect(ok && f.calls.set.length === 2 && f.calls.set[1].length === 2, 'пакет сохранения: ' + JSON.stringify(f.calls.set.slice(1)));
    const vals = await storeReadMany(['sc.test.c', 'sc.test.none']);
    t.expect(f.calls.get.length === 1 && vals[0] === 'x' && vals[1] === null, 'чтение: ' + JSON.stringify(vals));
  });
});

registerTest('save', 'сохранение Bridge: дельта к базе, загрузка даёт ту же сетку и игрока', async (t: TestCtx) => {
  await withBridge({}, async (f) => {
    await sandbox(async () => {
      t.sc.start({ seed: 5, diff: 1 });
      await t.frames(5);
      G.paused = true;                                      // the grid must not move between the save and the comparison
      const { MAT } = await import('../content/materials');
      const p = G.player;
      for (let k = 0; k < 400; k++) { const i = (Math.floor(p.y) - 3 + (k % 20)) * W + Math.floor(p.x) - 10 + Math.floor(k / 20); mat[i] = k % 3 ? MAT.SNOWBLOCK : MAT.SNOW; aux[i] = (k * 7) & 255; }
      resetSaveGapForTests();
      t.expect(await saveGame(), 'сохранение не прошло');
      const live = { mat: mat.slice(), aux: aux.slice(), flags: flags.slice(), bg: bg.slice() }, x = G.player.x, y = G.player.y;
      t.expect((await peekSave())?.seed === 5, 'метаданные не прочитаны');
      const d = await loadGame();
      t.expect(!!d && !!d.delta, 'загрузка не вернула дельту');
      t.sc.start({ seed: 5, diff: 1, save: d! });
      G.paused = true;
      let diff = 0;
      for (let i = 0; i < mat.length; i++) if (mat[i] !== live.mat[i] || aux[i] !== live.aux[i] || flags[i] !== live.flags[i]) diff++;
      for (let i = 0; i < bg.length; i++) if (bg[i] !== live.bg[i]) diff++;
      t.expect(diff === 0, 'после загрузки сетка отличается в ' + diff + ' ячейках');
      t.expect(Math.abs(G.player.x - x) < 0.01 && Math.abs(G.player.y - y) < 0.01, 'игрок не на месте после загрузки');
      t.metric('save cells changed', lastSaveInfo.cells, 'cells');
      t.metric('save json', lastSaveInfo.jsonBytes, 'B');
      t.metric('save packed', lastSaveInfo.packedBytes, 'B');
      t.metric('save base64', lastSaveInfo.b64Chars, 'chars');
      t.expect(lastSaveInfo.b64Chars <= 900 * 1024, 'сохранение больше 900 КБ: ' + lastSaveInfo.b64Chars);
      await deleteSave();
      t.expect(!(await peekSave()), 'после удаления сохранение осталось');
    });
    t.expect(f.calls.set.length > 0, 'сохранение не ушло в Bridge');
  });
});

registerTest('save', 'части сохранения: лишние части короче новой записи удаляются одним вызовом', async (t: TestCtx) => {
  await withBridge({}, async (f) => {
    await sandbox(async () => {
      t.sc.start({ seed: 6, diff: 1 });
      await t.frames(3);
      G.paused = true;
      const p = G.player; let seed = 12345;
      const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed >>> 24; };   // high entropy: gzip must not hide the size
      const cells: number[] = [];
      for (let k = 0; k < 200000; k++) { const i = ((Math.floor(p.y) - 60 + Math.floor(k / 400)) % H) * W + Math.floor(p.x) - 200 + (k % 400); cells.push(i); mat[i] = rnd() % 14; aux[i] = rnd(); }
      resetSaveGapForTests();
      G.paused = true;
      t.expect(await saveGame(), 'первое сохранение не прошло');
      const many = lastSaveInfo.chunks;
      t.metric('chunk test cells', lastSaveInfo.cells, 'cells'); t.metric('chunk test packed', lastSaveInfo.packedBytes, 'B'); t.metric('chunk test b64', lastSaveInfo.b64Chars, 'chars');
      t.expect(many >= 2, 'большое сохранение должно делиться на части: ' + many);
      for (const i of cells) { mat[i] = 0; aux[i] = 0; }
      resetSaveGapForTests();
      t.expect(await saveGame(), 'второе сохранение не прошло');
      t.expect(lastSaveInfo.chunks === 1, 'малое сохранение: частей ' + lastSaveInfo.chunks);
      const removed = f.calls.del.flat();
      for (let i = 1; i < many; i++) t.expect(removed.includes('sc.save.' + i), 'лишняя часть sc.save.' + i + ' не удалена');
      t.expect(![...f.store.keys()].some(k => /^sc\.save\.[1-9]/.test(k)), 'в хранилище остались лишние части');
      await deleteSave();
    });
  });
});

registerTest('save', 'периодическое сохранение в Bridge-сборке: не чаще раза в 20 с и только после 2 игровых часов', async (t: TestCtx) => {
  await withBridge({}, async () => {
    const time0 = G.time;
    await sandbox(async () => {
      t.sc.start({ seed: 7, diff: 1 });
      await t.frames(2);
      resetSaveGapForTests();
      t.expect(await saveGame(), 'первое сохранение не прошло');
      const again = await saveGame();
      t.expect(again === false, 'второе сохранение в пределах 20 с не должно идти');
      t.expect(!autosaveDue(), 'сразу после сохранения периодическое сохранение не нужно');
      G.time += 60;
      t.expect(!autosaveDue(), 'через час игрового времени периодическое сохранение ещё не нужно');
      G.time += 61;
      t.expect(autosaveDue(), 'через 2 игровых часа периодическое сохранение нужно');
      await deleteSave();
    });
    G.time = time0;
  });
});
