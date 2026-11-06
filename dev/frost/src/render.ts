// WebGL2 renderer: world data-texture -> full-screen fragment shader (materials, subsurface snow,
// sky lighting, ray-marched point lights, parallax background, weather, x-ray) + particle point pass.
import { G } from './state';
import { W, H, CH, CW, CHH, HW, HH, mat, dens, bond, flags, body, gpuDirty } from './world';
import { P, PK } from './particles';
import { T, WND } from './heat';

const VS = `#version 300 es
void main(){ vec2 p = vec2(float((gl_VertexID<<1)&2), float(gl_VertexID&2)); gl_Position = vec4(p*2.-1.,0.,1.); }`;

const FS = `#version 300 es
precision highp float; precision highp int; precision highp sampler2D;
uniform sampler2D uWorld; uniform sampler2D uHeat;
uniform vec2 uRes, uCam, uView, uSkyDir, uVis;
uniform float uTime, uDay, uStorm, uWind, uFog, uFeet;
uniform int uXray, uNL, uSteps;
uniform vec3 uAmb, uDirCol, uSkyTop, uSkyHor;
uniform vec4 uBody;
uniform vec4 uLP[8]; uniform vec3 uLC[8];
out vec4 fragColor;
const int WI = ${W}; const int HI = ${H};
const vec3 DEEP = vec3(.32,.52,.78);
const vec3 ABS_S[13] = vec3[13](vec3(0.), vec3(.174,.122,.073), vec3(.05), vec3(.08), vec3(6.), vec3(6.), vec3(6.), vec3(.015), vec3(.6), vec3(6.), vec3(6.), vec3(6.), vec3(6.));
const vec3 ABS_L[13] = vec3[13](vec3(0.), vec3(.125,.165,.22), vec3(.06,.05,.04), vec3(.1), vec3(6.), vec3(6.), vec3(6.), vec3(.2), vec3(1.), vec3(6.), vec3(6.), vec3(6.), vec3(6.));

uint ihash(uvec2 v){ v = v*1664525u + 1013904223u; v.x += v.y*1664525u; v.y += v.x*1664525u; v ^= v>>16u; v.x += v.y*1664525u; v.y += v.x*1664525u; v ^= v>>16u; return v.x; }
float hash2(ivec2 c){ return float(ihash(uvec2(c + ivec2(4096))))*(1./4294967296.); }
float hash3(ivec2 c, int t){ return float(ihash(uvec2(c + ivec2(4096) + ivec2(t*131, -t*71))))*(1./4294967296.); }
float hf(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7)))*43758.5453); }
float h1(float n){ return fract(sin(n*127.1+11.7)*43758.5453); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(hf(i),hf(i+vec2(1,0)),f.x), mix(hf(i+vec2(0,1)),hf(i+vec2(1,1)),f.x), f.y); }
float vn1(float x){ float i=floor(x), f=fract(x); f=f*f*(3.-2.*f); return mix(h1(i),h1(i+1.),f); }
float fbm1(float x){ float a=.5,s=0.; for(int o=0;o<4;o++){ s+=a*vn1(x); x=x*2.03+17.; a*=.5; } return s/.9375; }

int mAt(ivec2 c){
  if(c.y<0) return 0;
  if(c.x<0||c.x>=WI||c.y>=HI) return 12;
  return min(12, int(texelFetch(uWorld,c,0).r*255.+.5));
}
vec4 fetchW(ivec2 c){
  if(c.y<0) return vec4(0.);
  if(c.x<0||c.x>=WI||c.y>=HI) return vec4(12.,0.,0.,0.);
  return floor(texelFetch(uWorld,c,0)*255.+.5);
}

// sky transmittance straight up (stp cells per sample); depth = distance to first air above
vec3 skyMarch(ivec2 c, int stp, int jit, int mUp, out float depth){
  vec3 A = ABS_S[mUp]; depth = (mUp==0) ? 0. : 40.;
  bool found = (mUp==0);
  if(A.g>4.5) return exp(-A);
  for(int i=0;i<16;i++){
    int dy = 2 + i*stp + jit;
    if(c.y-dy<0){ if(!found) depth=float(dy); break; }
    int mm = mAt(c+ivec2(0,-dy));
    if(mm==0){ if(!found){ found=true; depth=float(dy); } }
    else { A += ABS_S[mm]*float(stp); if(A.g>4.5) break; }
  }
  return exp(-A);
}
// transmittance toward the sky light (sun/moon) for shadows; depth = distance to first air that way
vec3 dirMarch(vec2 wp, out float depth){
  vec3 A = vec3(0.); depth = 40.; bool found = false;
  for(int i=0;i<8;i++){
    float t = 1.5 + 2.*float(i);
    int mm = mAt(ivec2(floor(wp + uSkyDir*t)));
    if(mm==0){ if(!found){ found=true; depth=t; } }
    else { A += ABS_S[mm]*2.; if(A.g>4.5) break; }
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

vec3 pointLights(vec2 wp, ivec2 c, vec2 n, float hasN, float jr){
  vec3 acc = vec3(0.);
  for(int i=0;i<8;i++){
    if(i>=uNL) break;
    vec2 d = uLP[i].xy - wp; float dist = length(d); float r = uLP[i].z;
    if(dist>=r) continue;
    float q = dist/r*3.;
    float pw = uLP[i].w * (1./(1.+q*q) - .1)/.9;
    if(pw<=.003) continue;
    vec3 A = vec3(0.); float sl = dist/float(uSteps);
    for(int k=0;k<24;k++){
      if(k>=uSteps) break;
      float t = (float(k)+.25+.5*jr)/float(uSteps);
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
    float t = clamp((dn-60.)/400.,0.,1.);
    vec3 b = mix(vec3(.915,.955,.99), vec3(.80,.85,.90), t);           // fresh -> compacted (slightly greyer)
    b = mix(b, b*vec3(.95,.97,1.), smoothstep(30.,255.,bn)*.5);
    float amp = .05;
    if((fl&16)!=0){ b = mix(b, vec3(.93,.96,.995), .5); amp = .02; }
    if((fl&2)!=0) b = mix(b, vec3(.58,.63,.70), .6);
    b += g*amp;
    b += (vn(vec2(cf.x*.02, cf.y*.45))-.5)*.04*t;
    // subsurface blue grows with distance from the nearest air (cuts, caves), not with the global height
    float d1 = 1.-exp(-depth/16.), d2 = 1.-exp(-depth/52.);
    b = mix(b, vec3(.36,.56,.79), d1*.5);
    b = mix(b, vec3(.17,.31,.53), d2*.55);
    return b;
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
    float blot = vn(cf*.2), fine = vn(cf*.85);
    vec3 b = mix(vec3(.25,.175,.125), vec3(.39,.29,.21), blot*.65+fine*.35);
    b *= (.93+.14*vn(vec2(cf.x*.02, cf.y*.55)))*(1.+g*.32);
    if(fract(hh*91.3)>.93) b *= .68;                                   // dark pebbles
    if(fract(hh*37.7)>.968) b = mix(b, vec3(.72,.8,.88), .5);          // frost crystals
    if(depth<3.5 && fract(hh*37.3)>.88) b = mix(b, vec3(.75,.82,.9), .6);
    return b;
  }
  if(m==5){
    float band = .5+.5*sin(cf.y*.3 + vn(cf*.05)*5. + cf.x*.01);
    float sn = vn(cf*vec2(.06,.5));
    vec3 b = mix(vec3(.30,.32,.37), vec3(.52,.54,.58), band*.55+sn*.45);
    b *= (.82+.32*vn(cf*.35))*(1.+g*.2);
    if(fract(hh*53.1)>.965) b *= 1.3;                                  // mineral speckle
    if(fract(hh*17.9)>.985) b *= .6;
    float rim = (1.-smoothstep(0.,2.6,depth))*(1.-upN);
    b *= 1.-rim*.42;                                                   // darker rim / sides
    float topH = upN*(1.-smoothstep(1.2,3.5,depth));
    b = mix(b, vec3(.82,.88,.95), topH*.42)*(1.+topH*.12);             // frosted top highlight
    return b;
  }
  if(m==12){
    return vec3(.15,.16,.20)*(.8+.4*vn(cf*.3))*(1.+g*.2);
  }
  if(m==6){
    float s = vert ? vn(vec2(cf.x*.9, cf.y*.05)) : vn(vec2(cf.x*.05, cf.y*.9));
    vec3 b = vec3(.31,.21,.12)*(.7+.6*s)*(1.+g*.15);
    if(s<.18) b *= .6;
    return b;
  }
  if(m==11){
    float s = vert ? vn(vec2(cf.x*.7, cf.y*.03)) : vn(vec2(cf.x*.03, cf.y*.7));
    vec3 b = vec3(.74,.58,.38)*(.85+.3*s)*(1.+g*.06);
    float e = vert ? mod(cf.x,20.) : mod(cf.y,20.);
    if(e<1.) b *= .62;
    return b;
  }
  if(m==7){
    vec3 b = mix(vec3(.05,.17,.1), vec3(.1,.26,.15), hh)*(.8+.4*vn(cf*.5));
    if(fract(hh*91.7)>.8) b = mix(b, vec3(.85,.9,.95), .45);
    if(top) b = mix(b, vec3(.85,.9,.95), .35);
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

vec3 background(vec2 sUV, vec2 sOff, vec3 bgL){
  float asp = uRes.x/uRes.y;
  vec3 sky = mix(uSkyTop, uSkyHor, smoothstep(0.,.8,sUV.y));
  float nightClear = (1.-uDay)*(1.-smoothstep(.1,.35,uStorm));
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
  vec2 dv = (sUV-uBody.xy)*vec2(asp,1.); float ds = length(dv);
  sky += vec3(1.,.85,.6)*exp(-ds*7.)*.5*uVis.x;
  sky = mix(sky, vec3(1.,.97,.85)*1.6, (1.-smoothstep(.030,.034,ds))*uVis.x);
  vec2 mv = (sUV-uBody.zw)*vec2(asp,1.); float dm = length(mv);
  sky += vec3(.4,.5,.8)*exp(-dm*9.)*.25*uVis.y;
  sky = mix(sky, vec3(.9,.93,1.)*(.8+.2*vn(mv*90.)), (1.-smoothstep(.022,.025,dm))*uVis.y);

  float fg = uFog + uStorm*.35;
  float nt = (1.-uDay);
  vec3 col = sky;
  // far mountains
  {
    float Lx = uCam.x*.06 + sOff.x, ly = sOff.y + (uCam.y-380.)*.10;
    float rr = 1.-abs(2.*fbm1(Lx*.012+3.)-1.);
    float e = 20. - 100.*pow(rr,1.5);
    float a = smoothstep(-.7,.7,ly-e);
    vec3 c = mix(vec3(.70,.79,.92), vec3(.46,.58,.78), clamp((ly-e)/60.,0.,1.))*bgL;
    c += vec3(.05,.08,.15)*nt*(1.-uStorm)*exp(-max(ly-e,0.)/7.)*(.5+.5*uVis.y);   // moonlit snowcaps
    c = mix(c, uSkyHor, clamp((.55-.2*nt)+.35*fg,0.,1.));
    col = mix(col, c, a);
  }
  // mid hills
  {
    float Lx = uCam.x*.15 + sOff.x, ly = sOff.y + (uCam.y-380.)*.17;
    float e = 48. - 50.*fbm1(Lx*.02+41.);
    float a = smoothstep(-.7,.7,ly-e);
    vec3 c = mix(vec3(.52,.63,.80), vec3(.34,.46,.68), clamp((ly-e)/50.,0.,1.))*bgL*(1.-.28*nt);
    c = mix(c, uSkyHor, clamp(.42+.4*fg,0.,1.));
    col = mix(col, c, a);
  }
  // near snow field + spruce forest
  {
    float Lx = uCam.x*.30 + sOff.x, ly = sOff.y + (uCam.y-380.)*.27;
    float hy = 74. - 16.*fbm1(Lx*.03+90.);
    float a = smoothstep(-.7,.7,ly-hy);
    vec3 c = vec3(.86,.91,.97)*bgL*(1.+.25*nt);
    c = mix(c, uSkyHor, clamp(.22+.4*fg,0.,1.));
    col = mix(col, c, a);
    if(ly>-8.){
      float aT = 0.; float sp = 11.; float k0 = floor(Lx/sp);
      for(int j=-1;j<=1;j++){
        float k = k0 + float(j);
        if(h1(k*7.3+1.)<.22) continue;
        float tx = (k + .15 + .7*h1(k*3.1+5.))*sp;
        float th = 24. + 36.*h1(k*5.7+2.);
        float dy = (74. - 16.*fbm1(tx*.03+90.) + 3.) - ly;
        if(dy>0. && dy<th){
          float hw = (1.-dy/th)*(7.+th*.06)*(.62+.38*fract(dy/6.5));
          if(abs(Lx-tx)<hw) aT = 1.;
        }
      }
      vec3 tc = mix(vec3(.10,.18,.24)*bgL*(1.-.35*nt), uSkyHor, clamp(.18+.4*fg,0.,1.));
      col = mix(col, tc, aT);
    }
  }
  return col;
}

void main(){
  vec2 fc = vec2(gl_FragCoord.x, uRes.y-gl_FragCoord.y);
  vec2 sUV = fc/uRes;
  vec2 sOff = (sUV-.5)*uView;
  vec2 wp = uCam + sOff;
  ivec2 c = ivec2(floor(wp));
  vec4 tx = fetchW(c);
  int m = int(tx.r);
  float dn = tx.g*4., bn = tx.b; int fl = int(tx.a);
  float hh = hash2(c);
  vec2 cf = vec2(c);
  vec3 bgL = uAmb*.85+.02 + vec3(.03,.05,.09)*(1.-uDay)*(1.-uStorm);
  float asp = uRes.x/uRes.y;
  float dd = length((sUV-.5)*vec2(asp,1.));
  vec3 col;
  float openA = 0.;
  bool isAir = (m==0);
  int mUp = mAt(c+ivec2(0,-1));

  if(isAir){
    float dUp; vec3 sv3 = skyMarch(c, 3, int(hh*3.), mUp, dUp);
    float open = smoothstep(.35,.62,sv3.g);
    vec3 pl = uNL>0 ? pointLights(wp, c, vec2(0.), 0., hh) : vec3(0.);
    vec3 bw = vec3(.26,.33,.45)*(1.+(hh-.5)*.06+(vn(wp*.15)-.5)*.2);
    vec3 inner = bw*(uAmb*(.07+.93*sv3) + pl*.9);
    col = inner;
    if(open>.004){
      vec3 bg = background(sUV, sOff, bgL) + pl*.4;
      col = mix(inner, bg, open);
    }
    openA = open;
  } else {
    int jit = int(hh*2.);
    float dUp; vec3 sv3 = skyMarch(c, 2, jit, mUp, dUp);
    float dLat = 40.;
    for(int k=0;k<3;k++){ int q=1+2*k; if(mAt(c+ivec2(-q,0))==0 || mAt(c+ivec2(q,0))==0){ dLat=float(q); break; } }
    float dDir; vec3 dirT = dirMarch(wp, dDir);
    float depth = min(dUp, min(dLat, dDir*1.3));
    vec2 n = vec2(0.); float hasN = 0.;
    if(depth<=2.5){ n = surfN(c); hasN = 1.; }
    vec3 n3 = normalize(vec3(n*1.2,.6));
    vec3 L3 = normalize(vec3(uSkyDir,.55));
    float diff = hasN>.5 ? max(dot(n3,L3),0.) : .55;
    vec3 alb = albedo(m, dn, bn, fl, cf, hh, depth, mUp==0, n, hasN);
    vec3 pl = uNL>0 ? pointLights(wp, c, n, hasN, hh) : vec3(0.);
    vec3 scat = m==1 ? vec3(.12,.2,.3)*exp(-depth/30.) : vec3(0.);
    // thick snow still scatters plenty of light: neutral (hue-free) falloff, the blue lives in the albedo gradient
    float svL = smoothstep(0.,.18,dot(sv3,vec3(.33)));
    vec3 lit = uAmb*(m==1 ? .22+.78*svL+scat*.5 : .45+.84*sv3+scat) + uDirCol*diff*dirT + pl;
    col = alb*lit;
    if(m==1){
      // never darker than moon-lit snow where it can see the sky
      col = max(col, vec3(.078,.137,.227)*smoothstep(.12,.45,sv3.b)*(1.-.5*smoothstep(8.,30.,depth)));
      if(depth<1.5){
        float gl = hash3(c, int(floor(uTime*3.)));
        float lum = dot(uDirCol,vec3(.33))*dirT.g + dot(pl,vec3(.33));
        if(gl>.994) col += vec3(1.,.98,.92)*lum*1.6;
        else if(hh>.93 && gl>.8) col += vec3(.9,.96,1.)*dot(uDirCol,vec3(.33))*dirT.g*.5;   // crisp daytime sparkle
      }
    }
  }

  // low drifting snow hugging the local ground when it blows (> ~6 m/s)
  float ws = smoothstep(5.,11.,abs(uWind));
  if(isAir && ws>.01 && openA>.05){
    float gh = 26.;
    for(int k=1;k<=8;k++){ if(mAt(c+ivec2(0,k*3))!=0){ gh = float(k*3)-1.5; break; } }
    float prof = exp(-gh/9.);
    if(prof>.02){
      float sx = wp.x - uTime*uWind*2.2;
      float s1 = vn(vec2(sx*.035, wp.y*.85))*vn(vec2(sx*.011+9., wp.y*.3+3.));
      float s = smoothstep(.2,.5,s1*1.7) + .5*smoothstep(.82,.95,vn(vec2(sx*.2, wp.y*1.7)));
      col = mix(col, min(bgL*1.1+.06, vec3(1.)), clamp(s,0.,1.)*prof*ws*(.4+.6*uStorm)*.75*openA);
    }
  }
  // storm: wind-driven snow streaks + whiteout
  if(uStorm>.02){
    float spd = min(abs(uWind),30.), wdir = uWind>=0.?1.:-1.;
    vec2 vel = vec2(wdir*(14.+spd*2.4), 24.+12.*uStorm);
    vec2 vdir = normalize(vel), pdir = vec2(-vdir.y, vdir.x);
    float acc = 0.;
    int NL = uSteps>12 ? 3 : 2;
    for(int L=0;L<3;L++){
      if(L>=NL) break;
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
  // weather veil
  col = mix(col, uSkyHor, uFog*(.12+.88*smoothstep(.05,1.1,dd))*.8);
  // gentle filmic curve
  col = max(col, 0.);
  vec3 hi = .7+.3*(1.-exp(-(col-.7)/.3));
  col = mix(col, hi, step(.7,col));

  if(uXray>0){
    vec3 xc = vec3(0.); bool use = false; float k = .8;
    if(uXray==1 && m==1){
      float t = clamp((dn-50.)/450.,0.,1.);
      xc = t<.5 ? mix(vec3(.345,.682,.941), vec3(.875,.914,.949), t*2.) : mix(vec3(.875,.914,.949), vec3(.788,.471,.227), (t-.5)*2.);
      use = true;
    } else if(uXray==2 && m==1){
      float t = bn/255.;
      xc = t<.5 ? mix(vec3(.71,.322,.231), vec3(.851,.761,.478), t*2.) : mix(vec3(.851,.761,.478), vec3(.435,.761,.545), (t-.5)*2.);
      vec4 xr = fetchW(c+ivec2(1,0)), xd = fetchW(c+ivec2(0,1));          // contour where bond crosses BOND_SOLID (48)
      if((xr.r==1. && (bn>=48.)!=(xr.b>=48.)) || (xd.r==1. && (bn>=48.)!=(xd.b>=48.))) xc = vec3(1.);
      use = true;
    } else if(uXray==3){
      float tc = texture(uHeat, wp/vec2(float(WI),float(HI))).r*127.5-60.;
      float t = clamp((tc+40.)/50.,0.,1.);
      xc = t<.5 ? mix(vec3(.239,.435,.847), vec3(.933,.953,.973), t*2.) : mix(vec3(.933,.953,.973), vec3(.847,.341,.184), (t-.5)*2.);
      use = true; k = .72;
    }
    col = use ? mix(col*(uXray==3?.5:.4), xc, k) : col*.4;
  }
  col *= 1.-.3*smoothstep(.35,.75,length(sUV-.5));
  col += (float(ihash(uvec2(gl_FragCoord.xy)))*(1./4294967296.)-.5)/255.;
  fragColor = vec4(col,1.);
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
const mixn = (a: number, b: number, t: number) => a + (b - a) * t;
const sstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
type V3 = [number, number, number];
const mix3 = (a: V3, b: V3, t: number): V3 => [mixn(a[0], b[0], t), mixn(a[1], b[1], t), mixn(a[2], b[2], t)];

export class Renderer {
  private gl!: WebGL2RenderingContext;
  private prog!: WebGLProgram; private pprog!: WebGLProgram;
  private vao!: WebGLVertexArrayObject; private pvao!: WebGLVertexArrayObject;
  private pbuf!: WebGLBuffer; private worldTex!: WebGLTexture; private heatTex!: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};
  private pu: Record<string, WebGLUniformLocation | null> = {};
  private pix = new Uint8Array(W * H * 4);
  private heatPix = new Uint8Array(HW * HH * 4);
  private pdata = new Float32Array(24000 * 8);
  private lp = new Float32Array(32); private lc = new Float32Array(24);
  private cssW = 1; private cssH = 1; private scale = 1;
  private frame = 0; private full = true; private lost = false; private maxPt = 64;
  private tint: V3 = [1, 1, 1];

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', { antialias: false, premultipliedAlpha: false, alpha: false, depth: false, stencil: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 не поддерживается этим браузером / устройством: игра не может запуститься.');
    this.gl = gl;
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

  private tex(w: number, h: number, filter: number): WebGLTexture {
    const gl = this.gl, t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  private init() {
    const gl = this.gl;
    this.prog = this.compile(VS, FS, 'world'); this.pprog = this.compile(PVS, PFS, 'particles');
    this.u = {}; this.pu = {};
    for (const n of ['uWorld', 'uHeat', 'uRes', 'uCam', 'uView', 'uSkyDir', 'uVis', 'uTime', 'uDay', 'uStorm', 'uWind', 'uFog', 'uFeet', 'uXray', 'uNL', 'uSteps', 'uAmb', 'uDirCol', 'uSkyTop', 'uSkyHor', 'uBody', 'uLP[0]', 'uLC[0]'])
      this.u[n] = gl.getUniformLocation(this.prog, n);
    for (const n of ['uCam', 'uView', 'uPx', 'uMaxPt']) this.pu[n] = gl.getUniformLocation(this.pprog, n);
    this.vao = gl.createVertexArray()!;
    this.worldTex = this.tex(W, H, gl.NEAREST);
    this.heatTex = this.tex(HW, HH, gl.LINEAR);
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

  resize(cssW: number, cssH: number, dpr: number) {
    this.cssW = Math.max(1, cssW); this.cssH = Math.max(1, cssH);
    this.scale = G.quality === 0 ? 0.6 : Math.min(dpr || 1, 2);
    this.canvas.width = Math.max(1, Math.round(this.cssW * this.scale));
    this.canvas.height = Math.max(1, Math.round(this.cssH * this.scale));
    this.canvas.style.width = this.cssW + 'px'; this.canvas.style.height = this.cssH + 'px';
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
  private uploadWorld() {
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.worldTex);
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, W);
    if (this.full) {
      this.pack(0, 0, W, H);
      gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
      gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, this.pix);
      gpuDirty.fill(0); this.full = false;
    } else {
      for (let cy = 0; cy < CHH; cy++) {
        let cx = 0;
        while (cx < CW) {
          if (!gpuDirty[cy * CW + cx]) { cx++; continue; }
          let e = cx; while (e < CW && gpuDirty[cy * CW + e]) { gpuDirty[cy * CW + e] = 0; e++; }
          const x0 = cx * CH, y0 = cy * CH, w = (e - cx) * CH;
          this.pack(x0, y0, w, CH);
          gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, x0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, y0);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, CH, gl.RGBA, gl.UNSIGNED_BYTE, this.pix);
          cx = e;
        }
      }
    }
    gl.pixelStorei(gl.UNPACK_ROW_LENGTH, 0); gl.pixelStorei(gl.UNPACK_SKIP_PIXELS, 0); gl.pixelStorei(gl.UNPACK_SKIP_ROWS, 0);
  }
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
  private setUniforms() {
    const gl = this.gl, u = this.u, c = G.cam;
    const day = clamp(G.daylight), sa = G.sunAngle, storm = clamp(G.storm), moon = clamp(G.moon);
    const dusk = Math.exp(-((sa / 0.1) ** 2)) * (1 - 0.8 * storm);
    const tod = ((G.time / 60) % 24 + 24) % 24;
    // ambient
    const dayAmb: V3 = [0.88 * (1 - 0.3 * storm), 0.93 * (1 - 0.3 * storm), 1.0 * (1 - 0.25 * storm)];
    const nm = 0.7 + 0.55 * moon, nightAmb: V3 = [0.15 * nm, 0.205 * nm, 0.345 * nm];
    const amb = mix3(nightAmb, dayAmb, day);
    amb[0] += 0.10 * dusk; amb[1] += 0.03 * dusk; amb[2] = Math.max(0, amb[2] - 0.03 * dusk);
    // directional light (sun / moon)
    const sunI = clamp((day - 0.1) / 0.5) * (1 - 0.85 * storm) * 0.6;
    const sunCol = mix3([1, 0.97, 0.9], [1, 0.68, 0.42], clamp(dusk * 1.4));
    const moonI = moon * 0.3 * (1 - day) * (1 - 0.6 * storm);
    const dir: V3 = [sunCol[0] * sunI + 0.5 * moonI, sunCol[1] * sunI + 0.68 * moonI, sunCol[2] * sunI + 1.05 * moonI];
    // celestial positions in sky uv (y from top)
    const sbx = 0.5 + clamp((12.5 - tod) / 4.2, -1, 1) * 0.44, sby = 0.62 - clamp(sa, -0.1, 0.5) / 0.5 * 0.45;
    const mt = clamp(((tod - 17 + 24) % 24) / 14), mbx = 0.5 + (0.5 - mt) * 0.9, mby = 0.62 - 0.45 * Math.sin(mt * Math.PI);
    const useSun = sunI >= moonI;
    const bx = useSun ? sbx : mbx, by = useSun ? sby : mby;
    let dx = (bx - 0.5) * 1.5, dy = -(0.25 + (0.62 - by) * 1.6);
    const dl = Math.hypot(dx, dy) || 1; dx /= dl; dy /= dl;
    // sky colours
    let top: V3 = mix3([0.010, 0.022, 0.07], [0.30, 0.52, 0.90], day);
    const hm = 0.55 + 0.9 * moon;
    let hor: V3 = mix3([0.035 * hm, 0.07 * hm, 0.17 * hm], [0.66, 0.77, 0.88], day);   // day haze ~ #9fb4c8-ish, never pink
    hor = [hor[0] + 0.62 * dusk * 0.7, hor[1] + 0.28 * dusk * 0.7, hor[2] + 0.1 * dusk * 0.7];
    top = [top[0] + 0.16 * dusk * 0.3, top[1] + 0.07 * dusk * 0.3, top[2] + 0.18 * dusk * 0.3];
    const gk = 0.2 + 0.8 * day, grey: V3 = [0.60 * gk, 0.65 * gk, 0.74 * gk];
    top = mix3(top, [grey[0] * 0.85, grey[1] * 0.85, grey[2] * 0.85], storm * 0.85);
    hor = mix3(hor, grey, storm * 0.85);
    const fog = 0.15 + 0.6 * storm + Math.min(0.15, G.snowfall * 2);
    this.tint = [clamp(amb[0] * 1.1 + 0.12), clamp(amb[1] * 1.1 + 0.12), clamp(amb[2] * 1.1 + 0.12)];

    gl.uniform1i(u.uWorld, 0); gl.uniform1i(u.uHeat, 1);
    gl.uniform2f(u.uRes, this.canvas.width, this.canvas.height);
    gl.uniform2f(u.uCam, c.x, c.y); gl.uniform2f(u.uView, c.vw, c.vh);
    gl.uniform2f(u.uSkyDir, dx, dy);
    gl.uniform2f(u.uVis, sstep(-0.04, 0.06, sa) * (1 - storm * 0.92), (1 - sstep(0.2, 0.8, day)) * (0.3 + 0.7 * moon) * (1 - storm * 0.9));
    gl.uniform1f(u.uTime, G.realTime); gl.uniform1f(u.uDay, day); gl.uniform1f(u.uStorm, storm);
    gl.uniform1f(u.uWind, G.wind); gl.uniform1f(u.uFog, fog); gl.uniform1f(u.uFeet, G.player.y + G.player.h / 2);
    gl.uniform1i(u.uXray, G.xray | 0); gl.uniform1i(u.uSteps, G.quality === 0 ? 12 : 24);
    gl.uniform3f(u.uAmb, amb[0], amb[1], amb[2]); gl.uniform3f(u.uDirCol, dir[0], dir[1], dir[2]);
    gl.uniform3f(u.uSkyTop, top[0], top[1], top[2]); gl.uniform3f(u.uSkyHor, hor[0], hor[1], hor[2]);
    gl.uniform4f(u.uBody, sbx, sby, mbx, mby);
    const n = Math.min(8, G.lights.length);
    for (let i = 0; i < n; i++) {
      const l = G.lights[i];
      this.lp[i * 4] = l.x; this.lp[i * 4 + 1] = l.y; this.lp[i * 4 + 2] = l.r; this.lp[i * 4 + 3] = l.power;
      this.lc[i * 3] = l.color[0]; this.lc[i * 3 + 1] = l.color[1]; this.lc[i * 3 + 2] = l.color[2];
    }
    gl.uniform1i(u.uNL, n);
    gl.uniform4fv(u['uLP[0]'], this.lp); gl.uniform3fv(u['uLC[0]'], this.lc);
  }

  // ---------- particles ----------
  private fillParticles(): number {
    const c = G.cam, hx = c.vw * 0.5 + 10, hy = c.vh * 0.5 + 10, buf = this.pdata, tn = this.tint;
    let o = 0;
    for (let pass = 0; pass < 3; pass++) {
      const want = pass === 0 ? 1 : pass === 1 ? 0 : 2;
      for (let i = 0; i < P.n; i++) {
        const k = P.kind[i], isF = k === PK.FLAKE, lay = isF ? P.layer[i] : 0;
        if (lay !== want) continue;
        const par = lay === 1 ? 0.7 : lay === 2 ? 1.25 : 1;
        const x = c.x + (P.x[i] - c.x) * par, y = c.y + (P.y[i] - c.y) * par;
        if (x < c.x - hx || x > c.x + hx || y < c.y - hy || y > c.y + hy) continue;
        const s = P.seed[i], l0 = P.life0[i], lr = l0 > 0 ? clamp(P.life[i] / l0) : 1, m = P.m[i] > 0 ? P.m[i] : 1;
        let sz = 1, hd = 1, r = 1, g = 1, b = 1, a = 1, add = false;
        switch (k) {
          case PK.FLAKE:
            if (lay === 0) { sz = 1.2 + s; hd = 0.6; a = 0.9; }
            else if (lay === 1) { sz = 0.8 + s * 0.7; hd = 0.3; a = 0.5; }
            else { sz = 4 + s * 3; hd = 0; a = 0.16; }
            a *= Math.min(1, lr * 8); break;
          case PK.DRIFT: sz = 1 + s * 0.6; hd = 0.7; a = 0.7 * Math.min(1, lr * 4); break;
          case PK.CLUMP: sz = 2 + s; hd = 1; a = 0.95; break;
          case PK.SPARK: add = true; sz = 1.2 * m; hd = 0.8; r = 1; g = 0.5 + 0.45 * lr; b = 0.12 + 0.2 * lr * lr; a = lr; break;
          case PK.FLAME: add = true; sz = (2 + 3 * lr) * m * (0.8 + 0.4 * s); hd = 0; r = 1; g = 0.25 + 0.55 * lr; b = 0.05 + 0.15 * lr * lr; a = 0.55 * Math.min(1, lr * 2.5); break;
          case PK.SMOKE: sz = (3 + (1 - lr) * 6) * m; hd = 0; r = 0.35; g = 0.35; b = 0.37; a = 0.4 * sstep(0, 0.3, lr) * Math.min(1, (1 - lr) * 8 + 0.2); break;
          case PK.STEAM: sz = (2 + (1 - lr) * 5) * m; hd = 0; a = 0.25 * lr; break;
          case PK.CHIP: sz = 1.2; hd = 1; r = 0.45; g = 0.3; b = 0.15; a = 1; break;
          case PK.BREATH: sz = (2 + (1 - lr) * 4) * m; hd = 0; a = 0.3 * lr; break;
          default: sz = (1.2 + (1 - lr)) * m; hd = 0.3; a = 0.5 * lr; break; // DUST
        }
        if (!add) { r *= tn[0]; g *= tn[1]; b *= tn[2]; }
        buf[o] = x; buf[o + 1] = y; buf[o + 2] = add ? -sz : sz; buf[o + 3] = hd;
        buf[o + 4] = r; buf[o + 5] = g; buf[o + 6] = b; buf[o + 7] = a;
        o += 8;
      }
    }
    return o >> 3;
  }

  render(_dt: number) {
    if (this.lost) return;
    const gl = this.gl, c = G.cam;
    this.frame++;
    c.vw = this.cssW / c.zoom; c.vh = this.cssH / c.zoom;
    this.uploadWorld();
    if ((this.frame & 3) === 1) this.uploadHeat();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.disable(gl.BLEND);
    gl.useProgram(this.prog);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.worldTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, this.heatTex);
    this.setUniforms();
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const cnt = this.fillParticles();
    if (cnt > 0) {
      gl.enable(gl.BLEND);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
      gl.useProgram(this.pprog);
      gl.uniform2f(this.pu.uCam, c.x, c.y); gl.uniform2f(this.pu.uView, c.vw, c.vh);
      gl.uniform1f(this.pu.uPx, this.canvas.height / c.vh); gl.uniform1f(this.pu.uMaxPt, this.maxPt);
      gl.bindVertexArray(this.pvao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.pbuf);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.pdata, 0, cnt * 8);
      gl.drawArrays(gl.POINTS, 0, cnt);
      gl.disable(gl.BLEND);
    }
    gl.bindVertexArray(null);
  }
}
