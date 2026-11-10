// Compile-time flag: true in the Playgama build (`npm run build:pg`, vite --mode pg), false in the preview build.
// Vite replaces the bare identifier; code under `if (!__PG__)` / `if (__PG__)` is dropped from the other build.
// Node tests (tsx) define it on globalThis first (see tests/save.test.ts).
declare const __PG__: boolean;
