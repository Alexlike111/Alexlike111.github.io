import sys,re,shutil,os
g,ver,kind=sys.argv[1:4]
src=f'/home/user/work/{g}'
os.system(f'rm -rf {src}; mkdir -p {src}; cd /mnt/project-files/games/{g} && tar --exclude=node_modules --exclude=dist --exclude="*.zip" --exclude="*.png" --exclude="qa-shots*" --exclude=shots -cf - . | (cd {src} && tar xf -)')
shutil.copy('/home/user/work/tpl/src/kit/intro.ts',f'{src}/src/intro.ts')
raw=open('/home/user/work/intro-inline.html').read()
style,div=raw.split('</style>\n'); style+='</style>'
h=open(f'{src}/index.html').read()
h=h.replace('  </head>','    '+style+'\n  </head>',1)
i=h.index('<div id="app">')+len('<div id="app">')
h=h[:i]+'\n      '+div.strip()+h[i:]
open(f'{src}/index.html','w').write(h)
a=open(f'{src}/src/audio.ts').read()
a=a.replace("  setEnabled(on: boolean): void {","""  /** Studio logo sting: a soft boing, then a sparkle. */
  sting(): void {
    const c = ensure();
    if (!c || c.state !== 'running' || !enabled || paused || !master) return;
    const tone = (f: number, d: number, type: OscillatorType, v: number, to?: number, when = 0) => {
      const t0 = c.currentTime + when;
      const o = c.createOscillator();
      o.type = type;
      o.frequency.setValueAtTime(f, t0);
      if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + d);
      const g = c.createGain();
      g.gain.setValueAtTime(v, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + d);
      o.connect(g).connect(master!);
      o.start(t0);
      o.stop(t0 + d + 0.02);
    };
    tone(180, 0.22, 'sine', 0.2, 420);
    tone(988, 0.3, 'triangle', 0.1, undefined, 0.5);
    tone(1319, 0.4, 'triangle', 0.1, undefined, 0.58);
    tone(1760, 0.5, 'triangle', 0.08, undefined, 0.66);
  },

  setEnabled(on: boolean): void {""",1)
open(f'{src}/src/audio.ts','w').write(a)
m=open(f'{src}/src/main.ts').read()
m=m.replace("import { sfx } from './audio';","import { sfx } from './audio';\nimport { playIntro } from './intro';",1)
m=m.replace("yt.firstFrameReady();","yt.firstFrameReady();\n// studio intro: markup is inline in index.html (paints first); the game boots underneath\nvoid playIntro(document.getElementById('app')!, { sting: () => sfx.sting(), unlock: () => sfx.unlock(), track: (n, d) => yt.track(n, d), qa: new URLSearchParams(location.search).has('qa') });",1)
open(f'{src}/src/main.ts','w').write(m)
L={'en':'A new animated Ragdoll Lab intro.','ru':'Новая анимированная заставка Ragdoll Lab.','uk':'Нова анімована заставка Ragdoll Lab.','es':'Nueva intro animada de Ragdoll Lab.','pt':'Nova abertura animada da Ragdoll Lab.','de':'Neues animiertes Ragdoll-Lab-Intro.','fr':'Nouvelle intro animée Ragdoll Lab.','tr':'Yeni animasyonlu Ragdoll Lab girişi.','id':'Intro Ragdoll Lab beranimasi baru.','hi':'Ragdoll Lab का नया एनिमेटेड इंट्रो।'}
body=''.join(f"      {k}: ['{v}'],\n" for k,v in L.items())
if kind=='bh':
    p=f'{src}/src/news.ts'; s=open(p).read()
    s=s.replace("export const RELEASES: Release[] = [\n","export const RELEASES: Release[] = [\n  {\n    v: '%s',\n    date: '2026-10-22',\n    items: {\n%s    },\n  },\n"%(ver,body),1)
else:
    p=f'{src}/src/changelog.ts'; s=open(p).read()
    s=s.replace("export const CHANGELOG: Release[] = [\n","export const CHANGELOG: Release[] = [\n  {\n    v: '%s',\n    date: [2026, 10, 22],\n    pts: {\n%s    },\n  },\n"%(ver,body),1)
open(p,'w').write(s)
pj=open(f'{src}/package.json').read()
pj=re.sub(r'"version": "[^"]+"',f'"version": "{ver}"',pj,1)
open(f'{src}/package.json','w').write(pj)
