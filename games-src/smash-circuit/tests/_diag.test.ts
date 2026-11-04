import { it } from 'vitest';
import { Sim } from '../src/sim/sim';
import { baseStats } from '../src/sim/carModel';
import { TRACKS } from '../src/track/tracks';
function field(seed:number){const out:any[]=[];for(let i=0;i<8;i++){const f=i/7;const j=((i*31+seed*17)%10)/10;out.push({id:i,isPlayer:false,name:'c'+i,colorIndex:i,stats:baseStats(),ai:{skill:0.95-f*0.35,aggression:0.15+j*0.8,laneOffset:(((i+seed)%5)-2)/2.5,mistakeRate:0.03+f*0.1}});}return out;}
it('diag',()=>{
 for(const id of ['t1','t2','t3'])for(const seed of [1,2,3,4]){
  const sim=new Sim({track:TRACKS.find(t=>t.id===id)!,cars:field(seed),seed});
  let t=0,last=0;const log:string[]=[];
  while(t<300&&sim.race.phase!=='finished'){sim.update(1/60);t+=1/60;
   for(const e of sim.drainEvents()){ if((e as any).type==='oilSpin') log.push(`${t.toFixed(1)} oil car${(e as any).carId}`);}
   if(sim.respawns!==last){last=sim.respawns;log.push(`${t.toFixed(1)} RESPAWN total ${last}`);}
  }
  console.log(id,seed,'respawns',sim.respawns,'t',t.toFixed(0),log.join(' | ').slice(0,400));
 }
},600000);
