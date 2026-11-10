// The build flag as a value: true in the Playgama build (`vite build --mode pg`), false in the preview build and in the Node tests (tsx), where
// the compile-time identifier __PG__ is not defined. Vite replaces the identifier, so `if (PG)` branches fold away in the other build.
declare const __PG__: boolean | undefined;
export const PG: boolean = typeof __PG__ !== 'undefined' && __PG__ === true;
