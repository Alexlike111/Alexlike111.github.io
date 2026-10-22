// The ONLY place that decides when an interstitial may run. Project rule (Саша, 18.10):
//   - never when the player loses and never mid-play;
//   - only after a result, when the player taps "Next" / "Try again" (`afterResult`);
//   - at least 90 s since the previous interstitial, none in the first 3 minutes of a session;
//   - game and sound are paused while any ad is open.
import { platform, QA } from './bridge';
import { toast } from './toast';
import { t } from './i18n';

const MIN_GAP_MS = 90_000;
const FIRST_AD_AFTER_MS = 180_000;

/** Test hook: ?qa=1 lets the check script move the clock instead of waiting minutes. */
const clock = (): number => performance.now() + (QA ? (window.__qa?.clockOffset ?? 0) : 0);

let lastAt = -Infinity;
let showing = false;
const pauseHooks: ((paused: boolean) => void)[] = [];

/** The game and the audio register here so an ad pauses them. */
export const onAdPause = (f: (paused: boolean) => void): void => void pauseHooks.push(f);
const setPaused = (p: boolean) => pauseHooks.forEach((f) => f(p));

export const adShowing = (): boolean => showing;

export function interstitialAllowed(): boolean {
  const now = clock();
  return !showing && now >= FIRST_AD_AFTER_MS && now - lastAt >= MIN_GAP_MS;
}

/**
 * Call from the click handler of the "Next" / "Try again" button on the result screen,
 * await it, then start the next run. Resolves when the game may go on.
 */
export async function afterResult(): Promise<void> {
  if (!interstitialAllowed()) return;
  showing = true;
  setPaused(true);
  try {
    const shown = await platform.showInterstitial('level_completed');
    if (shown) {
      lastAt = clock();
      platform.track('ad_interstitial', { placement: 'after_result' });
    }
  } finally {
    showing = false;
    setPaused(false);
  }
}

/**
 * Rewarded ad on the player's own tap (a button with the video-ad icon). Resolves true only if the
 * reward was earned. Explains in a toast when it failed; buttons stay visible even with an ad blocker.
 */
export async function rewarded(rewardId: string): Promise<boolean> {
  if (showing) return false;
  if (await platform.adBlockedNow()) {
    toast(t('adBlock'));
    return false;
  }
  showing = true;
  setPaused(true);
  try {
    const ok = await platform.showRewarded(rewardId);
    platform.track('ad_rewarded', { reward_id: rewardId, earned: ok });
    if (!ok) toast(t('adFail'));
    else lastAt = Math.max(lastAt, clock() - MIN_GAP_MS / 2); // a rewarded view also spaces out the next interstitial
    return ok;
  } finally {
    showing = false;
    setPaused(false);
  }
}
