/* eslint-disable @typescript-eslint/no-unsafe-member-access -- test responses are untyped JSON */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './support.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.stop();
});

const T1 = '2026-01-01T10:00:00.000Z';
const T2 = '2026-02-02T10:00:00.000Z';

describe('guide progress', () => {
  it('starts empty with the guide on', async () => {
    const me = await t.makeUser();
    const res = await t.call(me, 'GET', '/users/me/guide');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      seen: {},
      used: {},
      welcome_done_at: null,
      enabled: true,
      version: 0,
    });
  });

  it('PATCH adds topics and never removes or re-times them', async () => {
    const me = await t.makeUser();
    await t.call(me, 'PATCH', '/users/me/guide', { seen: { 'a.one': T1 } });
    const res = await t.call(me, 'PATCH', '/users/me/guide', {
      seen: { 'a.two': T2, 'a.one': T2 },
      used: { 'b.x': T2 },
    });
    expect(res.status).toBe(200);
    expect(res.body.seen).toEqual({ 'a.one': T1, 'a.two': T2 });
    expect(res.body.used).toEqual({ 'b.x': T2 });
    // an empty patch removes nothing
    const same = await t.call(me, 'PATCH', '/users/me/guide', {});
    expect(same.body.seen).toEqual({ 'a.one': T1, 'a.two': T2 });
    expect((await t.call(me, 'GET', '/users/me/guide')).body).toEqual(res.body);
  });

  it('the welcome time is set once; enabled can be switched', async () => {
    const me = await t.makeUser();
    await t.call(me, 'PATCH', '/users/me/guide', { welcome_done_at: T1 });
    const res = await t.call(me, 'PATCH', '/users/me/guide', {
      welcome_done_at: T2,
      enabled: false,
    });
    expect(res.body.welcome_done_at).toBe(T1);
    expect(res.body.enabled).toBe(false);
  });

  it('reset clears seen, used and the welcome time but keeps the switch', async () => {
    const me = await t.makeUser();
    await t.call(me, 'PATCH', '/users/me/guide', {
      seen: { 'a.one': T1 },
      used: { 'a.one': T1 },
      welcome_done_at: T1,
      enabled: false,
    });
    const res = await t.call(me, 'PATCH', '/users/me/guide', { reset: true });
    expect(res.body).toMatchObject({ seen: {}, used: {}, welcome_done_at: null, enabled: false });
    // reset together with new entries: cleared first, then added
    const both = await t.call(me, 'PATCH', '/users/me/guide', { reset: true, seen: { 'c.y': T2 } });
    expect(both.body.seen).toEqual({ 'c.y': T2 });
  });

  it('version goes up only when something changed', async () => {
    const me = await t.makeUser();
    const first = await t.call(me, 'PATCH', '/users/me/guide', { seen: { 'a.one': T1 } });
    const again = await t.call(me, 'PATCH', '/users/me/guide', { seen: { 'a.one': T1 } });
    expect(first.body.version).toBe(1);
    expect(again.body.version).toBe(1);
  });

  it('two devices saving at once keep both sets of topics', async () => {
    const me = await t.makeUser();
    await Promise.all([
      t.call(me, 'PATCH', '/users/me/guide', { seen: { 'phone.one': T1 } }),
      t.call(me, 'PATCH', '/users/me/guide', { seen: { 'laptop.one': T2 } }),
    ]);
    const res = await t.call(me, 'GET', '/users/me/guide');
    expect(Object.keys((res.body as { seen: object }).seen).sort()).toEqual([
      'laptop.one',
      'phone.one',
    ]);
  });

  it('refuses bad ids, bad times, too many topics and unknown reset values', async () => {
    const me = await t.makeUser();
    const bad = async (body: unknown) =>
      expect((await t.call(me, 'PATCH', '/users/me/guide', body)).status).toBe(400);
    await bad({ seen: { 'Bad Id': T1 } });
    await bad({ seen: { ['x'.repeat(65)]: T1 } });
    await bad({ seen: { '': T1 } });
    await bad({ seen: { ok: 'yesterday' } });
    await bad({ used: [] });
    await bad({ enabled: 'yes' });
    await bad({ reset: false });
    await bad({
      seen: Object.fromEntries(Array.from({ length: 201 }, (_, i) => [`t${i}`, T1])),
    });
    const full = await t.call(me, 'PATCH', '/users/me/guide', {
      seen: Object.fromEntries(Array.from({ length: 200 }, (_, i) => [`t${i}`, T1])),
    });
    expect(full.status).toBe(200);
    // the stored list stays capped at 200
    const more = await t.call(me, 'PATCH', '/users/me/guide', { seen: { extra: T1 } });
    expect(Object.keys((more.body as { seen: object }).seen)).toHaveLength(200);
  });

  it('nobody else can read or change yours; each user has their own', async () => {
    const me = await t.makeUser();
    const other = await t.makeUser();
    await t.call(me, 'PATCH', '/users/me/guide', { seen: { private: T1 } });
    expect((await t.call(other, 'GET', '/users/me/guide')).body.seen).toEqual({});
    await t.call(other, 'PATCH', '/users/me/guide', { reset: true });
    expect((await t.call(me, 'GET', '/users/me/guide')).body.seen).toEqual({ private: T1 });
  });
});
