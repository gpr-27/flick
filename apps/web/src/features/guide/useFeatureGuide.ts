import { useEffect } from 'react';
import { useGuideStore } from './useGuideStore';

/**
 * Call this in the screen of a feature that has a first-open tip in catalog.ts.
 *
 * When the screen shows and the person has not seen the tip and has never used the feature, the
 * tip is queued. The guide shows queued tips one at a time, never during a call, with a dialog
 * open, while the person types, or more than once a minute. If the screen goes away before the
 * tip's turn, it is dropped. Pass `ready = false` until the thing the tip points at is on screen.
 */
export function useFeatureGuide(topicId: string, ready = true): void {
  useFeatureGuides([topicId], ready);
}

/** The same for several tips of one screen; they are queued in the order given. */
export function useFeatureGuides(topicIds: readonly string[], ready = true): void {
  const key = topicIds.join(',');
  useEffect(() => {
    if (!ready) return;
    const ids = key.split(',');
    for (const id of ids) useGuideStore.getState().requestTip(id);
    return () => {
      for (const id of ids) useGuideStore.getState().cancelTip(id);
    };
  }, [key, ready]);
}

/** Marks a feature as used the moment `used` becomes true (for example when its panel opens). */
export function useMarkUsedWhen(topicId: string, used: boolean): void {
  useEffect(() => {
    if (used) useGuideStore.getState().markUsed(topicId);
  }, [topicId, used]);
}
