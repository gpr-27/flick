/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- test payloads are untyped */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sendMessage } from '../../src/modules/messages/index.js';
import {
  createGateDb,
  dedupeBySeq,
  eventually,
  type GateApp,
  type GateDb,
} from './gate-helpers.js';

// THE GATE: the core delivery pipeline, tested all together.
//
//   client -> send (socket or REST) -> Postgres transaction (seq + message + outbox row)
//          -> dispatcher (in the API) -> Socket.IO rooms -> clients (dedupe by seq)
//                                     -> pg-boss "notify" job for offline people
//
// Everything is real (Fastify app on port 0, Postgres, Redis, socket.io-client) except Clerk.
// Needs DATABASE_URL and REDIS_URL, see infra/docker/compose.test.yml.

let env: GateDb;
let api: GateApp;
beforeAll(async () => {
  env = await createGateDb();
  api = await env.startApp();
});
afterAll(async () => {
  await env.destroy();
});

describe('1. duplicate sends', () => {
  // Guarantee: retrying a send (lost ack, reconnect, double click) never creates a second message.
  // The first call is accepted, every retry gets the SAME message_id and seq with duplicate: true.
  it('one client_message_id sent many times, one after another, makes one message', async () => {
    const [alice, bob] = [await env.makeUser(), await env.makeUser()];
    const conv = await env.makeGroup([alice, bob]);
    const a = await api.connect(alice);
    const clientMessageId = `cm_${randomUUID()}`;
    const body = { content: { type: 'text', text: 'once' }, client_message_id: clientMessageId };

    const answers = [
      (await a.send(conv, 'once', clientMessageId)).data,
      (await a.send(conv, 'once', clientMessageId)).data,
      (await api.rest(alice, 'POST', `/conversations/${conv}/messages`, body)).body,
      (await api.rest(alice, 'POST', `/conversations/${conv}/messages`, body)).body,
    ];

    expect(answers.map((x) => x.duplicate)).toEqual([false, true, true, true]);
    expect(new Set(answers.map((x) => x.message_id)).size).toBe(1);
    expect(new Set(answers.map((x) => x.seq))).toEqual(new Set([1]));
    await expectOneMessage(conv, clientMessageId);
  });

  // Guarantee: even when the retries race each other (the real shape of a flaky network), the
  // unique key on (sender device, client_message_id) lets exactly one through.
  it('the same client_message_id sent at the same time over sockets and REST makes one message', async () => {
    const [alice, bob] = [await env.makeUser(), await env.makeUser()];
    const conv = await env.makeGroup([alice, bob]);
    const a1 = await api.connect(alice);
    const a2 = await api.connect(alice); // same user and device, a second connection
    const clientMessageId = `cm_${randomUUID()}`;
    const body = { content: { type: 'text', text: 'race' }, client_message_id: clientMessageId };

    const answers = await Promise.all([
      ...Array.from({ length: 6 }, () =>
        a1.send(conv, 'race', clientMessageId).then((r) => r.data),
      ),
      ...Array.from({ length: 6 }, () =>
        a2.send(conv, 'race', clientMessageId).then((r) => r.data),
      ),
      ...Array.from({ length: 6 }, () =>
        api.rest(alice, 'POST', `/conversations/${conv}/messages`, body).then((r) => r.body),
      ),
    ]);

    expect(answers.every((x) => x && x.seq === 1)).toBe(true);
    expect(new Set(answers.map((x) => x.message_id)).size).toBe(1);
    expect(answers.filter((x) => x.duplicate === false)).toHaveLength(1); // one winner
    expect(answers.filter((x) => x.duplicate === true)).toHaveLength(17);
    await expectOneMessage(conv, clientMessageId);
  });

  async function expectOneMessage(conv: string, clientMessageId: string) {
    const messages = await env.db
      .selectFrom('messages')
      .select('seq')
      .where('conversation_id', '=', conv)
      .where('client_message_id', '=', clientMessageId)
      .execute();
    expect(messages).toHaveLength(1);
    const created = await env.db
      .selectFrom('outbox')
      .select('id')
      .where('partition_key', '=', conv)
      .execute();
    expect(created).toHaveLength(1); // and one event for the dispatcher, so one live delivery
    const conversation = await env.db
      .selectFrom('conversations')
      .select('last_seq')
      .where('id', '=', conv)
      .executeTakeFirstOrThrow();
    expect(conversation.last_seq).toBe(1); // a duplicate does not burn a seq
  }
});

