// Whether the guide may run at all.
//
// It is OFF while unit tests run (MODE is "test"), so no existing test meets an overlay; a guide
// test turns it on with enableGuideForTests(). A person or a browser test can also switch it off
// on one device by storing "1" under `flick.guide.off` (this keeps their progress untouched).
// A browser test can also shorten the wait between tips with `flick.guide.cooldown_ms`.

export const GUIDE_OFF_KEY = 'flick.guide.off';
export const GUIDE_COOLDOWN_KEY = 'flick.guide.cooldown_ms';

let forced: boolean | null = null;

/** Tests only: true = run the guide, false = never, null = back to the normal rule. */
export function forceGuideAvailable(value: boolean | null): void {
  forced = value;
}

export function guideAvailable(): boolean {
  if (forced !== null) return forced;
  if (import.meta.env.MODE === 'test') return false;
  try {
    return localStorage.getItem(GUIDE_OFF_KEY) !== '1';
  } catch {
    return true;
  }
}

/** The least time between two tips: a minute, unless a browser test changed it (0 to ten minutes). */
export function tipCooldownMs(defaultMs: number): number {
  try {
    const wanted = Number(localStorage.getItem(GUIDE_COOLDOWN_KEY));
    if (localStorage.getItem(GUIDE_COOLDOWN_KEY) !== null && Number.isFinite(wanted)) {
      return Math.min(Math.max(wanted, 0), 600_000);
    }
  } catch {
    // no storage: the normal wait
  }
  return defaultMs;
}
