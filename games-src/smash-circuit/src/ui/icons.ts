// Inline SVG icons (no emoji, no external files). All use currentColor unless a fixed colour is part of the design.
const svg = (body: string, vb = '0 0 24 24', cls = 'ic'): string =>
  `<svg class="${cls}" viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  play: svg('<path d="M7 4.5v15a1 1 0 0 0 1.5.86l12-7.5a1 1 0 0 0 0-1.72l-12-7.5A1 1 0 0 0 7 4.5z" fill="currentColor"/>'),
  pause: svg('<rect x="5" y="4" width="5" height="16" rx="1.6" fill="currentColor"/><rect x="14" y="4" width="5" height="16" rx="1.6" fill="currentColor"/>'),
  back: svg('<path d="M14.5 4.5 7 12l7.5 7.5" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  gear: svg('<path fill="currentColor" fill-rule="evenodd" d="M10.3 2h3.4l.6 2.7c.6.2 1.1.5 1.6.9l2.6-.9 1.7 2.9-2 1.8c.1.6.1 1.2 0 1.8l2 1.8-1.7 2.9-2.6-.9c-.5.4-1 .7-1.6.9l-.6 2.7h-3.4l-.6-2.7c-.6-.2-1.1-.5-1.6-.9l-2.6.9-1.7-2.9 2-1.8a6 6 0 0 1 0-1.8l-2-1.8 1.7-2.9 2.6.9c.5-.4 1-.7 1.6-.9zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z" transform="translate(0 1.5) scale(1 .92)"/>'),
  wrench: svg('<path fill="currentColor" d="M21.6 6.4a5.6 5.6 0 0 1-7.2 6.9L7 20.7a2.3 2.3 0 0 1-3.3-3.3l7.4-7.4A5.6 5.6 0 0 1 17.6 2.4l-3.4 3.4.9 3.1 3.1.9z"/><circle cx="5.9" cy="18.5" r="1.1" fill="#0b1430" opacity=".55"/>'),
  coin: svg('<circle cx="12" cy="12" r="10" fill="#ffc93c" stroke="#14213d" stroke-width="2"/><circle cx="12" cy="12" r="6.2" fill="none" stroke="#c58d00" stroke-width="1.8"/><path d="M12 8v8M9.6 10.2c.5-1 1.4-1.4 2.4-1.4s2 .4 2.4 1.3c.2 1.9-4.8 1.1-4.8 3.2.1 1 1.2 1.6 2.4 1.6s1.9-.4 2.4-1.2" fill="none" stroke="#14213d" stroke-width="1.5" stroke-linecap="round"/>'),
  lock: svg('<path d="M7.5 10V7.5a4.5 4.5 0 0 1 9 0V10" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><rect x="4.5" y="10" width="15" height="11" rx="2.6" fill="currentColor"/><circle cx="12" cy="15" r="1.8" fill="#0b1430"/><rect x="11.2" y="15.5" width="1.6" height="3" rx=".8" fill="#0b1430"/>'),
  speakerOn: svg('<path d="M4 9.5h3.6L12 5.5v13l-4.4-4H4z" fill="currentColor"/><path d="M15.2 8.6a5 5 0 0 1 0 6.8M17.6 6a8.6 8.6 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>'),
  speakerOff: svg('<path d="M4 9.5h3.6L12 5.5v13l-4.4-4H4z" fill="currentColor"/><path d="m15.5 9.5 5 5m0-5-5 5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  restart: svg('<path d="M19.5 12a7.5 7.5 0 1 1-2.4-5.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M20 3.2v5.6h-5.6z" fill="currentColor"/>'),
  exit: svg('<path d="M10 3.5H5.5A1.5 1.5 0 0 0 4 5v14a1.5 1.5 0 0 0 1.5 1.5H10" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.5 12h10.5m-4-4.5L20 12l-4 4.5" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round"/>'),
  check: svg('<path d="m5 12.8 4.4 4.4L19 7.4" fill="none" stroke="currentColor" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>'),
  flag: svg('<path d="M5 21V3" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M5 4h14l-2.6 4.2L19 12.4H5z" fill="currentColor"/><path d="M9 4v8.4M13 4v8.4" stroke="#0b1430" stroke-width="2" opacity=".5"/>'),
  engine: svg('<path d="M7 5h6v2h2.2l1.3 1.8H19V7h2v9h-2v-1.8h-2.5L15 16H7.6L5.5 13.6H3.6v-4H5.5L7 7.6z" fill="currentColor" transform="translate(0 1.6)"/><rect x="9" y="3" width="4" height="2" rx=".7" fill="currentColor"/>'),
  tyre: svg('<circle cx="12" cy="12" r="9.5" fill="currentColor"/><circle cx="12" cy="12" r="4.4" fill="#0b1430" opacity=".85"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" stroke="#0b1430" stroke-width="1.7" opacity=".55" stroke-linecap="round"/>'),
  shield: svg('<path d="M12 2.5 20 5.6v6.2c0 4.7-3.2 8.2-8 9.9-4.8-1.7-8-5.2-8-9.9V5.6z" fill="currentColor"/><path d="M12 6.2 16.6 8v3.7c0 2.7-1.8 4.8-4.6 5.9z" fill="#0b1430" opacity=".4"/>'),
  speed: svg('<path d="M3.5 17a8.5 8.5 0 1 1 17 0" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round"/><path d="m12 16 4.4-6.2" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><circle cx="12" cy="16" r="2" fill="currentColor"/>'),
  bolt: svg('<path d="M13.5 2 5 13.5h5.8L9.6 22 19 9.8h-6z" fill="currentColor"/>'),
  trophy: svg('<path d="M7 3.5h10v5.2a5 5 0 0 1-10 0z" fill="currentColor"/><path d="M7 5.2H3.8c0 3 1.2 4.7 3.4 5.1M17 5.2h3.2c0 3-1.2 4.7-3.4 5.1" fill="none" stroke="currentColor" stroke-width="2"/><rect x="10.6" y="13.2" width="2.8" height="4" fill="currentColor"/><rect x="7.5" y="17.2" width="9" height="3.3" rx="1.2" fill="currentColor"/>'),
  ad: svg('<rect x="2.5" y="4.5" width="19" height="13" rx="2.6" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M10 8.5v5.4l4.6-2.7z" fill="currentColor"/><path d="M8 20.5h8" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>'),
  arrowL: svg('<path d="M20 12H5m6-6-6 6 6 6" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  arrowR: svg('<path d="M4 12h15m-6-6 6 6-6 6" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>'),
  finger: svg('<path d="M9.2 3.2a1.7 1.7 0 0 1 3.4 0v7.2l5.1 1.1a2.4 2.4 0 0 1 1.9 2.5l-.4 4.8a3 3 0 0 1-3 2.7h-4.5a3 3 0 0 1-2.4-1.2L5 14.4a1.6 1.6 0 0 1 2.6-1.8l1.6 1.9z" fill="currentColor"/>'),
  crash: svg('<path d="m12 1.8 2 5.4 5.2-2.5-2.2 5.5 5.2 1.6-5.2 2 3 4.7-5.3-1.6-.7 5.6L12 17l-3 4.5-.7-5.6-5.3 1.6 3-4.7-5.2-2 5.2-1.6-2.2-5.5 5.2 2.5z" fill="currentColor"/>'),
  info: svg('<circle cx="12" cy="12" r="10" fill="currentColor"/><rect x="10.6" y="10.5" width="2.8" height="7.5" rx="1.2" fill="#0b1430"/><circle cx="12" cy="7" r="1.7" fill="#0b1430"/>'),
};

export type IconName = keyof typeof ICONS;
export const icon = (n: IconName): string => ICONS[n];

/** Top-down car silhouette with the 9 damage zones (nose up). Zones get inline fill from the HUD. */
export const CAR_ZONES_SVG = `<svg class="carz" viewBox="0 0 40 80" aria-hidden="true" focusable="false">
  <rect x="6.5" y="1.5" width="27" height="77" rx="10" fill="#0b1430" stroke="#fff" stroke-opacity=".55" stroke-width="1.4"/>
  <path data-z="front" d="M10.5 7.5q9.5-6 19 0l1 11h-21z"/>
  <rect data-z="engine" x="11" y="20" width="18" height="12" rx="2.5"/>
  <rect data-z="left" x="8.6" y="34" width="5" height="25" rx="2"/>
  <rect data-z="right" x="26.4" y="34" width="5" height="25" rx="2"/>
  <rect x="15" y="34" width="10" height="25" rx="3" fill="#33425f"/>
  <path data-z="rear" d="M9 61h22l-1 10.5q-10 5-20 0z"/>
  <rect data-z="wheelFL" x="1.2" y="11" width="6" height="13" rx="2.6"/>
  <rect data-z="wheelFR" x="32.8" y="11" width="6" height="13" rx="2.6"/>
  <rect data-z="wheelRL" x="1.2" y="54" width="6" height="14" rx="2.6"/>
  <rect data-z="wheelRR" x="32.8" y="54" width="6" height="14" rx="2.6"/>
