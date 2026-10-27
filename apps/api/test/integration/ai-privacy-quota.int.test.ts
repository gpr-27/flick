/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment -- test responses are untyped JSON */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { AiChain, type ProviderAdapter, type ProviderCallParams } from '@chat/ai';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { loadStyleSample } from '../../src/modules/ai/style.js';
import { aiServiceFromChain } from '../../src/modules/ai/service.js';
import { autoTranscribeOnMessage } from '../../src/modules/ai/transcripts.js';
import { createStorage } from '../../src/modules/media/domain/storage.js';
import {
  attachment,
  createDatabase,
  direct,
  send,
  startStack,
  type Stack,
  type TestDatabase,
  type TestUser,
} from './harness.js';

// The per-chat "Allow Flick to read this chat" switch and the daily quota on transcription,
// translation and style samples, and "Download / Clear my AI data" for transcripts and prefs.

class Translator implements ProviderAdapter {
  readonly provider = 'groq' as const;
  readonly account = '1';
  readonly models = ['fake'];
  calls = 0;
  prompts: string[] = [];
  complete({ request }: ProviderCallParams): Promise<string> {
    this.calls += 1;
    const text = request.messages
      .map((m) => (typeof m.content === 'string' ? m.content : ''))
      .join('');
    this.prompts.push(text);
    const found = /<items>\n([\s\S]*)\n<\/items>/.exec(text);
    if (!found) return Promise.resolve('Short and friendly.');
    const items = JSON.parse(found[1]!) as string[];
    return Promise.resolve(JSON.stringify(items.map((t) => `T:${t}`)));
  }
  async *stream(params: ProviderCallParams): AsyncIterable<string> {
    yield await this.complete(params);
  }
}

const LIMIT = 6;
const translator = new Translator();
let database: TestDatabase;
let stack: Stack;
const realFetch = globalThis.fetch;
let groq: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

