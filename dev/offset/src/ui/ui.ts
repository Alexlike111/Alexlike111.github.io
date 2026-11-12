// DOM interface entry point. The host calls mountUi(api) once and frame(dtReal) every rendered frame.
import './ui.css';
import type { UiApi } from './api';
import { detectLang, setLang } from '../core/i18n';
import { createHud } from './hud';
import { createScreens } from './screens';
import { applyInks, BASE_INKS, BIOME_INKS } from './icons';

export function mountUi(api: UiApi): { frame(dtReal: number): void } {
  let root = document.getElementById('ui');
  if (!root) { root = document.createElement('div'); root.id = 'ui'; document.body.append(root); }
  const ui = root; ui.classList.add('of-ui');
  setLang(api.meta.s.settings.lang || detectLang());
  applyInks(ui, BASE_INKS);

  // the interface is print, not a web page: no selection, no context menu, no pinch / double-tap zoom
  const stop = (e: Event) => e.preventDefault();
  ui.addEventListener('contextmenu', stop); ui.addEventListener('selectstart', stop); ui.addEventListener('dragstart', stop);
  ui.addEventListener('dblclick', stop);
  document.addEventListener('gesturestart', stop); document.addEventListener('gesturechange', stop);
  ui.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
  window.addEventListener('wheel', (e) => { if (e.ctrlKey) e.preventDefault(); }, { passive: false });

  const hud = createHud(ui, api);
  const screens = createScreens(ui, api, () => { hud.relabel(); screens.rebuild(); });
  let mode = ''; let biome = '';
  return {
    frame(dtReal: number) {
      const dt = dtReal > 0.1 ? 0.1 : dtReal < 0 ? 0 : dtReal;
      const h = api.hud();
      if (h.mode !== mode || h.biome !== biome) {
        mode = h.mode; biome = h.biome; ui.dataset.mode = mode;
        // inside a run the interface is printed with the inks of the current biome
        applyInks(ui, mode === 'run' || mode === 'offer' ? BIOME_INKS[biome] ?? BASE_INKS : BASE_INKS);
      }
      hud.update(h, dt);
      screens.sync(h, dt);
    },
  };
}
