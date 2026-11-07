// UI modes (wave 5, AGENTS_W5 §3): 'full' shows the whole HUD (dial arc, hint box, shelter details, wind and barometer rows, «ощущается» line,
// compass name); 'min' keeps only what the player needs to walk and act. The choice is stored in localStorage («sc.ui»); with nothing stored the
// first start picks 'min' on a short window (height < 340 CSS px, a landscape phone) and 'full' otherwise, and keeps that pick.
// The mode is a pair of body classes (ui-min / ui-full) that the HUD CSS reads, plus the window event 'sc:uimode' (detail: { mode }).
// Settings (ui/menu.ts) call setUiMode(); nothing here touches the game state. Storage may be blocked: then the mode is computed each time.

export type UiMode = 'full' | 'min';
const KEY = 'sc.ui';
export const SHORT_H = 340;                  // below this window height the HUD uses its compact layout (also in CSS: max-height 339px)

const isMode = (v: unknown): v is UiMode => v === 'full' || v === 'min';
const readStored = (): UiMode | null => { try { const v = localStorage.getItem(KEY); return isMode(v) ? v : null; } catch { return null; } };
const autoMode = (): UiMode => (typeof window !== 'undefined' && window.innerHeight < SHORT_H ? 'min' : 'full');

let last: UiMode | null = null;

/** The current mode. With nothing stored yet, the first call decides by the window height and stores that decision. */
export function getUiMode(): UiMode {
  const s = readStored();
  if (s) return s;
  const m = autoMode();
  try { localStorage.setItem(KEY, m); } catch { /* storage blocked: decided again next time */ }
  return m;
}

/** Store the mode and apply it now. */
export function setUiMode(m: UiMode): void {
  const v: UiMode = isMode(m) ? m : 'full';
  try { localStorage.setItem(KEY, v); } catch { /* storage blocked: the mode lasts until the page is closed */ }
  applyUiMode();
}

/** Put the classes on <body> and announce a change once. Safe to call often (the resize handler does). */
export function applyUiMode(): void {
  if (typeof document === 'undefined') return;
  const m = getUiMode();
  document.body.classList.toggle('ui-min', m === 'min');
  document.body.classList.toggle('ui-full', m === 'full');
  if (m !== last) {
    last = m;
    if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sc:uimode', { detail: { mode: m } }));
  }
}

/** Compact layout for the current window (a landscape phone or a small window). */
export const shortScreen = () => typeof window !== 'undefined' && window.innerHeight < SHORT_H;

/** Once at start: apply the mode and follow window resizes (a short window in 'min' stays 'min' because the choice is stored). */
export function initUiMode(): void {
  applyUiMode();
  if (typeof window !== 'undefined') window.addEventListener('resize', () => applyUiMode());
}
