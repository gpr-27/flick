import { describe, expect, it } from 'vitest';
import { BOB, ME, makeMessage } from '../../../test/fakes';
import { MAX_LIVE_AGE_MS, canPlaySound, excerptOf, mentionsUser, shouldNotify } from './rules';

const NOW = Date.parse('2026-01-01T12:00:30Z');
const fresh = (over = {}) =>
  makeMessage({ created_at: new Date(NOW - 1000).toISOString(), ...over });
const base = { myId: ME, mutedUntil: null, tabHidden: true, now: NOW };
const inAnHour = new Date(NOW + 3_600_000).toISOString();

describe('shouldNotify', () => {
  it('notifies for a fresh message from someone else while the tab is hidden', () => {
    expect(shouldNotify({ ...base, message: fresh() })).toBe(true);
  });

  it('stays quiet when the tab is visible, or the message is mine, deleted or stale', () => {
    expect(shouldNotify({ ...base, message: fresh(), tabHidden: false })).toBe(false);
    expect(shouldNotify({ ...base, message: fresh({ sender_user_id: ME }) })).toBe(false);
    const deleted = fresh({ deleted_at: '2026-01-01T12:00:00Z' });
    expect(shouldNotify({ ...base, message: deleted })).toBe(false);
    const old = makeMessage({ created_at: new Date(NOW - MAX_LIVE_AGE_MS - 1).toISOString() });
    expect(shouldNotify({ ...base, message: old })).toBe(false);
  });

  it('never notifies for a muted chat...', () => {
    expect(shouldNotify({ ...base, mutedUntil: inAnHour, message: fresh() })).toBe(false);
  });

  it('...unless the message mentions me', () => {
    const mention = fresh({ content: { type: 'text', text: 'hey', mentions: [ME] } });
    expect(shouldNotify({ ...base, mutedUntil: inAnHour, message: mention })).toBe(true);
    const other = fresh({ content: { type: 'text', text: 'hey', mentions: [BOB] } });
    expect(shouldNotify({ ...base, mutedUntil: inAnHour, message: other })).toBe(false);
  });

  it('an expired mute no longer counts', () => {
    const mutedUntil = new Date(NOW - 1).toISOString();
    expect(shouldNotify({ ...base, mutedUntil, message: fresh() })).toBe(true);
  });
});

describe('mentionsUser', () => {
  it('is false for null content and content without mentions', () => {
    expect(mentionsUser(null, ME)).toBe(false);
    expect(mentionsUser({ type: 'text', text: 'hi' }, ME)).toBe(false);
  });
});

describe('canPlaySound', () => {
  it('allows the first sound, then at most one per second', () => {
    expect(canPlaySound(null, 5000)).toBe(true);
    expect(canPlaySound(5000, 5500)).toBe(false);
    expect(canPlaySound(5000, 5999)).toBe(false);
    expect(canPlaySound(5000, 6000)).toBe(true);
  });
});

describe('excerptOf', () => {
  it('shortens long text', () => {
    expect(excerptOf({ type: 'text', text: 'x'.repeat(300) })).toHaveLength(100);
    expect(excerptOf({ type: 'text', text: 'hi' })).toBe('hi');
  });
});
