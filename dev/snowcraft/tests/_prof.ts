import { clearWorld, idx, mat, flags, F_PLACED, F_TREE, wakeRect } from '../src/engine/grid';
import { MAT } from '../src/content/materials';
import { G } from '../src/game/state';
import { initSim, stepSim, ignite } from '../src/engine/sim';
import { initHeat, stepHeat, addHeat } from '../src/engine/heat';
import { initStructure, stepStructure, pendingChecks } from '../src/engine/structure';
import { stepBodies } from '../src/engine/bodies';
import { stepParticles, FX, FC } from '../src/engine/particles';
function fill(x0:number,y0:number,x1:number,y1:number,m:number,fl=0){for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const i=idx(x,y);mat[i]=m;flags[i]=fl;}}
clearWorld(); Object.assign(G.win,{x0:800,y0:250,x1:1220,y1:490}); G.snowfall=0.6; G.wind=6; G.ambientT=-18;
initSim(); initStructure();
fill(800,400,1220,424,MAT.PACKED);fill(800,425,1220,450,MAT.DIRT);fill(800,451,1220,520,MAT.STONE);
for (let k=0;k<7;k++){const x=820+k*55; fill(x,340,x+3,399,MAT.WOOD,F_TREE); fill(x-8,345,x+11,380,MAT.NEEDLES,F_TREE);}
fill(1150,392,1160,399,MAT.LOG,F_PLACED);
let s=1; const r=()=>{s=(s*1664525+1013904223)>>>0;return s/4294967296;};
for(let i=0;i<6000;i++) mat[idx(800+((r()*420)|0),260+((r()*120)|0))]=MAT.SNOW;
initHeat(); wakeRect(760,210,1260,530,120); ignite(1150,399);
const T={sim:0,heat:0,st:0,bo:0,pa:0}; let worst=0, wi=0;
for(let t=0;t<720;t++){
  addHeat(1155,398,90);
  const a=performance.now(); stepSim(1/60); const b=performance.now(); stepHeat(1/60); const c=performance.now(); stepStructure(1/60); const d=performance.now(); stepBodies(1/60); const e=performance.now(); stepParticles(1/60); const f=performance.now();
  if (t>=120){T.sim+=b-a;T.heat+=c-b;T.st+=d-c;T.bo+=e-d;T.pa+=f-e; if(f-a>worst){worst=f-a;wi=t; console.log('spike',t,(b-a).toFixed(1),(c-b).toFixed(1),(d-c).toFixed(1),(e-d).toFixed(1),(f-e).toFixed(1));}}
}
for(const k in T) console.log(k,(T[k as keyof typeof T]/600).toFixed(3));
console.log('fx',FX.n,'fc',FC.n,'pending',pendingChecks());
