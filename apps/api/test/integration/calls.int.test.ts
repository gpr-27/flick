/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- test responses are untyped JSON */
import { TokenVerifier } from 'livekit-server-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { joinGroupCall } from '../../src/modules/calls/repo/group-call.js';
import { recordCall } from '../../src/modules/calls/repo/call-log.js';
import { startTestApp } from './support.js';

// No LiveKit server is involved: tokens are signed locally, and checked here with the same secret.
process.env.LIVEKIT_URL = 'wss://livekit.test';
process.env.LIVEKIT_API_KEY = 'test-key';
process.env.LIVEKIT_API_SECRET = 'test-secret-that-is-long-enough-for-hs256';

let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.stop();
});

async function group(memberCount = 2) {
  const owner = await t.makeUser();
  const members: string[] = [];
  for (let i = 0; i < memberCount; i++) members.push(await t.makeUser());
  const res = await t.call(owner, 'POST', '/conversations/group', {
    title: 'Team',
    member_ids: members,
  });
  expect(res.status).toBe(201);
  return { owner, members, id: res.body.id as string };
}

const callEvents = (conversationId: string) =>
  t.db
    .selectFrom('messages')
    .select(['content', 'sender_id'])
    .where('conversation_id', '=', conversationId)
    .where('type', '=', 'call_event')
    .execute();

describe('group calls', () => {
  it('gives a member a token for that room only, and announces the call once', async () => {
    const g = await group();
    const res = await t.call(g.members[0]!, 'POST', '/calls/livekit-token', {
      conversation_id: g.id,
    });
    expect(res.status).toBe(200);
    expect(res.body.url).toBe('wss://livekit.test');

    const claims = await new TokenVerifier(
      'test-key',
      'test-secret-that-is-long-enough-for-hs256',
    ).verify(res.body.token);
    expect(claims.sub).toBe(g.members[0]);
    expect(claims.video).toMatchObject({
      room: `group-${g.id}`,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
    });
    expect(claims.video?.roomAdmin).toBeFalsy();

    // A second person joining the running call does not post a second message.
    await t.call(g.owner, 'POST', '/calls/livekit-token', { conversation_id: g.id });
    const events = await callEvents(g.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sender_id: g.members[0],
      content: { outcome: 'started', group: true },
    });
  });

  it('refuses a non-member, a former member and a direct chat, and writes nothing', async () => {
    const g = await group();
    const outsider = await t.makeUser();
    const res = await t.call(outsider, 'POST', '/calls/livekit-token', { conversation_id: g.id });
    expect(res.status).toBe(404);
    expect(res.body.token).toBeUndefined();

    await t.db
      .updateTable('conversation_members')
      .set({ left_at: new Date() })
      .where('conversation_id', '=', g.id)
      .where('user_id', '=', g.members[1]!)
      .execute();
    expect(
      (await t.call(g.members[1]!, 'POST', '/calls/livekit-token', { conversation_id: g.id }))
        .status,
    ).toBe(404);

    const direct = await t.call(g.owner, 'POST', '/conversations/direct', { user_id: outsider });
    expect(
      (await t.call(g.owner, 'POST', '/calls/livekit-token', { conversation_id: direct.body.id }))
        .status,
    ).toBe(400);
    expect(await callEvents(g.id)).toHaveLength(0);
  });

  it('commits the "started" message with the token, or not at all', async () => {
    const g = await group();
    const config = loadConfig({
      ...process.env,
      DATABASE_URL: 'postgres://x@h/db',
      REDIS_URL: 'redis://h',
    });
    const failing = () => Promise.reject(new Error('signing failed'));
    await expect(joinGroupCall(t.db, config, g.owner, g.id, 'video', failing)).rejects.toThrow(
      'signing failed',
    );
    expect(await callEvents(g.id)).toHaveLength(0);
    const conv = await t.db
      .selectFrom('conversations')
      .select('last_seq')
      .where('id', '=', g.id)
      .executeTakeFirstOrThrow();
    const before = conv.last_seq;

    await joinGroupCall(t.db, config, g.owner, g.id, 'video');
    expect(await callEvents(g.id)).toHaveLength(1);
    const after = await t.db
      .selectFrom('conversations')
      .select('last_seq')
      .where('id', '=', g.id)
      .executeTakeFirstOrThrow();
    expect(after.last_seq).toBe(before + 1); // no gap left by the failed attempt
  });

  it('answers FEATURE_DISABLED and names the variable when LiveKit is not configured', async () => {
    const g = await group();
    const config = loadConfig({
      ...process.env,
      LIVEKIT_URL: undefined,
      DATABASE_URL: 'postgres://x@h/db',
      REDIS_URL: 'redis://h',
    });
    await expect(joinGroupCall(t.db, config, g.owner, g.id, 'audio')).rejects.toMatchObject({
      code: 'FEATURE_DISABLED',
      message: expect.stringContaining('LIVEKIT_URL'),
    });
  });
});

