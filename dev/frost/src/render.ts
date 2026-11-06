// WebGL2 renderer, two passes:
//  1. CELL pass: one fragment per visible world cell (~100k at 22 m view) into a float target: materials, strata, sky light,
//     sun/moon shadow, ray-marched point lights. Everything that is constant over a 5 cm cell is evaluated here once, not per screen pixel.
//  2. SCREEN pass: one fragment per canvas pixel: nearest lookup of the cell colour + parallax background (only where the sky shows through),
//     drift/storm/fog, tone curve, x-ray, vignette. Its cost scales with canvas resolution (dynamic scale), the cell pass does not.
// Then the particle point pass.
import { G } from './state';
import { W, H, CH, CW, CHH, HW, HH, mat, dens, bond, flags, body, gpuDirty } from './world';
import { P, PK } from './particles';
import { T, WND } from './heat';
import { prof, pnow, pend } from './prof';

const VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.-1.,0.,1.); }`;

const COMMON = `
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uWorld;
const int WI = ${W}; const int HI = ${H};
uint ihash(uvec2 v){ v = v*1664525u + 1013904223u; v.x += v.y*1664525u; v.y += v.x*1664525u; v ^= v>>16u; v.x += v.y*1664525u; v.y += v.x*1664525u; v ^= v>>16u; return v.x; }
float hash2(ivec2 c){ return float(ihash(uvec2(c + ivec2(4096))))*(1./4294967296.); }
float hash3(ivec2 c, int t){ return float(ihash(uvec2(c + ivec2(4096) + ivec2(t*131, -t*71))))*(1./4294967296.); }
float hf(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float h1(float n){ return fract(sin(n*127.1+11.7)*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hf(i),hf(i+vec2(1,0)),f.x), mix(hf(i+vec2(0,1)),hf(i+vec2(1,1)),f.x), f.y); }
vec4 fetchW(ivec2 c){
  if(c.y<0) return vec4(0.);
  if(c.x<0||c.x>=WI||c.y>=HI) return vec4(12.,0.,0.,0.);
  return floor(texelFetch(uWorld,c,0)*255.+.5);
}
`;

// ---------------------------------------------------------------- cell pass
const CELL_BODY = `
uniform highp usampler2D uTop;
uniform ivec2 uOrg;
uniform float uTime, uDay, uStorm, uWind, uCamX;
// loop budgets are compile-time per quality (HIQ variant) instead of uniforms: the loops unroll to their real length
#ifdef HIQ
#define PL_STEPS 24      // point-light beam samples per light and cell
#define SKY_N 16         // sky transmittance samples upward
#define SKY_S 0          // extra cell stride per sky sample
#else
#define PL_STEPS 8       // quality 0: 8 beam samples (was 12): coarser beam, same cut-off
#define SKY_N 10
#define SKY_S 1
#endif
uniform int uNL;
uniform vec2 uSkyDir;
uniform vec3 uAmb, uDirCol;
uniform vec2 uVis;
uniform vec4 uLP[8]; uniform vec3 uLC[8];
layout(location=0) out vec4 oCol;
layout(location=1) out vec4 oAux;
const vec3 ABS_S[14] = vec3[14](vec3(0.), vec3(.174,.122,.073), vec3(.05), vec3(.08), vec3(6.), vec3(6.), vec3(6.), vec3(.015), vec3(.6), vec3(6.), vec3(6.), vec3(6.), vec3(6.), vec3(6.));
const vec3 ABS_L[14] = vec3[14](vec3(0.), vec3(.125,.165,.22), vec3(.06,.05,.04), vec3(.1), vec3(6.), vec3(6.), vec3(6.), vec3(.2), vec3(1.), vec3(6.), vec3(6.), vec3(6.), vec3(6.), vec3(6.));

int mAt(ivec2 c){
  if(c.y<0) return 0;
  if(c.x<0||c.x>=WI||c.y>=HI) return 12;
  return min(13, int(texelFetch(uWorld,c,0).r*255.+.5));
}