describe('2. ordering', () => {
  // Guarantee: seqs are unique and gapless per conversation however many senders race, and every
  // recipient sees them in seq order. Seqs are taken while the conversation row is locked, and
  // the outbox is dispatched in commit order, so the order is the same everywhere.
  it('8 senders x 10 concurrent messages get seq 1..80, and recipients see them in order', async () => {
    const senders = await Promise.all(Array.from({ length: 8 }, () => env.makeUser()));
    const readers = await Promise.all([env.makeUser(), env.makeUser()]);
    const conv = await env.makeGroup([...senders, ...readers]);
    const senderClients = await Promise.all(senders.map((u) => api.connect(u)));
    const readerClients = await Promise.all(readers.map((u) => api.connect(u)));

    const accepted = (
      await Promise.all(
        senderClients.flatMap((client, s) =>
          Array.from({ length: 10 }, (_, i) => client.send(conv, `s${s}-m${i}`)),
        ),
      )
    ).map((r) => {
      expect(r.ok).toBe(true);
      return r.data.seq as number;
    });
    expect([...accepted].sort((x, y) => x - y)).toEqual(
      Array.from({ length: 80 }, (_, i) => i + 1),
    );

    await eventually(
      () =>
        readerClients.every(
          (r) => dedupeBySeq(r.of('new_message').map((p) => p.message)).length === 80,
        ),
      'both readers to receive 80 messages',
    );
    for (const reader of readerClients) {
      const live = reader.of('new_message').map((p) => p.message);
      const shown = dedupeBySeq(live);
      expect(shown.map((m) => m.seq)).toEqual(Array.from({ length: 80 }, (_, i) => i + 1));
      // Stronger than the client rule needs: even the raw stream arrives in seq order.
      expect(live.map((m) => m.seq)).toEqual([...live.map((m) => m.seq)].sort((x, y) => x - y));
    }
    // A sender also sees the other senders' 70 messages, never its own on the sending device.
    const first = senderClients[0]!;
    await eventually(
      () => dedupeBySeq(first.of('new_message').map((p) => p.message)).length === 70,
      'a sender to receive the other 70 messages',
    );
    expect(first.of('new_message').every((p) => p.message.sender_user_id !== senders[0]!.id)).toBe(
      true,
    );
  });
});

