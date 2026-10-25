import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installFakeServices, type FakeApi } from '../../../test/fakes';
import { TIP_COOLDOWN_MS } from './scheduler';
import { disableGuideForTests, enableGuideForTests } from './testing';
import { GUIDE_KEY, markUsed, useGuideStore } from './useGuideStore';

const T0 = '2026-01-01T10:00:00.000Z';
const T1 = '2026-02-01T10:00:00.000Z';

const serverState = (over: Record<string, unknown> = {}) => ({
  seen: {},
  used: {},
  welcome_done_at: null,
  enabled: true,
  version: 1,
  ...over,
});

const store = () => useGuideStore.getState();
const tick = (now: number, over: { blocked?: boolean; typing?: boolean } = {}) => {
  store().tick({ now, blocked: false, typing: false, ...over });
};

let api: FakeApi;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
  vi.setSystemTime(new Date('2026-03-01T09:00:00.000Z'));
  ({ api } = installFakeServices());
  enableGuideForTests('u1');
});
afterEach(() => {
  disableGuideForTests();
  vi.useRealTimers();
});

describe('guide store: starting up', () => {
  it('is off by default under unit tests, until a test switches it on', async () => {
    disableGuideForTests();
    markUsed('composer.voice');
    expect(store().used).toEqual({});
    store().requestTip('composer.voice');
    expect(store().queue).toEqual([]);
    await store().loadFromServer();
    expect(api.call).not.toHaveBeenCalled();
  });

  it('hydrates at once from what this device saved (before the server answers)', async () => {
    localStorage.setItem(
      GUIDE_KEY,
      JSON.stringify({
        userId: 'u1',
        seen: { 'composer.voice': T0 },
        used: { 'chat.pinned': T0 },
        welcomeDoneAt: T0,
        enabled: false,
        version: 4,
      }),
    );
    vi.resetModules();
    const fresh = await import('./useGuideStore');
    const s = fresh.useGuideStore.getState();
    expect(s.seen).toEqual({ 'composer.voice': T0 });
    expect(s.used).toEqual({ 'chat.pinned': T0 });
    expect(s.welcomeDoneAt).toBe(T0);
    expect(s.enabled).toBe(false);
  });

  it('ignores damaged saved data instead of failing', async () => {
    localStorage.setItem(GUIDE_KEY, '{not json');
    vi.resetModules();
    const fresh = await import('./useGuideStore');
    expect(fresh.useGuideStore.getState().seen).toEqual({});
    localStorage.setItem(
      GUIDE_KEY,
      JSON.stringify({ seen: { 'Bad Id': 'x', ok: T0 }, enabled: 7 }),
    );
    vi.resetModules();
    const again = await import('./useGuideStore');
    expect(again.useGuideStore.getState().seen).toEqual({ ok: T0 });
    expect(again.useGuideStore.getState().enabled).toBe(true);
  });

  it('a different account on the same browser starts clean', () => {
    markUsed('composer.voice');
    expect(store().used).toHaveProperty('composer.voice');
    store().bindUser('u2');
    expect(store().used).toEqual({});
    expect(store().userId).toBe('u2');
  });
});

describe('guide store: syncing with the server', () => {
  it('merges the server copy with this device and sends what the server lacks', async () => {
    markUsed('composer.voice');
    api.call.mockResolvedValueOnce(
      serverState({ seen: { 'chat.pinned': T0 }, used: { 'composer.voice': T0 }, version: 3 }),
    );
    api.call.mockResolvedValue(serverState({ version: 4 }));
    await store().loadFromServer();
    expect(store().seen).toEqual({ 'chat.pinned': T0 });
    // the earlier time wins when both sides know a topic
    expect(store().used['composer.voice']).toBe(T0);
    expect(store().settled).toBe(true);
    await vi.advanceTimersByTimeAsync(2000);
    const [endpoint, options] = api.call.mock.calls[1] as [
      { method: string },
      { body: Record<string, unknown> },
    ];
    expect(endpoint.method).toBe('PATCH');
    expect(Object.keys(options.body.used as object)).toContain('composer.voice');
  });

  it('works offline: keeps the changes and sends them when the server is back', async () => {
    api.call.mockRejectedValue(new Error('offline'));
    await store().loadFromServer();
    expect(store().settled).toBe(true);
    markUsed('chat.pinned');
    await vi.advanceTimersByTimeAsync(2000);
    expect(store().dirty).toBe(true);
    const saved = JSON.parse(localStorage.getItem(GUIDE_KEY) ?? '{}') as { used: object };
    expect(saved.used).toHaveProperty('chat.pinned');

    api.call.mockResolvedValue(serverState({ used: { 'chat.pinned': T1 }, version: 2 }));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(store().dirty).toBe(false);
    expect(store().version).toBe(2);
  });

  it('a reset reaches the server once and is not undone by the old server copy', async () => {
    markUsed('chat.pinned');
    store().reset();
    expect(store().used).toEqual({});
    api.call.mockResolvedValueOnce(serverState({ used: { 'chat.pinned': T0 }, version: 2 }));
    api.call.mockResolvedValue(serverState({ version: 3 }));
    await store().loadFromServer();
    expect(store().used).toEqual({});
    await vi.advanceTimersByTimeAsync(2000);
    const patch = api.call.mock.calls.find(([e]) => (e as { method: string }).method === 'PATCH');
    expect((patch?.[1] as { body: Record<string, unknown> }).body.reset).toBe(true);
    expect(store().pendingReset).toBe(false);
  });
});

