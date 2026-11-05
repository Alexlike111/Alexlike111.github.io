// Leaderboard view: the top 10 best laps of a track, read through the Playgama Bridge (`platform.leaderboardTop`).
// Self-contained: it appends one modal layer to the UI root and talks to the platform wrapper only. Entry points
// (the track-select "Leaderboard" button and the results screen) live in ui.ts; `game.ts` owns the instance.
// Shown only when the platform hands out entries (`leaderboards.type === 'in_game'`); `native_popup` platforms use
// `platform.showLeaderboardPopup` instead (see `openLeaderboard` in game.ts); everything else hides the controls.
import './leaderboard.css';
import { CONFIG } from '../config';
import { t } from '../i18n';
import { platform, type LeaderboardResult } from '../platform/bridge';
import { TRACKS } from '../track/tracks';
import { icon } from './icons';

const esc = (s: string | number): string =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

const CLOSE_SVG = '<svg class="ic" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round"/></svg>';

/** Best lap in whole milliseconds -> "m:ss.cc" (same look as the in-game lap times). */
export function formatLapMs(ms: number): string {
  if (!(ms > 0) || !Number.isFinite(ms)) return '--:--.--';
  const cs = Math.round(ms / 10);
  const m = Math.floor(cs / 6000);
  const s = (cs - m * 6000) / 100;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(2)}`;
}

type State =
  | { kind: 'loading' }
  | { kind: 'ok'; rows: Extract<LeaderboardResult, { status: 'ok' }>['rows'] }
  | { kind: 'error' };

export class LeaderboardPanel {
  private layer: HTMLElement;
  private trackId = TRACKS[0]?.id ?? 't1';
  private state: State = { kind: 'loading' };
  private seq = 0;   // a late answer for a tab the player already left is dropped

  constructor(root: HTMLElement, private sfx?: (name: 'click') => void) {
    this.layer = document.createElement('div');
    this.layer.className = 'lb-layer';
    this.layer.hidden = true;
    root.appendChild(this.layer);
    this.layer.addEventListener('click', this.onClick);
  }

  get isOpen(): boolean { return !this.layer.hidden; }

  /** Open on `trackId` (falls back to the first track) and start loading. No-op when the platform has no readable board. */
  show(trackId?: string): void {
    if (platform.leaderboardMode() !== 'in_game') return;
    this.trackId = TRACKS.some((x) => x.id === trackId) ? (trackId as string) : (TRACKS[0]?.id ?? this.trackId);
    this.layer.hidden = false;
    this.load();
    // focus the close button so keyboard players can leave without a mouse (Esc is never bound)
    this.layer.querySelector<HTMLElement>('[data-lb=close]')?.focus({ preventScroll: true });
  }

  close(): void {
    this.seq++;
    this.layer.hidden = true;
    this.layer.replaceChildren();
  }

  private load(): void {
    const mine = ++this.seq;
    this.state = { kind: 'loading' };
    this.render();
    void platform.leaderboardTop(CONFIG.game.leaderboardPrefix + this.trackId, 10).then((r) => {
      if (mine !== this.seq || this.layer.hidden) return;
      this.state = r.status === 'ok' ? { kind: 'ok', rows: r.rows } : { kind: 'error' };
      this.render();
    });
  }

  private onClick = (e: Event): void => {
    const target = e.target as HTMLElement | null;
    if (target === this.layer) { this.close(); return; }   // the dim backdrop closes, like the close button
    const el = target?.closest<HTMLElement>('[data-lb]');
    if (!el) return;
    this.sfx?.('click');
    switch (el.dataset.lb) {
      case 'close': this.close(); break;
      case 'retry': this.load(); break;
      case 'track': if (el.dataset.id && el.dataset.id !== this.trackId) { this.trackId = el.dataset.id; this.load(); } break;
      default: break;
    }
  };

  private render(): void {
    const tabs = TRACKS.map((tr) =>
      `<button class="lb-tab${tr.id === this.trackId ? ' on' : ''}" role="tab" aria-selected="${tr.id === this.trackId}" data-lb="track" data-id="${esc(tr.id)}">${esc(t(tr.nameKey))}</button>`).join('');
    let body: string;
    const s = this.state;
    if (s.kind === 'loading') {
      body = `<div class="lb-msg"><i class="lb-spin" aria-hidden="true"></i><span>${esc(t('lb.loading'))}</span></div>`;
    } else if (s.kind === 'error') {
      body = `<div class="lb-msg"><span>${esc(t('lb.error'))}</span><button class="btn yellow sm" data-lb="retry">${icon('restart')}<span>${esc(t('lb.retry'))}</span></button></div>`;
    } else if (s.rows.length === 0) {
      body = `<div class="lb-msg"><span>${esc(t('lb.empty'))}</span></div>`;
    } else {
      body = `<ol class="lb-list">${s.rows.map((r) => `<li class="lb-row${r.isPlayer ? ' me' : ''}${r.rank <= 3 ? ' p' + r.rank : ''}">
        <b class="lb-rank">${r.rank}</b>
        <span class="lb-name">${esc(r.name || t('lb.player'))}${r.isPlayer ? `<em>${esc(t('lb.you'))}</em>` : ''}</span>
        <b class="lb-time">${formatLapMs(r.score)}</b></li>`).join('')}</ol>`;
    }
    this.layer.innerHTML = `<div class="lb-card panel" role="dialog" aria-modal="true" aria-label="${esc(t('lb.title'))}">
      <div class="lb-head">
        <span class="lb-trophy">${icon('trophy')}</span>
        <div class="lb-titles"><h2 class="title sm">${esc(t('lb.title'))}</h2><small>${esc(t('lb.sub'))}</small></div>
        <button class="btn round grey lb-x" data-lb="close" aria-label="${esc(t('lb.close'))}">${CLOSE_SVG}</button>
      </div>
      <div class="lb-tabs" role="tablist">${tabs}</div>
      <div class="lb-body" aria-live="polite">${body}</div>
    </div>`;
  }
}
