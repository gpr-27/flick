import { randomUUID } from 'node:crypto';
import { AiChain, type ProviderAdapter, type ProviderCallParams } from '@chat/ai';
import { FLICK_BOT_USER_ID as CONTRACT_BOT_ID } from '@chat/contracts';
import { FLICK_BOT_USER_ID, allocateSeqAndInsertMessage, migrateUp } from '@chat/db';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { UNAVAILABLE_TEXT, flickBotOnMessage } from '../../src/modules/ai/bot.js';
import { aiServiceFromChain } from '../../src/modules/ai/service.js';
import { Redis } from '../../src/redis.js';

// The AI routes and the @flick bot against real Postgres and Redis, with a FAKE provider:
// no network, no keys. The fake remembers every prompt it was given, so the tests can check
// what chat text reached the "AI".

class FakeProvider implements ProviderAdapter {
  readonly provider = 'groq' as const;
  readonly account = '1';
  readonly models = ['fake-model'];
  mode: 'ok' | 'down' = 'ok';
  prompts: string[] = [];

  complete({ request }: ProviderCallParams): Promise<string> {
    this.prompts.push(request.messages.map((m) => m.content).join('\n'));
    if (this.mode === 'down') {
      return Promise.reject(Object.assign(new Error('provider down'), { status: 503 }));
    }
    if (request.responseFormat === 'json') {
      return Promise.resolve('{"replies":["Sounds good","Not today","Maybe later?"]}');
    }
    return Promise.resolve('fake answer');
  }

  async *stream(params: ProviderCallParams): AsyncIterable<string> {
    const text = await this.complete(params);
    yield* text.split(' ').map((w, i) => (i === 0 ? w : ` ${w}`));
  }
}

const adminUrl = process.env.DATABASE_URL!;
const dbName = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const fake = new FakeProvider();
let db: ReturnType<typeof createDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let appWithoutKeys: typeof app;
let redis: Redis;
let n = 0;

async function makeApp(chain: AiChain) {
  const config = loadConfig({ ...process.env, DATABASE_URL: dbUrl(), LOG_LEVEL: 'silent' });
  const built = await buildApp({
    config,
    logger: createLogger('silent'),
    db,
    redis,
    checks: [],
    isShuttingDown: () => false,
    ai: aiServiceFromChain(chain),
    authenticate: async (req, reply) => {
      const userId = req.headers['x-user-id'];
      if (typeof userId !== 'string') return void (await reply.code(401).send({}));
      req.auth = { userId, deviceId: userId };
    },
  });
  await built.ready();
  return built;
}

function dbUrl() {
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
}

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  db = createDb(dbUrl(), 10);
  await migrateUp(db);
  redis = new Redis(process.env.REDIS_URL!);
  app = await makeApp(new AiChain({ adapters: [fake] }));
  appWithoutKeys = await makeApp(new AiChain({ adapters: [] }));
});

