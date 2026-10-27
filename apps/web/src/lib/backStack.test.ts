import { describe, expect, it, vi } from 'vitest';
import {
  EXIT_WINDOW_MS,
  GUARD_KEY,
  OVERLAY_KEY,
  createBackStack,
  type BackStackEnv,
} from './backStack';

/** A history that behaves like the browser's: back() is asynchronous, popstate follows. */
const makeEnv = (standalone = false) => {
  const entries: unknown[] = [{ usr: null, key: 'r', idx: 0 }];
  let index = 0;
  let queued = 0;
  const listeners = new Set<() => void>();
  const timers: { at: number; fn: () => void; id: number }[] = [];
  const microtasks: (() => void)[] = [];
  let clock = 0;
  let nextId = 1;
  const hint = vi.fn();
  const history = {
    get state() {
      return entries[index];
    },
    pushState: (s: unknown, url?: string) => {
      expect(url ?? '').toBe('');
      entries.splice(index + 1);
      entries.push(s);
      index += 1;
    },
    replaceState: (s: unknown) => {
      entries[index] = s;
    },
    back: () => {
      queued += 1;
    },
  };
  const env: BackStackEnv = {
    history,
    addPopListener: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    defer: (fn) => microtasks.push(fn),
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: clock + ms, fn, id });
      return id;
    },
    clearTimer: (h) => {
      const i = timers.findIndex((t) => t.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
    isStandalone: () => standalone,
    onExitHint: hint,
  };
  const sim = {
    entries,
    hint,
    get index() {
      return index;
    },
    /** Run deferred work and deliver queued history traversals until quiet. */
    settle() {
      for (let guard = 0; guard < 50; guard++) {
        const m = microtasks.splice(0);
        m.forEach((f) => {
          f();
        });
        if (queued > 0) {
          queued -= 1;
          if (index === 0) continue; // nothing below: the real app would close here
          index -= 1;
          listeners.forEach((l) => {
            l();
          });
          continue;
        }
        if (!microtasks.length) return;
      }
    },
    /** The user presses the phone Back button. */
    userBack() {
      history.back();
      sim.settle();
    },
    tick(ms: number) {
      clock += ms;
      for (const t of timers.filter((x) => x.at <= clock)) {
        timers.splice(timers.indexOf(t), 1);
        t.fn();
      }
      sim.settle();
    },
    /** Router-style navigation: a new entry that carries no marker. */
    navigate() {
      history.pushState({ usr: null, key: `k${String(entries.length)}`, idx: index + 1 }, '');
    },
    atTop: () => index === entries.length - 1,
  };
  return { env, sim };
};

