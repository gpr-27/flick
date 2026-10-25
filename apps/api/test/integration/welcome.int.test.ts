import { randomUUID } from 'node:crypto';
import { AiChain, type ProviderAdapter, type ProviderCallParams } from '@chat/ai';
import {
  FLICK_BOT_USER_ID,
  allocateSeqAndInsertMessage,
  findOrCreateDirectConversation,
  migrateUp,
} from '@chat/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { flickBotOnMessage } from '../../src/modules/ai/bot.js';
import { aiServiceFromChain } from '../../src/modules/ai/service.js';
import { ensureFlickWelcome, welcomeText } from '../../src/modules/ai/welcome.js';
import { createAuth, type Clerk } from '../../src/modules/auth/index.js';
import { Redis } from '../../src/redis.js';

// The welcome message in a new person's chat with Flick, through the real sign-in path
// (a fake Clerk: the token "token-<name>" belongs to the Clerk user "user_<name>").

class CountingProvider implements ProviderAdapter {
  readonly provider = 'groq' as const;
  readonly account = '1';
  readonly models = ['fake-model'];
  calls = 0;
  complete(_params: ProviderCallParams): Promise<string> {
    this.calls += 1;
    return Promise.resolve('fake answer');
  }
  async *stream(params: ProviderCallParams): AsyncIterable<string> {
    yield await this.complete(params);
  }
}

const clerk: Clerk = {
  verify: (token) => Promise.resolve(`user_${token.slice(6)}`),
  profile: (clerkId) => {
    const name = clerkId.slice(5);
    return Promise.resolve({
      username: name,
      email: `${name}@example.com`,
      displayName: `${name} Person`,
      imageUrl: null,
    });
  },
};

