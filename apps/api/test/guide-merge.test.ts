import { describe, expect, it } from 'vitest';
import { mergeGuide } from '../src/modules/users/repo/guide.js';

const T0 = '2026-01-01T10:00:00.000Z';
const T1 = '2026-02-01T10:00:00.000Z';
const empty = { seen: {}, used: {}, welcome_done_at: null, enabled: true, version: 0 };

describe('mergeGuide (the rules of PATCH /users/me/guide)', () => {
  it('adds topics and keeps the first time of one it already has', () => {
    const first = mergeGuide(empty, { seen: { a: T0 } });
    expect(first).toMatchObject({ seen: { a: T0 }, version: 1 });
    const second = mergeGuide(first, { seen: { a: T1, b: T1 }, used: { c: T1 } });
    expect(second.seen).toEqual({ a: T0, b: T1 });
    expect(second.used).toEqual({ c: T1 });
    expect(second.version).toBe(2);
  });

  it('never removes anything without reset', () => {
    const state = mergeGuide(empty, { seen: { a: T0 }, used: { b: T0 }, welcome_done_at: T0 });
    const next = mergeGuide(state, { seen: {}, used: {}, enabled: false });
    expect(next.seen).toEqual({ a: T0 });
    expect(next.used).toEqual({ b: T0 });
    expect(next.welcome_done_at).toBe(T0);
    expect(next.enabled).toBe(false);
  });

  it('sets the welcome time once', () => {
    const done = mergeGuide(empty, { welcome_done_at: T1 });
    expect(mergeGuide(done, { welcome_done_at: T0 }).welcome_done_at).toBe(T1);
  });

  it('a change that changes nothing does not count as a new version', () => {
    const state = mergeGuide(empty, { seen: { a: T0 } });
    expect(mergeGuide(state, { seen: { a: T1 } }).version).toBe(state.version);
  });

  it('reset clears seen, used and the welcome time, and keeps the switch', () => {
    const state = mergeGuide(empty, { seen: { a: T0 }, used: { b: T0 }, welcome_done_at: T0 });
    const off = mergeGuide(state, { enabled: false });
    const reset = mergeGuide(off, { reset: true });
    expect(reset).toMatchObject({ seen: {}, used: {}, welcome_done_at: null, enabled: false });
    // the other fields of the same request are applied after the clearing
    expect(mergeGuide(off, { reset: true, seen: { z: T1 } }).seen).toEqual({ z: T1 });
  });

  it('stops at 200 topics in a list', () => {
    const many = Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`t${i}`, T0]));
    const full = mergeGuide(empty, { seen: many });
    expect(Object.keys(mergeGuide(full, { seen: { extra: T0 } }).seen)).toHaveLength(200);
  });
});
