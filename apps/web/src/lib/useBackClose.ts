import { useEffect, useRef } from 'react';
import { notify } from '@/components/ui/notify';
import { createBackStack, type BackStack } from './backStack';

/** True when the app runs as an installed PWA (its own window, no browser chrome). */
export const isStandalone = (): boolean => {
  if (typeof window === 'undefined') return false;
  const mq =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)').matches
      : false;
  const ios = (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return mq || ios;
};

let instance: BackStack | null = null;

/** The app-wide back stack, created on first use. */
export const getBackStack = (): BackStack => {
  instance ??= createBackStack({
    history: window.history,
    addPopListener: (fn) => {
      window.addEventListener('popstate', fn);
      return () => {
        window.removeEventListener('popstate', fn);
      };
    },
    defer: (fn) => {
      queueMicrotask(fn);
    },
    setTimer: (fn, ms) => window.setTimeout(fn, ms),
    clearTimer: (h) => {
      window.clearTimeout(h as number);
    },
    isStandalone,
    onExitHint: () => {
      notify.info('Press back again to exit');
    },
  });
  return instance;
};

/** Test helper: drop the shared stack so the next call builds a fresh one. */
export const resetBackStackForTests = (): void => {
  instance?.destroy();
  instance = null;
};

export interface BackCloseOptions {
  /** Set false to leave Back alone (e.g. an overlay that only exists on phones). Default true. */
  enabled?: boolean;
}

/**
 * While `open`, the phone Back button / back swipe calls `onClose` instead of leaving the page.
 * Opening pushes one history entry; closing by any other means removes it again. Overlays
 * stack: Back closes the topmost one. Safe to call from any component that has an open state.
 *
 *   useBackClose(open, () => { setOpen(false); });
 */
export const useBackClose = (
  open: boolean,
  onClose: () => void,
  { enabled = true }: BackCloseOptions = {},
): void => {
  const token = useRef({});
  const onCloseRef = useRef(onClose);
  const openRef = useRef(open && enabled);
  useEffect(() => {
    onCloseRef.current = onClose;
    openRef.current = open && enabled;
  });

  const active = open && enabled;
  useEffect(() => {
    if (!active) return;
    const stack = getBackStack();
    const me = token.current;
    const close = (): void => {
      onCloseRef.current();
      // The owner may refuse to close (a confirm step): put the entry back so Back keeps working.
      window.setTimeout(() => {
        if (openRef.current) stack.acquire(me, close);
      }, 0);
    };
    stack.acquire(me, close);
    return () => {
      stack.release(me);
    };
  }, [active]);
};

/** Installed PWA at the app root: first Back shows a hint, a second one within 2 s leaves. */
export const useExitGuard = (): void => {
  useEffect(() => {
    getBackStack().installExitGuard();
  }, []);
};
