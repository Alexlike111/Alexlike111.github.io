// Ragdoll Lab player feedback v1: "rate the game + what to improve" with an in-game reward.
// No free text on purpose: YouTube Playables and Playgama forbid requests to outside servers, and the
// only allowed channel (Bridge analytics) must not carry player-written text. Answers are bounded
// booleans, so every one of them can be counted through the Playgama telemetry API.
// Copy this folder into the game as src/feedback/ next to src/ui-kit/. See README.md.
import './feedback.css';
import { ic, type IconName } from '../ui-kit/ui-kit';
import { fbDict, type FbLang } from './feedback-i18n';

export const FEEDBACK_VERSION = 1;

/** What the module keeps in the game's own save (through Bridge Storage, never localStorage). */
export interface FbSave {
  runs: number; // finished runs since the last sent feedback
  sentAt: number; // ms of the last sent feedback, 0 = never
  promptAt: number; // ms of the last automatic invitation
  skips: number; // automatic invitations closed without sending, since the last send
  count: number; // feedbacks sent in total
}

export interface FbTopic {
  id: string; // snake_case, becomes the telemetry field imp_<id>
  icon: IconName;
  label: Partial<Record<FbLang, string>> & { en: string };
}

export interface FeedbackOpts {
  gameVersion: string; // build version, sent with every answer
  lang: () => string; // current game language code
  track: (name: string, data: Record<string, string | number | boolean>) => void; // Bridge analytics.send
  load: () => Partial<FbSave> | undefined; // read from the game save
  save: (s: FbSave) => void; // write into the game save and persist it
  reward: () => { html: string; give: () => void }; // html shows the prize (e.g. ic('coin') + ' 500')
  extraTopics?: FbTopic[]; // up to 3 game-specific answers
  onOpen?: () => void; // pause the game / hide HUD
  onClose?: () => void;
  sfx?: (kind: 'tap' | 'send') => void;
  minRuns?: number; // runs before the first automatic invitation (default 3)
  cooldownDays?: number; // days between two feedbacks with a reward (default 3)
  maxSkips?: number; // stop inviting after this many "Not now" (default 2); the menu button stays
}

const BASE: { id: string; icon: IconName }[] = [
  { id: 'controls', icon: 'hand-tap' },
  { id: 'too_hard', icon: 'bomb' },
  { id: 'too_easy', icon: 'feather' },
  { id: 'graphics', icon: 'palette' },
  { id: 'more_content', icon: 'map' },
  { id: 'fewer_ads', icon: 'video-ad' },
  { id: 'bugs_lag', icon: 'bandage' },
  { id: 'sound', icon: 'sound-on' },
];
const ALL_GOOD = 'all_good';
const DAY = 86_400_000;
const PROMPT_GAP = 20 * 3_600_000; // at most one automatic invitation per ~day

export interface Feedback {
  /** Call once per finished run / level / round (win or lose). */
  runEnded(): void;
  /** Call at a natural pause (back on the menu or the next level, never mid-play or right on an ad).
   *  Opens the form when the player has played enough and has not been asked recently. */
  maybePrompt(): boolean;
  /** Menu button: open the form (or the "thanks, next in N days" card). */
  open(source?: 'menu' | 'prompt'): void;
  isOpen(): boolean;
  /** True when sending now would give the reward: use it for a badge on the menu button. */
  canSend(): boolean;
  daysLeft(): number;
  label(): string; // localized menu button text
}