describe('guide store: never annoying', () => {
  it('a feature that was used is never shown as a tip', () => {
    markUsed('composer.voice');
    store().requestTip('composer.voice');
    expect(store().queue).toEqual([]);
    store().requestTip('composer.gif');
    expect(store().queue).toEqual(['composer.gif']);
    markUsed('composer.gif');
    expect(store().queue).toEqual([]);
  });

  it('a tip that is already queued is dropped when its feature gets used', () => {
    store().requestTip('chat.pinned');
    markUsed('chat.pinned');
    tick(Date.now());
    expect(store().active).toBeNull();
  });

  it('shows one tip at a time, and a tip counts as seen as soon as it shows', () => {
    store().requestTip('composer.gif');
    store().requestTip('composer.poll');
    tick(Date.now());
    expect(store().active?.topicId).toBe('composer.gif');
    expect(store().seen).toHaveProperty('composer.gif');
    tick(Date.now() + TIP_COOLDOWN_MS * 2);
    expect(store().active?.topicId).toBe('composer.gif');
    // a seen tip is not queued again (not even after a reload)
    store().requestTip('composer.gif');
    expect(store().queue).toEqual(['composer.poll']);
  });

  it('waits a minute between tips', () => {
    store().requestTip('composer.gif');
    store().requestTip('composer.poll');
    const start = Date.now();
    tick(start);
    store().next(); // "Got it"
    expect(store().active).toBeNull();
    tick(start + TIP_COOLDOWN_MS - 1);
    expect(store().active).toBeNull();
    tick(start + TIP_COOLDOWN_MS + 1);
    expect(store().active?.topicId).toBe('composer.poll');
  });

  it('stays quiet while a dialog or call is in the way, or the person is typing', () => {
    store().requestTip('composer.gif');
    tick(Date.now(), { blocked: true });
    tick(Date.now(), { typing: true });
    expect(store().active).toBeNull();
    store().setHoldTips(true);
    tick(Date.now());
    expect(store().active).toBeNull();
    store().setHoldTips(false);
    tick(Date.now());
    expect(store().active?.topicId).toBe('composer.gif');
  });

  it('does nothing until the server has answered (so a known user is not shown a tour)', () => {
    useGuideStore.setState({ settled: false });
    store().requestTip('composer.gif');
    tick(Date.now());
    expect(store().active).toBeNull();
  });

  it('"Don\'t show tips" turns tips off and clears the queue', () => {
    store().requestTip('composer.gif');
    store().setEnabled(false);
    expect(store().queue).toEqual([]);
    store().requestTip('composer.poll');
    expect(store().queue).toEqual([]);
    store().setEnabled(true);
    store().requestTip('composer.poll');
    expect(store().queue).toEqual(['composer.poll']);
  });

  it('closing a tip (Esc or outside click) counts as seen', () => {
    store().requestTip('composer.gif');
    tick(Date.now());
    store().close();
    expect(store().active).toBeNull();
    expect(store().seen).toHaveProperty('composer.gif');
  });
});

describe('guide store: the welcome tour', () => {
  it('finishing marks it done; closing early marks it done but can be resumed', () => {
    store().startTopic('welcome');
    expect(store().active?.source).toBe('welcome');
    store().next();
    store().next();
    store().close();
    expect(store().welcomeDoneAt).not.toBeNull();
    expect(store().resumeStep).toBe(2);

    store().startTopic('welcome', { step: store().resumeStep ?? 0 });
    expect(store().active?.step).toBe(2);
    for (let i = 0; i < 20 && store().active; i++) store().next();
    expect(store().active).toBeNull();
    expect(store().resumeStep).toBeNull();
    expect(store().seen).toHaveProperty('welcome');
    // what the tour showed needs no tip later; what it did not show still does
    expect(store().seen).toHaveProperty('composer.attach');
    expect(store().seen).not.toHaveProperty('composer.gif');
  });

  it('Back goes to the step before, and not before the first', () => {
    store().startTopic('welcome');
    store().back();
    expect(store().active?.step).toBe(0);
    store().next();
    store().back();
    expect(store().active?.step).toBe(0);
  });

  it('replay shows a topic again even though it was seen', () => {
    store().requestTip('composer.gif');
    tick(Date.now());
    store().next();
    store().replay('composer.gif');
    expect(store().active).toMatchObject({ topicId: 'composer.gif', source: 'replay' });
  });
});
