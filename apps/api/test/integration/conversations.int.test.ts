/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call -- test responses are untyped JSON */
import { allocateSeqAndInsertMessage } from '@chat/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './support.js';

// Needs the test Postgres (DATABASE_URL). Each run gets its own throwaway database.
let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.stop();
});

/** A group owned by a new user, with the given number of plain members. */
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

const roleOf = async (id: string, userId: string) =>
  (
    await t.db
      .selectFrom('conversation_members')
      .select('role')
      .where('conversation_id', '=', id)
      .where('user_id', '=', userId)
      .where('left_at', 'is', null)
      .executeTakeFirst()
  )?.role;

describe('direct chats', () => {
  it('returns the same chat for both users, and refuses a blocked pair either way', async () => {
    const [a, b, c] = [await t.makeUser(), await t.makeUser(), await t.makeUser()];
    const first = await t.call(a, 'POST', '/conversations/direct', { user_id: b });
    const second = await t.call(b, 'POST', '/conversations/direct', { user_id: a });
    expect(first.status).toBe(200);
    expect(second.body.id).toBe(first.body.id);
    expect(first.body.peer.id).toBe(b);

    await t.db.insertInto('blocks').values({ blocker_id: c, blocked_id: a }).execute();
    for (const [from, to] of [
      [a, c],
      [c, a],
    ] as const) {
      const res = await t.call(from, 'POST', '/conversations/direct', { user_id: to });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('BLOCKED');
    }
  });
});

describe('role matrix', () => {
  it('a member cannot remove anyone; an admin cannot demote the owner', async () => {
    const g = await group(3);
    const [admin, m1, m2] = g.members as [string, string, string];
    const base = `/conversations/${g.id}/members`;
    expect((await t.call(g.owner, 'PATCH', `${base}/${admin}`, { role: 'admin' })).status).toBe(
      200,
    );

    expect((await t.call(m1, 'DELETE', `${base}/${m2}`)).status).toBe(403);
    expect((await t.call(admin, 'PATCH', `${base}/${g.owner}`, { role: 'member' })).status).toBe(
      403,
    );
    expect((await t.call(admin, 'DELETE', `${base}/${g.owner}`)).status).toBe(403);
    expect(await roleOf(g.id, g.owner)).toBe('owner');

    expect((await t.call(admin, 'DELETE', `${base}/${m2}`)).status).toBe(204);
    expect(await roleOf(g.id, m2)).toBeUndefined();
  });

  it('only admins change group settings', async () => {
    const g = await group(1);
    const body = { settings: { only_admins_send: true, disappearing_timer_s: 86_400 } };
    expect((await t.call(g.members[0]!, 'PATCH', `/conversations/${g.id}`, body)).status).toBe(403);
    const ok = await t.call(g.owner, 'PATCH', `/conversations/${g.id}`, body);
    expect(ok.status).toBe(200);
    expect(ok.body.settings).toMatchObject({
      only_admins_send: true,
      disappearing_timer_s: 86_400,
    });
  });
});

describe('ownership transfer', () => {
  it('goes to the oldest admin, otherwise the oldest member', async () => {
    const g = await group(3);
    const [m1, m2, m3] = g.members as [string, string, string];
    const setJoined = (user: string, day: number) =>
      t.db
        .updateTable('conversation_members')
        .set({ joined_at: new Date(2026, 0, day) })
        .where('conversation_id', '=', g.id)
        .where('user_id', '=', user)
        .execute();
    await setJoined(m1, 3);
    await setJoined(m2, 2);
    await setJoined(m3, 1); // the oldest member, but not an admin
    await t.db
      .updateTable('conversation_members')
      .set({ role: 'admin' })
      .where('conversation_id', '=', g.id)
      .where('user_id', 'in', [m1, m2])
      .execute();

    expect((await t.call(g.owner, 'POST', `/conversations/${g.id}/leave`)).status).toBe(204);
    expect(await roleOf(g.id, m2)).toBe('owner'); // the oldest admin
    expect(await roleOf(g.id, g.owner)).toBeUndefined();

    await t.call(m2, 'POST', `/conversations/${g.id}/leave`);
    expect(await roleOf(g.id, m1)).toBe('owner'); // the only admin left
    await t.call(m1, 'POST', `/conversations/${g.id}/leave`);
    expect(await roleOf(g.id, m3)).toBe('owner'); // no admins: the oldest member
  });
});

