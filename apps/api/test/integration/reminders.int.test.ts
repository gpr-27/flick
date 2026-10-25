/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument -- test responses are untyped JSON */
/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call -- test responses are untyped JSON */
import { randomUUID } from 'node:crypto';
import { LIMITS } from '@chat/contracts';
import { allocateSeqAndInsertMessage } from '@chat/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './support.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.stop();
});

const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

/** A direct chat between two new people with one message from the first. */
async function chatWithMessage() {
  const me = await t.makeUser();
  const friend = await t.makeUser();
  const conv = (await t.call(me, 'POST', '/conversations/direct', { user_id: friend })).body.id;
  const sent = await allocateSeqAndInsertMessage(t.db, {
    conversationId: conv,
    senderId: friend,
    senderDeviceId: null,
    clientMessageId: null,
    type: 'text',
    bodyText: 'bring the passport on Friday',
  });
  return { me, friend, conv: conv as string, messageId: sent.message.id };
}

describe('reminders', () => {
  it('creates a reminder about a message; the list reads the quote live and stores no text', async () => {
    const { me, conv, messageId } = await chatWithMessage();
    const created = await t.call(me, 'POST', '/reminders', {
      message_id: messageId,
      remind_at: inMinutes(60),
      note: '  pack it  ',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      conversation_id: conv,
      message_id: messageId,
      note: 'pack it',
      status: 'pending',
      quote: 'bring the passport on Friday',
      author_name: 'User 2',
      message_gone: false,
    });
    expect(created.body.chat_name).toEqual(expect.any(String));

    // Only ids and the note are stored: the message text is read when needed.
    const row = await t.db
      .selectFrom('reminders')
      .selectAll()
      .where('id', '=', created.body.id)
      .executeTakeFirstOrThrow();
    expect(JSON.stringify(row)).not.toContain('passport');

    const list = await t.call(me, 'GET', '/reminders');
    expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([created.body.id]);
    expect(list.body.next_cursor).toBeNull();
  });

  it('creates a reminder about a whole chat', async () => {
    const { me, conv } = await chatWithMessage();
    const created = await t.call(me, 'POST', '/reminders', {
      conversation_id: conv,
      remind_at: inMinutes(5),
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      message_id: null,
      note: null,
      quote: null,
      message_gone: false,
    });
  });

  it('the list shows a deleted or hidden message as gone', async () => {
    const { me, messageId } = await chatWithMessage();
    const made = await t.call(me, 'POST', '/reminders', {
      message_id: messageId,
      remind_at: inMinutes(5),
    });
    await t.db
      .insertInto('hidden_messages')
      .values({ user_id: me, message_id: messageId })
      .execute();
    const list = await t.call(me, 'GET', '/reminders');
    expect(list.body.items[0]).toMatchObject({ id: made.body.id, quote: null, message_gone: true });

    // And a message that is hidden or deleted cannot get a new reminder.
    const again = await t.call(me, 'POST', '/reminders', {
      message_id: messageId,
      remind_at: inMinutes(5),
    });
    expect(again.status).toBe(404);
  });

  it('validates the time, the note and the target', async () => {
    const { me, conv, messageId } = await chatWithMessage();
    const post = (body: object) => t.call(me, 'POST', '/reminders', body);
    const tooFar = LIMITS.REMINDER_MAX_LEAD_S / 60 + 5;
    expect((await post({ conversation_id: conv, remind_at: inMinutes(0) })).status).toBe(400);
    expect((await post({ conversation_id: conv, remind_at: inMinutes(tooFar) })).status).toBe(400);
    expect((await post({ conversation_id: conv, remind_at: 'tomorrow' })).status).toBe(400);
    expect((await post({ remind_at: inMinutes(5) })).status).toBe(400); // no target
    expect(
      (
        await post({
          message_id: messageId,
          remind_at: inMinutes(5),
          note: 'x'.repeat(LIMITS.MAX_REMINDER_NOTE_LENGTH + 1),
        })
      ).status,
    ).toBe(400);
    expect(
      (await post({ message_id: messageId, remind_at: inMinutes(5), note: 'x'.repeat(200) }))
        .status,
    ).toBe(201);
    // Exactly the edges are fine: a bit over a minute, and just under a year.
    expect((await post({ conversation_id: conv, remind_at: inMinutes(2) })).status).toBe(201);
    expect((await post({ conversation_id: conv, remind_at: inMinutes(tooFar - 10) })).status).toBe(
      201,
    );
  });

  it('a non-member, and a message from another chat, get 404', async () => {
    const a = await chatWithMessage();
    const b = await chatWithMessage();
    const body = { remind_at: inMinutes(5) };
    expect(
      (await t.call(b.me, 'POST', '/reminders', { ...body, conversation_id: a.conv })).status,
    ).toBe(404);
    expect(
      (await t.call(b.me, 'POST', '/reminders', { ...body, message_id: a.messageId })).status,
    ).toBe(404);
    // The message exists, but not in the chat that was named.
    expect(
      (
        await t.call(a.me, 'POST', '/reminders', {
          ...body,
          message_id: a.messageId,
          conversation_id: b.conv,
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await t.call(a.me, 'POST', '/reminders', {
          ...body,
          message_id: randomUUID(),
        })
      ).status,
    ).toBe(404);
  });

  it('someone who left the chat cannot set a reminder for it', async () => {
    const { me, conv } = await chatWithMessage();
    await t.db
      .updateTable('conversation_members')
      .set({ left_at: new Date() })
      .where('conversation_id', '=', conv)
      .where('user_id', '=', me)
      .execute();
    const res = await t.call(me, 'POST', '/reminders', {
      conversation_id: conv,
      remind_at: inMinutes(5),
    });
    expect(res.status).toBe(404);
  });

  it('cancels only your own pending reminder; others cannot see or cancel it', async () => {
    const { me, conv } = await chatWithMessage();
    const stranger = await t.makeUser();
    const mine = await t.call(me, 'POST', '/reminders', {
      conversation_id: conv,
      remind_at: inMinutes(5),
    });

    expect((await t.call(stranger, 'GET', '/reminders')).body.items).toEqual([]);
    expect((await t.call(stranger, 'DELETE', `/reminders/${mine.body.id}`)).status).toBe(404);
    expect((await t.call(me, 'GET', '/reminders')).body.items).toHaveLength(1);

    expect((await t.call(me, 'DELETE', `/reminders/${mine.body.id}`)).status).toBe(204);
    expect((await t.call(me, 'GET', '/reminders')).body.items).toEqual([]);
    expect((await t.call(me, 'DELETE', `/reminders/${mine.body.id}`)).status).toBe(404);
  });

  it('keeps sent reminders in the list for a few days, and a sent one cannot be cancelled', async () => {
    const { me, conv } = await chatWithMessage();
    const recent = await t.call(me, 'POST', '/reminders', {
      conversation_id: conv,
      remind_at: inMinutes(5),
    });
    const old = await t.call(me, 'POST', '/reminders', {
      conversation_id: conv,
      remind_at: inMinutes(6),
    });
    await t.db
      .updateTable('reminders')
      .set({ status: 'sent', sent_at: new Date() })
      .where('id', '=', recent.body.id)
      .execute();
    await t.db
      .updateTable('reminders')
      .set({ status: 'sent', sent_at: new Date(Date.now() - 10 * 86_400_000) })
      .where('id', '=', old.body.id)
      .execute();

    const list = await t.call(me, 'GET', '/reminders');
    expect(list.body.items.map((r: { id: string }) => r.id)).toEqual([recent.body.id]);
    expect(list.body.items[0].status).toBe('sent');
    expect((await t.call(me, 'DELETE', `/reminders/${recent.body.id}`)).status).toBe(404);
  });

  it('pages with a cursor, soonest first', async () => {
    const { me, conv } = await chatWithMessage();
    for (const m of [30, 10, 20]) {
      await t.call(me, 'POST', '/reminders', { conversation_id: conv, remind_at: inMinutes(m) });
    }
    const first = await t.call(me, 'GET', '/reminders?limit=2');
    expect(first.body.items).toHaveLength(2);
    expect(first.body.next_cursor).toEqual(expect.any(String));
    const second = await t.call(
      me,
      'GET',
      `/reminders?limit=2&cursor=${encodeURIComponent(first.body.next_cursor)}`,
    );
    expect(second.body.items).toHaveLength(1);
    expect(second.body.next_cursor).toBeNull();
    const times = [...first.body.items, ...second.body.items].map(
      (r: { remind_at: string }) => r.remind_at,
    );
    expect(times).toEqual([...times].sort());
    expect((await t.call(me, 'GET', '/reminders?cursor=%25%25')).status).toBe(400);
  });

  it('stops at the per-user limit of waiting reminders, even with requests at once', async () => {
    const { me, conv } = await chatWithMessage();
    const rows = Array.from({ length: LIMITS.MAX_PENDING_REMINDERS_PER_USER - 1 }, () => ({
      user_id: me,
      conversation_id: conv,
      remind_at: new Date(Date.now() + 3_600_000),
    }));
    await t.db.insertInto('reminders').values(rows).execute();
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        t.call(me, 'POST', '/reminders', { conversation_id: conv, remind_at: inMinutes(5) }),
      ),
    );
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
  });
});
