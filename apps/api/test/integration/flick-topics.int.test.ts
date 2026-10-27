import { randomUUID } from 'node:crypto';
import { AiChain, type ProviderAdapter, type ProviderCallParams } from '@chat/ai';
import { ENDPOINTS, buildPath } from '@chat/contracts';
import { FLICK_BOT_USER_ID, allocateSeqAndInsertMessage, migrateUp } from '@chat/db';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createDb } from '../../src/db.js';
import { createLogger } from '../../src/logger.js';
import { flickBotOnMessage } from '../../src/modules/ai/bot.js';
import { aiServiceFromChain } from '../../src/modules/ai/service.js';
import { Redis } from '../../src/redis.js';

// Resuming a finished Flick topic, against real Postgres and Redis and a fake provider that
// remembers the prompts it was given.

class FakeProvider implements ProviderAdapter {
  readonly provider = 'groq' as const;
  readonly account = '1';
  readonly models = ['fake-model'];
  prompts: string[] = [];
  complete({ request }: ProviderCallParams): Promise<string> {
    this.prompts.push(
      request.messages.map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n'),
    );
    return Promise.resolve(request.responseFormat === 'json' ? '{"facts":[]}' : 'fake answer');
  }
  async *stream(params: ProviderCallParams): AsyncIterable<string> {
    yield await this.complete(params);
  }
}

const adminUrl = process.env.DATABASE_URL!;
const dbName = `t_${randomUUID().replace(/-/g, '').slice(0, 16)}`;
const fake = new FakeProvider();
const chain = new AiChain({ adapters: [fake] });
let db: ReturnType<typeof createDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
let redis: Redis;

const dbUrl = () => {
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  return url.toString();
};
const config = () => loadConfig({ ...process.env, DATABASE_URL: dbUrl(), LOG_LEVEL: 'silent' });
const deps = () => ({
  db,
  redis,
  logger: createLogger('silent'),
  ai: aiServiceFromChain(chain),
  config: config(),
  checks: [],
});

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  db = createDb(dbUrl(), 10);
  await migrateUp(db);
  redis = new Redis(process.env.REDIS_URL!);
  app = await buildApp({
    config: config(),
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

async function makeUser(): Promise<string> {
  const u = await db
    .insertInto('users')
    .values({ username: `u_${randomUUID().slice(0, 8)}`, display_name: 'Asha' })
    .returning('id')
    .executeTakeFirstOrThrow();
  return u.id;
}

async function flickChat(userId: string): Promise<string> {
  const chat = await db
    .insertInto('conversations')
    .values({ type: 'direct', created_by: userId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await db
    .insertInto('conversation_members')
    .values([
      { conversation_id: chat.id, user_id: userId },
      { conversation_id: chat.id, user_id: FLICK_BOT_USER_ID },
    ])
    .execute();
  return chat.id;
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

const api = (userId: string, method: 'GET' | 'POST', url: string, payload?: object) =>
  app.inject({
    method,
    url,
    headers: { 'x-user-id': userId, accept: 'application/json' },
    ...(payload ? { payload } : {}),
  });

interface Topic {
  id: string;
  title: string;
  resumes_topic_id: string | null;
}
const topicOf = (res: { json: <T>() => T }): Topic => res.json<Topic>();

const resumePath = (id: string) => buildPath('', ENDPOINTS.flick.resumeTopic.path, { id });

describe('resuming a Flick topic', () => {
  it('lets Flick read the resumed topic again, and only that', async () => {
    const alice = await makeUser();
    const chat = await flickChat(alice);

    // Topic 1: talk about taxes. Topic 2: talk about Goa.
    const t1 = topicOf(await api(alice, 'POST', '/flick/topics', { title: 'Taxes' }));
    await say(chat, alice, 'How do I file my taxes?');
    await say(chat, FLICK_BOT_USER_ID, 'Use form ITR-1 for salaried people.');
    const t2 = topicOf(await api(alice, 'POST', '/flick/topics', { title: 'Goa' }));
    await say(chat, alice, 'Best beach in Goa?');
    await say(chat, FLICK_BOT_USER_ID, 'Palolem is calm.');

    // Without resuming, topic 2 knows nothing of the taxes.
    fake.prompts = [];
    const q2 = await say(chat, alice, 'And where to eat there?');
    expect(await flickBotOnMessage(deps(), q2)).toBe('replied');
    const plain = fake.prompts.find((p) => p.includes('And where to eat there?'))!;
    expect(plain).toContain('Best beach in Goa?');
    expect(plain).not.toContain('ITR-1');
    expect(plain).not.toContain('Earlier in this topic');

    // Resume the taxes topic.
    const res = await api(alice, 'POST', resumePath(t1.id));
    expect(res.statusCode).toBe(200);
    const resumed = ENDPOINTS.flick.resumeTopic.response.parse(res.json());
    expect(resumed.title).toBe('Resumed: Taxes');
    expect(resumed.resumes_topic_id).toBe(t1.id);
    expect(resumed.id).not.toBe(t2.id);

    // Resuming again while it is current (or the double tap) changes nothing.
    const again = await api(alice, 'POST', resumePath(t1.id));
    expect(topicOf(again).id).toBe(resumed.id);
    expect(topicOf(await api(alice, 'POST', resumePath(resumed.id))).id).toBe(resumed.id);
    const list = (await api(alice, 'GET', '/flick/topics')).json<{ topics: unknown[] }>().topics;
    expect(list).toHaveLength(3);

    fake.prompts = [];
    const q3 = await say(chat, alice, 'Remind me which form again?');
    expect(await flickBotOnMessage(deps(), q3)).toBe('replied');
    const prompt = fake.prompts.find((p) => p.includes('Remind me which form again?'))!;
    expect(prompt).toContain('Earlier in this topic');
    expect(prompt).toContain('Asha: How do I file my taxes?');
    expect(prompt).toContain('Use form ITR-1');
    expect(prompt.indexOf('ITR-1')).toBeLessThan(prompt.indexOf('Remind me which form again?'));
    // The Goa topic stays out.
    expect(prompt).not.toContain('Palolem');
    expect(prompt).not.toContain('Best beach');
  });

  it('only resumes your own topics, in your own Flick chat', async () => {
    const [alice, bob] = [await makeUser(), await makeUser()];
    await flickChat(alice);
    const topic = topicOf(await api(alice, 'POST', '/flick/topics', { title: 'Mine' }));
    expect((await api(bob, 'POST', resumePath(topic.id))).statusCode).toBe(404);
    expect((await api(alice, 'POST', resumePath(randomUUID()))).statusCode).toBe(404);
    expect((await api(alice, 'POST', '/flick/topics/not-an-id/resume')).statusCode).toBe(400);
    // A user without a Flick chat cannot resume anything (and cannot own a topic to resume).
    const noChat = await makeUser();
    expect((await api(noChat, 'POST', resumePath(topic.id))).statusCode).toBe(404);
  });

  it('keeps the clean-up working with resumed topics', async () => {
    const alice = await makeUser();
    const chat = await flickChat(alice);
    const first = topicOf(await api(alice, 'POST', '/flick/topics', { title: 'One' }));
    await say(chat, alice, 'hello');
    await api(alice, 'POST', '/flick/topics', { title: 'Two' });
    await say(chat, alice, 'again');
    await api(alice, 'POST', resumePath(first.id));
    await db.deleteFrom('ai_topics').where('user_id', '=', alice).execute();
    const left = await db
      .selectFrom('ai_topics')
      .select('id')
      .where('user_id', '=', alice)
      .execute();
    expect(left).toEqual([]);
  });
});
