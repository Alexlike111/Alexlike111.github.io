// The «Крафт» panel: every recipe of craft.ts with what it needs (have / need), the workbench, and the gear the hero owns.
// Opened with C (PC) or the «Крафт» button (touch). It reads the pack and the hero through tools.ts and crafts through craftAt().
import { RECIPES, variantsOf, recipeRows, type RecipeId, type RecipeRow } from './craft';
import { inv, craftAt, benchAt, toggleShoesWorn, heroAt, benchCount, carryCapOf } from './tools';
import { count, has, label, type CountId } from './items';
import { gear } from './gear';

interface RowEl { root: HTMLElement; btn: HTMLButtonElement; need: HTMLElement; ways: HTMLElement; st: HTMLElement }

export class CraftPanel {
  readonly root: HTMLElement;
  open = false;
  private rows = new Map<RecipeId, RowEl>();
  private benchBtn!: HTMLButtonElement;
  private benchSt!: HTMLElement;
  private shoesBtn!: HTMLButtonElement;
  private gearBox!: HTMLElement;
  private toast: (msg: string) => void;
  private lastGear = '';

  constructor(parent: HTMLElement, toast: (msg: string) => void) {
    this.toast = toast;
    const root = document.createElement('div');
    root.className = 'craft';
    root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'Крафт');
    root.innerHTML = `<div class="craft-scrim"></div>
      <div class="craft-box">
        <header class="craft-head"><b>Крафт</b><i class="craft-key mono">C</i><button class="craft-x" type="button" aria-label="Закрыть">×</button></header>
        <p class="craft-hint">Нажми рецепт, чтобы сделать. Справа в скобках: есть / надо. Верстак нужен там, где написано.</p>
        <div class="craft-list"></div>
        <div class="craft-bench"><button class="craft-bn" type="button"></button><span class="craft-bst"></span></div>
        <h4 class="craft-gh">Экипировка</h4>
        <div class="craft-gear"></div>
      </div>`;
    parent.appendChild(root);
    this.root = root;
    const list = root.querySelector('.craft-list') as HTMLElement;
    for (const r of RECIPES) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'craft-row';
      el.innerHTML = `<span class="cr-name"></span><span class="cr-need mono"></span><span class="cr-ways"></span><span class="cr-st"></span>`;
      el.addEventListener('click', () => this.make(r.id));
      list.appendChild(el);
      this.rows.set(r.id, {
        root: el, btn: el,
        need: el.querySelector('.cr-need') as HTMLElement,
        ways: el.querySelector('.cr-ways') as HTMLElement,
        st: el.querySelector('.cr-st') as HTMLElement,
      });
      el.querySelector('.cr-name')!.textContent = r.name + (r.needsWorkbench ? ' · верстак' : '');
      el.title = r.description;
    }
    this.benchBtn = root.querySelector('.craft-bn') as HTMLButtonElement;
    this.benchSt = root.querySelector('.craft-bst') as HTMLElement;
    this.benchBtn.addEventListener('click', () => this.bench());
    this.gearBox = root.querySelector('.craft-gear') as HTMLElement;
    (root.querySelector('.craft-x') as HTMLElement).addEventListener('click', () => this.close());
    (root.querySelector('.craft-scrim') as HTMLElement).addEventListener('click', () => this.close());
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  toggle(): void { if (this.open) this.close(); else this.show(); }

  show(): void {
    if (this.open) return;
    this.open = true;
    this.root.hidden = false;
    this.root.classList.add('on');
    this.refresh();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.root.classList.remove('on');
    this.root.hidden = true;
  }

  private make(id: RecipeId): void {
    const r = craftAt(id);
    this.toast(r.msg);
    this.refresh();
  }

  private bench(): void {
    const r = benchAt();
    this.toast(r.msg);
    this.refresh();
  }

  /** Recounts every row from the pack (a few dozen DOM writes; called only while the panel is open). */
  refresh(): void {
    if (!this.open) return;
    const rows: RecipeRow[] = recipeRows(inv, heroAt());
    for (const row of rows) {
      const el = this.rows.get(row.id);
      if (!el) continue;
      const r = RECIPES.find((x) => x.id === row.id)!;
      const v = variantsOf(r)[0];
      const need = Object.keys(v.needs).map((k) => `${label(k as CountId, 1).replace(/^1 /, '')} ${count(inv, k as CountId)}/${v.needs[k as CountId]}`).join(' · ');
      el.need.textContent = need;
      el.ways.textContent = row.ways.length > 1 ? 'два способа: ' + row.ways.join('  или  ') : row.ways[0];
      el.st.textContent = row.ok ? 'сделать' : row.reason;
      el.root.classList.toggle('ok', row.ok);
      el.root.classList.toggle('no', !row.ok);
    }
    const b = benchCount();
    this.benchBtn.textContent = `Поставить верстак (2 бревна${b ? ', уже стоит ' + b : ''})`;
    const logsOk = count(inv, 'logs') >= 2;
    this.benchBtn.disabled = !logsOk;
    this.benchSt.textContent = logsOk ? 'ставится в 2 м от тебя; санки и доски делаются рядом с ним' : 'нужно 2 бревна';
    this.paintGear();
  }

  /** Gear the hero owns, and how to use it. Rebuilt when the set changes (cheap diff by a key string). */
  private paintGear(): void {
    const k = ['snowshoes', 'sled', 'sleepingBag', 'kettle', 'lantern', 'pickaxe'].map((g) => (has(inv, g as 'sled') ? '1' : '0')).join('') + (gear.shoesOn ? 'o' : 'c') + Math.round(gear.sledX / 40) + ':' + gear.torches.length;
    if (k === this.lastGear) return;
    this.lastGear = k;
    const cap = carryCapOf();
    const lines: [string, string, boolean][] = [
      ['Снегоступы', has(inv, 'snowshoes') ? (gear.shoesOn ? 'надеты: проваливаешься в три раза меньше' : 'сняты') : 'нет', has(inv, 'snowshoes')],
      ['Санки', has(inv, 'sled') ? `тянутся за тобой: брёвен до ${cap.logs}, блоков до ${cap.blocks}` : 'нет (2 бревна + верёвка, у верстака)', has(inv, 'sled')],
      ['Спальник', has(inv, 'sleepingBag') ? 'спать: «Ждать» (T) в укрытии или у костра, тепло уходит в 2,5 раза медленнее' : 'нет', has(inv, 'sleepingBag')],
      ['Котелок', has(inv, 'kettle') ? 'ПКМ на огонь: поставить. Копай снег лопатой над ним, ПКМ — лёд и хвоя, E — слить воду или чай' : 'нет', has(inv, 'kettle')],
      ['Фонарь', has(inv, 'lantern') ? 'горит от запаса факела, без дыма' : 'нет', has(inv, 'lantern')],
      ['Кирка', has(inv, 'pickaxe') ? 'клавиша 7: лёд, мёрзлая земля, камень' : 'нет', has(inv, 'pickaxe')],
    ];
    this.gearBox.textContent = '';
    for (const [name, text, owned] of lines) {
      const row = document.createElement('div');
      row.className = 'cg-row' + (owned ? ' own' : '');
      const n = document.createElement('b'); n.textContent = name;
      const t = document.createElement('span'); t.textContent = text;
      row.append(n, t);
      if (name === 'Снегоступы' && owned) {
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'cg-btn';
        btn.textContent = gear.shoesOn ? 'Снять' : 'Надеть';
        btn.addEventListener('click', () => { toggleShoesWorn(); this.lastGear = ''; this.refresh(); });
        row.appendChild(btn);
      }
      this.gearBox.appendChild(row);
    }
    this.shoesBtn = this.gearBox.querySelector('.cg-btn') as HTMLButtonElement;
  }
}