describe('3. restart after commit, before live delivery', () => {
  // Guarantee: "accepted" means durable. If the API dies after the commit but before the live
  // emit, a new API process still delivers the message, because the outbox row is still there.
  it('a message committed while no API was running is delivered by the next one, once', async () => {
    // Its own database, so that no other API process (like the shared one above) dispatches first.
    const env = await createGateDb();
    try {
      await restartScenario(env);
    } finally {
      await env.destroy();
    }
  });

  async function restartScenario(env: GateDb) {
    const [alice, bob] = [await env.makeUser(), await env.makeUser()];
    const conv = await env.makeGroup([alice, bob]);

    // The "crash": the send transaction commits, and no API process (so no dispatcher) exists.
    const accepted = await sendMessage(
      { db: env.db },
      { userId: alice.id, deviceId: alice.deviceId },
      {
        conversation_id: conv,
        client_message_id: `cm_${randomUUID()}`,
        content: { type: 'text', text: 'survives a crash' },
      },
    );
    expect(await env.outboxDone(conv)).toBe(false);

    // To make the test deterministic, hold the outbox row while the new API starts and Bob
    // connects (the dispatcher skips locked rows); releasing the lock is "the dispatcher's turn".
    const holder = new pg.Client({ connectionString: env.databaseUrl });
    await holder.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM outbox WHERE partition_key = $1 FOR UPDATE', [conv]);

    const restarted = await env.startApp();
    const b = await restarted.connect(bob);
    await holder.query('COMMIT');
    await holder.end();

    await eventually(() => b.of('new_message').length >= 1, 'Bob to receive the message');
    await eventually(() => env.outboxDone(conv), 'the outbox row to be marked done');
    await b.flush();
    const shown = dedupeBySeq(b.of('new_message').map((p) => p.message));
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({ seq: accepted.seq, message_id: accepted.message_id });
    await restarted.stop();
  }

  // Guarantee: the opposite crash is safe too. If the emit happened but the row was not marked
  // done, the row is emitted again. The duplicate is harmless because clients dedupe by seq, and
  // the row is finally marked done. (Here the failing step after the emit is queueing the
  // notification for the offline member: the job store rejects it, so the row is retried.)
  it('a message emitted but not marked done is emitted again; clients dedupe by seq', async () => {
    const [alice, bob, carol] = [await env.makeUser(), await env.makeUser(), await env.makeUser()];
    const conv = await env.makeGroup([alice, bob, carol]); // Carol stays offline
    const b = await api.connect(bob);
    // Failure injection: inserting a notify job fails, as if the job store were unavailable.
    await sql`CREATE OR REPLACE FUNCTION pgboss.gate_fail() RETURNS trigger LANGUAGE plpgsql AS
      $$ BEGIN RAISE EXCEPTION 'gate: job store unavailable'; END $$`.execute(env.db);
    await sql`CREATE TRIGGER gate_fail BEFORE INSERT ON pgboss.job_common
      FOR EACH ROW EXECUTE FUNCTION pgboss.gate_fail()`.execute(env.db);

    const sent = await api.rest(alice, 'POST', `/conversations/${conv}/messages`, {
      client_message_id: `cm_${randomUUID()}`,
      content: { type: 'text', text: 'emit, then fail' },
    });
    expect(sent.status).toBeLessThan(300);
    await eventually(
      async () =>
        b.of('new_message').length >= 2 &&
        (
          await env.db
            .selectFrom('outbox')
            .select('attempts')
            .where('partition_key', '=', conv)
            .executeTakeFirstOrThrow()
        ).attempts > 0,
      'the row to be emitted again after a failed attempt',
    );
    expect(await env.outboxDone(conv)).toBe(false);

    // The problem is fixed, the dispatcher's next attempt succeeds.
    await sql`DROP TRIGGER gate_fail ON pgboss.job_common`.execute(env.db);
    await eventually(() => env.outboxDone(conv), 'the outbox row to be marked done', 20_000);

    await b.flush();
    expect(b.of('new_message').length).toBeGreaterThanOrEqual(2);
    expect(dedupeBySeq(b.of('new_message').map((p) => p.message))).toHaveLength(1);
    expect((await env.notifyJobs(conv)).map((j) => j.user_id)).toEqual([carol.id]);
  });
});

