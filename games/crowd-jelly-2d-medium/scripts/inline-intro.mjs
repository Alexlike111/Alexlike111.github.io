// Prints the intro CSS + markup for pasting into index.html of heavy games (first paint before JS):
//   node --import tsx scripts/inline-intro.mjs  -> <style id="rl-css">…</style> and <div id="rl-intro">…</div>
import { INTRO_CSS, introMarkup } from '../src/kit/intro.ts';
console.log(`<style id="rl-css">${INTRO_CSS}</style>\n<div id="rl-intro">${introMarkup()}</div>`);