beforeAll(async () => {
  database = await createDatabase('aipq');
  stack = await startStack({
    databaseUrl: database.url,
    env: { GROQ_API_KEY_1: 'test-key', AI_DAILY_LIMIT: String(LIMIT) },
    ai: aiServiceFromChain(new AiChain({ adapters: [translator] })),
  });
});
afterAll(async () => {
  await stack.stop();
  await database.drop();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

function fakeGroq(text = 'Hello'): void {
  groq = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  groq.mockImplementation(() =>
    Promise.resolve(new Response(JSON.stringify({ text, language: 'english', duration: 2 }))),
  );
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    return url.startsWith('https://api.groq.com') ? groq(url, init) : realFetch(input, init);
  };
}

/** Two users in a chat. */
async function chat(): Promise<{ alice: TestUser; bob: TestUser; conv: string }> {
  const [alice, bob] = [await stack.user('alice'), await stack.user('bob')];
  return { alice, bob, conv: await direct(stack, alice, bob) };
}

async function voiceNote(alice: TestUser, conv: string): Promise<{ att: string; id: string }> {
  const att = await attachment(stack.db, alice, 'voice');
  const row = await stack.db
    .selectFrom('attachments')
    .select('object_key')
    .where('id', '=', att)
    .executeTakeFirstOrThrow();
  const storage = createStorage(stack.config)!;
  await storage.client.send(
    new PutObjectCommand({ Bucket: storage.bucket, Key: row.object_key, Body: Buffer.from('x') }),
  );
  storage.client.destroy();
  storage.signer.destroy();
  const res = await send(stack, alice, conv, {
    type: 'voice',
    attachment_id: att,
    duration_ms: 2000,
    waveform: [5, 6],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { att, id: res.body.message_id as string };
}

const aiOff = (user: TestUser, conv: string) =>
  stack.call(user, 'PUT', `/ai/privacy/${conv}`, { allow: false });
const used = async (user: TestUser): Promise<number> =>
  (await stack.call(user, 'GET', '/ai/usage')).body.used as number;
const batch = (user: TestUser, conv: string, id = 'm1', text = 'hello') =>
  stack.call(user, 'POST', '/ai/translate-batch', {
    conversation_id: conv,
    target_language: 'Telugu',
    items: [{ id, text }],
    cache: true,
  });

describe('Allow Flick to read this chat: off', () => {
  it('refuses transcribe, transcript lookup/edit and translate-batch with the same message', async () => {
    const { alice, bob, conv } = await chat();
    const { att } = await voiceNote(alice, conv);
    await aiOff(bob, conv);
    fakeGroq();
    for (const res of [
      await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: att }),
      await stack.call(bob, 'GET', `/ai/transcript/${att}`),
      await stack.call(bob, 'PUT', `/ai/transcript/${att}`, { text: 'x' }),
      await batch(bob, conv),
    ]) {
      expect(res.status).toBe(403);
      expect(res.body.error.message).toBe('AI is turned off for this chat');
    }
    expect(groq).not.toHaveBeenCalled();
    expect(await used(bob)).toBe(0); // refused before anything was counted
    // Alice did not switch it off: it works for her.
    expect((await batch(alice, conv)).status).toBe(200);
  });

  it('is applied to /ai/translate too (the existing guard sees the chat id)', async () => {
    const { bob, conv } = await chat();
    await aiOff(bob, conv);
    const res = await stack.call(bob, 'POST', '/ai/translate', {
      text: 'hello',
      targetLang: 'Hindi',
      conversation_id: conv,
    });
    expect(res.status).toBe(403);
    expect(res.body.error.message).toBe('AI is turned off for this chat');
  });

  it('keeps that chat out of the style samples', async () => {
    const { alice, bob, conv } = await chat();
    const other = await stack.user('carol');
    const conv2 = await direct(stack, alice, other);
    await send(stack, alice, conv, { type: 'text', text: 'secret private words' });
    await send(stack, alice, conv2, { type: 'text', text: 'open public words' });
    expect(await loadStyleSample(stack.db, alice.id)).toEqual(
      expect.arrayContaining(['secret private words', 'open public words']),
    );
    await aiOff(alice, conv);
    const sample = await loadStyleSample(stack.db, alice.id);
    expect(sample).toContain('open public words');
    expect(sample).not.toContain('secret private words');
    void bob;
  });

  it('keeps that chat out of the style profile refresh too', async () => {
    const { alice, conv } = await chat();
    const other = await stack.user('dave');
    const conv2 = await direct(stack, alice, other);
    for (let i = 0; i < 12; i++) {
      await send(stack, alice, conv, { type: 'text', text: `private line number ${i}` });
      await send(stack, alice, conv2, { type: 'text', text: `public line number ${i}` });
    }
    await aiOff(alice, conv);
    translator.prompts.length = 0;
    const res = await stack.call(alice, 'POST', '/ai/style-profile');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const prompt = translator.prompts.join('\n');
    expect(prompt).toContain('public line number');
    expect(prompt).not.toContain('private line number');
  });

  it('auto-transcribe skips the chat when nobody who wants it allows AI there', async () => {
    const { alice, bob, conv } = await chat();
    await stack.call(bob, 'PUT', `/ai/transcribe-prefs/${conv}`, { enabled: true });
    await aiOff(bob, conv);
    fakeGroq();
    const { id } = await voiceNote(alice, conv);
    const message = await stack.db
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    const deps = {
      db: stack.db,
      redis: stack.redis,
      config: stack.config,
      logger: console as never,
    };
    expect(await autoTranscribeOnMessage(deps, message)).toBe('skipped');
    expect(groq).not.toHaveBeenCalled();
  });
});

describe('daily quota', () => {
  it('counts transcribe (once per Whisper call), translate-batch (not cached answers) and auto-transcribe', async () => {
    const { alice, bob, conv } = await chat();
    const a = await voiceNote(alice, conv);
    fakeGroq();
    expect(await used(bob)).toBe(0);
    expect((await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: a.att })).status).toBe(
      200,
    );
    expect(await used(bob)).toBe(1);
    // already transcribed: no Whisper call, no quota
    await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: a.att });
    expect(await used(bob)).toBe(1);

    await batch(bob, conv, 'x1', 'one');
    expect(await used(bob)).toBe(2);
    await batch(bob, conv, 'x1', 'one'); // cached for this reader
    expect(await used(bob)).toBe(2);
    const feature = (await stack.call(bob, 'GET', '/ai/usage')).body.by_feature as {
      feature: string;
    }[];
    expect(feature.map((f) => f.feature).sort()).toEqual(['transcribe', 'translate-batch']);

    // auto-transcribe is paid by the member it is for
    await stack.call(bob, 'PUT', `/ai/transcribe-prefs/${conv}`, { enabled: true });
    const b = await voiceNote(alice, conv);
    const message = await stack.db
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', b.id)
      .executeTakeFirstOrThrow();
    const deps = {
      db: stack.db,
      redis: stack.redis,
      config: stack.config,
      logger: console as never,
    };
    expect(await autoTranscribeOnMessage(deps, message)).toBe('done');
    expect(await used(bob)).toBe(3);
    const row = await stack.db
      .selectFrom('message_transcripts')
      .select('author_id')
      .where('message_id', '=', b.id)
      .executeTakeFirstOrThrow();
    expect(row.author_id).toBe(bob.id);
  });

  it('shows the limit message for a manual action and skips quietly in the background', async () => {
    const { alice, bob, conv } = await chat();
    fakeGroq();
    for (let i = 0; i < LIMIT; i++) await batch(bob, conv, `q${i}`, `text ${i}`);
    const over = await batch(bob, conv, 'late', 'one more');
    expect(over.status).toBe(429);
    expect(over.body.error.message).toMatch(/Daily AI limit reached/);

    const n = await voiceNote(alice, conv);
    const manual = await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: n.att });
    expect(manual.status).toBe(429);
    expect(manual.body.error.message).toMatch(/Daily AI limit reached/);
    expect(groq).not.toHaveBeenCalled();

    await stack.call(bob, 'PUT', `/ai/transcribe-prefs/${conv}`, { enabled: true });
    const message = await stack.db
      .selectFrom('messages')
      .selectAll()
      .where('id', '=', n.id)
      .executeTakeFirstOrThrow();
    const deps = {
      db: stack.db,
      redis: stack.redis,
      config: stack.config,
      logger: console as never,
    };
    expect(await autoTranscribeOnMessage(deps, message)).toBe('skipped');
    expect(groq).not.toHaveBeenCalled();
  });
});