export function createFeedback(o: FeedbackOpts): Feedback {
  const minRuns = o.minRuns ?? 3;
  const cooldown = (o.cooldownDays ?? 3) * DAY;
  const maxSkips = o.maxSkips ?? 2;
  const extras = (o.extraTopics || []).slice(0, 3);
  let st: FbSave = { runs: 0, sentAt: 0, promptAt: 0, skips: 0, count: 0, ...(o.load() || {}) };
  let root: HTMLElement | null = null;
  let keyHandler: ((e: KeyboardEvent) => void) | null = null;

  const persist = () => o.save({ ...st });
  const now = () => Date.now();
  const canSend = () => !st.sentAt || now() - st.sentAt >= cooldown || now() < st.sentAt; // clock moved back: allow
  const daysLeft = () => (canSend() ? 0 : Math.max(1, Math.ceil((st.sentAt + cooldown - now()) / DAY)));
  const d = () => fbDict(o.lang());
  const lang = () => (o.lang() || 'en').toLowerCase().split(/[-_]/)[0] as FbLang;
  const topicLabel = (id: string) => {
    const x = extras.find((e) => e.id === id);
    return x ? x.label[lang()] || x.label.en : d().topics[id] || id;
  };
  const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
  const runsBucket = (n: number) => (n < 3 ? '0-2' : n < 6 ? '3-5' : n < 11 ? '6-10' : n < 21 ? '11-20' : '21+');

  function close(): void {
    if (!root) return;
    root.remove();
    root = null;
    if (keyHandler) window.removeEventListener('keydown', keyHandler, true);
    keyHandler = null;
    o.onClose?.();
  }

  function mount(html: string): HTMLElement {
    if (root) root.remove();
    const el = document.createElement('div');
    el.className = 'gk-dim gk fb-dim';
    el.innerHTML = html;
    // block taps and keys from reaching the game underneath
    for (const ev of ['pointerdown', 'pointerup', 'touchstart', 'mousedown', 'click', 'wheel', 'contextmenu'])
      el.addEventListener(ev, (e) => e.stopPropagation());
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    document.body.appendChild(el);
    root = el;
    return el;
  }

  function showThanks(prize: string): void {
    const t = d();
    const el = mount(`
      <div class="gk-panel fb-panel fb-thanks" role="dialog" aria-modal="true">
        <div class="gk-ribbon gk-h">${esc(t.thanks)}</div>
        <button class="gk-btn round red small gk-close" data-x aria-label="${esc(t.later)}">${ic('close')}</button>
        <div class="gk-panel-body">
          <div class="fb-big">${ic('heart', 'lg')}</div>
          <p class="gk-body fb-sub">${esc(t.thanksSub)}</p>
          ${prize ? `<div class="fb-prize got">${esc(t.got)}: ${prize}</div>` : `<p class="gk-body fb-sub small">${esc(t.again.replace('{n}', String(daysLeft())))}</p>`}
          <button class="gk-btn big" data-x>${ic('check')}<span>OK</span></button>
        </div>
      </div>`);
    el.querySelectorAll('[data-x]').forEach((b) => b.addEventListener('click', () => close()));
    setKeys((e) => { if (e.key === 'Escape' || e.key === 'Enter') close(); });
  }

  function setKeys(fn: (e: KeyboardEvent) => void): void {
    if (keyHandler) window.removeEventListener('keydown', keyHandler, true);
    keyHandler = (e) => {
      e.stopPropagation();
      fn(e);
    };
    window.addEventListener('keydown', keyHandler, true);
  }

  function showForm(source: 'menu' | 'prompt'): void {
    const t = d();
    const r = o.reward();
    let rating = 0;
    const picked = new Set<string>();
    const topics = [...BASE, ...extras.map((e) => ({ id: e.id, icon: e.icon })), { id: ALL_GOOD, icon: 'heart' as IconName }];
    const el = mount(`
      <div class="gk-panel fb-panel" role="dialog" aria-modal="true" aria-label="${esc(t.title)}">
        <div class="gk-ribbon gk-h">${esc(t.title)}</div>
        <button class="gk-btn round red small gk-close" data-later aria-label="${esc(t.later)}">${ic('close')}</button>
        <div class="gk-panel-body fb-body">
          <div class="fb-left">
            <div class="fb-prize">${ic('gift')}<span>${esc(t.reward)}:</span> ${r.html}</div>
            <div class="fb-q">${esc(t.q1)}</div>
            <div class="fb-stars" role="radiogroup">
              ${[1, 2, 3, 4, 5].map((i) => `<button class="fb-star" data-r="${i}" role="radio" aria-checked="false" aria-label="${i}">${ic('star-empty')}</button>`).join('')}
            </div>
          </div>
          <div class="fb-right">
            <div class="fb-q">${esc(t.q2)} <small>${esc(t.multi)}</small></div>
            <div class="fb-chips">
              ${topics.map((x) => `<button class="fb-chip${x.id === ALL_GOOD ? ' good' : ''}" data-t="${x.id}" aria-pressed="false">${ic(x.icon)}<span>${esc(topicLabel(x.id))}</span></button>`).join('')}
            </div>
          </div>
        </div>
        <div class="fb-foot">
          <div class="fb-hint" aria-live="polite"></div>
          <div class="fb-row">
            <button class="gk-btn blue small" data-later>${esc(t.later)}</button>
            <button class="gk-btn fb-send is-disabled" data-send>${ic('check')}<span>${esc(t.send)}</span></button>
          </div>
        </div>
      </div>`);
    const send = el.querySelector<HTMLButtonElement>('[data-send]')!;
    const hint = el.querySelector<HTMLElement>('.fb-hint')!;
    const refresh = () => {
      el.querySelectorAll<HTMLElement>('.fb-star').forEach((b) => {
        const on = Number(b.dataset.r) <= rating;
        b.classList.toggle('on', on);
        b.setAttribute('aria-checked', String(Number(b.dataset.r) === rating));
        b.querySelector('use')?.setAttribute('href', on ? '#gk-star' : '#gk-star-empty');
      });
      el.querySelectorAll<HTMLElement>('.fb-chip').forEach((b) => {
        const on = picked.has(b.dataset.t!);
        b.classList.toggle('on', on);
        b.setAttribute('aria-pressed', String(on));
      });
      send.classList.toggle('is-disabled', !(rating && picked.size));
      if (rating && picked.size) hint.textContent = '';
    };
    const setRating = (n: number) => {
      rating = n;
      o.sfx?.('tap');
      refresh();
    };
    el.querySelectorAll<HTMLElement>('.fb-star').forEach((b) => b.addEventListener('click', () => setRating(Number(b.dataset.r))));
    el.querySelectorAll<HTMLElement>('.fb-chip').forEach((b) =>
      b.addEventListener('click', () => {
        const id = b.dataset.t!;
        if (picked.has(id)) picked.delete(id);
        else {
          // "All good" and the improvement answers exclude each other
          if (id === ALL_GOOD) picked.clear();
          else picked.delete(ALL_GOOD);
          picked.add(id);
        }
        o.sfx?.('tap');
        refresh();
      }),
    );
    const later = () => {
      o.track('feedback_closed', { source, rated: rating > 0, n_topics: picked.size, game_version: o.gameVersion });
      if (source === 'prompt') {
        st.skips++;
        persist();
      }
      close();
    };
    el.querySelectorAll('[data-later]').forEach((b) => b.addEventListener('click', later));
    const submit = () => {
      if (!rating) return void (hint.textContent = t.pickRating);
      if (!picked.size) return void (hint.textContent = t.pickTopic);
      const data: Record<string, string | number | boolean> = {
        rating, source, n_topics: picked.size, runs: runsBucket(st.runs), nth: Math.min(st.count + 1, 10), game_version: o.gameVersion, fb_v: FEEDBACK_VERSION,
      };
      for (const x of topics) data[`imp_${x.id}`] = picked.has(x.id);
      o.track('feedback_sent', data);
      const rewarded = canSend();
      st = { ...st, runs: 0, sentAt: rewarded ? now() : st.sentAt, skips: 0, count: st.count + 1 };
      let prize = '';
      if (rewarded) {
        r.give();
        prize = r.html;
      }
      persist();
      o.sfx?.('send');
      showThanks(prize);
    };
    send.addEventListener('click', submit);
    setKeys((e) => {
      if (e.key === 'Escape') later();
      else if (e.key >= '1' && e.key <= '5') setRating(Number(e.key));
      else if (e.key === 'Enter') submit();
    });
    o.track('feedback_shown', { source, game_version: o.gameVersion });
  }

  return {
    runEnded() {
      st.runs++;
      persist();
    },
    maybePrompt() {
      if (root || !canSend()) return false;
      if (st.runs < minRuns || st.skips >= maxSkips) return false;
      if (st.promptAt && now() - st.promptAt < PROMPT_GAP && now() >= st.promptAt) return false;
      st.promptAt = now();
      persist();
      this.open('prompt');
      return true;
    },
    open(source = 'menu') {
      if (root) return;
      o.onOpen?.();
      if (canSend()) showForm(source);
      else showThanks('');
    },
    isOpen: () => !!root,
    canSend,
    daysLeft,
    label: () => d().button,
  };
}
