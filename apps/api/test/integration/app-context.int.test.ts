import { randomUUID } from 'node:crypto';
import { AiChain, type ProviderAdapter, type ProviderCallParams } from '@chat/ai';
import {
  FLICK_BOT_USER_ID,
  allocateSeqAndInsertMessage,
  findOrCreateDirectConversation,
  findOrCreateSavedConversation,
  migrateUp,
} from '@chat/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { buildFlickContext } from '../../src/modules/ai/app-context.js';
import { flickBotOnMessage } from '../../src/modules/ai/bot.js';
import { aiServiceFromChain } from '../../src/modules/ai/service.js';
import { Redis } from '../../src/redis.js';

// buildFlickContext against real Postgres and Redis with seeded data: the numbers must be exact,
// and nothing about other people or any secret may appear.

class Recorder implements ProviderAdapter {
  readonly provider = 'groq' as const;
  readonly account = '1';
  readonly models = ['fake-model'];
  systems: string[] = [];
  complete({ request }: ProviderCallParams): Promise<string> {
    this.systems.push(request.system ?? '');
    return Promise.resolve('fake answer');
  }
  async *stream(params: ProviderCallParams): AsyncIterable<string> {
    yield await this.complete(params);
  }
}

const SECRET_KEY = 'sk-ant-SUPERSECRETKEY123';
const adminUrl = process.env.DATABASE_URL!;
const dbName = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
let db: ReturnType<typeof createDb>;
let redis: Redis;
let config: ReturnType<typeof loadConfig>;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  config = loadConfig({
    ...process.env,
    DATABASE_URL: url.toString(),
    LOG_LEVEL: 'silent',
    ANTHROPIC_API_KEY: SECRET_KEY,
    GIPHY_API_KEY: 'giphy-SECRET-key',
  });
  db = createDb(config.DATABASE_URL, 10);
  await migrateUp(db);
  redis = new Redis(process.env.REDIS_URL!);
});