describe('call links', () => {
  const makeLink = async (body: Record<string, unknown> = {}) => {
    const g = await group();
    const res = await t.call(g.owner, 'POST', '/calls/links', {
      conversation_id: g.id,
      media: 'video',
      ...body,
    });
    return { g, res };
  };

  it('lets an admin create a link; a plain member cannot', async () => {
    const { g, res } = await makeLink();
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(/^[A-Za-z0-9_-]{10,32}$/);

    const denied = await t.call(g.members[0]!, 'POST', '/calls/links', {
      conversation_id: g.id,
      media: 'audio',
    });
    expect(denied.status).toBe(403);

    // The raw code is not stored.
    const rows = await t.db
      .selectFrom('call_links')
      .selectAll()
      .where('conversation_id', '=', g.id)
      .execute();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.token_hash.toString('utf8')).not.toContain(res.body.code);
  });

  it('gives a signed-in outsider a token for the room without making them a member', async () => {
    const { g, res } = await makeLink();
    const guest = await t.makeUser();
    expect((await t.call(guest, 'GET', `/calls/links/${res.body.code}`)).body.conversation_id).toBe(
      g.id,
    );

    const joined = await t.call(guest, 'POST', '/calls/livekit-token', {
      call_link: res.body.code,
    });
    expect(joined.status).toBe(200);
    const claims = await new TokenVerifier(
      'test-key',
      'test-secret-that-is-long-enough-for-hs256',
    ).verify(joined.body.token);
    expect(claims.sub).toBe(guest);
    expect(claims.video?.room).toBe(`group-${g.id}`);

    const member = await t.db
      .selectFrom('conversation_members')
      .select('user_id')
      .where('conversation_id', '=', g.id)
      .where('user_id', '=', guest)
      .executeTakeFirst();
    expect(member).toBeUndefined();
    // and the guest still cannot read the conversation
    expect((await t.call(guest, 'GET', `/conversations/${g.id}`)).status).toBe(404);
  });

  it('stops at max uses', async () => {
    const { res } = await makeLink({ max_uses: 2 });
    const [a, b, c] = [await t.makeUser(), await t.makeUser(), await t.makeUser()];
    for (const user of [a, b]) {
      expect(
        (await t.call(user, 'POST', '/calls/livekit-token', { call_link: res.body.code })).status,
      ).toBe(200);
    }
    const third = await t.call(c, 'POST', '/calls/livekit-token', { call_link: res.body.code });
    expect(third.status).toBe(404);
    expect(third.body.error.code).toBe('INVITE_INVALID');
  });

  it('stops after it expires', async () => {
    const { g, res } = await makeLink();
    await t.db
      .updateTable('call_links')
      .set({ expires_at: new Date(Date.now() - 1000) })
      .where('conversation_id', '=', g.id)
      .execute();
    const guest = await t.makeUser();
    expect((await t.call(guest, 'GET', `/calls/links/${res.body.code}`)).status).toBe(404);
    expect(
      (await t.call(guest, 'POST', '/calls/livekit-token', { call_link: res.body.code })).status,
    ).toBe(404);
  });

  it('can be revoked by its creator only', async () => {
    const { g, res } = await makeLink();
    const guest = await t.makeUser();
    expect((await t.call(guest, 'DELETE', `/calls/links/${res.body.code}`)).status).toBe(404);
    expect((await t.call(g.owner, 'DELETE', `/calls/links/${res.body.code}`)).status).toBe(204);
    expect(
      (await t.call(guest, 'POST', '/calls/livekit-token', { call_link: res.body.code })).status,
    ).toBe(404);
  });
});