describe('4. offline recovery', () => {
  // Guarantee: a device that was offline asks "what is after seq N?" and gets everything it
  // missed (messages AND edits, deletes, reactions) in order, with no gap and no duplicate, no
  // matter how small the pages are. A message that arrives live while it is syncing is not lost.
  it('sync returns 30 missed events in order across small pages, and keeps a live message', async () => {
    const [alice, bob] = [await env.makeUser(), await env.makeUser()];
    const conv = await env.makeGroup([alice, bob]);
    const ids: string[] = [];
    const sendText = async (text: string) => {
      const r = await api.rest(alice, 'POST', `/conversations/${conv}/messages`, {
        client_message_id: `cm_${randomUUID()}`,
        content: { type: 'text', text },
      });
      expect(r.status).toBe(200);
      ids.push(r.body.message_id);
    };
    const at = `/conversations/${conv}/messages`;

    // Bob is offline for all of this: 27 messages + 1 edit + 1 delete + 1 reaction = seq 1..30.
    for (let i = 1; i <= 12; i++) await sendText(`m${i}`); // seq 1..12
    expect(
      (
        await api.rest(alice, 'PATCH', `${at}/${ids[2]}`, {
          content: { type: 'text', text: 'm3 edited' },
        })
      ).status,
    ).toBeLessThan(300); // 13
    for (let i = 13; i <= 22; i++) await sendText(`m${i}`); // seq 14..23
    expect((await api.rest(alice, 'DELETE', `${at}/${ids[4]}?for=everyone`)).status).toBe(204); // 24
    expect(
      (await api.rest(alice, 'PUT', `${at}/${ids[6]}/reaction`, { emoji: '👍' })).status,
    ).toBeLessThan(300); // 25
    for (let i = 23; i <= 27; i++) await sendText(`m${i}`); // seq 26..30
    await eventually(() => env.outboxDone(conv), 'the dispatcher to finish while Bob is offline');

    // Bob comes online and syncs with pages of 7.
    const b = await api.connect(bob);
    const sync = async (cursor?: string) =>
      (
        await b.request('sync_request', {
          cursors: [{ conversation_id: conv, after_seq: 0 }],
          limit: 7,
          ...(cursor ? { cursor } : {}),
        })
      ).data;
    const synced: { type: string; payload: any }[] = [];
    let page = await sync();
    synced.push(...page.events);
    expect(page.events).toHaveLength(7);
    expect(page.next_cursor).not.toBeNull();

    // A new message arrives live in the middle of the sync.
    await sendText('arrives during sync'); // seq 31
    await eventually(() => b.of('new_message').length === 1, 'the live message');
    expect(b.of('new_message')[0].message.seq).toBe(31);

    let pages = 1;
    while (page.next_cursor) {
      page = await sync(page.next_cursor);
      synced.push(...page.events);
      pages++;
    }
    expect(pages).toBeGreaterThanOrEqual(5);

    // The sync stream alone: strictly increasing, gapless from 1, no duplicate.
    const seqs = synced.map((e) => e.payload.seq ?? e.payload.message.seq);
    expect(seqs).toEqual(Array.from({ length: seqs.length }, (_, i) => i + 1));
    expect(seqs.length).toBeGreaterThanOrEqual(30);
    const typeAt = (seq: number) => synced[seq - 1]!.type;
    expect([typeAt(13), typeAt(24), typeAt(25)]).toEqual([
      'message_edited',
      'message_deleted',
      'reaction_added',
    ]);
    expect(typeAt(1)).toBe('new_message');

    // Sync plus the live stream, with the client rule: nothing lost, nothing twice.
    const all = dedupeBySeq([
      ...synced.map((e) => ({ seq: e.payload.seq ?? e.payload.message.seq })),
      ...b.of('new_message').map((p) => ({ seq: p.message.seq })),
    ]);
    expect(all.map((x) => x.seq)).toEqual(Array.from({ length: 31 }, (_, i) => i + 1));
  });
});

