// The small pure rules behind the guide: merging, where the card goes, and who counts as new.
import type { ConversationSummary } from '@chat/contracts';
import { describe, expect, it } from 'vitest';
import { makeConversation, makeMessage, ME } from '../../../test/fakes';
import { inferUsedTopics } from './inferUsed';
import { placeCard } from './placement';
import { cleanTimes, earliest, hasExtra, readStored, unionTimes } from './progress';
import { TIP_COOLDOWN_MS, isTipDue, nextTip, type SchedulerInput } from './scheduler';
import { isOnScreen } from './targets';
import { isNewAccount } from './welcomeRules';

const T0 = '2026-01-01T10:00:00.000Z';
const T1 = '2026-02-01T10:00:00.000Z';

describe('progress merging', () => {
  it('keeps everything from both sides and the earlier time', () => {
    expect(unionTimes({ a: T1, b: T0 }, { a: T0, c: T1 })).toEqual({ a: T0, b: T0, c: T1 });
    expect(earliest(null, T1)).toBe(T1);
    expect(earliest(T1, T0)).toBe(T0);
    expect(earliest(null, null)).toBeNull();
  });

  it('knows when one side has something the other lacks', () => {
    const base = { seen: {}, used: {}, welcomeDoneAt: null };
    expect(hasExtra({ ...base, seen: { a: T0 } }, base)).toBe(true);
    expect(hasExtra(base, { ...base, seen: { a: T0 } })).toBe(false);
    expect(hasExtra({ ...base, welcomeDoneAt: T0 }, base)).toBe(true);
  });

  it('drops bad ids and times, and caps the list at 200', () => {
    expect(cleanTimes({ ok: T0, 'Bad Id': T0, late: 'tomorrow' })).toEqual({ ok: T0 });
    expect(cleanTimes(null)).toEqual({});
    const many = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`t${i}`, T0]));
    expect(Object.keys(cleanTimes(many))).toHaveLength(200);
    expect(readStored('nonsense').enabled).toBe(true);
  });
});

describe('scheduler', () => {
  const ready: SchedulerInput = {
    queue: ['composer.gif'],
    seen: {},
    used: {},
    enabled: true,
    busy: false,
    blocked: false,
    typing: false,
    hold: false,
    now: 10 * TIP_COOLDOWN_MS,
    lastTipAt: 0,
  };

  it('picks the first tip that is still due', () => {
    expect(nextTip(ready)).toBe('composer.gif');
    expect(
      nextTip({ ...ready, queue: ['composer.gif', 'composer.poll'], seen: { 'composer.gif': T0 } }),
    ).toBe('composer.poll');
    expect(nextTip({ ...ready, used: { 'composer.gif': T0 } })).toBeNull();
  });

  it('waits for every reason to be quiet', () => {
    for (const quiet of [
      { enabled: false },
      { busy: true },
      { blocked: true },
      { typing: true },
      { hold: true },
      { lastTipAt: ready.now - 1000 },
    ]) {
      expect(nextTip({ ...ready, ...quiet }), JSON.stringify(quiet)).toBeNull();
    }
  });

  it('never treats the welcome tour or an unknown topic as a tip', () => {
    expect(isTipDue('welcome', {}, {})).toBe(false);
    expect(isTipDue('nope.nothing', {}, {})).toBe(false);
  });
});

describe('card placement', () => {
  const viewport = { width: 1000, height: 700 };
  const card = { width: 352, height: 200 };
  const safe = { top: 0, bottom: 0 };
  const box = (top: number) => ({ top, left: 100, width: 200, height: 50 });

  it('centres the card when there is no target', () => {
    expect(placeCard({ viewport, target: null, card, phone: false, safe })).toEqual({
      mode: 'centered',
    });
  });

  it('puts it below a target near the top and above one near the bottom', () => {
    const below = placeCard({ viewport, target: box(40), card, phone: false, safe });
    expect(below).toMatchObject({ mode: 'anchored' });
    expect((below as { top: number }).top).toBeGreaterThan(90);
    const above = placeCard({ viewport, target: box(600), card, phone: false, safe });
    expect((above as { top: number }).top).toBeLessThan(600);
  });

  it('keeps the card inside the window', () => {
    const right = placeCard({
      viewport,
      target: { top: 40, left: 960, width: 30, height: 30 },
      card,
      phone: false,
      safe,
    });
    expect((right as { left: number }).left + card.width).toBeLessThanOrEqual(viewport.width);
  });

  it('docks to the bottom on a phone, and to the top when the target is down there', () => {
    const phone = { width: 390, height: 780 };
    expect(placeCard({ viewport: phone, target: box(100), card, phone: true, safe })).toEqual({
      mode: 'docked',
      edge: 'bottom',
    });
    expect(placeCard({ viewport: phone, target: box(700), card, phone: true, safe })).toEqual({
      mode: 'docked',
      edge: 'top',
    });
  });

  it('knows when a box is outside the window', () => {
    expect(isOnScreen(box(40), viewport)).toBe(true);
    expect(isOnScreen(box(5000), viewport)).toBe(false);
    expect(isOnScreen({ top: -100, left: 0, width: 50, height: 50 }, viewport)).toBe(false);
  });
});

describe('who is new', () => {
  const now = Date.parse('2026-03-01T09:00:00.000Z');
  const withMessage = (over: Partial<ConversationSummary> = {}) =>
    makeConversation({ last_message: makeMessage(), ...over });

  it('a young account is new', () => {
    expect(isNewAccount('2026-03-01T01:00:00.000Z', [withMessage()], now)).toBe(true);
  });

  it('an older account with no real conversation is new too', () => {
    const saved = makeConversation({ is_saved: true, last_message: makeMessage() });
    expect(isNewAccount('2025-01-01T00:00:00.000Z', [saved], now)).toBe(true);
    expect(isNewAccount(undefined, [], now)).toBe(true);
  });

  it('an older account with a real conversation is not', () => {
    expect(isNewAccount('2025-01-01T00:00:00.000Z', [withMessage()], now)).toBe(false);
  });
});

describe('features already used', () => {
  it('are worked out from the chat list', () => {
    const mine = makeMessage({ sender_user_id: ME });
    const used = inferUsedTopics(
      [
        makeConversation({ id: 'g', type: 'group', last_message: mine }),
        makeConversation({ id: 's', is_saved: true, last_message: mine }),
      ],
      ME,
    );
    expect(used).toEqual(
      expect.arrayContaining(['group.create', 'composer.basics', 'saved.messages']),
    );
    expect(inferUsedTopics([], ME)).toEqual([]);
  });
});
