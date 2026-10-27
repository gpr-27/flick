// One place that decides what the phone Back button / back swipe does.
//
// Every overlay (modal, sheet, popover, panel) pushes ONE history entry when it opens, and
// closing the topmost overlay is what a `popstate` means while any overlay is open. When an
// overlay is closed by other means (X, Esc, outside tap, code) its entry is removed again with
// history.back(), but only if that entry is still the current one.
//
// The module is plain TypeScript with injected browser pieces so the rules can be tested with a
// fake history. React glue lives in useBackClose.ts.

/** history.state key that marks an overlay entry (value: `<nonce>:<seq>`). */
export const OVERLAY_KEY = '__flickBack';
/** history.state key that marks the "press back again to exit" sentinel entry. */
export const GUARD_KEY = '__flickGuard';
/** How long the second Back press counts as "yes, exit". */
export const EXIT_WINDOW_MS = 2000;

type StateRecord = Record<string, unknown>;

export interface HistoryLike {
  readonly state: unknown;
  pushState(state: unknown, unused: string): void;
  replaceState(state: unknown, unused: string): void;
  back(): void;
}

export interface BackStackEnv {
  history: HistoryLike;
  addPopListener(fn: () => void): () => void;
  /** Runs `fn` after the current synchronous work (a microtask in the browser). */
  defer(fn: () => void): void;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
  /** True in the installed PWA, where Back would otherwise close the app. */
  isStandalone(): boolean;
  /** Shows "Press back again to exit". */
  onExitHint(): void;
}

interface Entry {
  token: unknown;
  seq: number;
  close: () => void;
  releasing: boolean;
}

const asRecord = (state: unknown): StateRecord =>
  state !== null && typeof state === 'object' ? (state as StateRecord) : {};

/** A copy of the router's state without one of our own markers. */
const without = (state: unknown, key: string): StateRecord => {
  return Object.fromEntries(Object.entries(asRecord(state)).filter(([k]) => k !== key));
};

export interface BackStack {
  /** Registers an open overlay. Calling again with the same token only updates `close`. */
  acquire(token: unknown, close: () => void): void;
  /** The overlay closed by other means. Safe to call twice, or for an unknown token. */
  release(token: unknown): void;
  /** Put the exit sentinel under the app (installed PWA only). Safe to call repeatedly. */
  installExitGuard(): void;
  /** Number of overlays currently registered. */
  depth(): number;
  /** Stops listening (tests, hot reload). */
  destroy(): void;
}

export const createBackStack = (env: BackStackEnv): BackStack => {
  const nonce = Math.random().toString(36).slice(2, 8);
  let counter = 0;
  let stack: Entry[] = [];
  let guardInstalled = false;
  let onGuard = false;
  let rearm: unknown = null;

  const markerOf = (seq: number): string => `${nonce}:${String(seq)}`;
  const currentMarker = (): string | null => {
    const v = asRecord(env.history.state)[OVERLAY_KEY];
    return typeof v === 'string' ? v : null;
  };
  /** Sequence number of a marker from this page load; 0 for none or a foreign one. */
  const seqOf = (marker: string | null): number => {
    if (!marker) return 0;
    const [n, s] = marker.split(':');
    return n === nonce ? Number(s) : 0;
  };
  const isAtRoot = (): boolean => {
    const s = asRecord(env.history.state);
    if (OVERLAY_KEY in s || GUARD_KEY in s) return false;
    const idx = s.idx;
    return idx === undefined || idx === 0;
  };

  const pushGuard = (): void => {
    env.history.pushState({ ...without(env.history.state, OVERLAY_KEY), [GUARD_KEY]: 1 }, '');
    onGuard = true;
  };

  const onPop = (): void => {
    const state = asRecord(env.history.state);
    const marker = currentMarker();
    const curSeq = seqOf(marker);

    // Everything opened after the entry we are now on has lost its history entry: close it,
    // topmost first.
    const popped = stack.filter((e) => e.seq > curSeq);
    if (popped.length) {
      stack = stack.filter((e) => e.seq <= curSeq);
      for (const e of popped.reverse()) e.close();
    }

    const wasOnGuard = onGuard;
    onGuard = GUARD_KEY in state;

    // An entry of an overlay that is already closed: a dead step, skip over it.
    if (marker !== null && !stack.some((e) => markerOf(e.seq) === marker)) {
      env.history.back();
      return;
    }

    if (guardInstalled && isAtRoot()) {
      if (wasOnGuard) {
        // Back was pressed on the sentinel: show the hint and stay on the root entry. A second
        // Back inside the window leaves the app; afterwards the sentinel returns.
        env.onExitHint();
        if (rearm !== null) env.clearTimer(rearm);
        rearm = env.setTimer(() => {
          rearm = null;
          if (guardInstalled && isAtRoot()) pushGuard();
        }, EXIT_WINDOW_MS);
      } else {
        // Came back to the root from a page above it: arm the sentinel again.
        pushGuard();
      }
    }
  };

  const off = env.addPopListener(onPop);

  const finishRelease = (entry: Entry): void => {
    if (!entry.releasing) return;
    const wasOnTop = currentMarker() === markerOf(entry.seq);
    stack = stack.filter((e) => e !== entry);
    if (wasOnTop) env.history.back();
  };

  return {
    acquire(token, close) {
      const existing = stack.find((e) => e.token === token);
      if (existing) {
        existing.close = close;
        existing.releasing = false;
        return;
      }
      counter += 1;
      const entry: Entry = { token, seq: counter, close, releasing: false };
      stack.push(entry);
      const base = without(env.history.state, GUARD_KEY);
      env.history.pushState({ ...base, [OVERLAY_KEY]: markerOf(entry.seq) }, '');
      onGuard = false;
    },
    release(token) {
      const entry = stack.find((e) => e.token === token);
      if (!entry || entry.releasing) return;
      entry.releasing = true;
      // Deferred: React StrictMode (and a quick close-then-open) re-acquires right after.
      env.defer(() => {
        finishRelease(entry);
      });
    },
    installExitGuard() {
      if (guardInstalled || !env.isStandalone()) return;
      guardInstalled = true;
      if (GUARD_KEY in asRecord(env.history.state)) {
        onGuard = true;
        return;
      }
      if (isAtRoot()) pushGuard();
    },
    depth: () => stack.length,
    destroy() {
      off();
      if (rearm !== null) env.clearTimer(rearm);
      stack = [];
      guardInstalled = false;
    },
  };
};