afterAll(async () => {
  await db.destroy();
  redis.disconnect();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

async function makeUser(name: string, extra: Record<string, unknown> = {}) {
  const row = await db
    .insertInto('users')
    .values({
      username: `${name.toLowerCase()}_${randomUUID().slice(0, 6)}`,
      display_name: name,
      email: `${name.toLowerCase()}-${randomUUID().slice(0, 6)}@private.example`,
      ...extra,
    })
    .returning(['id', 'email'])
    .executeTakeFirstOrThrow();
  await db.insertInto('user_settings').values({ user_id: row.id }).execute();
  return row;
}

async function say(conversationId: string, senderId: string, text: string) {
  const { message } = await allocateSeqAndInsertMessage(db, {
    conversationId,
    senderId,
    senderDeviceId: null,
    clientMessageId: null,
    type: 'text',
    bodyText: text,
  });
  return message;
}

async function makeGroup(name: string, owner: string, ...others: string[]) {
  const c = await db
    .insertInto('conversations')
    .values({ type: 'group', name, created_by: owner })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('conversation_members')
    .values([
      { conversation_id: c.id, user_id: owner, role: 'owner' as const },
      ...others.map((user_id) => ({ conversation_id: c.id, user_id })),
    ])
    .execute();
  return c.id;
}

const freshCache = async (userId: string) => {
  await redis.del(`flick:ctx:user:${userId}`, 'flick:ctx:app');
};

describe('buildFlickContext', () => {
  it('reports exact numbers for the asker and leaks nothing about anyone else', async () => {
    const alice = await makeUser('Alice');
    const bob = await makeUser('Bob', { about: 'BOB-PRIVATE-ABOUT' });
    const carol = await makeUser('Carol');
    const dave = await makeUser('Dave'); // shares no chat with Alice

    // Alice: a direct chat with Bob (3 unread), a group she owns (2 unread, pinned), a group she
    // is only a member of (archived and muted, read), Saved messages, and the Flick chat.
    const withBob = (await findOrCreateDirectConversation(db, alice.id, bob.id)).conversationId;
    await say(withBob, bob.id, 'bob message one');
    await say(withBob, bob.id, 'BOB-SECRET-MESSAGE two');
    await say(withBob, bob.id, 'bob message three');
    const owned = await makeGroup('Climbing Club', alice.id, carol.id);
    await say(owned, carol.id, 'CAROL-SECRET-TEXT');
    const pinnedMsg = await say(owned, carol.id, 'carol again');
    const other = await makeGroup('Book Group', carol.id, alice.id);
    const otherMsg = await say(other, carol.id, 'read this');
    const saved = (await findOrCreateSavedConversation(db, alice.id)).conversationId;
    await findOrCreateDirectConversation(db, alice.id, FLICK_BOT_USER_ID);
    await say(await groupWithDave(dave.id, carol.id), dave.id, 'DAVE-SECRET-TEXT');

    await db
      .updateTable('conversation_members')
      .set({ pinned_at: new Date() })
      .where('conversation_id', '=', owned)
      .where('user_id', '=', alice.id)
      .execute();
    await db
      .updateTable('conversation_members')
      .set({
        archived: true,
        muted_until: new Date(Date.now() + 3_600_000),
        read_seq: otherMsg.seq,
      })
      .where('conversation_id', '=', other)
      .where('user_id', '=', alice.id)
      .execute();
    await db
      .insertInto('pinned_messages')
      .values({ message_id: pinnedMsg.id, conversation_id: owned, pinned_by: carol.id })
      .execute();
    await db
      .insertInto('starred_messages')
      .values([
        { user_id: alice.id, message_id: pinnedMsg.id },
        { user_id: alice.id, message_id: otherMsg.id },
      ])
      .execute();
    await db
      .insertInto('scheduled_messages')
      .values([
        {
          user_id: alice.id,
          conversation_id: saved,
          body_text: 'later',
          send_at: new Date(Date.now() + 86_400_000),
        },
        {
          user_id: alice.id,
          conversation_id: saved,
          body_text: 'later 2',
          send_at: new Date(Date.now() + 86_500_000),
        },
        {
          user_id: alice.id,
          conversation_id: saved,
          body_text: 'done',
          send_at: new Date(),
          status: 'sent',
        },
      ])
      .execute();
    await db.insertInto('blocks').values({ blocker_id: alice.id, blocked_id: dave.id }).execute();
    await db
      .insertInto('devices')
      .values([
        { user_id: alice.id, name: 'Chrome on Mac' },
        { user_id: alice.id, name: 'Safari on iPhone' },
        { user_id: alice.id, name: 'Old tablet', revoked_at: new Date() },
      ])
      .execute();
    await db
      .insertInto('call_logs')
      .values({ conversation_id: withBob, caller_id: bob.id, type: 'video', status: 'missed' })
      .execute();
    await db
      .updateTable('user_settings')
      .set({ read_receipts: false, last_seen_privacy: 'nobody', ai_language: 'Telugu' })
      .where('user_id', '=', alice.id)
      .execute();

    await freshCache(alice.id);
    const text = await buildFlickContext(db, redis, config, alice.id, [
      { name: 'postgres', critical: true, check: () => Promise.resolve() },
      { name: 'object-storage', critical: false, check: () => Promise.reject(new Error('down')) },
    ]);

    // Exact numbers: 5 chats (Bob, Climbing, Book, Saved, Flick), 2 groups, 2 direct + Saved.
    expect(text).toContain('Name: Alice;');
    expect(text).toContain('Chats: 5 in total (2 direct, 2 groups, plus Saved messages).');
    // Unread: Bob chat 3, Climbing 2 = 2 chats, 5 messages. The Book Group is read.
    expect(text).toContain('Unread: 2 chats with unread messages, 5 unread messages in total.');
    expect(text).toContain('Archived chats: 1. Pinned chats: 1. Muted chats: 1.');
    expect(text).toContain('Starred messages: 2. Pinned messages (in their chats): 1.');
    expect(text).toContain('Scheduled messages waiting to send: 2. Blocked people: 1.');
    expect(text).toContain('Signed-in devices: 2');
    expect(text).toContain('Chrome on Mac');
    expect(text).not.toContain('Old tablet');
    expect(text).toContain('read receipts off; last seen visible to nobody');
    expect(text).toContain('Flick answers in Telugu');
    expect(text).toContain('1 call in the last 30 days; the latest was a video call (missed)');
    expect(text).toContain('Groups they own: Climbing Club.');
    expect(text).toMatch(/- Bob \(direct\): 3 unread/);
    expect(text).toMatch(/- Climbing Club \(group\): 2 unread/);
    expect(text).toContain('- Saved messages (saved): 0 unread');
    expect(text).toContain('Features enabled:');
    expect(text).toContain('AI providers configured: Anthropic.');
    expect(text).toContain('object-storage DOWN');
    expect(text).toContain('postgres ok');
    // Whole app: 4 people (Alice, Bob, Carol, Dave), bot excluded; chats exclude Saved.
    expect(text).toContain('4 people use Flick');
    expect(text).toContain('HOW FLICK WORKS');
    expect(text.length).toBeLessThanOrEqual(10_000);

    // Nothing about anyone else, and no secret of any kind.
    for (const secret of [
      'BOB-SECRET-MESSAGE',
      'CAROL-SECRET-TEXT',
      'DAVE-SECRET-TEXT',
      'BOB-PRIVATE-ABOUT',
      bob.email!,
      alice.email!,
      'Dave',
      SECRET_KEY,
      'giphy-SECRET-key',
      adminUrl,
      process.env.REDIS_URL!,
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  async function groupWithDave(dave: string, carol: string) {
    return makeGroup('Dave and Carol', dave, carol);
  }

  it('caches for a few seconds and is live again once the cache expires', async () => {
    const eve = await makeUser('Eve');
    const frank = await makeUser('Frank');
    const chat = (await findOrCreateDirectConversation(db, eve.id, frank.id)).conversationId;
    await freshCache(eve.id);
    const before = await buildFlickContext(db, redis, config, eve.id);
    expect(before).toContain('Unread: 0 chats');
    await say(chat, frank.id, 'hello eve');
    expect(await buildFlickContext(db, redis, config, eve.id)).toContain('Unread: 0 chats');
    await redis.del(`flick:ctx:user:${eve.id}`);
    expect(await buildFlickContext(db, redis, config, eve.id)).toContain(
      'Unread: 1 chat with unread messages, 1 unread message in total.',
    );
  });

  it('works when Redis is down, and gives nothing for an unknown user', async () => {
    const gina = await makeUser('Gina');
    const dead = new Redis('redis://127.0.0.1:1', { lazyConnect: true, enableOfflineQueue: false });
    expect(await buildFlickContext(db, dead, config, gina.id)).toContain('Name: Gina;');
    dead.disconnect();
    expect(await buildFlickContext(db, redis, config, randomUUID())).toBe('');
  });

  it('is part of the system prompt of every reply, not of the user message', async () => {
    const hana = await makeUser('Hana');
    const ivan = await makeUser('Ivan');
    const recorder = new Recorder();
    const deps = {
      db,
      redis,
      logger: createLogger('silent'),
      ai: aiServiceFromChain(new AiChain({ adapters: [recorder] })),
      config,
      checks: [],
    };
    const direct = (await findOrCreateDirectConversation(db, hana.id, FLICK_BOT_USER_ID))
      .conversationId;
    const group = await makeGroup('Lunch crew', hana.id, ivan.id);

    await flickBotOnMessage(deps, await say(direct, hana.id, 'how many chats do I have?'));
    await flickBotOnMessage(deps, await say(group, hana.id, '@flick what can you do?'));
    expect(recorder.systems).toHaveLength(2);
    for (const system of recorder.systems) {
      expect(system).toContain('<app_knowledge>');
      expect(system).toContain('You are read-only');
      expect(system).toContain('Name: Hana;');
      expect(system).toContain('HOW FLICK WORKS');
      expect(system).not.toContain('Name: Ivan');
    }
    // Hana is in two chats: the Flick chat and the group.
    expect(recorder.systems[0]).toContain('Chats: 2 in total');
  });
});