describe('Download / Clear my AI data', () => {
  it('includes and deletes transcripts the person caused and their translation settings', async () => {
    const { alice, bob, conv } = await chat();
    const note = await voiceNote(alice, conv);
    fakeGroq('నమస్కారం');
    await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: note.att });
    await stack.call(bob, 'PUT', `/ai/auto-translate/${conv}`, { target_language: 'Telugu' });
    await stack.call(bob, 'PUT', `/ai/transcribe-prefs/${conv}`, { enabled: true });
    await stack.call(bob, 'PATCH', '/ai/translation-settings', {
      auto_transcribe: true,
      dont_translate: ['Flick'],
    });

    const data = (await stack.call(bob, 'GET', '/ai/data')).body;
    expect(data.translation.transcripts).toEqual([
      expect.objectContaining({ message_id: note.id, text: 'నమస్కారం' }),
    ]);
    expect(data.translation.auto_translate).toEqual([
      { conversation_id: conv, target_language: 'Telugu' },
    ]);
    expect(data.translation.chat_transcribe).toEqual([{ conversation_id: conv, enabled: true }]);
    expect(data.translation.settings).toEqual({ auto_transcribe: true, dont_translate: ['Flick'] });
    expect(data.flick_assistant.ratings).toEqual([]);
    expect(data.writing).toBeDefined();
    // Alice caused nothing: her download holds none of it.
    expect((await stack.call(alice, 'GET', '/ai/data')).body.translation.transcripts).toEqual([]);

    expect((await stack.call(bob, 'DELETE', '/ai/data')).status).toBe(204);
    const after = (await stack.call(bob, 'GET', '/ai/data')).body;
    expect(after.translation).toEqual({
      transcripts: [],
      auto_translate: [],
      chat_transcribe: [],
      settings: null,
    });
    expect(
      (await stack.call(alice, 'GET', `/ai/transcript/${note.att}`)).body.transcript,
    ).toBeNull();
  });
});
