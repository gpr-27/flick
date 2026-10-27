import { OVERLAY_KEY } from '@/lib/backStack';

/**
 * Go back one step from the browser history, or to the chat list when there is nothing before
 * this page in the app (a deep link opened in a fresh window).
 */
export const goBack = (navigate: (to: string, o: { replace: boolean }) => void): void => {
  const s = (window.history.state ?? {}) as Record<string, unknown>;
  const idx = typeof s.idx === 'number' ? s.idx : 0;
  if (OVERLAY_KEY in s || idx > 0) window.history.back();
  else navigate('/', { replace: true });
};