describe('5. removed member', () => {
  // Guarantee: the moment someone is removed they stop getting live events, and cannot read the
  // history, sync it, or send to it. (Membership is read from Postgres at delivery time, never
  // from a cache.)
  it('after removal: no live events, history / sync / send are refused', async () => {
    const [alice, bob, carol] = [await env.makeUser(), await env.makeUser(), await env.makeUser()];
    const conv = await env.makeGroup([alice, bob, carol]);
    const [a, b, c] = [await api.connect(alice), await api.connect(bob), await api.connect(carol)];

    await a.send(conv, 'before removal');
    await eventually(() => b.of('new_message').length === 1, 'Bob to get the first message');
    expect((await api.rest(bob, 'GET', `/conversations/${conv}/messages`)).status).toBe(200);

    const removed = await api.rest(alice, 'DELETE', `/conversations/${conv}/members/${bob.id}`);
    expect(removed.status).toBe(204);
    await eventually(
      () => b.of('conversation_updated').some((u) => u.conversation === null),
      'Bob to be told he lost the conversation',
    );

    const second = await a.send(conv, 'after removal');
    await eventually(() => c.of('new_message').length === 2, 'Carol to get the second message');
    await eventually(() => env.outboxDone(conv), 'the dispatcher to finish');
    await b.flush();
    expect(b.of('new_message')).toHaveLength(1); // only the one from before
    expect(b.of('new_message').some((p) => p.message.seq === second.data.seq)).toBe(false);

    expect((await api.rest(bob, 'GET', `/conversations/${conv}/messages`)).status).toBe(403);
    const sync = await b.request('sync_request', {
      cursors: [{ conversation_id: conv, after_seq: 0 }],
      limit: 50,
    });
    expect(sync.data.events).toEqual([]);
    expect(sync.data.removed_conversation_ids).toEqual([conv]);
    const viaSocket = await b.send(conv, 'let me in');
    expect(viaSocket).toMatchObject({ ok: false, error: { code: 'NOT_A_MEMBER' } });
    const viaRest = await api.rest(bob, 'POST', `/conversations/${conv}/messages`, {
      client_message_id: `cm_${randomUUID()}`,
      content: { type: 'text', text: 'let me in' },
    });
    expect(viaRest.status).toBe(403);
  });
});

describe('6. receipts', () => {
  // Guarantee: "delivered" (a device stored it) and "read" (the user saw it) are separate cursors
  // that only move forward. An old or repeated ack changes nothing, and the server emitting a
  // message to a socket is NOT a delivery receipt: only the client's delivery_ack is.
  it('delivered and read are separate and monotonic; an emit alone is not a receipt', async () => {
    const [alice, bob] = [await env.makeUser(), await env.makeUser()];
    const conv = await env.makeGroup([alice, bob]);
    const [a, b] = [await api.connect(alice), await api.connect(bob)];
    const sent: { seq: number; message_id: string }[] = [];
    for (const text of ['one', 'two', 'three']) sent.push((await a.send(conv, text)).data);

    await eventually(() => b.of('new_message').length === 3, 'Bob to receive all three');
    const deliveredSeq = async () =>
      (
        await env.db
          .selectFrom('device_cursors')
          .select('delivered_seq')
          .where('device_id', '=', bob.deviceId)
          .where('conversation_id', '=', conv)
          .executeTakeFirst()
      )?.delivered_seq ?? 0;
    const readSeq = async () =>
      (
        await env.db
          .selectFrom('conversation_members')
          .select('read_seq')
          .where('conversation_id', '=', conv)
          .where('user_id', '=', bob.id)
          .executeTakeFirstOrThrow()
      ).read_seq;
    const info = async (seq: number) =>
      (
        await api.rest(
          alice,
          'GET',
          `/conversations/${conv}/messages/${sent[seq - 1]!.message_id}/info`,
        )
      ).body.recipients[0];

    // Bob's socket got all three, yet nothing counts as delivered.
    expect(await deliveredSeq()).toBe(0);
    expect(await readSeq()).toBe(0);
    expect(await info(3)).toMatchObject({ delivered: false, read: false });
    expect(a.of('receipt_update')).toEqual([]);

    // delivery_ack 2: messages 1 and 2 are delivered, 3 is not. Read is untouched.
    expect(
      (await b.request('delivery_ack', { acks: [{ conversation_id: conv, seq: 2 }] })).ok,
    ).toBe(true);
    expect(await deliveredSeq()).toBe(2);
    expect(await readSeq()).toBe(0);
    expect(await info(2)).toMatchObject({ delivered: true, read: false });
    expect(await info(3)).toMatchObject({ delivered: false, read: false });
    await eventually(
      () => a.of('receipt_update').length === 1,
      'Alice to see the delivered receipt',
    );
    expect(a.of('receipt_update')[0]).toMatchObject({ user_id: bob.id, delivered_seq: 2 });

    // An older ack (and a repeat) never moves the cursor back, and sends no new receipt.
    await b.request('delivery_ack', { acks: [{ conversation_id: conv, seq: 1 }] });
    await b.request('delivery_ack', { acks: [{ conversation_id: conv, seq: 2 }] });
    expect(await deliveredSeq()).toBe(2);
    await b.request('delivery_ack', { acks: [{ conversation_id: conv, seq: 3 }] });
    expect(await deliveredSeq()).toBe(3);
    await eventually(() => a.of('receipt_update').length === 2, 'Alice to see delivered 3');
    await a.flush();
    expect(a.of('receipt_update').map((r) => r.delivered_seq)).toEqual([2, 3]);

    // read_ack moves only the read cursor, also never back.
    expect((await b.request('read_ack', { conversation_id: conv, seq: 2 })).ok).toBe(true);
    expect(await readSeq()).toBe(2);
    expect(await deliveredSeq()).toBe(3);
    await b.request('read_ack', { conversation_id: conv, seq: 1 });
    expect(await readSeq()).toBe(2);
    expect(await info(2)).toMatchObject({ delivered: true, read: true });
    expect(await info(3)).toMatchObject({ delivered: true, read: false });
    await eventually(
      () => a.of('receipt_update').some((r) => r.read_seq === 2),
      'Alice to see read 2',
    );
    await a.flush();
    expect(
      a
        .of('receipt_update')
        .filter((r) => r.read_seq !== undefined)
        .map((r) => r.read_seq),
    ).toEqual([2]);
  });
});