</svg>`;

/** Medal shape (place number is overlaid as HTML text). */
export const MEDAL_SVG = `<svg class="medal-svg" viewBox="0 0 100 120" aria-hidden="true" focusable="false">
  <path d="M22 4h20l8 34-18 6z" fill="#2f8cff" stroke="#14213d" stroke-width="4" stroke-linejoin="round"/>
  <path d="M78 4H58l-8 34 18 6z" fill="#ff5a36" stroke="#14213d" stroke-width="4" stroke-linejoin="round"/>
  <circle cx="50" cy="74" r="40" fill="var(--medal-a)" stroke="#14213d" stroke-width="5"/>
  <circle cx="50" cy="74" r="30" fill="var(--medal-b)" stroke="#14213d" stroke-opacity=".35" stroke-width="3"/>
  <path d="M26 58a28 28 0 0 1 22-14" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="5" stroke-linecap="round"/>
</svg>`;

/** 4th-8th place: a flat everyday badge (no ribbon, no shine), so podium medals stay special. */
export const BADGE_SVG = `<svg class="medal-svg badge-svg" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <circle cx="50" cy="50" r="42" fill="var(--medal-a)" stroke="#14213d" stroke-width="5"/>
  <circle cx="50" cy="50" r="32" fill="var(--medal-b)" stroke="#14213d" stroke-opacity=".3" stroke-width="3"/>
</svg>`;