describe('call log', () => {
  async function directCall(outcome: 'missed' | 'rejected' | 'completed', startedAt: Date) {
    const [a, b] = [await t.makeUser(), await t.makeUser()];
    const conv = await t.call(a, 'POST', '/conversations/direct', { user_id: b });
    const callId = crypto.randomUUID();
    await recordCall(t.db, {
      callId,
      conversationId: conv.body.id,
      callerId: a,
      media: 'video',
      outcome,
      startedAt,
      answeredAt: outcome === 'completed' ? new Date(startedAt.getTime() + 2000) : null,
      endedAt: new Date(startedAt.getTime() + 65_000),
    });
    return { a, b, callId, conversationId: conv.body.id as string };
  }

  it('shows the call to both participants, with direction and duration, and to nobody else', async () => {
    const c = await directCall('completed', new Date());
    const caller = await t.call(c.a, 'GET', '/calls');
    expect(caller.body.items).toEqual([
      expect.objectContaining({
        call_id: c.callId,
        direction: 'outgoing',
        outcome: 'ended',
        media: 'video',
        group: false,
        duration_s: 63,
        conversation_id: c.conversationId,
      }),
    ]);
    expect(caller.body.items[0].participant_ids.sort()).toEqual([c.a, c.b].sort());

    const callee = await t.call(c.b, 'GET', '/calls');
    expect(callee.body.items[0]).toMatchObject({ direction: 'incoming', call_id: c.callId });

    const stranger = await t.makeUser();
    expect((await t.call(stranger, 'GET', '/calls')).body.items).toEqual([]);
  });

  it('writes one call_event message, and recording the same call twice changes nothing', async () => {
    const c = await directCall('rejected', new Date());
    await recordCall(t.db, {
      callId: c.callId,
      conversationId: c.conversationId,
      callerId: c.a,
      media: 'video',
      outcome: 'rejected',
      startedAt: new Date(),
      answeredAt: null,
      endedAt: new Date(),
    });
    const events = await callEvents(c.conversationId);
    expect(events).toHaveLength(1);
    expect(events[0]!.content).toMatchObject({ outcome: 'declined', duration_s: 0 });
    expect((await t.call(c.b, 'GET', '/calls')).body.items[0].outcome).toBe('declined');
  });

  it('pages with a keyset cursor, newest first', async () => {
    const a = await t.makeUser();
    const b = await t.makeUser();
    const conv = await t.call(a, 'POST', '/conversations/direct', { user_id: b });
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const callId = crypto.randomUUID();
      ids.unshift(callId); // newest first
      await recordCall(t.db, {
        callId,
        conversationId: conv.body.id,
        callerId: a,
        media: 'audio',
        outcome: 'missed',
        startedAt: new Date(Date.now() - (3 - i) * 60_000),
        answeredAt: null,
        endedAt: new Date(),
      });
    }
    const first = await t.call(a, 'GET', '/calls?limit=2');
    expect(first.body.items.map((i: { call_id: string }) => i.call_id)).toEqual(ids.slice(0, 2));
    const second = await t.call(a, 'GET', `/calls?limit=2&cursor=${first.body.next_cursor}`);
    expect(second.body.items.map((i: { call_id: string }) => i.call_id)).toEqual(ids.slice(2));
    expect(second.body.next_cursor).toBeNull();
  });
});