describe('back stack: overlays', () => {
  it('opening pushes one entry that keeps the router state; Back closes the overlay', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    const close = vi.fn();
    stack.acquire('a', close);
    expect(sim.entries).toHaveLength(2);
    expect(sim.entries[1]).toMatchObject({ key: 'r', idx: 0 });
    expect(OVERLAY_KEY in (sim.entries[1] as object)).toBe(true);
    sim.userBack();
    expect(close).toHaveBeenCalledTimes(1);
    expect(stack.depth()).toBe(0);
    expect(sim.index).toBe(0);
  });

  it('Back closes only the topmost overlay, one per press', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    const a = vi.fn();
    const b = vi.fn();
    stack.acquire('a', a);
    stack.acquire('b', b);
    sim.userBack();
    expect(b).toHaveBeenCalledTimes(1);
    expect(a).not.toHaveBeenCalled();
    sim.userBack();
    expect(a).toHaveBeenCalledTimes(1);
  });

  it('closing by other means removes the entry with history.back()', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    const close = vi.fn();
    stack.acquire('a', close);
    stack.release('a');
    sim.settle();
    expect(sim.index).toBe(0);
    expect(close).not.toHaveBeenCalled();
    expect(stack.depth()).toBe(0);
  });

  it('a double release removes the entry only once', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    stack.acquire('x', vi.fn());
    sim.navigate();
    stack.release('x');
    stack.release('x');
    sim.settle();
    expect(stack.depth()).toBe(0);
  });

  it('StrictMode: release then immediate acquire keeps a single entry', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    const close = vi.fn();
    stack.acquire('a', close);
    stack.release('a');
    stack.acquire('a', close);
    sim.settle();
    expect(sim.entries).toHaveLength(2);
    expect(sim.index).toBe(1);
    expect(stack.depth()).toBe(1);
  });

  it('fast open/close/open leaves exactly one entry', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    stack.acquire('a', vi.fn());
    stack.release('a');
    sim.settle();
    stack.acquire('a', vi.fn());
    sim.settle();
    expect(sim.index).toBe(1);
  });

  it('does not call history.back() when the user already navigated away', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    stack.acquire('a', vi.fn());
    sim.navigate(); // a link inside the overlay
    stack.release('a'); // the overlay unmounts because of the navigation
    sim.settle();
    expect(sim.entries).toHaveLength(3);
    expect(sim.index).toBe(2); // still on the new page
  });

  it('skips the dead entry left behind when navigating from an overlay', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    stack.acquire('a', vi.fn());
    sim.navigate();
    stack.release('a');
    sim.settle();
    sim.userBack(); // from the new page: lands on the dead entry, then skips to the page below
    expect(sim.index).toBe(0);
  });

  it('closing a lower overlay first leaves the upper one working', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    const b = vi.fn();
    stack.acquire('a', vi.fn());
    stack.acquire('b', b);
    stack.release('a');
    sim.settle();
    expect(sim.index).toBe(2);
    sim.userBack(); // closes b, then skips a's dead entry
    expect(b).toHaveBeenCalledTimes(1);
    expect(sim.index).toBe(0);
  });

  it('a fresh stack works on top of history from an earlier page load', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    const close = vi.fn();
    stack.acquire('a', close);
    sim.userBack();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('release of an unknown token is harmless', () => {
    const { env, sim } = makeEnv();
    const stack = createBackStack(env);
    stack.release('nope');
    sim.settle();
    expect(sim.index).toBe(0);
  });
});

describe('back stack: exit guard', () => {
  it('does nothing outside the installed app', () => {
    const { env, sim } = makeEnv(false);
    createBackStack(env).installExitGuard();
    expect(sim.entries).toHaveLength(1);
  });

  it('first Back shows the hint and stays; a second one inside the window may leave', () => {
    const { env, sim } = makeEnv(true);
    const stack = createBackStack(env);
    stack.installExitGuard();
    stack.installExitGuard(); // idempotent
    expect(sim.entries).toHaveLength(2);
    expect(GUARD_KEY in (sim.entries[1] as object)).toBe(true);

    sim.userBack();
    expect(sim.hint).toHaveBeenCalledTimes(1);
    expect(sim.index).toBe(0);
    // No sentinel any more: the next Back is the browser's own and leaves the app.
    expect(sim.entries).toHaveLength(2);
  });

  it('puts the sentinel back after the window so the hint can show again (no trap)', () => {
    const { env, sim } = makeEnv(true);
    const stack = createBackStack(env);
    stack.installExitGuard();
    sim.userBack();
    sim.tick(EXIT_WINDOW_MS + 10);
    expect(sim.index).toBe(1);
    sim.userBack();
    expect(sim.hint).toHaveBeenCalledTimes(2);
  });

  it('re-arms the sentinel when coming back to the root from another page', () => {
    const { env, sim } = makeEnv(true);
    const stack = createBackStack(env);
    stack.installExitGuard();
    sim.navigate(); // [R, G, X]
    sim.userBack(); // to G
    expect(sim.hint).not.toHaveBeenCalled();
    sim.userBack(); // to R: hint
    expect(sim.hint).toHaveBeenCalledTimes(1);
  });

  it('overlays sit above the sentinel: Back closes the overlay first', () => {
    const { env, sim } = makeEnv(true);
    const stack = createBackStack(env);
    stack.installExitGuard();
    const close = vi.fn();
    stack.acquire('a', close);
    expect(GUARD_KEY in (sim.entries[2] as object)).toBe(false);
    sim.userBack();
    expect(close).toHaveBeenCalled();
    expect(sim.hint).not.toHaveBeenCalled();
    sim.userBack();
    expect(sim.hint).toHaveBeenCalledTimes(1);
  });
});