describe('7. offline notification', () => {
  // Guarantee: every unmuted member (not the sender) gets exactly one "notify" job per message (not
  // one per dispatch attempt); a muted member gets none. A member with no connected socket gets it
  // at once; a connected member's job waits a few seconds, because a frozen tab or a just-closed app
  // still looks connected, and the worker pushes only if no delivery receipt arrived by then.
  it('queues one notify job per unmuted member: at once if offline, delayed if connected', async () => {
    const [alice, bob, carol, dave] = [
      await env.makeUser(),
      await env.makeUser(),
      await env.makeUser(),
      await env.makeUser(),
    ];
    const conv = await env.makeGroup([alice, bob, carol, dave]);
    await env.db
      .updateTable('conversation_members')
      .set({ muted_until: sql<Date>`now() + interval '1 day'` })
      .where('conversation_id', '=', conv)
      .where('user_id', '=', carol.id)
      .execute();
    const a = await api.connect(alice);
    const d = await api.connect(dave); // Bob and Carol stay offline

    const sent = await a.send(conv, 'ping');
    await eventually(async () => (await env.notifyJobs(conv)).length > 1, 'the notify jobs');
    await eventually(() => env.outboxDone(conv), 'the dispatcher to finish');
    await d.flush();
    expect(d.of('new_message')).toHaveLength(1);
    const jobs = await env.notifyJobs(conv);
    expect(jobs.map((j) => j.user_id).sort()).toEqual([bob.id, dave.id].sort()); // not carol, not alice
    expect(jobs.find((j) => j.user_id === bob.id)).toEqual({
      user_id: bob.id,
      conversation_id: conv,
      message_id: sent.data.message_id,
      seq: sent.data.seq,
      kind: 'message',
    });
    const { rows } = await sql<{ user_id: string; delayed: boolean }>`
      SELECT data->>'user_id' AS user_id, start_after > now() + interval '3 seconds' AS delayed
      FROM pgboss.job WHERE name = 'notify' AND data->>'conversation_id' = ${conv}`.execute(env.db);
    expect(rows.find((r) => r.user_id === bob.id)!.delayed).toBe(false);
    expect(rows.find((r) => r.user_id === dave.id)!.delayed).toBe(true);

    // Dispatching the same row again (as after a crash) must not queue a second notification.
    await env.db
      .updateTable('outbox')
      .set({ published_at: null })
      .where('partition_key', '=', conv)
      .execute();
    await eventually(() => env.outboxDone(conv), 'the row to be dispatched again');
    expect(await env.notifyJobs(conv)).toHaveLength(2);
  });
});