// sky transmittance straight up (stp cells per sample); depth = distance to first air above.
// uTop = first non-air row of each column: everything above it is air, so open-sky cells skip the march and the others only march through the rows below it (same result, fewer fetches).
vec3 skyMarch(ivec2 c, int stp, int jit, int mUp, out float depth){
  vec3 A = ABS_S[mUp]; depth = (mUp==0) ? 0. : 40.;
  bool found = (mUp==0);
  if(A.g>4.5) return exp(-A);
  int top = (c.x<0||c.x>=WI) ? 0 : int(texelFetch(uTop, ivec2(c.x,0), 0).r);
  if(mUp==0 && c.y<top) return vec3(1.);
  stp += SKY_S;
  int nmax = min(16, SKY_N);
  int lim = c.y - top - 2 - jit; lim = lim<0 ? 0 : min(nmax, lim/stp + 1);
  bool dead = false;
  for(int i=0;i<16;i++){
    if(i>=lim) break;
    int dy = 2 + i*stp + jit;
    vec4 tv = texelFetch(uWorld, c+ivec2(0,-dy), 0);
    int mm = (c.y-dy<0) ? 0 : (c.x<0||c.x>=WI) ? 12 : min(13, int(tv.r*255.+.5));
    if(mm==0){ if(!found){ found=true; depth=float(dy); } }
    else {
      vec3 ab = ABS_S[mm];
      if(mm==1 && int(tv.a*255.+.5)>=128) ab *= .15;                 // snow caps on boughs: faint sky shadow
      A += ab*float(stp); if(A.g>4.5){ dead=true; break; }
    }
  }
  if(!dead && !found && lim<nmax) depth = float(2 + lim*stp + jit);
  return exp(-A);
}
// transmittance toward the sky light (sun/moon) for shadows; depth = distance to first air that way
vec3 dirMarch(vec2 wp, out float depth){
  vec3 A = vec3(0.); depth = 40.; bool found = false;
#ifdef HIQ
  for(int i=0;i<8;i++){
    float t = 1.5 + 2.*float(i);
    float w = 2.;
#else
  for(int i=0;i<4;i++){                                                   // quality 0: half the samples, twice the stride
    float t = 2.5 + 4.*float(i);
    float w = 4.;
#endif
    int mm = mAt(ivec2(floor(wp + uSkyDir*t)));
    if(mm==0){ if(!found){ found=true; depth=t; } }
    else { A += ABS_S[mm]*w; if(A.g>4.5) break; }
  }
  return exp(-A);
}
float occ(ivec2 c){ return mAt(c)==0 ? 0. : 1.; }
vec2 surfN(ivec2 c){
  float nx=0., ny=0.;
  for(int k=-1;k<=1;k++){
    nx += occ(c+ivec2(-1,k)) - occ(c+ivec2(1,k));
    ny += occ(c+ivec2(k,-1)) - occ(c+ivec2(k,1));
  }
  return vec2(nx,ny)/3.;
}

// ray-march through the cells between the pixel's cell and each light; the sample count follows the distance (>= ~1 cell per step) and stops once the beam is dead
vec3 pointLights(vec2 wp, ivec2 c, vec2 n, float hasN, float jr){
  vec3 acc = vec3(0.);
  for(int i=0;i<8;i++){
    if(i>=uNL) break;
    vec2 d = uLP[i].xy - wp; float dist = length(d); float r = uLP[i].z;
    if(dist>=r) continue;
    float q = dist/r*3.;
    float pw = uLP[i].w * (1./(1.+q*q) - .1)/.9;
    if(pw<=.003) continue;
    int ns = min(PL_STEPS, int(dist*.75)+2);
    vec3 A = vec3(0.); float sl = dist/float(ns);
    for(int k=0;k<PL_STEPS;k++){
      if(k>=ns) break;
      float t = (float(k)+.25+.5*jr)/float(ns);
      if(t>.94) break;
      ivec2 cc = ivec2(floor(wp + d*t));
      if(cc==c) continue;
      int mm = mAt(cc);
      if(mm!=0){ A += ABS_L[mm]*sl; if(A.g>4.5) break; }
    }
    float facing = hasN>.5 ? .7+.3*clamp(dot(n, d/max(dist,.001))*1.5,-1.,1.) : 1.;
    vec3 warm = mix(vec3(1.), vec3(1.,.74,.5), clamp(q*.5,0.,1.));
    acc += uLC[i]*warm*pw*exp(-A)*facing;
  }
  return acc*(1.-.55*uDay);   // a campfire barely shows in full daylight
}

vec3 albedo(int m, float dn, float bn, int fl, vec2 cf, float hh, float depth, bool top, vec2 nn, float hasN){
  float g = hh-.5;
  float upN = hasN>.5 ? clamp(-nn.y,0.,1.) : (top?1.:0.);
  bool vert = (fl & 8) != 0;
  if(m==1){
    // stratigraphy: fresh powder (bright, grainy) / settled (smooth grey-blue) / old pack (wind slab = chalky) / depth hoar at the ground
    float fresh = 1.-smoothstep(115.,140.,dn);
    float old = smoothstep(205.,240.,dn);
    float slab = (fl&16)!=0 ? 1. : 0.;
    vec3 b = mix(vec3(.795,.855,.93), vec3(.95,.975,1.), fresh);
    b = mix(b, mix(vec3(.835,.88,.935), vec3(.92,.915,.895), slab), old);
    b = mix(b, b*vec3(.95,.97,1.), smoothstep(30.,255.,bn)*.4);
    float amp = mix(mix(.028,.02+.03*slab,old), .08, fresh);
    if((fl&2)!=0) b = mix(b, vec3(.58,.63,.70), .6);
    float trail = ((fl&1)!=0 && dn>=280. && depth<3.5) ? 1. : 0.;          // trodden path: compacted groove, a little darker, bluer and smoother
    amp *= 1.-.85*trail;
    b = mix(b, b*vec3(.83,.885,.96), trail*.9);
    b += g*amp;
    b += (vn(vec2(cf.x*.025, cf.y*.9))-.5)*.05*(1.-fresh);                  // thin horizontal strata
    float strat2 = 1.;
    if(bn>=95.){                                                           // old pack: bond grows smoothly with depth -> clean, layer-aligned bands
      float bq = bn/18.;
      strat2 = 1.+(hf(vec2(floor(bq), 7.3))-.5)*.3*old;
      if(fract(bq)<.16) strat2 *= 1.-.16*old;                              // thin firn line between layers
    }
    else if(bn>=24.){ float bq = bn/6.; strat2 = 1.+(hf(vec2(floor(bq), 2.9))-.5)*.14*(1.-fresh); }
#ifdef HIQ
    if(dn>=140.){
      ivec2 ic = ivec2(cf);
      float hoar = 0.;
      if(mAt(ic+ivec2(0,1))==4) hoar = 1.; else if(mAt(ic+ivec2(0,2))==4) hoar = .8; else if(mAt(ic+ivec2(0,3))==4) hoar = .45;
      if(hoar>0.){
        vec3 hc = vec3(.70,.755,.82)*(.82+.32*vn(cf*.8));
        if(hh>.82) hc = mix(hc, vec3(.92,.95,.98), .5);
        b = mix(b, hc, hoar*.8);
      }
    }
#endif
    if(depth<2.6){                                                         // wind ripples / sastrugi along the surface: strong on wind slab, a whisper on plain slopes
      float wv = vn(vec2(cf.x*.035, cf.y*.35));
      float rp = sin(cf.x*.62 + wv*5.5);
      float rq = sin(cf.x*.23 - cf.y*.9 + wv*7.);
      float ra = (fl&16)!=0 ? .035 : .013;
      b *= 1.+(ra*rp + .009*rq*(1.-slab))*(1.-trail);
      b += (vn(vec2(cf.x*.05, cf.y*1.3))-.5)*.022*(1.-trail);             // long, flat wind streaks
    }
    // subsurface blue grows with distance from the nearest air (cuts, caves), not with the global height
    float d1 = 1.-exp(-depth/16.), d2 = 1.-exp(-depth/52.);
    b = mix(b, vec3(.36,.56,.79), d1*.5);
    b = mix(b, vec3(.17,.31,.53), d2*.55);
    return b*strat2;
  }
  if(m==2){
    float s = vn(vec2(cf.x*.12, cf.y*.7));
    vec3 b = mix(vec3(.45,.72,.82), vec3(.72,.9,.95), s) + g*.04;
    return mix(b, vec3(.2,.45,.7), (1.-exp(-depth/8.))*.5);
  }
  if(m==3){
    float sh = sin(cf.x*.45 + uTime*1.6 + vn(vec2(cf.x*.05, uTime*.3))*6.)*.5+.5;
    vec3 b = mix(vec3(.05,.16,.34), vec3(.12,.3,.52), sh*.5*exp(-depth/6.));
    if(top) b = mix(b, vec3(.5,.75,.9), .35*sh);
    return b;
  }
  if(m==4){
    float nn2 = vn(cf*.16)*.65 + vn(cf*.55+7.)*.35;                          // two octaves, no directional stripes
    vec3 b = mix(vec3(.235,.168,.118), vec3(.385,.29,.21), nn2);
    b *= 1.+g*.3;
    vec2 pc = floor(cf*.5); float ph = hf(pc*1.7+3.);
    if(ph>.962){                                                           // sparse 2x2 pebbles
      vec2 lf = cf*.5-pc;
      vec3 pb = vec3(.46,.43,.40)*(.8+.4*hf(pc));
      if(lf.x<.5 && lf.y<.5) pb *= 1.2; else if(lf.x>=.5 && lf.y>=.5) pb *= .72;
      b = mix(b, pb, .85);
    }
    float fz = (1.-smoothstep(.5,4.,depth));
    float fm = smoothstep(.38,.72, vn(cf*.45+3.) + fz*.45) * fz;           // frozen top layer: frosted
    b = mix(b, vec3(.72,.8,.9)*(.9+.2*hh), fm*.6);
    if(fract(hh*37.7)>.968) b = mix(b, vec3(.78,.85,.93), .5*(.3+fz));
    return b;
  }
  if(m==5 && (fl&64)!=0){                                                   // boulder: lumpy grey rock, cracks, lichen, frost
    float n1 = vn(cf*.17), n2 = vn(cf*.6+9.);
    vec3 b = mix(vec3(.46,.45,.47), vec3(.70,.67,.64), n1*.8+n2*.2);
    b *= .84+.3*vn(vec2(cf.x*.11+cf.y*.04, cf.y*.14-cf.x*.05)+17.);                // large facets
    float cr = vn(vec2(cf.x*.09+cf.y*.05, cf.y*.12-cf.x*.04)+4.);
    if(abs(cr-.5)<.022) b *= .68;                                          // crack
    float rim = (1.-smoothstep(0.,2.4,depth))*(1.-upN);
    b *= 1.-rim*.35;                                                       // shaded sides
    float topH = upN*(1.-smoothstep(1.,3.2,depth));
    b = mix(b, vec3(.80,.86,.92), topH*.5)*(1.+topH*.15);                  // lit, frosted crown
    vec2 pc = floor(cf*.34); float lh = hf(pc*1.3+7.);
    if(lh>.9 && n1>.35){ vec2 lf = fract(cf*.34)-.5; if(dot(lf,lf)<.12+.1*hf(pc+3.)) b = mix(b, mix(vec3(.62,.68,.30), vec3(.86,.82,.52), hf(pc+1.)), .85); }   // lichen patch
    if(fract(hh*53.1)>.955) b = mix(b, vec3(.9,.95,1.), .65);              // frost speckle
    return b*(1.+g*.12);
  }
  if(m==5){
    float st = cf.y/4.5 + vn(vec2(cf.x*.012, cf.y*.08))*1.6;               // thin, nearly horizontal strata
    float si = floor(st), sf = fract(st);
    float tone = hf(vec2(si, 3.7));
    vec3 b = mix(vec3(.24,.238,.255), vec3(.385,.375,.385), tone*.75+.12);
    b *= .84+.32*(vn(cf*.2)*.6+vn(cf*.75)*.4);
    if(sf<.14) b *= .72;                                                   // dark joint line
    else if(sf>.86) b *= 1.1;
    b *= 1.+g*.2;
    if(fract(hh*53.1)>.965) b *= 1.3;                                      // mineral speckle
    if(fract(hh*17.9)>.985) b *= .6;
    float rim = (1.-smoothstep(0.,2.6,depth))*(1.-upN);
    b *= 1.-rim*.42;                                                       // darker rim / sides
    float topH = upN*(1.-smoothstep(1.2,3.5,depth));
    b = mix(b, vec3(.82,.88,.95), topH*.42)*(1.+topH*.12);                 // frosted top highlight
    return b;
  }
  if(m==12){
    return vec3(.15,.16,.20)*(.8+.4*vn(cf*.3))*(1.+g*.2);
  }
  if(m==6){
    if(bn>200.){ return mix(vec3(.05,.16,.115), vec3(.1,.27,.18), vn(cf*.4))*(.95+.1*hh); }   // trunk hidden inside the crown reads as dark needle core
    float s = vert ? vn(vec2(cf.x*1.4, cf.y*.07)) : vn(vec2(cf.x*.07, cf.y*1.4));
    float s2 = vert ? vn(vec2(cf.x*.5+3., cf.y*.3)) : vn(vec2(cf.x*.3, cf.y*.5+3.));
    vec3 b = mix(vec3(.27,.18,.135), vec3(.50,.35,.245), s*.65+s2*.35);   // warm dark brown bark (never black)
    if(s<.3) b *= .66;                                                     // furrows
    if(s>.78) b *= 1.14;                                                   // ridges catch light
    if(hh>.93) b = b*1.25+vec3(.03,.025,.02);                              // lighter bark flakes
    if(top) b = mix(b, vec3(.85,.9,.95), .4);
    return b*(1.+g*.15);
  }
  if(m==11){
    float s = vert ? vn(vec2(cf.x*.7, cf.y*.03)) : vn(vec2(cf.x*.03, cf.y*.7));
    vec3 b = vec3(.74,.58,.38)*(.85+.3*s)*(1.+g*.06);
    float e = vert ? mod(cf.x,20.) : mod(cf.y,20.);
    if(e<1.) b *= .62;
    return b;
  }
  if(m==13){                                                              // plank door: light vertical boards in a dark frame with rails
    int dl = mAt(ivec2(cf)+ivec2(-1,0))!=13 ? 0 : mAt(ivec2(cf)+ivec2(-2,0))!=13 ? 1 : mAt(ivec2(cf)+ivec2(-3,0))!=13 ? 2 : 3;
    bool fr = dl==0 || mAt(ivec2(cf)+ivec2(1,0))!=13 || mAt(ivec2(cf)+ivec2(0,-1))!=13 || mAt(ivec2(cf)+ivec2(0,1))!=13;
    vec3 b = vec3(.9,.72,.46)*(.9+.2*vn(vec2(cf.x*.6, cf.y*.05)));
    if(dl==2 && mAt(ivec2(cf)+ivec2(1,0))==13 && mAt(ivec2(cf)+ivec2(2,0))!=13) b *= .72;   // groove between the two middle boards (4-wide door)
    if(mod(cf.y,10.)<1. && !fr) b *= .8;                                      // faint plank joints
    if(fr) b = vec3(.30,.19,.10)*(.9+.2*hh);
    return b*(1.+g*.05);
  }
  if(m==7){                                                               // three tones by position in the bough: light tips / top edge, mid, dark core / underside
    float t = bn/255.;
    vec3 cL = vec3(.26,.52,.34), cM = vec3(.12,.33,.215), cD = vec3(.05,.17,.125);
    vec3 b = mix(mix(cL, cM, smoothstep(.30,.36,t)), cD, smoothstep(.62,.68,t));
    b = mix(b, cL*1.06, (1.-smoothstep(0.,1.4,depth))*.3*(1.-t));         // tips catch the light
    b *= .97+.06*hh;
    if(top) b = mix(b, vec3(.78,.87,.92), .25);
    return b;
  }
  if(m==8) return vec3(.19,.19,.2)*(1.+g*.3);
  if(m==9){
    vec3 b = vec3(.74,.43,.15)*(.9+.2*vn(cf*vec2(.1,.8)));
    if(mod(cf.y,4.)<1. || mod(cf.x,16.)<1.2) b = vec3(.30,.16,.06);
    return b*(1.+g*.15);
  }
  if(m==10) return vert ? vec3(.95,.95,.92) : vec3(1.,.42,.05);
  return vec3(1.,0.,1.);
}

vec4 enc(vec4 v){
#ifdef HALF
  return v;
#else
  return vec4(sqrt(clamp(v.rgb*.5,0.,1.)), v.a);
#endif
}

void main(){
  ivec2 c = uOrg + ivec2(gl_FragCoord.xy);
  vec2 wp = vec2(c) + .5;
  vec4 tx = fetchW(c);
  int m = int(tx.r);
  float dn = tx.g*4., bn = tx.b; int fl = int(tx.a);
  float hh = hash2(c);
  vec2 cf = vec2(c);
  vec3 col; float openA = 0., dprof = 0.;
  int mUp = mAt(c+ivec2(0,-1));

  if(m==0){
    float dUp; vec3 sv3 = skyMarch(c, 3, int(vn(wp*.21)*2.99), mUp, dUp);
    float open = smoothstep(.35,.62,sv3.g);
    #ifdef LIGHTS
    vec3 pl = pointLights(wp, c, vec2(0.), 0., hh);
#else
    vec3 pl = vec3(0.);
#endif
    // enclosed air (cut pockets, caves): dim blue-grey, lit by the snow around it, never black. sv3 only darkens it, it keeps a floor
    vec3 bw = vec3(.52,.64,.84)*(1.+(hh-.5)*.06+(vn(wp*.15)-.5)*.2);
    float gloom = .40+.60*dot(sv3,vec3(.33));
#ifdef HIQ
    if(gloom<.98 && mAt(c+ivec2(0,3))!=0) gloom *= 1.22;                         // snow floor right below: bounce light, the pocket brightens toward its floor
#endif
    vec3 inner = bw*(uAmb*gloom + pl*.9) + vec3(.020,.030,.052)*(1.-.6*uDay);
    col = inner;
    if(open>.004){ col = inner*(1.-open) + pl*.4*open; openA = open; }   // screen pass adds background*openA
    // low drifting snow hugging the local ground when it blows: height above the ground below this cell
#ifdef WIND
    float ws = smoothstep(5.,11.,abs(uWind));
    if(ws>.01 && openA>.05){
      float gh = 26.;
      for(int k=1;k<=8;k++){ if(mAt(c+ivec2(0,k*3))!=0){ gh = float(k*3)-1.5; break; } }
      dprof = exp(-gh/9.);
    }
#endif
  } else {
    int jit = int(vn(wp*.27)*1.99);   // spatially coherent jitter: smooth shadow edges instead of per-cell dither
    float dUp; vec3 sv3 = skyMarch(c, 2, jit, mUp, dUp);
    float dLat = 40.;
#ifdef HIQ
    for(int k=0;k<3;k++){ int q=1+2*k; if(mAt(c+ivec2(-q,0))==0 || mAt(c+ivec2(q,0))==0){ dLat=float(q); break; } }
#else
    for(int k=0;k<2;k++){ int q=1+3*k; if(mAt(c+ivec2(-q,0))==0 || mAt(c+ivec2(q,0))==0){ dLat=float(q); break; } }
#endif
    float dDir; vec3 dirT = dirMarch(wp, dDir);
    float depth = min(dUp, min(dLat, dDir*1.3));
    vec2 n = vec2(0.); float hasN = 0.;
    if(depth<=2.5){ n = surfN(c); hasN = 1.; }
    vec3 n3 = normalize(vec3(n*1.2,.6));
    vec3 L3 = normalize(vec3(uSkyDir,.55));
    float diff = hasN>.5 ? max(dot(n3,L3),0.) : .55;
    vec3 alb = albedo(m, dn, bn, fl, cf, hh, depth, mUp==0, n, hasN);
    float lip = 0.;
#ifdef HIQ
    if(hasN>.5){
      // soft 1-cell AO at concave corners; convex lips catch light, undersides sink into shadow
      int air = 0;
      for(int j=-1;j<=1;j++) for(int i2=-1;i2<=1;i2++){ if(i2==0&&j==0) continue; if(mAt(c+ivec2(i2,j))==0) air++; }
      if(air>=1) alb *= 1.-.08*float(3-min(air,3));
      lip = smoothstep(4.,6.,float(air));
      if(m==1){ alb += lip*.035*(.5+.5*uDay); alb = mix(alb, alb*vec3(.8,.86,1.), smoothstep(.2,.8,n.y)*.5); }
      if(m==1 && mAt(c+ivec2(0,2))==0 && mAt(c+ivec2(0,1))!=0) alb *= vec3(.95,.96,.99);   // second row under an overhang
    }
#endif
    float wallF = 0.;
    if(m==1 && hasN>.5){
      // cut edges: exposed upper edges get a 1-cell lighter lip, the cell under an overhang sinks into shadow (softens the stair-step look)
      if(mUp==0){
        bool trench = mAt(c+ivec2(-3,-3))!=0 || mAt(c+ivec2(3,-3))!=0;     // floor of a cut / cave: a bright, crisp edge
        alb = mix(alb, vec3(.97,.985,1.), trench ? .4 : .22);
      }
      else if(mAt(c+ivec2(0,1))==0) alb *= vec3(.82,.86,.95);
      // exposed cut faces (steep, sheltered from the sky): tool-cut strata, a fine horizontal grain and darker joints; deeper = bluer (the depth tint above)
      wallF = smoothstep(.35,.8,abs(n.x)) * step(.5, float(mUp!=0)) * (1.-smoothstep(1.6,2.6,depth));
      if(wallF>0.){
        float sy = cf.y*.42 + vn(vec2(cf.x*.05, cf.y*.12))*2.4;
        float band = smoothstep(.68,.9,fract(sy));
        float cutg = (hash2(ivec2(c.x>>1, c.y)) - .5);
        alb *= 1. - wallF*(.075*band + .035*(fract(cf.y*.16+ vn(vec2(cf.x*.03,cf.y*.05))*3.)<.12 ? 1. : 0.));
        alb += wallF*cutg*.028;
        alb = mix(alb, alb*vec3(.9,.95,1.03), wallF*.4);
      }
    }
    #ifdef LIGHTS
    vec3 pl = pointLights(wp, c, n, hasN, hh);
#else
    vec3 pl = vec3(0.);
#endif
    vec3 scat = m==1 ? vec3(.12,.2,.3)*exp(-depth/30.) : vec3(0.);
    // thick snow still scatters plenty of light: neutral (hue-free) falloff, the blue lives in the albedo gradient
    float svL = smoothstep(0.,.18,dot(sv3,vec3(.33)));
    vec3 lit = uAmb*(m==1 ? .22+.78*svL+scat*.5 : .45+.84*sv3+scat) + uDirCol*diff*dirT + pl;
    if(m==6) lit = max(lit, uAmb*.82 + pl);                               // bark and boughs under the crown never go black
    else if(m==7) lit = max(lit, uAmb*.62 + pl);
    else if(m==11 || m==13) lit = max(lit, uAmb*1.05 + pl) + vec3(.085,.058,.032)*(1.-uDay);   // placed timber stays readable at night (a touch warmer / brighter)
    else if(m==5 && (fl&64)!=0) lit = lit*1.2 + uAmb*.15;
    col = alb*lit;
    if(m==1 && hasN>.5 && depth<2.2){
      float fac = clamp(dot(n, uSkyDir)*1.3+.35, 0., 1.);                 // surface cells facing the sun / moon
      float night = (1.-uDay)*uVis.y*(1.-uStorm);
      // moon rim light along the surface edge
      col += vec3(.10,.17,.34)*night*smoothstep(.1,.8,dot(n,uSkyDir))*(.6+.4*dirT.g);
      float lum = dot(uDirCol,vec3(.33))*dirT.g;
      float plL = dot(pl,vec3(.33));
      // glints: clusters of 1-2 bright cells; each flashes with time and with camera movement. Density follows the light: rarer under the moon, warm near fires
      float hs = hash2(ivec2(c.x/3, c.y>>1));
      float plW = smoothstep(.04,.35,plL);
      if(hs > mix(.91,.965,night)){
        float h2 = hash2(c+ivec2(5,9));
        if(h2 > .22){
          float tw = pow(.5+.5*sin(uTime*(1.6+3.*hs) + hs*400. + uCamX*.11*(.4+hs) + h2*6.), 5.);
          float str = clamp(lum*1.5 + plL*1.6 + .28*uDay*(1.-uStorm) + .22*night, 0., 1.);
          float h3 = hash2(c+ivec2(11,17)), wc = mix(.12, .6, 1.-uDay);      // by day white would vanish on white snow: prismatic cyan / gold / violet glints dominate
          vec3 tint = h3<wc ? vec3(2.) : (h3<wc+(1.-wc)*.45 ? vec3(.3,1.0,1.7) : (h3<wc+(1.-wc)*.8 ? vec3(1.8,1.1,.3) : vec3(1.25,.45,1.6)));
          tint = mix(tint, vec3(1.8,1.15,.55), plW*.85);
          col = mix(col, tint, clamp(smoothstep(.06,.3,tw)*(.6+.6*str)*(.8+.2*fac),0.,1.));
        }
      }
      // ice glaze: snow that a fire has warmed and refrozen, a thin glassy film on the walls and floor of cuts near the fire (needs the lit side and a bit of depth)
      if(plL>.1){
        float gz = smoothstep(.1,.5,plL) * (.45+.55*vn(vec2(cf.x*.28, cf.y*.1))) * (1.-smoothstep(.9,2.1,depth));
        col = mix(col, vec3(.70,.90,1.06)*min(1.4,.5+plL*1.3), gz*.5);
        col += vec3(1.,.78,.55)*gz*smoothstep(.55,.9,vn(vec2(cf.x*.5,cf.y*.7)+4.))*.16;
      }
      // wind crust: a glossy sheen sliding over the slab as the view moves
      if((fl&16)!=0){
        float sheen = smoothstep(.45,.95, vn(vec2(cf.x*.045 + uCamX*.006, cf.y*.5)+3.));
        col += vec3(.9,.97,1.)*sheen*.09*(lum*1.2 + .22*uDay*(1.-uStorm) + .15*night)*fac;
      }
      // trodden groove: tiny shadow on the wall on the light side
      if((fl&1)!=0 && dn>=280. && mUp==0 && mAt(c+ivec2(uSkyDir.x>=0. ? 1 : -1, -1))!=0) col *= .84;
    }
  }
  oCol = enc(vec4(col, openA));
  oAux = vec4(dprof, 0., 0., 1.);
}`;
// Variants are compiled with #defines instead of uniform branches (dead code is not free everywhere): LIGHTS = a light reaches the view, WIND = drifting-snow profile, HIQ = AO / lips.
const CF = { LIGHTS: 1, WIND: 2, HIQ: 4 };
const defs = (names: string[], f: number, map: Record<string, number>) => names.map(n => (f & map[n] ? `#define ${n}\n` : '')).join('');
const fsCell = (half: boolean, f: number) => '#version 300 es\n' + (half ? '#define HALF\n' : '') + defs(['LIGHTS', 'WIND', 'HIQ'], f, CF) + COMMON + CELL_BODY;

// ---------------------------------------------------------------- screen pass
const SCR_BODY = `
uniform sampler2D uHeat, uCell, uAux, uCol;
uniform ivec2 uOrg, uCellSz;
uniform vec2 uRes, uCam, uView, uVis;
uniform float uTime, uDay, uStorm, uWind, uFog;
uniform int uXray, uStormL;
uniform vec3 uAmb, uSkyTop, uSkyHor;
uniform vec4 uBody;
out vec4 fragColor;

// coverage of one spruce silhouette (tv = (x - tree x, height, ground y, present)); tone 0..1 = position inside the tier (for light tips)
float spruce(vec4 tv, float ly, float w0, float w1, float tier, out float tone, out float side){
  float dy = tv.z - ly; tone = 0.; side = 0.;
  if(tv.w>.5 && dy>0. && dy<tv.y){
    float fr = fract(dy/tier);
    float hw = (1.-dy/tv.y)*(w0+tv.y*w1)*(.62+.38*fr);
    if(abs(tv.x)<hw){ tone = fr; side = clamp(tv.x/max(hw,1.),-1.,1.); return 1.; }
  }
  return 0.;
}

vec3 background(vec2 sUV, vec2 sOff, vec3 bgL){
  float asp = uRes.x/uRes.y;
  float skyT = smoothstep(0.,.9,sUV.y);
  vec3 sky = mix(uSkyTop, uSkyHor, skyT);
  sky += vec3(-.02,.0,.04)*(4.*skyT*(1.-skyT))*uDay*(1.-uStorm);            // a touch more saturated blue half-way down, so the gradient is not a straight lerp
  float hzx = (sUV.y-.8)*4.2;
  sky += uSkyHor*(1./(1.+hzx*hzx*hzx*hzx))*(.08+.34*uStorm);                 // horizon haze glow
  float nightClear = (1.-uDay)*(1.-smoothstep(.1,.35,uStorm));
#ifdef NIGHT
  if(nightClear>.02){
    vec2 sp = vec2(sUV.x*asp, sUV.y)*70. + vec2(uCam.x*.02, 0.);
    vec2 ci = floor(sp), cf = fract(sp);
    float h = hf(ci);
    if(h>.985){
      vec2 pos = vec2(hf(ci+7.1), hf(ci+3.7))*.6+.2;
      float s = 1.-smoothstep(0.,.22,length(cf-pos));
      float tw = .65+.35*sin(uTime*2.5+h*60.);
      sky += vec3(.85,.9,1.)*s*tw*nightClear*(1.-smoothstep(.5,.8,sUV.y))*(.4+.6*(h-.985)/.015);
    }
    if(nightClear>.3){
      float x = sUV.x*asp*2.2 + uCam.x*.0005;
      float band = .32 + .1*sin(x*1.7+uTime*.07) + .05*sin(x*4.1-uTime*.11);
      float wd = .07+.05*vn(vec2(x*2.,uTime*.05));
      float auU = (sUV.y-band)/wd; float inten = exp(-auU*auU);
      float curtain = vn(vec2(x*5.+uTime*.1, sUV.y*3.));
      vec3 ac = mix(vec3(.15,1.,.55), vec3(.6,.25,.95), smoothstep(0.,.15,band-sUV.y));
      sky += ac*inten*curtain*.35*clamp((nightClear-.3)/.7,0.,1.);
    }
  }
#endif
  vec2 dv = (sUV-uBody.xy)*vec2(asp,1.); float ds = length(dv);
  sky += vec3(1.,.85,.6)*exp(-ds*7.)*.5*uVis.x;
  sky = mix(sky, vec3(1.,.97,.85)*1.6, (1.-smoothstep(.030,.034,ds))*uVis.x);
  vec2 mv = (sUV-uBody.zw)*vec2(asp,1.); float dm = length(mv);
  sky += vec3(.4,.5,.8)*exp(-dm*9.)*.25*uVis.y;
  if(dm<.025) sky = mix(sky, vec3(.9,.93,1.)*(.8+.2*vn(mv*90.)), (1.-smoothstep(.022,.025,dm))*uVis.y);

  float fg = uFog + uStorm*.35;
  float nt = (1.-uDay);
  vec3 col = sky;
  // light direction for the ridges: the sun by day, the moon at night (screen-space, y down)
  float lbx = uVis.x >= uVis.y ? uBody.x : uBody.z;
  vec2 Ld = normalize(vec2((lbx-.5)*2.6 + (lbx>=.5 ? .18 : -.18), -.62));
#ifdef COLTEX
  vec4 cm = texelFetch(uCol, ivec2(int(gl_FragCoord.x), 0), 0);
  int gx = int(gl_FragCoord.x), gw = textureSize(uCol,0).x;
#endif
  float cpx = uView.x/uRes.x;                                                 // cells per canvas pixel
#ifdef COLTEX
  vec4 sl = texelFetch(uCol, ivec2(gx, 7), 0);                                // (ridge slope, hill slope, facet noise, streak noise)
#else
  vec4 sl = slopeRow(uCam.x*.06 + sOff.x, uCam.x*.15 + sOff.x, cpx);
#endif
  // far mountains: snow ridges shaded by the light direction, rock streaks, mist at the foot
  {
    float ly = sOff.y + (uCam.y-380.)*.10;
#ifdef COLTEX
    float e = cm.x;
#else
    float e = eMtn(uCam.x*.06 + sOff.x);
#endif
    float a = smoothstep(-.7,.7,ly-e);
    if(a>0.){
      float dz = max(ly-e,0.);
      float dedx = sl.x;
      vec2 nrm = normalize(vec2(clamp(dedx,-2.5,2.5)*1.1, -1.));
      float lit = smoothstep(-.3,.85,dot(nrm,Ld));
      float fx = sl.z + .7*(fract(dz*.021 + sl.z*4.)-.5);                      // facets / gullies running down the flank
      lit = clamp(lit + (fx-.5)*1.5*smoothstep(2.,20.,dz), 0., 1.);
      float rk = fract(sl.w*11. + dz*.04*sign(dedx+.001));
      float streak = smoothstep(.7,.9,rk)*smoothstep(8.,22.,dz)*(1.-smoothstep(60.,105.,dz))*(.4+.6*smoothstep(.1,.8,abs(dedx)));
      vec3 c = mix(vec3(.50,.60,.79), vec3(.95,.975,1.), lit);
      c = mix(c, vec3(.30,.35,.48)*(.65+.55*lit), streak*.62);
      c = mix(c, vec3(.46,.58,.78), clamp(dz/120.,0.,1.)*.4);
      c += vec3(.1,.11,.12)*lit*(1.-smoothstep(0.,1.6,dz));                    // rim light along the sunny crest
      c *= bgL;
      c += vec3(.05,.08,.15)*nt*(1.-uStorm)*exp(-dz/7.)*(.5+.5*uVis.y);        // moonlit snowcaps
      c = mix(c, uSkyHor, clamp(.40-.2*nt+.35*fg + .3*smoothstep(50.,130.,dz),0.,1.));   // far layer: strongest atmospheric haze, thick mist in the valley
      col = mix(col, c, a);
    }
  }
  // mid hills
  {
    float ly = sOff.y + (uCam.y-380.)*.17;
#ifdef COLTEX
    float e = cm.y;
#else
    float e = eHill(uCam.x*.15 + sOff.x);
#endif
    float a = smoothstep(-.7,.7,ly-e);
    if(a>0.){
      float dz = max(ly-e,0.);
      float lit = smoothstep(-.3,.85,dot(normalize(vec2(clamp(sl.y,-2.,2.)*1.4,-1.)),Ld));
      lit = clamp(lit + (fract(dz*.037 + sl.z*5.)-.5)*.4*smoothstep(1.,14.,dz), 0., 1.);
      vec3 c = mix(vec3(.52,.63,.80), vec3(.34,.46,.68), clamp(dz/50.,0.,1.));
      c *= .84 + .3*lit;
      c += vec3(.07,.08,.09)*lit*(1.-smoothstep(0.,1.4,dz));
      c *= bgL*(1.-.28*nt);
      c = mix(c, uSkyHor, clamp(.36+.4*fg + .2*smoothstep(24.,60.,dz),0.,1.));
      col = mix(col, c, a);
    }
  }
  // near snow field + two spruce rows: a far, small one (parallax .30) and a nearer, bigger one (.46) that stands behind the playfield
  {
    float ly = sOff.y + (uCam.y-380.)*.27;
#ifdef COLTEX
    float hy = cm.z;
#else
    float Lx = uCam.x*.30 + sOff.x;
    float hy = eNear(Lx);
#endif
    float a = smoothstep(-.7,.7,ly-hy);
    vec3 c = vec3(.86,.91,.97)*bgL*(1.+.25*nt);
    c = mix(c, uSkyHor, clamp(.22+.4*fg,0.,1.));
    col = mix(col, c, a);
    if(hy-ly>-6. && hy-ly<68.){
      float aT = 0.;
#ifdef COLTEX
      for(int j=0;j<3;j++){
        vec4 tv = texelFetch(uCol, ivec2(gx, 1+j), 0);                       // (tx - Lx, th, ground y below the tree, present)
        float tn, sd; aT = max(aT, spruce(tv, ly, 7., .06, 6.5, tn, sd));
      }
#else
      for(int j=-1;j<=1;j++){
        float tn, sd; aT = max(aT, spruce(treeRow(Lx, 0, j), ly, 7., .06, 6.5, tn, sd));
      }
#endif
      vec3 tc = mix(vec3(.10,.18,.24)*bgL*(1.-.35*nt), uSkyHor, clamp(.18+.4*fg,0.,1.));
      col = mix(col, tc, aT);
    }
  }
  {
    float ly = sOff.y + (uCam.y-380.)*.36;
#ifdef COLTEX
    float hy = cm.w;
#else
    float Lx2 = uCam.x*.46 + sOff.x;
    float hy = eNear2(Lx2);
#endif
    float a = smoothstep(-.7,.7,ly-hy);
    vec3 c = mix(vec3(.80,.87,.95), vec3(.66,.76,.90), clamp((ly-hy)/40.,0.,1.))*bgL*(1.+.2*nt);
    c = mix(c, uSkyHor, clamp(.12+.38*fg,0.,1.));
    col = mix(col, c, a);
    if(hy-ly>-6. && hy-ly<92.){
      float aT = 0., tnA = 0., sdA = 0.;
#ifdef COLTEX
      for(int j=0;j<3;j++){
        vec4 tv = texelFetch(uCol, ivec2(gx, 4+j), 0);
        float tn, sd; float cv = spruce(tv, ly, 8., .13, 8.5, tn, sd);
        if(cv>aT){ aT = cv; tnA = tn; sdA = sd; }
      }
#else
      for(int j=-1;j<=1;j++){
        float tn, sd; float cv = spruce(treeRow(Lx2, 1, j), ly, 8., .13, 8.5, tn, sd);
        if(cv>aT){ aT = cv; tnA = tn; sdA = sd; }
      }
#endif
      if(aT>0.){
        float sunS = lbx>=.5 ? 1. : -1.;
        vec3 tc = vec3(.07,.15,.20)*(.8+.5*tnA)*(1.+.28*sdA*-sunS);           // lighter on the sun side, boughs lighter at the top of a tier
        tc = mix(tc, vec3(.50,.62,.78), smoothstep(.62,1.,tnA)*.28*(1.-nt*.7)*(1.-uStorm));   // frost on the bough tips
        tc *= bgL*(1.-.3*nt);
        tc = mix(tc, uSkyHor, clamp(.10+.4*fg,0.,1.));
        col = mix(col, tc, aT);
      }
    }
  }
  return col;
}

// x-ray colour ramps (polynomial fits of turbo / inferno; hand-picked diverging ramp for temperature) – keep in sync with XR_RAMPS in ui.ts
vec3 xrTurbo(float x){
  x = clamp(x,0.,1.);
  vec4 v4 = vec4(1.,x,x*x,x*x*x); vec2 v2 = v4.zw*v4.z;
  return clamp(vec3(dot(v4,vec4(.13572138,4.6153926,-42.66032258,132.13108234))+dot(v2,vec2(-152.94239396,59.28637943)),
                    dot(v4,vec4(.09140261,2.19418839,4.84296658,-14.18503333))+dot(v2,vec2(4.27729857,2.82956604)),
                    dot(v4,vec4(.1066733,12.64194608,-60.58204836,110.36276771))+dot(v2,vec2(-89.90310912,27.34824973))),0.,1.);
}
vec3 xrInferno(float t){
  t = clamp(t,0.,1.);
  return clamp(vec3(.0002189403691192265,.001651004631001012,-.01948089843709184)+t*(vec3(.1065134194856116,.5639564367884091,3.932712388889277)+t*(vec3(11.60249308247187,-3.972853965665698,-15.9423941062914)+t*(vec3(-41.70399613139459,17.43639888205313,44.35414519872813)+t*(vec3(77.162935699427,-33.40235894210092,-81.80730925738993)+t*(vec3(-71.31942824499214,32.62606426397723,73.20951985803202)+t*vec3(25.13112622477341,-12.24266895238567,-23.07032500287172)))))),0.,1.);
}
vec3 xrTemp(float t){
  const vec3 A=vec3(.20,.12,.60), B=vec3(.16,.45,.95), C=vec3(.35,.85,.95), D=vec3(.93,.97,1.), E=vec3(1.,.80,.30), F=vec3(.95,.22,.12);
  if(t<.3) return mix(A,B,t/.3);
  if(t<.6) return mix(B,C,(t-.3)/.3);
  if(t<.78) return mix(C,D,(t-.6)/.18);
  if(t<.84) return mix(D,E,(t-.78)/.06);
  return mix(E,F,(t-.84)/.16);
}

vec4 dec(vec4 v){
#ifdef HALF
  return v;
#else
  return vec4(v.rgb*v.rgb*2., v.a);
#endif
}

void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y-gl_FragCoord.y);
  vec2 sUV = fc/uRes;
  vec2 sOff = (sUV-.5)*uView;
  vec2 wp = uCam + sOff;
  ivec2 c = ivec2(floor(wp));
  ivec2 q = clamp(c-uOrg, ivec2(0), uCellSz-ivec2(1));
  vec4 cc = dec(texelFetch(uCell, q, 0));
  vec3 col = cc.rgb; float openA = cc.a;
  vec3 bgL = uAmb*.85+.02 + vec3(.03,.05,.09)*(1.-uDay)*(1.-uStorm);
  float asp = uRes.x/uRes.y;
  float dd = length((sUV-.5)*vec2(asp,1.));
  if(openA>.004) col += background(sUV, sOff, bgL)*openA;

  // low drifting snow hugging the local ground when it blows (> ~6 m/s)
#ifdef DRIFT
  float ws = smoothstep(5.,11.,abs(uWind));
  if(ws>.01 && openA>.05){
    float prof = texelFetch(uAux, q, 0).r;
    if(prof>.02){
      float sx = wp.x - uTime*uWind*2.2;
      float s1 = vn(vec2(sx*.035, wp.y*.85))*vn(vec2(sx*.011+9., wp.y*.3+3.));
      float s = smoothstep(.2,.5,s1*1.7) + .5*smoothstep(.82,.95,vn(vec2(sx*.2, wp.y*1.7)));
      col = mix(col, min(bgL*1.1+.06, vec3(1.)), clamp(s,0.,1.)*prof*ws*(.4+.6*uStorm)*.75*openA);
    }
  }
#endif
  // storm: wind-driven snow streaks + whiteout
#ifdef STORM
  if(uStorm>.02){
    float spd = min(abs(uWind),30.), wdir = uWind>=0.?1.:-1.;
    vec2 vel = vec2(wdir*(14.+spd*2.4), 24.+12.*uStorm);
    vec2 vdir = normalize(vel), pdir = vec2(-vdir.y, vdir.x);
    float acc = 0.;
    for(int L=0;L<3;L++){
      if(L>=uStormL) break;
      float fl = float(L);
      float cs = 15.-3.5*fl, par = 1.3-.28*fl;
      vec2 p = (sOff + uCam*par - vel*uTime*(1.15-.2*fl)*(.9+.2*fl))/cs;
      vec2 ci = floor(p);
      float r0 = hf(ci+fl*13.7);
      if(r0>.5+.12*uStorm) continue;
      vec2 off = (vec2(hf(ci+3.1+fl), hf(ci+8.3+fl))-.5)*.34;
      vec2 d = (fract(p)-.5-off)*cs;
      float len = (3.6+spd*.22)*(1.-.3*fl);
      float along = abs(dot(d,vdir)), perp = abs(dot(d,pdir));
      float w = .5+.28*(2.-fl)*.5;
      acc += (1.-smoothstep(.15,w,perp))*(1.-smoothstep(len*.25,len,along))*(.75-.12*fl);
    }
    vec3 wo = min(uSkyHor*1.1+.05, vec3(1.));
    vec3 sc = min(max(uAmb*1.08+.05, wo*1.6+.08), vec3(1.));
    col = mix(col, sc, clamp(acc,0.,.8)*uStorm*.8);
    float wf = uStorm*(.2+.62*smoothstep(.1,.85,dd)) + uStorm*.12*vn(vec2(wp.x*.01-uTime*uWind*.05, wp.y*.02));
    col = mix(col, wo, clamp(wf,0.,.92));
  }
#endif
  // weather veil
  col = mix(col, uSkyHor, uFog*(.12+.88*smoothstep(.05,1.1,dd))*.8);
  // gentle filmic curve
  col = max(col, 0.);
  vec3 hi = .7+.3*(1.-exp(-(col-.7)/.3));
  col = mix(col, hi, step(.7,col));

#ifdef XRAY
  if(uXray>0){
    // "scanner" view: everything that is not the measured quantity is crushed to a dark desaturated relief,
    // the quantity itself is drawn with a perceptual colour map (same ramps as the legend in ui.ts), over a faint grid + scanlines.
    vec4 tx = fetchW(c);
    int m = int(tx.r); float dn = tx.g*4., bn = tx.b;
    float lum = dot(col, vec3(.299,.587,.114));
    vec3 base = m==0 ? vec3(.012,.026,.040) + lum*vec3(.035,.055,.075) : vec3(.030,.045,.060) + lum*vec3(.20,.24,.28);
    vec3 xc = base; float k = 0.;
    float ppc = uRes.x/uView.x;                                              // canvas pixels per world cell
    if(uXray==1 && m==1){
      float t = clamp((dn-50.)/450.,0.,1.);
      xc = xrTurbo(.08+.84*t); k = .94;
    } else if(uXray==2 && m==1){
      float t = clamp(sqrt(bn/160.),0.,1.);
      xc = xrInferno(.10+.82*t); k = .94;
      vec4 xr = fetchW(c+ivec2(1,0)), xd = fetchW(c+ivec2(0,1));          // contour where bond crosses BOND_SOLID (48)
      if((xr.r==1. && (bn>=48.)!=(xr.b>=48.)) || (xd.r==1. && (bn>=48.)!=(xd.b>=48.))) { xc = vec3(.55,1.,.95); k = 1.; }
    } else if(uXray==3){
      float tc = texture(uHeat, wp/vec2(float(WI),float(HI))).r*127.5-60.;
      float t = clamp((tc+40.)/50.,0.,1.);
      xc = xrTemp(t); k = m==0 ? .5 : .94;
      float iso = abs(fract(tc*.1+.5)-.5)*10.;                            // isotherm every 10 deg, 0 deg brighter
      float il = 1.-smoothstep(.0,1.4/ppc+.05,iso);
      xc = mix(xc, vec3(1.), il*(abs(tc)<1.2 ? .75 : .28)*(m==0?.6:1.));
    }
    vec3 xo = mix(base, xc, k);
    if(m==1 && k>0.){                                                       // thin bright rim where snow meets open air: keeps the terrain shape readable
      if(fetchW(c+ivec2(0,-1)).r==0. || fetchW(c+ivec2(-1,0)).r==0.) xo = mix(xo, vec3(.92,1.,1.), .55);
    }
    vec2 gd = abs(fract(wp*(1./16.)+.5)-.5)*16.;
    xo += vec3(.02,.09,.10)*max(step(gd.x,1./ppc), step(gd.y,1./ppc));      // world grid, 16 cells
    xo *= .86+.14*step(.5, fract(gl_FragCoord.y*.25));                      // scanlines
    xo += vec3(.0,.20,.16)*exp(-pow((sUV.y-fract(uTime*.11))*28.,2.))*.35;  // slow sweep bar
    col = xo;
  }
#endif
  col *= 1.-.3*smoothstep(.35,.75,length(sUV-.5));
  uint dh = ihash(uvec2(gl_FragCoord.xy));
  col += (float(dh&65535u) + float(dh>>16u) - 65535.)*(1./65536./255.);   // triangular dither (+-1 LSB): no banding in the sky gradient
  fragColor = vec4(col,1.);
}`;
const SF = { STORM: 1, DRIFT: 2, NIGHT: 4, XRAY: 8 };
const fsScr = (half: boolean, coltex: boolean, f: number) => '#version 300 es\n' + (half ? '#define HALF\n' : '') + (coltex ? '#define COLTEX\n' : '') + defs(['STORM', 'DRIFT', 'NIGHT', 'XRAY'], f, SF) + COMMON + BGF + SCR_BODY;

// ---------------------------------------------------------------- background column pass
// The parallax mountains / hills / field / tree rows only depend on the screen column, so they are evaluated once per canvas column here
// (4 texels per column, float target; same GLSL as the inline fallback, so the picture is identical) instead of once per pixel.
const BGF = `
uniform int uOct;
float vn1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(h1(i),h1(i+1.),f); }
float fbm1(float x){ float a=.5,s=0.,n=0.; for(int o=0;o<4;o++){ if(o>=uOct) break; s+=a*vn1(x); n+=a; x=x*2.03+17.; a*=.5; } return s/n; }
float eMtn(float Lx){ float rr = 1.-abs(2.*fbm1(Lx*.012+3.)-1.); float r2 = 1.-abs(2.*fbm1(Lx*.037+11.)-1.); return 20. - 100.*pow(rr,1.5) - 15.*r2*rr*rr; }   // ridged peaks + crags on the crests
float eHill(float Lx){ return 48. - 50.*fbm1(Lx*.02+41.); }
float eNear(float Lx){ return 74. - 16.*fbm1(Lx*.03+90.); }
float eNear2(float Lx){ return 70. - 11.*fbm1(Lx*.027+130.); }
// per-column ridge / hill slopes (cells per cell) and two 1D noises that drive the facet / rock-streak shading of the far ridges
vec4 slopeRow(float Lm, float Lh, float cpx){
  return vec4((eMtn(Lm+4.*cpx)-eMtn(Lm-4.*cpx))/(8.*cpx), (eHill(Lh+5.*cpx)-eHill(Lh-5.*cpx))/(10.*cpx), vn1(Lm*.07), vn1(Lm*.45));
}
// spruce j (-1..1 around the pixel) of layer 0 (far, small) / 1 (near, big, in clumps): (x - tree x, height, ground y below it, present)
vec4 treeRow(float Lx, int layer, int j){
  float sp = layer==0 ? 11. : 19.;
  float k = floor(Lx/sp) + float(j);
  float tx = (k + .15 + .7*h1(k*3.1+5.))*sp;
  if(layer==0) return vec4(Lx - tx, 24. + 36.*h1(k*5.7+2.), eNear(tx)+3., h1(k*7.3+1.)<.22 ? 0. : 1.);
  float pf = fbm1(k*.17+60.);
  return vec4(Lx - tx, 46. + 40.*h1(k*5.7+2.), eNear2(tx)+3., h1(k*7.3+1.) < clamp(.78-1.15*pf,.04,.75) ? 0. : 1.);
}
`;
const FS_COL = '#version 300 es\n' + COMMON + BGF + `
uniform vec2 uCam, uView, uRes;
out vec4 o;
void main(){
  int row = int(gl_FragCoord.y);
  float sx = (gl_FragCoord.x/uRes.x - .5)*uView.x;
  if(row==0){
    o = vec4(eMtn(uCam.x*.06 + sx), eHill(uCam.x*.15 + sx), eNear(uCam.x*.30 + sx), eNear2(uCam.x*.46 + sx));
  } else if(row<4){
    o = treeRow(uCam.x*.30 + sx, 0, row-2);
  } else if(row==7){
    o = slopeRow(uCam.x*.06 + sx, uCam.x*.15 + sx, uView.x/uRes.x);
  } else {
    o = treeRow(uCam.x*.46 + sx, 1, row-5);
  }
}`;

const PVS = `#version 300 es
in vec2 aPos; in vec2 aS; in vec4 aC;
uniform vec2 uCam, uView; uniform float uPx, uMaxPt;
out vec4 vC; out float vHard; flat out float vAdd;
void main(){
  vec2 o = (aPos-uCam)/(uView*.5);
  gl_Position = vec4(o.x, -o.y, 0., 1.);
  gl_PointSize = clamp(abs(aS.x)*uPx, 1., uMaxPt);
  vC = aC; vHard = aS.y; vAdd = aS.x<0. ? 1. : 0.;
}`;
const PFS = `#version 300 es
precision mediump float;
in vec4 vC; in float vHard; flat in float vAdd;
out vec4 o;
void main(){
  float r = length(gl_PointCoord*2.-1.);
  if(r>=1.) discard;
  float f = mix((1.-r)*(1.-r), 1.-smoothstep(.7,1.,r), vHard) * vC.a;
  o = vec4(vC.rgb*f, vAdd>.5 ? 0. : f);
}`;

const clamp = (v: number, a = 0, b = 1) => v < a ? a : v > b ? b : v;
/** cells rendered beyond the view on each side (quality 0 only): lets the cell target be reused while the camera drifts a few cells */
const cellMargin = () => (G.quality === 0 ? 3 : 0);
/** touch devices: quality 1 screen pass is capped at this many canvas px per css px (the screen pass scales with pixels, the cell pass does not) */
const TOUCH_Q1_SCALE = 1.0;
const mixn = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
type V3 = [number, number, number];
const v3 = (): V3 => [0, 0, 0];
const set3 = (o: V3, x: number, y: number, z: number): V3 => { o[0] = x; o[1] = y; o[2] = z; return o; };
const mix3 = (o: V3, a: V3, b: V3, t: number): V3 => { o[0] = mixn(a[0], b[0], t); o[1] = mixn(a[1], b[1], t); o[2] = mixn(a[2], b[2], t); return o; };

export class Renderer {
  private gl!: WebGL2RenderingContext;
  private pprog!: WebGLProgram;
  private cellV = new Map<number, { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }>();
  private scrV = new Map<number, { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> }>();
  private vao!: WebGLVertexArrayObject; private pvao!: WebGLVertexArrayObject;
  private pbuf!: WebGLBuffer; private worldTex!: WebGLTexture; private heatTex!: WebGLTexture;
  private cellTex: WebGLTexture | null = null; private auxTex: WebGLTexture | null = null; private cellFbo: WebGLFramebuffer | null = null;
  private cellW = 0; private cellH = 0; private orgX = 0; private orgY = 0;
  // cell target reuse: origin / variant it was last rendered with, and frames since (see render, pass 1)
  private cellOrgX = 0; private cellOrgY = 0; private cellValid = false; private cellVar = -1; private cellAge = 0;
  private half = false; private colOK = false;
  private progCol: WebGLProgram | null = null; private uk: Record<string, WebGLUniformLocation | null> = {};
  private colTex: WebGLTexture | null = null; private colFbo: WebGLFramebuffer | null = null; private colW = 0;
  private topTex!: WebGLTexture; private colTopY = new Uint16Array(W); private topDirty = true;
  private pu: Record<string, WebGLUniformLocation | null> = {};
  private pix = new Uint8Array(W * H * 4);
  private heatPix = new Uint8Array(HW * HH * 4);
  private pdata = new Float32Array(24000 * 8);
  private pStart = [0, 0, 0]; private pCount = [0, 0, 0];
  private lp = new Float32Array(32); private lc = new Float32Array(24);
  private cssW = 1; private cssH = 1; private dpr = 1; private scale = 1; private dyn = 1;
  /** touch quality ladder (main.ts): screen-pass canvas px per css px for the current quality, still capped by dpr; null = built-in rule */
  private scaleOverride: number | null = null;
  private frame = 0; private full = true; private lost = false; private maxPt = 64;
  private tint: V3 = v3();
  /** unmasked GPU string (lower case), '' when the browser hides it */
  gpu = '';
  // per-frame lighting scratch (no allocations in the frame loop)
  private amb = v3(); private dir = v3(); private top = v3(); private hor = v3();
  private sA = v3(); private sB = v3(); private sC = v3(); private sD = v3(); private sE = v3();
  private lt = { sbx: 0, sby: 0, mbx: 0, mby: 0, dx: 0, dy: 0, day: 1, storm: 0, fog: 0, vis0: 0, vis1: 0 };

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 не поддерживается этим браузером / устройством: игра не может запуститься.');
    this.gl = gl;
    try { const e = gl.getExtension('WEBGL_debug_renderer_info'); if (e) this.gpu = String(gl.getParameter(e.UNMASKED_RENDERER_WEBGL) || '').toLowerCase(); } catch { /* hidden */ }
    canvas.addEventListener('webglcontextlost', e => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { this.init(); this.lost = false; });
    this.init();
  }

  /** Force a full re-upload of the world texture (call after generate()/load). */
  invalidate() { this.full = true; }

  private compile(vs: string, fs: string, name: string): WebGLProgram {
    const gl = this.gl;
    const mk = (t: number, src: string) => {
      const s = gl.createShader(t)!; gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(`Shader ${name} compile error: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(p, 0, 'aPos'); gl.bindAttribLocation(p, 1, 'aS'); gl.bindAttribLocation(p, 2, 'aC');
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Program ${name} link error: ${gl.getProgramInfoLog(p)}`);
    return p;
  }

  private tex(w: number, h: number, filter: number, fmt: number = this.gl.RGBA8): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  /** Can we render into RGBA16F (colour can exceed 1 with lights)? Otherwise the cell target is RGBA8 with a sqrt encoding. */
  private probeHalf(): boolean {
    const gl = this.gl;
    if (/[?&]nohalf\b/.test(location.search)) return false;   // dev: exercise the RGBA8 fallback
    if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return false;
    const t = this.tex(4, 4, gl.NEAREST, gl.RGBA16F), f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); gl.deleteTexture(t);
    return ok;
  }

  /** RGBA32F render target available (background column pass)? */
  private probeF32(): boolean {
    const gl = this.gl;
    if (/[?&]nof32\b/.test(location.search)) return false;   // dev: exercise the inline-background fallback
    if (!gl.getExtension('EXT_color_buffer_float')) return false;
    const t = this.tex(4, 4, gl.NEAREST, gl.RGBA32F), f = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(f); gl.deleteTexture(t);
    return ok;
  }

  private init() {
    const gl = this.gl;
    this.half = this.probeHalf(); this.colOK = this.probeF32();
    this.pprog = this.compile(PVS, PFS, 'particles');
    this.cellV.clear(); this.scrV.clear();
    this.progCol = this.colOK ? this.compile(VS, FS_COL, 'bgcol') : null;
    this.uk = {}; this.pu = {};
    if (this.progCol) for (const n of ['uCam', 'uView', 'uRes', 'uOct', 'uWorld']) this.uk[n] = gl.getUniformLocation(this.progCol, n);
    for (const n of ['uCam', 'uView', 'uPx', 'uMaxPt']) this.pu[n] = gl.getUniformLocation(this.pprog, n);
    this.vao = gl.createVertexArray()!;
    this.worldTex = this.tex(W, H, gl.NEAREST);
    this.heatTex = this.tex(HW, HH, gl.LINEAR);
    this.cellTex = null; this.auxTex = null; this.cellFbo = null; this.cellW = this.cellH = 0;
    this.colTex = null; this.colFbo = null; this.colW = 0;
    this.topTex = this.tex(W, 1, gl.NEAREST, gl.R16UI); this.topDirty = true;
    this.pvao = gl.createVertexArray()!; gl.bindVertexArray(this.pvao);
    this.pbuf = gl.createBuffer()!; gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
    gl.bufferData(gl.ARRAY_BUFFER, this.pdata.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 32, 0);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 32, 8);
    gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 4, gl.FLOAT, false, 32, 16);
    gl.bindVertexArray(null);
    this.maxPt = (gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE) as Float32Array)[1] || 64;
    this.full = true;
  }

  private locs(p: WebGLProgram, names: string[]) { const o: Record<string, WebGLUniformLocation | null> = {}; for (const n of names) o[n] = this.gl.getUniformLocation(p, n); return o; }
  private cellProg(f: number) {
    let v = this.cellV.get(f);
    if (!v) {
      const p = this.compile(VS, fsCell(this.half, f), 'cell');
      v = { p, u: this.locs(p, ['uWorld', 'uTop', 'uOrg', 'uTime', 'uDay', 'uStorm', 'uWind', 'uCamX', 'uNL', 'uSkyDir', 'uAmb', 'uDirCol', 'uVis', 'uLP[0]', 'uLC[0]']) };
      this.cellV.set(f, v);
    }
    return v;
  }
  private scrProg(f: number) {
    let v = this.scrV.get(f);
    if (!v) {
      const p = this.compile(VS, fsScr(this.half, this.colOK, f), 'screen');
      v = { p, u: this.locs(p, ['uWorld', 'uHeat', 'uCell', 'uAux', 'uCol', 'uOrg', 'uCellSz', 'uRes', 'uCam', 'uView', 'uVis', 'uTime', 'uDay', 'uStorm', 'uWind', 'uFog', 'uXray', 'uOct', 'uStormL', 'uAmb', 'uSkyTop', 'uSkyHor', 'uBody']) };
      this.scrV.set(f, v);
    }
    return v;
  }
  /** Compile the shader variants a session will hit (night, storm, fire) while the title screen is up, so the first dusk / storm / campfire does not hitch. */
  prewarm() {
    // touch: the quality ladder can promote to quality 1 at any moment, so both cell variants are compiled up front (no hitch on promotion)
    const hqs = G.mobile ? [0, CF.HIQ] : [G.quality ? CF.HIQ : 0];
    for (const hq of hqs) for (const l of [0, CF.LIGHTS]) for (const w of [0, CF.WIND]) this.cellProg(hq | l | w);
    for (const n of [0, SF.NIGHT]) for (const w of [0, SF.STORM | SF.DRIFT]) this.scrProg(n | w);
  }

  /** (Re)allocate the cell target when the view size in cells changes. */
  private ensureCell() {
    const gl = this.gl, c = G.cam, mg = cellMargin(), cw = Math.ceil(c.vw) + 3 + 2 * mg, ch = Math.ceil(c.vh) + 3 + 2 * mg;
    if (this.cellTex && cw === this.cellW && ch === this.cellH) return;
    if (this.cellTex) { gl.deleteTexture(this.cellTex); gl.deleteTexture(this.auxTex); gl.deleteFramebuffer(this.cellFbo); }
    this.cellW = cw; this.cellH = ch; this.cellValid = false;
    this.cellTex = this.tex(cw, ch, gl.NEAREST, this.half ? gl.RGBA16F : gl.RGBA8);
    this.auxTex = this.tex(cw, ch, gl.NEAREST, gl.RGBA8);
    this.cellFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.cellTex, 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, this.auxTex, 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Background column target: 8 rows x canvas width, float32. */
  private ensureCol() {
    const gl = this.gl, w = this.canvas.width;
    if (!this.progCol || (this.colTex && this.colW === w)) return;
    if (this.colTex) { gl.deleteTexture(this.colTex); gl.deleteFramebuffer(this.colFbo); }
    this.colW = w; this.colTex = this.tex(w, 8, gl.NEAREST, gl.RGBA32F);
    this.colFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.colFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.colTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Canvas pixels per css pixel at full dynamic scale (low quality renders at 0.6x and lets the browser upscale). */
  private baseScale() {
    if (this.scaleOverride !== null) return Math.min(this.dpr || 1, this.scaleOverride);
    if (G.quality === 0) return 0.6;
    return Math.min(this.dpr || 1, G.mobile ? TOUCH_Q1_SCALE : 2);   // touch: quality 1 never at full device resolution
  }
  /** Lowest dynamic multiplier we allow: keep >= ~1.1 canvas px per world cell so pixel art stays readable. */
  dynMin(): number { return clamp(1.1 / (G.cam.zoom * this.baseScale()), 0.45, 1); }
  getDyn() { return this.dyn; }
  /** touch quality ladder: set (or clear with null) the screen-pass scale for the current quality; the caller then resizes */
  setScaleOverride(s: number | null) {
    this.scaleOverride = s;
    this.dyn = clamp(this.dyn, this.dynMin(), 1);
    this.applySize();
  }
  /** drawing-buffer size in pixels */
  size(): [number, number] { return [this.canvas.width, this.canvas.height]; }
  /** Dynamic resolution: multiplier on the canvas size (screen pass + particles); the cell pass is resolution independent. */
  setDyn(s: number) {
    s = clamp(s, this.dynMin(), 1);
    if (Math.abs(s - this.dyn) < 1e-3) return;
    this.dyn = s; this.applySize();
  }

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = Math.max(1, cssW); this.cssH = Math.max(1, cssH); this.dpr = dpr;
    this.dyn = clamp(this.dyn, this.dynMin(), 1);
    this.applySize();
  }
  private applySize() {
    this.scale = this.baseScale() * this.dyn;
    const w = Math.max(1, Math.round(this.cssW * this.scale)), h = Math.max(1, Math.round(this.cssH * this.scale));
    if (this.canvas.width !== w) this.canvas.width = w;
    if (this.canvas.height !== h) this.canvas.height = h;
    this.canvas.style.width = this.cssW + 'px'; this.canvas.style.height = this.cssH + 'px';
    // pixel-art upscale: cells stay crisp when the world is drawn below native resolution (the UI lives on its own canvas / DOM)
    this.canvas.style.imageRendering = this.scale < (this.dpr || 1) * 0.98 ? 'pixelated' : 'auto';
    G.cam.vw = this.cssW / G.cam.zoom; G.cam.vh = this.cssH / G.cam.zoom;
  }

  worldToScreen(x: number, y: number): [number, number] {
    const c = G.cam; return [(x - c.x) * c.zoom + this.cssW / 2, (y - c.y) * c.zoom + this.cssH / 2];
  }
  screenToWorld(px: number, py: number): [number, number] {
    const c = G.cam; return [(px - this.cssW / 2) / c.zoom + c.x, (py - this.cssH / 2) / c.zoom + c.y];
  }

  // ---------- uploads ----------
  private pack(x0: number, y0: number, w: number, h: number) {
    const t = this.pix;
    for (let y = y0; y < y0 + h; y++) {
      let i = y * W + x0, o = i * 4;
      for (let x = 0; x < w; x++, i++, o += 4) {
        const d = dens[i] >> 2;
        t[o] = mat[i]; t[o + 1] = d > 255 ? 255 : d; t[o + 2] = bond[i]; t[o + 3] = flags[i] | (body[i] ? 32 : 0);
      }
    }
  }
  /** Uploads the dirty world chunks; returns true when any cell changed (the cell target then has to be rendered again). */
  private uploadWorld(): boolean {
    const gl = this.gl;
    let changed = false;
    gl.bindTexture(gl.TEXTURE_2D, this.worldTex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, W);
    if (this.full) {
      this.pack(0, 0, W, H);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, this.pix);
      gpuDirty.fill(0); this.full = false; this.scanTop(0, W); this.topDirty = true; changed = true;
    } else {
      for (let cy = 0; cy < CHH; cy++) {
        let cx = 0;
        while (cx < CW) {
          if (!gpuDirty[cy * CW + cx]) { cx++; continue; }
          let e = cx; while (e < CW && gpuDirty[cy * CW + e]) { gpuDirty[cy * CW + e] = 0; e++; }
          const x0 = cx * CH, y0 = cy * CH, w = (e - cx) * CH;
          this.pack(x0, y0, w, CH); if (prof.on) { prof.dirtyChunks = (prof.dirtyChunks || 0) * 0.98 + (e - cx) * 0.02; }
          gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, CH, gl.RGBA, gl.UNSIGNED_BYTE, this.pix);
          this.scanTop(x0, x0 + w); this.topDirty = true; changed = true;
          cx = e;
        }
      }
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
    if (this.topDirty) {
      gl.bindTexture(gl.TEXTURE_2D, this.topTex);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, this.colTopY);
      this.topDirty = false;
    }
    return changed;
  }
  /** First non-air row of every column in [x0,x1): the cell shader skips the sky march above it. Only dirty chunk columns are rescanned. */
  private scanTop(x0: number, x1: number) {
    const ty = this.colTopY;
    for (let x = x0; x < x1; x++) { let y = 0, i = x; while (y < H && mat[i] === 0) { y++; i += W; } ty[x] = y; }
  }
  /** Temperature texture: only the x-ray temperature view samples it. */
  private uploadHeat() {
    const gl = this.gl, h = this.heatPix, n = HW * HH;
    for (let i = 0, o = 0; i < n; i++, o += 4) {
      const t = (T[i] + 60) * 2, w = WND[i];
      h[o] = t < 0 ? 0 : t > 255 ? 255 : t;
      const a = Math.abs(w) * 10; h[o + 1] = a > 255 ? 255 : a;
      h[o + 2] = w >= 0 ? 255 : 0; h[o + 3] = 255;
    }
    gl.bindTexture(gl.TEXTURE_2D, this.heatTex);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, HW, HH, gl.RGBA, gl.UNSIGNED_BYTE, h);
  }

  // ---------- per-frame lighting parameters derived from G ----------
  private computeLight() {
    const c = G.cam, L = this.lt, amb = this.amb, dir = this.dir, top = this.top, hor = this.hor;
    const day = clamp(G.daylight), sa = G.sunAngle, storm = clamp(G.storm), moon = clamp(G.moon);
    const dusk = Math.exp(-((sa / 0.1) ** 2)) * (1 - 0.8 * storm);
    const tod = ((G.time / 60) % 24 + 24) % 24;
    // ambient
    const dayAmb = set3(this.sA, 0.88 * (1 - 0.3 * storm), 0.93 * (1 - 0.3 * storm), 1.0 * (1 - 0.25 * storm));
    const nm = 0.7 + 0.55 * moon, nightAmb = set3(this.sB, 0.15 * nm, 0.205 * nm, 0.345 * nm);
    mix3(amb, nightAmb, dayAmb, day);
    amb[0] += 0.10 * dusk; amb[1] += 0.03 * dusk; amb[2] = Math.max(0, amb[2] - 0.03 * dusk);
    // storm: a cold blue lift of the ambient light (scattered in the snow haze) so slopes, trees and the player never sink into black; strongest at night
    const lift = storm * (1 - 0.55 * day);
    amb[0] += 0.13 * lift; amb[1] += 0.19 * lift; amb[2] += 0.30 * lift;
    // directional light (sun / moon)
    const sunI = clamp((day - 0.1) / 0.5) * (1 - 0.85 * storm) * 0.6;
    const sunCol = mix3(this.sC, set3(this.sD, 1, 0.97, 0.9), set3(this.sE, 1, 0.68, 0.42), clamp(dusk * 1.4));
    const moonI = moon * 0.3 * (1 - day) * (1 - 0.6 * storm);
    set3(dir, sunCol[0] * sunI + 0.5 * moonI, sunCol[1] * sunI + 0.68 * moonI, sunCol[2] * sunI + 1.05 * moonI);
    // celestial positions in sky uv (y from top)
    const sbx = 0.5 + clamp((12.5 - tod) / 4.2, -1, 1) * 0.44, sby = 0.62 - clamp(sa, -0.1, 0.5) / 0.5 * 0.45;
    const mt = clamp(((tod - 17 + 24) % 24) / 14), mbx = 0.5 + (0.5 - mt) * 0.9, mby = 0.62 - 0.45 * Math.sin(mt * Math.PI);
    const useSun = sunI >= moonI;
    const bx = useSun ? sbx : mbx, by = useSun ? sby : mby;
    let dx = (bx - 0.5) * 1.5, dy = -(0.25 + (0.62 - by) * 1.6);
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    // sky colours
    mix3(top, set3(this.sA, 0.010, 0.022, 0.07), set3(this.sB, 0.30, 0.52, 0.90), day);
    const hm = 0.55 + 0.9 * moon;
    mix3(hor, set3(this.sA, 0.035 * hm, 0.07 * hm, 0.17 * hm), set3(this.sB, 0.66, 0.77, 0.88), day);   // day haze ~ #9fb4c8-ish, never pink
    hor[0] += 0.62 * dusk * 0.7; hor[1] += 0.28 * dusk * 0.7; hor[2] += 0.1 * dusk * 0.7;
    top[0] += 0.16 * dusk * 0.3; top[1] += 0.07 * dusk * 0.3; top[2] += 0.18 * dusk * 0.3;
    const gk = 0.5 + 0.5 * day, grey = set3(this.sC, 0.58 * gk, 0.66 * gk, 0.80 * gk);   // whiteout haze: bright grey-blue, only dimmed (not blackened) at night
    mix3(top, top, set3(this.sD, grey[0] * 0.85, grey[1] * 0.85, grey[2] * 0.85), storm * 0.85);
    mix3(hor, hor, grey, storm * 0.85);
    L.fog = 0.15 + 0.6 * storm + Math.min(0.15, G.snowfall * 2);
    set3(this.tint, clamp(amb[0] * 1.1 + 0.12), clamp(amb[1] * 1.1 + 0.12), clamp(amb[2] * 1.1 + 0.12));
    L.sbx = sbx; L.sby = sby; L.mbx = mbx; L.mby = mby; L.dx = dx; L.dy = dy; L.day = day; L.storm = storm;
    L.vis0 = sstep(-0.04, 0.06, sa) * (1 - storm * 0.92); L.vis1 = (1 - sstep(0.2, 0.8, day)) * (0.3 + 0.7 * moon) * (1 - storm * 0.9);
    void c;
  }

  /** Lights that can reach the cell-pass rectangle (CPU culling); returns how many were packed. */
  private packLights(): number {
    const c = G.cam, lp = this.lp, lc = this.lc;
    const x0 = this.orgX, y0 = this.orgY, x1 = x0 + this.cellW, y1 = y0 + this.cellH;
    let n = 0;
    for (let i = 0, L = G.lights.length; i < L && n < 8; i++) {
      const l = G.lights[i];
      // radius at which the falloff 1/(1+q^2)-.1 drops below the shader's .003 cut-off
      const f = 0.1 + 0.0027 / Math.max(l.power, 1e-6);
      if (f >= 1) continue;
      const re = l.r / 3 * Math.sqrt(1 / f - 1);
      if (l.x + re < x0 || l.x - re > x1 || l.y + re < y0 || l.y - re > y1) continue;
      lp[n * 4] = l.x; lp[n * 4 + 1] = l.y; lp[n * 4 + 2] = l.r; lp[n * 4 + 3] = l.power;
      lc[n * 3] = l.color[0]; lc[n * 3 + 1] = l.color[1]; lc[n * 3 + 2] = l.color[2];
      n++;
    }
    void c;
    return n;
  }

  // ---------- particles ----------
  /** One culling pass; particles are written into three contiguous ranges (background flakes, world plane, foreground flakes) so the draw order stays back-to-front. */
  private fillParticles() {
    const c = G.cam, hx = c.vw * 0.5 + 10, hy = c.vh * 0.5 + 10, buf = this.pdata, tn = this.tint;
    const kinds = P.kind, layers = P.layer, n = P.n;
    let c0 = 0, c2 = 0;
    for (let i = 0; i < n; i++) { if (kinds[i] === PK.FLAKE) { const l = layers[i]; if (l === 1) c0++; else if (l === 2) c2++; } }
    const st = this.pStart, cnt = this.pCount;
    st[0] = 0; st[1] = c0; st[2] = n - c2;
    cnt[0] = cnt[1] = cnt[2] = 0;
    const x0 = c.x - hx, x1 = c.x + hx, y0 = c.y - hy, y1 = c.y + hy;
    const cap = G.quality === 0 ? 6000 : 24000;   // quality 0: hard cap on drawn points
    let drawn = 0;
    for (let i = 0; i < n && drawn < cap; i++) {
      const k = kinds[i], isF = k === PK.FLAKE, lay = isF ? layers[i] : 0;
      const b = lay === 1 ? 0 : lay === 2 ? 2 : 1;
      const par = lay === 1 ? 0.7 : lay === 2 ? 1.25 : 1;
      const x = par === 1 ? P.x[i] : c.x + (P.x[i] - c.x) * par, y = par === 1 ? P.y[i] : c.y + (P.y[i] - c.y) * par;
      if (x < x0 || x > x1 || y < y0 || y > y1) continue;
      const s = P.seed[i], l0 = P.life0[i], lr = l0 > 0 ? clamp(P.life[i] / l0) : 1, m = P.m[i] > 0 ? P.m[i] : 1;
      let sz = 1, hd = 1, r = 1, g = 1, bl = 1, a = 1, add = false;
      switch (k) {
        case PK.FLAKE:
          if (lay === 0) { sz = 1 + s * 0.9; hd = 0.6; a = 0.9; }
          else if (lay === 1) { sz = 0.8 + s * 0.7; hd = 0.3; a = 0.5; }
          else { sz = 3.4 + s * 2.4; hd = 0; a = 0.16; }
          a *= Math.min(1, lr * 8); break;
        case PK.DRIFT: sz = 1 + s * 0.6; hd = 0.7; a = 0.7 * Math.min(1, lr * 4); break;
        case PK.CLUMP: { const v = 0.9 + 0.1 * ((s * 7.31) % 1); sz = 1.2 + s * 1.1; hd = 1; r = g = v; bl = Math.min(1, v + 0.04); a = 0.95; break; }
        case PK.SPARK: add = true; sz = 1.2 * m; hd = 0.8; r = 1; g = 0.5 + 0.45 * lr; bl = 0.12 + 0.2 * lr * lr; a = lr; break;
        case PK.FLAME: add = true; sz = (2 + 3 * lr) * m * (0.8 + 0.4 * s); hd = 0; r = 1; g = 0.25 + 0.55 * lr; bl = 0.05 + 0.15 * lr * lr; a = 0.55 * Math.min(1, lr * 2.5); break;
        case PK.SMOKE: sz = (3 + (1 - lr) * 6) * m; hd = 0; r = 0.35; g = 0.35; bl = 0.37; a = 0.4 * sstep(0, 0.3, lr) * Math.min(1, (1 - lr) * 8 + 0.2); break;
        case PK.STEAM: sz = (2 + (1 - lr) * 5) * m; hd = 0; a = 0.25 * lr; break;
        case PK.CHIP: sz = 1.2; hd = 1; r = 0.45; g = 0.3; bl = 0.15; a = 1; break;
        case PK.BREATH: sz = Math.max((2.2 + (1 - lr) * 2.0) * m * (0.85 + 0.3 * s), Math.min(4.6, 6.5 / c.zoom)); hd = 0.4; r = 0.96; g = 0.985; bl = 1; a = 0.78 * Math.min(1, 0.7 + (1 - lr) * 3) * sstep(0, 0.55, lr); break; // soft white puff: 2-4 cells (never under ~6 screen px), strong at the start, fading out
        default:
          if (m >= 1.7) { sz = 1.4 + s * 1.4; hd = 0.85; r = 0.97; g = 0.985; bl = 1; a = 0.95 * Math.min(1, lr * 3); }   // DUST clump: solid 2-3 cell chunk of snow
          else { sz = (0.8 + s * 1.0 + (1 - lr) * 0.5) * m; hd = 0.3 + 0.4 * s; r = 0.94; g = 0.97; a = (0.5 + 0.3 * s) * lr; }   // DUST: small, varied spray / puff
          break;
      }
      if (!add) { if (k === PK.BREATH || (k === PK.DUST && m < 1.7)) { r *= 0.35 + 0.65 * tn[0]; g *= 0.35 + 0.65 * tn[1]; bl *= 0.35 + 0.65 * tn[2]; } else { r *= tn[0]; g *= tn[1]; bl *= tn[2]; } }   // vapour / spray stay readable at night
      drawn++;
      const o = (st[b] + cnt[b]++) << 3;
      buf[o] = x; buf[o + 1] = y; buf[o + 2] = add ? -sz : sz; buf[o + 3] = hd;
      buf[o + 4] = r; buf[o + 5] = g; buf[o + 6] = bl; buf[o + 7] = a;
    }
  }

  private syncBuf = new Uint8Array(4);
  /** dev profiling only: a 1-pixel readback blocks until the GPU has finished everything queued so far (gl.finish() does not in Chrome). */
  private sync(cell: boolean) {
    const gl = this.gl;
    if (cell) gl.readBuffer(gl.COLOR_ATTACHMENT1);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.syncBuf);
    if (cell) gl.readBuffer(gl.COLOR_ATTACHMENT0);
  }

  render(_dt: number) {
    if (this.lost) return;
    const gl = this.gl, c = G.cam, pr = prof.on && !prof.nosync;
    let t = pnow();
    this.frame++;
    c.vw = this.cssW / c.zoom; c.vh = this.cssH / c.zoom;
    const worldChanged = this.uploadWorld();
    if (G.xray === 3 && (this.frame & 3) === 1) this.uploadHeat();
    this.ensureCell();
    const mg = cellMargin();
    this.orgX = Math.floor(c.x - c.vw * 0.5) - 1 - mg; this.orgY = Math.floor(c.y - c.vh * 0.5) - 1 - mg;   // origin this frame would render with
    this.computeLight();
    pend('upload', t); t = pnow();
    const lowQ = G.quality === 0, L = this.lt;
    gl.disable(gl.BLEND);
    gl.bindVertexArray(this.vao);

    // ---- pass 1: cells ----
    // The cell target is world-space, so it is reused as long as it still covers the view. It is rendered again at once when the world
    // changed (chunk uploads), the variant changed (lights / drift), its size changed or the view left it; otherwise every `period` frames
    // (time of day, glints, light flicker). The period grows as dyn drops, so under load the cell pass costs less.
    const nl = this.packLights();
    const windy = Math.abs(G.wind) > 5.3;
    const variant = (lowQ ? 0 : CF.HIQ) | (nl > 0 ? CF.LIGHTS : 0) | (windy ? CF.WIND : 0);
    const period = lowQ ? (this.dyn >= 0.75 ? 2 : 3) : (this.dyn >= 0.6 ? 1 : 2);
    const vx0 = Math.floor(c.x - c.vw * 0.5), vx1 = Math.floor(c.x + c.vw * 0.5), vy0 = Math.floor(c.y - c.vh * 0.5), vy1 = Math.floor(c.y + c.vh * 0.5);
    const covers = this.cellValid && this.cellOrgX <= vx0 && vx1 < this.cellOrgX + this.cellW && this.cellOrgY <= vy0 && vy1 < this.cellOrgY + this.cellH;
    this.cellAge++;
    // quality 0 (phones): world edits wait for the cadence (<= 1 frame late); the snow CA dirties chunks almost every frame, so forcing them would disable the reuse
    const drawCell = !covers || variant !== this.cellVar || (worldChanged && !lowQ) || this.cellAge >= period;
    if (drawCell) {
      this.cellOrgX = this.orgX; this.cellOrgY = this.orgY; this.cellVar = variant; this.cellValid = true; this.cellAge = 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.cellFbo);
      gl.viewport(0, 0, this.cellW, this.cellH);
      const cv = this.cellProg(variant), uc = cv.u;
      gl.useProgram(cv.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.worldTex);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.topTex);
      gl.uniform1i(uc.uWorld, 0); gl.uniform1i(uc.uTop, 4); gl.uniform2i(uc.uOrg, this.orgX, this.orgY);
      gl.uniform1f(uc.uTime, G.realTime); gl.uniform1f(uc.uDay, L.day); gl.uniform1f(uc.uStorm, L.storm); gl.uniform1f(uc.uWind, G.wind); gl.uniform1f(uc.uCamX, c.x);
      gl.uniform1i(uc.uNL, nl);
      gl.uniform2f(uc.uSkyDir, L.dx, L.dy); gl.uniform2f(uc.uVis, L.vis0, L.vis1);
      gl.uniform3f(uc.uAmb, this.amb[0], this.amb[1], this.amb[2]); gl.uniform3f(uc.uDirCol, this.dir[0], this.dir[1], this.dir[2]);
      if (nl > 0) { gl.uniform4fv(uc['uLP[0]'], this.lp); gl.uniform3fv(uc['uLC[0]'], this.lc); }
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (prof.on) { pend('cellSubmit', t); if (pr) { this.sync(true); pend('gpuCell', t); } t = pnow(); }
    }

    // ---- background columns ----
    if (this.progCol) {
      this.ensureCol();
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.colFbo);
      gl.viewport(0, 0, this.canvas.width, 8);
      gl.useProgram(this.progCol);
      const uk = this.uk;
      gl.uniform2f(uk.uCam, c.x, c.y); gl.uniform2f(uk.uView, c.vw, c.vh); gl.uniform2f(uk.uRes, this.canvas.width, this.canvas.height); gl.uniform1i(uk.uOct, lowQ ? 2 : 4);
      gl.uniform1i(uk.uWorld, 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }

    // ---- pass 2: screen ----
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    const night = (1 - L.day) * (1 - sstep(0.1, 0.35, L.storm)) > 0.02;
    const sv = this.scrProg((L.storm > 0.02 ? SF.STORM : 0) | (windy ? SF.DRIFT : 0) | (night ? SF.NIGHT : 0) | (G.xray ? SF.XRAY : 0)), u = sv.u;
    gl.useProgram(sv.p);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, this.colTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.heatTex);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, this.cellTex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, this.auxTex);
    gl.uniform1i(u.uWorld, 0); gl.uniform1i(u.uHeat, 1); gl.uniform1i(u.uCell, 2); gl.uniform1i(u.uAux, 3); gl.uniform1i(u.uCol, 4);
    gl.uniform2i(u.uOrg, this.cellOrgX, this.cellOrgY); gl.uniform2i(u.uCellSz, this.cellW, this.cellH);   // the origin the cell target was rendered with
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uCam, c.x, c.y); gl.uniform2f(u.uView, c.vw, c.vh); gl.uniform2f(u.uVis, L.vis0, L.vis1);
    gl.uniform1f(u.uTime, G.realTime); gl.uniform1f(u.uDay, L.day); gl.uniform1f(u.uStorm, L.storm); gl.uniform1f(u.uWind, G.wind); gl.uniform1f(u.uFog, L.fog);
    gl.uniform1i(u.uXray, G.xray | 0); gl.uniform1i(u.uOct, lowQ ? 2 : 4); gl.uniform1i(u.uStormL, lowQ ? 2 : 3);
    gl.uniform3f(u.uAmb, this.amb[0], this.amb[1], this.amb[2]);
    gl.uniform3f(u.uSkyTop, this.top[0], this.top[1], this.top[2]); gl.uniform3f(u.uSkyHor, this.hor[0], this.hor[1], this.hor[2]);
    gl.uniform4f(u.uBody, L.sbx, L.sby, L.mbx, L.mby);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (prof.on) { pend('scrSubmit', t); if (pr) { this.sync(false); pend('gpuScr', t); } t = pnow(); }

    // ---- particles ----
    this.fillParticles();
    const cnt = this.pCount, st = this.pStart;
    if (cnt[0] + cnt[1] + cnt[2] > 0) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.useProgram(this.pprog);
      gl.uniform2f(this.pu.uCam, c.x, c.y); gl.uniform2f(this.pu.uView, c.vw, c.vh);
      gl.uniform1f(this.pu.uPx, this.canvas.height / c.vh); gl.uniform1f(this.pu.uMaxPt, this.maxPt);
      gl.bindVertexArray(this.pvao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
      for (let b = 0; b < 3; b++) {
        if (cnt[b] === 0) continue;
        gl.bufferSubData(gl.ARRAY_BUFFER, st[b] * 32, this.pdata, st[b] * 8, cnt[b] * 8);
        gl.drawArrays(gl.POINTS, st[b], cnt[b]);
      }
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
    if (prof.on) { pend('particleDraw', t); if (pr) { this.sync(false); pend('gpuPart', t); } }
  }
}