const adminUrl = process.env.DATABASE_URL!;
const dbName = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const provider = new CountingProvider();
let db: ReturnType<typeof createDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let redis: Redis;
let config: ReturnType<typeof loadConfig>;

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  config = loadConfig({ ...process.env, DATABASE_URL: url.toString(), LOG_LEVEL: 'silent' });
  db = createDb(config.DATABASE_URL, 10);
  await migrateUp(db);
  redis = new Redis(process.env.REDIS_URL!);
  const auth = createAuth({ db, redis, clerk });
  app = await buildApp({
    config,
    logger: createLogger('silent'),
    db,
    redis,
    checks: [],
    isShuttingDown: () => false,
    authenticate: auth.authenticate,
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.destroy();
  redis.disconnect();
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

const signIn = (name: string, device = randomUUID()) =>
  app.inject({
    method: 'GET',
    url: '/users/me',
    headers: { authorization: `Bearer token-${name}`, 'x-device-id': device },
  });

async function userId(name: string) {
  const row = await db
    .selectFrom('users')
    .select('id')
    .where('clerk_id', '=', `user_${name}`)
    .executeTakeFirstOrThrow();
  return row.id;
}

async function makeUser(name: string) {
  const row = await db
    .insertInto('users')
    .values({ username: `${name}_${randomUUID().slice(0, 6)}`, display_name: name })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/** Every message of the person's chat with Flick (there is at most one such chat). */
async function flickChat(id: string) {
  const [lo, hi] = id < FLICK_BOT_USER_ID ? [id, FLICK_BOT_USER_ID] : [FLICK_BOT_USER_ID, id];
  const pair = await db
    .selectFrom('direct_pairs')
    .select('conversation_id')
    .where('user_lo', '=', lo)
    .where('user_hi', '=', hi)
    .executeTakeFirst();
  if (!pair) return null;
  const messages = await db
    .selectFrom('messages')
    .select(['id', 'seq', 'sender_id', 'body_text'])
    .where('conversation_id', '=', pair.conversation_id)
    .orderBy('seq')
    .execute();
  return { conversationId: pair.conversation_id, messages };
}

describe('Flick welcome message', () => {
  it('a new account gets exactly one welcome from Flick as message 1, unread', async () => {
    expect((await signIn('welcomed')).statusCode).toBe(200);
    const id = await userId('welcomed');
    const chat = await flickChat(id);
    expect(chat?.messages).toHaveLength(1);
    const [welcome] = chat!.messages;
    expect(welcome).toMatchObject({ seq: 1, sender_id: FLICK_BOT_USER_ID });
    expect(welcome!.body_text).toContain('welcomed Person');
    expect(welcome!.body_text).toContain('@flick');

    // Nothing read yet, so the chat list shows one unread message.
    const member = await db
      .selectFrom('conversation_members')
      .select('read_seq')
      .where('conversation_id', '=', chat!.conversationId)
      .where('user_id', '=', id)
      .executeTakeFirstOrThrow();
    expect(member.read_seq).toBe(0);
    // ...and it has an outbox event, like any message.
    const outbox = await db
      .selectFrom('outbox')
      .select('payload')
      .where('partition_key', '=', chat!.conversationId)
      .execute();
    expect(JSON.stringify(outbox)).toContain(welcome!.id);
  });

  it('repeated and concurrent sign-ins keep one welcome', async () => {
    await signIn('repeat');
    await Promise.all([signIn('repeat'), signIn('repeat'), signIn('repeat')]);
    expect((await flickChat(await userId('repeat')))?.messages).toHaveLength(1);

    // Four first sign-ins from four devices at the same moment.
    await Promise.all([signIn('race'), signIn('race'), signIn('race'), signIn('race')]);
    const id = await userId('race');
    expect((await flickChat(id))?.messages).toHaveLength(1);

    // Calling the helper again, in parallel, still writes nothing new.
    const results = await Promise.all(
      Array.from({ length: 5 }, () => ensureFlickWelcome(db, id, { create: true })),
    );
    expect(results.every((r) => !r)).toBe(true);
    expect((await flickChat(id))?.messages).toHaveLength(1);
  });

  it('concurrent first runs of the helper alone produce one welcome', async () => {
    const id = await makeUser('Solo');
    const results = await Promise.all(
      Array.from({ length: 6 }, () => ensureFlickWelcome(db, id, { create: true })),
    );
    expect(results.filter(Boolean)).toHaveLength(1);
    expect((await flickChat(id))?.messages).toHaveLength(1);
  });

  it('an older account that already talked to Flick gets none; one without a chat gets no chat', async () => {
    const talker = await makeUser('talker');
    const never = await makeUser('never');
    const { conversationId } = await findOrCreateDirectConversation(db, talker, FLICK_BOT_USER_ID);
    await allocateSeqAndInsertMessage(db, {
      conversationId,
      senderId: talker,
      senderDeviceId: null,
      clientMessageId: null,
      type: 'text',
      bodyText: 'hello flick',
    });
    expect(await ensureFlickWelcome(db, talker, { create: false })).toBe(false);
    expect((await flickChat(talker))?.messages.map((m) => m.body_text)).toEqual(['hello flick']);

    expect(await ensureFlickWelcome(db, never, { create: false })).toBe(false);
    expect(await flickChat(never)).toBeNull();
  });

  it('an older account whose Flick chat is empty gets the welcome once', async () => {
    const id = await makeUser('Empty');
    await findOrCreateDirectConversation(db, id, FLICK_BOT_USER_ID);
    expect(await ensureFlickWelcome(db, id, { create: false })).toBe(true);
    expect(await ensureFlickWelcome(db, id, { create: false })).toBe(false);
    expect((await flickChat(id))?.messages).toHaveLength(1);
  });

  it('the bot does not answer its own welcome', async () => {
    await signIn('quiet');
    const id = await userId('quiet');
    const chat = (await flickChat(id))!;
    const welcome = await db
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', chat.messages[0]!.id)
      .executeTakeFirstOrThrow();
    const outcome = await flickBotOnMessage(
      {
        db,
        redis,
        logger: createLogger('silent'),
        ai: aiServiceFromChain(new AiChain({ adapters: [provider] })),
        config,
        checks: [],
      },
      welcome,
    );
    expect(outcome).toBe('ignored');
    expect(provider.calls).toBe(0);
    expect((await flickChat(id))?.messages).toHaveLength(1);
  });

  it('escapes markdown in the display name', () => {
    expect(welcomeText('*Bob*_x')).toContain('Hi \\*Bob\\*\\_x,');
    expect(welcomeText('   ')).toContain('Hi there,');
  });
});