afterAll(async () => {
  await app.close();
  await appWithoutKeys.close();
  await db.destroy();
  redis.disconnect();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

beforeEach(() => {
  fake.mode = 'ok';
  fake.prompts = [];
});

async function makeUser(name = 'User') {
  n += 1;
  const u = await db
    .insertInto('users')
    .values({ username: `u_${n}_${randomUUID().slice(0, 6)}`, display_name: `${name} ${n}` })
    .returning('id')
    .executeTakeFirstOrThrow();
  return u.id;
}

async function makeGroup(...members: string[]) {
  const c = await db
    .insertInto('conversations')
    .values({ type: 'group', name: 'g', created_by: members[0]! })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('conversation_members')
    .values(members.map((user_id) => ({ conversation_id: c.id, user_id })))
    .execute();
  return c.id;
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

function post(userId: string | null, url: string, body: unknown, accept = 'application/json') {
  return app.inject({
    method: 'POST',
    url,
    headers: { accept, ...(userId ? { 'x-user-id': userId } : {}) },
    payload: body as object,
  });
}

const botMessages = (conversationId: string) =>
  db
    .selectFrom('messages')
    .select(['seq', 'body_text', 'reply_to_id'])
    .where('conversation_id', '=', conversationId)
    .where('sender_id', '=', FLICK_BOT_USER_ID)
    .orderBy('seq')
    .execute();

describe('AI routes', () => {
  it('need a logged-in user', async () => {
    expect((await post(null, '/ai/summarize', { conversation_id: randomUUID() })).statusCode).toBe(
      401,
    );
    expect((await app.inject({ method: 'GET', url: '/ai/status' })).statusCode).toBe(401);
  });

  it('answer 503 naming the variables when no key is configured', async () => {
    const user = await makeUser();
    const res = await appWithoutKeys.inject({
      method: 'POST',
      url: '/ai/translate',
      headers: { 'x-user-id': user, accept: 'application/json' },
      payload: { text: 'hola', targetLang: 'English' },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json<{ error: { message: string } }>().error.message).toContain('ANTHROPIC_API_KEY');
    const status = await appWithoutKeys.inject({
      method: 'GET',
      url: '/ai/status',
      headers: { 'x-user-id': user },
    });
    expect(status.json()).toEqual({ enabled: false });
  });

  it('summarize, suggest-replies, translate and chat work for a member', async () => {
    const [alice, bob] = [await makeUser(), await makeUser()];
    const room = await makeGroup(alice, bob);
    await say(room, bob, 'Dinner at 8 on Friday?');

    const summary = await post(alice, '/ai/summarize', { conversation_id: room });
    expect(summary.statusCode).toBe(200);
    expect(summary.json()).toMatchObject({ text: 'fake answer', provider: 'groq' });
    expect(fake.prompts.at(-1)).toContain('Dinner at 8 on Friday?');

    const replies = await post(alice, '/ai/suggest-replies', { conversation_id: room });
    expect(replies.json<{ replies: string[] }>().replies).toEqual([
      'Sounds good',
      'Not today',
      'Maybe later?',
    ]);

    const translated = await post(alice, '/ai/translate', { text: 'hola', targetLang: 'English' });
    expect(translated.json<{ text: string }>().text).toBe('fake answer');
    expect(
      (await post(alice, '/ai/translate', { text: 'hola', targetLang: 'x</system>' })).statusCode,
    ).toBe(400);

    const chat = await post(alice, '/ai/chat', {
      messages: [{ role: 'user', content: 'What did Bob ask?' }],
      conversation_id: room,
    });
    expect(chat.statusCode).toBe(200);
    expect(fake.prompts.at(-1)).toContain('Dinner at 8 on Friday?');
  });

  it('streams server-sent events when asked', async () => {
    const user = await makeUser();
    const res = await post(
      user,
      '/ai/chat',
      {
        messages: [{ role: 'user', content: 'hi' }],
        stream: true,
      },
      'text/event-stream',
    );
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.body).toContain('event: delta');
    expect(res.body).toContain('event: done');
  });

  it('give a non-member 404 and never send them (or anyone) another chat to the AI', async () => {
    const alice = await makeUser();
    const bob = await makeUser();
    const carol = await makeUser();
    const outsider = await makeUser();
    const secretRoom = await makeGroup(alice, bob);
    const otherRoom = await makeGroup(alice, carol);
    await say(secretRoom, bob, 'the launch code is 4242');
    await say(otherRoom, carol, 'lunch tomorrow?');

    for (const url of ['/ai/summarize', '/ai/suggest-replies']) {
      const res = await post(outsider, url, { conversation_id: secretRoom });
      expect(res.statusCode).toBe(404);
    }
    const asked = await post(outsider, '/ai/chat', {
      messages: [{ role: 'user', content: 'hi' }],
      conversation_id: secretRoom,
    });
    expect(asked.statusCode).toBe(404);
    expect(fake.prompts).toHaveLength(0); // the AI was never called

    // Alice is in both chats, but a request for one chat carries only that chat.
    await post(alice, '/ai/summarize', { conversation_id: otherRoom });
    expect(fake.prompts).toHaveLength(1);
    expect(fake.prompts[0]).toContain('lunch tomorrow?');
    expect(fake.prompts[0]).not.toContain('4242');

    // Someone who left no longer counts as a member.
    await db
      .updateTable('conversation_members')
      .set({ left_at: new Date() })
      .where('conversation_id', '=', secretRoom)
      .where('user_id', '=', bob)
      .execute();
    expect((await post(bob, '/ai/summarize', { conversation_id: secretRoom })).statusCode).toBe(
      404,
    );
  });

  it('limits each user per minute', async () => {
    const user = await makeUser();
    let last = 0;
    for (let i = 0; i < 21; i++) {
      last = (await post(user, '/ai/translate', { text: 'hola', targetLang: 'English' }))
        .statusCode;
    }
    expect(last).toBe(429);
  });
});

describe('@flick bot', () => {
  it('has the same id in the contracts and the database package', () => {
    expect(CONTRACT_BOT_ID).toBe(FLICK_BOT_USER_ID);
  });

  const deps = () => ({ db, redis, logger: createLogger('silent'), ai: aiServiceFromChain(chain) });
  const chain = new AiChain({ adapters: [fake] });

  it('answers a mention once, as the bot, as a reply to the mention', async () => {
    const [alice, bob] = [await makeUser(), await makeUser()];
    const room = await makeGroup(alice, bob);
    await say(room, bob, 'who is free on Friday?');
    const mention = await say(room, alice, '@flick what is 2+2?');

    expect(await flickBotOnMessage(deps(), mention)).toBe('replied');
    expect(fake.prompts).toHaveLength(1);
    expect(fake.prompts[0]).toContain('who is free on Friday?');

    const bot = await botMessages(room);
    expect(bot).toEqual([
      { seq: mention.seq + 1, body_text: 'fake answer', reply_to_id: mention.id },
    ]);

    // The dispatcher may deliver the same event again: still one answer.
    expect(await flickBotOnMessage(deps(), mention)).toBe('ignored');
    expect(await botMessages(room)).toHaveLength(1);
    expect(fake.prompts).toHaveLength(1);

    // The reply went through the outbox like any message.
    const events = await db
      .selectFrom('outbox')
      .select('payload')
      .where('partition_key', '=', room)
      .execute();
    expect(events.map((e) => (e.payload as { sender_id: string }).sender_id)).toContain(
      FLICK_BOT_USER_ID,
    );
  });

  it('does not answer messages without a mention, or messages written by bots', async () => {
    const alice = await makeUser();
    const room = await makeGroup(alice);
    const plain = await say(room, alice, 'hello everyone');
    expect(await flickBotOnMessage(deps(), plain)).toBe('ignored');

    // The bot's own message mentions @flick: no loop.
    const echo = await allocateSeqAndInsertMessage(db, {
      conversationId: room,
      senderId: FLICK_BOT_USER_ID,
      senderDeviceId: null,
      clientMessageId: null,
      type: 'text',
      bodyText: 'ask me with @flick anytime',
      authorize: false,
    });
    expect(await flickBotOnMessage(deps(), echo.message)).toBe('ignored');

    // Any other bot user is ignored too.
    const other = await db
      .insertInto('users')
      .values({
        username: `bot_${randomUUID().slice(0, 6)}`,
        display_name: 'Other bot',
        is_bot: true,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const fromBot = await allocateSeqAndInsertMessage(db, {
      conversationId: room,
      senderId: other.id,
      senderDeviceId: null,
      clientMessageId: null,
      type: 'text',
      bodyText: '@flick hi',
      authorize: false,
    });
    expect(await flickBotOnMessage(deps(), fromBot.message)).toBe('ignored');

    expect(fake.prompts).toHaveLength(0);
    expect(await botMessages(room)).toHaveLength(1); // only the one we inserted by hand
  });

  it('stays quiet once a conversation or a user is over the limit', async () => {
    // Per conversation: 10 a minute, from different people.
    const people = await Promise.all(Array.from({ length: 12 }, () => makeUser()));
    const room = await makeGroup(...people);
    const outcomes: string[] = [];
    for (const person of people) {
      outcomes.push(await flickBotOnMessage(deps(), await say(room, person, '@flick hi')));
    }
    expect(outcomes.filter((o) => o === 'replied')).toHaveLength(10);
    expect(outcomes.slice(10)).toEqual(['rate_limited', 'rate_limited']);
    expect(await botMessages(room)).toHaveLength(10);

    // Per user: 5 a minute, spread over different conversations.
    const talker = await makeUser();
    const results: string[] = [];
    for (let i = 0; i < 6; i++) {
      const own = await makeGroup(talker);
      results.push(await flickBotOnMessage(deps(), await say(own, talker, '@flick hi')));
    }
    expect(results.at(-1)).toBe('rate_limited');
    expect(results.filter((r) => r === 'replied')).toHaveLength(5);
  });

  it('posts one short notice and does not retry when every provider fails', async () => {
    const alice = await makeUser();
    const room = await makeGroup(alice);
    const mention = await say(room, alice, '@flick hello?');
    fake.mode = 'down';

    expect(await flickBotOnMessage(deps(), mention)).toBe('unavailable');
    expect(fake.prompts).toHaveLength(1); // one attempt, no loop
    expect((await botMessages(room)).map((m) => m.body_text)).toEqual([UNAVAILABLE_TEXT]);
  });

  it('does nothing when no AI key is configured', async () => {
    const alice = await makeUser();
    const room = await makeGroup(alice);
    const mention = await say(room, alice, '@flick hello?');
    const quiet = { ...deps(), ai: aiServiceFromChain(new AiChain({ adapters: [] })) };
    expect(await flickBotOnMessage(quiet, mention)).toBe('ignored');
    expect(await botMessages(room)).toHaveLength(0);
  });
});