describe('a removed member loses access at once', () => {
  it('gets 404 on the conversation, members and mentions, and cannot send', async () => {
    const g = await group(2);
    const [kept, removed] = g.members as [string, string];
    expect((await t.call(removed, 'GET', `/conversations/${g.id}`)).status).toBe(200);

    const del = await t.call(g.owner, 'DELETE', `/conversations/${g.id}/members/${removed}`);
    expect(del.status).toBe(204);

    for (const path of ['', '/members', '/mention-candidates']) {
      expect((await t.call(removed, 'GET', `/conversations/${g.id}${path}`)).status).toBe(404);
    }
    const list = await t.call(removed, 'GET', '/conversations');
    expect(list.body.items.map((c: { id: string }) => c.id)).not.toContain(g.id);
    expect((await t.call(kept, 'GET', `/conversations/${g.id}`)).status).toBe(200);

    // The message path checks membership in the database too.
    const device = await t.db
      .insertInto('devices')
      .values({ user_id: removed, name: 'd' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await expect(
      allocateSeqAndInsertMessage(t.db, {
        conversationId: g.id,
        senderId: removed,
        senderDeviceId: device.id,
        clientMessageId: crypto.randomUUID(),
        type: 'text',
        bodyText: 'hi',
      }),
    ).rejects.toMatchObject({ code: 'not_a_member' });
  });
});

describe('chat prefs and the chat list', () => {
  it('limits pinned chats to 3', async () => {
    const me = await t.makeUser();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const other = await t.makeUser();
      ids.push((await t.call(me, 'POST', '/conversations/direct', { user_id: other })).body.id);
    }
    const pin = (i: number, pinned: boolean) =>
      t.call(me, 'PATCH', `/conversations/${ids[i]}/prefs`, { pinned });
    for (const i of [0, 1, 2]) expect((await pin(i, true)).status).toBe(200);
    expect((await pin(3, true)).status).toBe(409);
    expect((await pin(0, true)).status).toBe(200); // already pinned is fine
    await pin(0, false);
    expect((await pin(3, true)).status).toBe(200); // a slot is free again
  });

  it('lists last message, unread count and prefs per user', async () => {
    const g = await group(1);
    const member = g.members[0]!;
    await t.call(member, 'PATCH', `/conversations/${g.id}/prefs`, {
      favorite: true,
      wallpaper: 'ocean',
      muted_until: '2099-01-01T00:00:00.000Z',
      locked: true,
      lock_hash: 'x'.repeat(32),
    });
    const list = await t.call(member, 'GET', '/conversations');
    const item = list.body.items.find((c: { id: string }) => c.id === g.id);
    expect(item.prefs).toMatchObject({
      favorite: true,
      wallpaper: 'ocean',
      locked: true,
      archived: false,
      pinned: false,
    });
    expect(item.my_role).toBe('member');
    expect(item.last_message.content.event).toBe('group_created');
    expect(item.unread_count).toBe(1); // the "group created" system message
    expect(item.member_count).toBe(2);

    const ownerView = (await t.call(g.owner, 'GET', `/conversations/${g.id}`)).body;
    expect(ownerView.prefs.favorite).toBe(false); // prefs are per user
    const lockWithoutHash = await t.call(g.owner, 'PATCH', `/conversations/${g.id}/prefs`, {
      locked: true,
    });
    expect(lockWithoutHash.status).toBe(400);
    expect(
      (await t.call(member, 'GET', '/conversations?filter=favorites')).body.items,
    ).toHaveLength(1);
    expect((await t.call(member, 'GET', '/conversations?filter=archived')).body.items).toHaveLength(
      0,
    );
  });

  it('suggests members for @mentions', async () => {
    const g = await group(2);
    const res = await t.call(g.owner, 'GET', `/conversations/${g.id}/mention-candidates?q=user_`);
    const ids = res.body.items.map((u: { id: string }) => u.id) as string[];
    expect([...ids].sort()).toEqual([...g.members].sort());
  });
});

describe('invite links', () => {
  it('create, preview, join, max uses, revoke', async () => {
    const g = await group(1);
    const [a, b, c] = [await t.makeUser(), await t.makeUser(), await t.makeUser()];
    const invitesPath = `/conversations/${g.id}/invites`;
    expect((await t.call(g.members[0]!, 'POST', invitesPath, {})).status).toBe(403);

    const invite = await t.call(g.owner, 'POST', invitesPath, { max_uses: 2 });
    expect(invite.status).toBe(201);
    const code = invite.body.code as string;
    const row = await t.db
      .selectFrom('invite_links')
      .selectAll()
      .where('conversation_id', '=', g.id)
      .executeTakeFirstOrThrow();
    expect(row.token_hash.toString('base64url')).not.toBe(code); // only the hash is stored

    const preview = await t.call(a, 'GET', `/invites/${code}`);
    expect(preview.body).toMatchObject({ conversation_id: g.id, title: 'Team', member_count: 2 });
    expect((await t.call(a, 'POST', `/invites/${code}/join`)).body.status).toBe('joined');
    expect((await t.call(a, 'POST', `/invites/${code}/join`)).body.status).toBe('joined'); // free
    expect((await t.call(b, 'POST', `/invites/${code}/join`)).body.status).toBe('joined');
    const used = await t.call(c, 'POST', `/invites/${code}/join`);
    expect(used.status).toBe(404);
    expect(used.body.error.code).toBe('INVITE_INVALID');

    const fresh = (await t.call(g.owner, 'POST', invitesPath, {})).body.code as string;
    expect((await t.call(a, 'DELETE', `/invites/${fresh}`)).status).toBe(403);
    expect((await t.call(g.owner, 'DELETE', `/invites/${fresh}`)).status).toBe(204);
    expect((await t.call(c, 'POST', `/invites/${fresh}/join`)).status).toBe(404);
  });

  it('with approval, joining makes a request that an admin approves or rejects', async () => {
    const g = await group(1);
    const [yes, no] = [await t.makeUser(), await t.makeUser()];
    const conv = `/conversations/${g.id}`;
    await t.call(g.owner, 'PATCH', conv, { settings: { approval_required: true } });
    const code = (await t.call(g.owner, 'POST', `${conv}/invites`, {})).body.code as string;

    for (const user of [yes, no]) {
      expect((await t.call(user, 'POST', `/invites/${code}/join`)).body.status).toBe('requested');
      expect((await t.call(user, 'GET', conv)).status).toBe(404); // not in yet
    }
    expect((await t.call(g.members[0]!, 'GET', `${conv}/join-requests`)).status).toBe(403);
    const pending = (await t.call(g.owner, 'GET', `${conv}/join-requests`)).body.items as {
      id: string;
      user: { id: string };
    }[];
    expect(pending).toHaveLength(2);

    const idOf = (user: string) => pending.find((r) => r.user.id === user)!.id;
    const decide = (user: string, approve: boolean) =>
      t.call(g.owner, 'POST', `${conv}/join-requests/${idOf(user)}`, { approve });
    expect((await decide(yes, true)).status).toBe(204);
    expect((await decide(no, false)).status).toBe(204);

    expect((await t.call(yes, 'GET', conv)).status).toBe(200);
    expect((await t.call(no, 'GET', conv)).status).toBe(404);
    expect((await t.call(g.owner, 'GET', `${conv}/join-requests`)).body.items).toHaveLength(0);
  });
});

describe('membership change + system message + event are one transaction', () => {
  const state = async (id: string) => ({
    last_seq: (
      await t.db
        .selectFrom('conversations')
        .select('last_seq')
        .where('id', '=', id)
        .executeTakeFirstOrThrow()
    ).last_seq,
    members: Number(
      (
        await t.db
          .selectFrom('conversation_members')
          .select((eb) => eb.fn.countAll().as('n'))
          .where('conversation_id', '=', id)
          .where('left_at', 'is', null)
          .executeTakeFirstOrThrow()
      ).n,
    ),
    events: Number(
      (
        await t.db
          .selectFrom('outbox')
          .select((eb) => eb.fn.countAll().as('n'))
          .where('partition_key', '=', id)
          .where('topic', '=', 'chat.conversation.v1')
          .executeTakeFirstOrThrow()
      ).n,
    ),
  });

  it('commits together', async () => {
    const g = await group(1);
    const before = await state(g.id);
    const newcomer = await t.makeUser();
    const res = await t.call(g.owner, 'POST', `/conversations/${g.id}/members`, {
      user_ids: [newcomer],
    });
    expect(res.body.added).toEqual([newcomer]);

    expect(await state(g.id)).toEqual({
      last_seq: before.last_seq + 1,
      members: before.members + 1,
      events: before.events + 1,
    });
    const msg = await t.db
      .selectFrom('messages')
      .selectAll()
      .where('conversation_id', '=', g.id)
      .where('seq', '=', before.last_seq + 1)
      .executeTakeFirstOrThrow();
    expect(msg).toMatchObject({
      type: 'system',
      sender_id: null,
      content: { event: 'member_added', target_user_ids: [newcomer] },
    });
    const outbox = await t.db
      .selectFrom('outbox')
      .select('payload')
      .where('partition_key', '=', g.id)
      .where('topic', '=', 'chat.message.v1')
      .execute();
    // The system message flows through the outbox like any message.
    expect(outbox.some((o) => o.payload.message_id === msg.id)).toBe(true);
  });

  it('rolls back together when a later step fails', async () => {
    const g = await group(1);
    const newcomer = await t.makeUser();
    const before = await state(g.id);

    await sql`CREATE FUNCTION fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'boom'; END $$`.execute(
      t.db,
    );
    await sql`CREATE TRIGGER fail_event BEFORE INSERT ON outbox FOR EACH ROW WHEN (NEW.topic = 'chat.conversation.v1') EXECUTE FUNCTION fail_event()`.execute(
      t.db,
    );
    try {
      const res = await t.call(g.owner, 'POST', `/conversations/${g.id}/members`, {
        user_ids: [newcomer],
      });
      expect(res.status).toBe(500);
    } finally {
      await sql`DROP TRIGGER fail_event ON outbox`.execute(t.db);
    }

    // No new member, no system message (last_seq unchanged), no event.
    expect(await state(g.id)).toEqual(before);
    expect(await roleOf(g.id, newcomer)).toBeUndefined();
  });
});
