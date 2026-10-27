/* eslint-disable @typescript-eslint/no-unsafe-member-access -- test responses are untyped JSON */
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
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

// POST /ai/transcribe against real Postgres and MinIO, with Groq faked: the stored audio is what
// reaches Whisper (with a matching file name), the transcript is stored for the whole chat, a
// second call does not call Groq again, a language hint transcribes again, and failures say why.
let database: TestDatabase;
let stack: Stack;
let alice: TestUser;
let bob: TestUser;
let conversation: string;
const realFetch = globalThis.fetch;
let groq: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

beforeAll(async () => {
  database = await createDatabase('transcribe');
  stack = await startStack({ databaseUrl: database.url, env: { GROQ_API_KEY_1: 'test-key' } });
  alice = await stack.user('alice');
  bob = await stack.user('bob');
  conversation = await direct(stack, alice, bob);
});
afterAll(async () => {
  await stack.stop();
  await database.drop();
});
afterEach(() => {
  globalThis.fetch = realFetch;
});

/** A voice message whose audio really is in storage. */
async function voiceNote(): Promise<{ attachmentId: string; messageId: string }> {
  const attachmentId = await attachment(stack.db, alice, 'voice');
  const row = await stack.db
    .selectFrom('attachments')
    .select('object_key')
    .where('id', '=', attachmentId)
    .executeTakeFirstOrThrow();
  const storage = createStorage(stack.config)!;
  await storage.client.send(
    new PutObjectCommand({
      Bucket: storage.bucket,
      Key: row.object_key,
      Body: Buffer.from('fake-webm-audio'),
      ContentType: 'audio/webm',
    }),
  );
  storage.client.destroy();
  storage.signer.destroy();
  const res = await send(stack, alice, conversation, {
    type: 'voice',
    attachment_id: attachmentId,
    duration_ms: 4000,
    waveform: [10, 20, 30],
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { attachmentId, messageId: res.body.message_id as string };
}

/** Groq answers with `replies` in order; every other request goes to the real fetch. */
function fakeGroq(...replies: (Response | Record<string, unknown>)[]): void {
  groq = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
  for (const r of replies) {
    groq.mockResolvedValueOnce(r instanceof Response ? r : new Response(JSON.stringify(r)));
  }
  globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
    const url = input instanceof Request ? input.url : input.toString();
    return url.startsWith('https://api.groq.com') ? groq(url, init) : realFetch(input, init);
  };
}

const formOf = (call: number): FormData =>
  (groq.mock.calls[call] as [string, RequestInit])[1].body as FormData;

describe('POST /ai/transcribe', () => {
  it('sends the stored audio to Whisper, stores the transcript for the chat, and reuses it', async () => {
    const { attachmentId, messageId } = await voiceNote();
    fakeGroq({ text: ' Hello there ', language: 'english', duration: 4 });

    const first = await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: attachmentId });
    expect(first.status, JSON.stringify(first.body)).toBe(200);
    expect(first.body.text).toBe('Hello there');
    const form = formOf(0);
    expect((form.get('file') as File).name).toBe('voice.webm');
    expect(await (form.get('file') as File).text()).toBe('fake-webm-audio');
    expect(form.get('model')).toBe('whisper-large-v3-turbo');

    const stored = await stack.call(alice, 'GET', `/ai/transcript/${attachmentId}`);
    expect(stored.body.transcript).toMatchObject({ text: 'Hello there', language: 'English' });
    const row = await stack.db
      .selectFrom('message_transcripts')
      .select('text')
      .where('message_id', '=', messageId)
      .executeTakeFirst();
    expect(row?.text).toBe('Hello there');

    const again = await stack.call(alice, 'POST', '/ai/transcribe', {
      attachment_id: attachmentId,
    });
    expect(again.body.text).toBe('Hello there');
    expect(groq).toHaveBeenCalledTimes(1);
  });

  it('transcribes again with a language hint and replaces the transcript', async () => {
    const { attachmentId } = await voiceNote();
    fakeGroq(
      { text: 'wrong words', language: 'english' },
      { text: 'నమస్కారం 😀', language: 'telugu' },
    );
    await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: attachmentId });
    const redo = await stack.call(bob, 'POST', '/ai/transcribe', {
      attachment_id: attachmentId,
      language: 'Telugu',
    });
    expect(redo.body.text).toBe('నమస్కారం 😀');
    expect(formOf(1).get('language')).toBe('te');
    const stored = await stack.call(alice, 'GET', `/ai/transcript/${attachmentId}`);
    expect(stored.body.transcript).toMatchObject({ text: 'నమస్కారం 😀', language: 'Telugu' });
  });

  it('says why when Groq is rate limited or fails, and stores nothing', async () => {
    const { attachmentId } = await voiceNote();
    fakeGroq(new Response('{}', { status: 429 }));
    const busy = await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: attachmentId });
    expect(busy.status).toBe(429);
    expect(busy.body.error.message).toMatch(/busy/i);

    fakeGroq(new Response('{}', { status: 500 }));
    const down = await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: attachmentId });
    expect(down.status).toBe(503);
    expect(down.body.error.message).toMatch(/try again/i);
    expect(
      (await stack.call(bob, 'GET', `/ai/transcript/${attachmentId}`)).body.transcript,
    ).toBeNull();
  });

  it('returns empty text for silence and does not store it', async () => {
    const { attachmentId } = await voiceNote();
    fakeGroq({ text: '', language: 'english' });
    const res = await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: attachmentId });
    expect(res.status).toBe(200);
    expect(res.body.text).toBe('');
    expect(
      (await stack.call(bob, 'GET', `/ai/transcript/${attachmentId}`)).body.transcript,
    ).toBeNull();
  });

  it("refuses a video with 'Videos can't be transcribed' and never calls Groq", async () => {
    const videoId = await attachment(stack.db, alice, 'video');
    const sent = await send(stack, alice, conversation, {
      type: 'video',
      attachment_id: videoId,
      width: 320,
      height: 240,
      duration_ms: 3000,
    });
    expect(sent.status, JSON.stringify(sent.body)).toBe(200);
    fakeGroq({ text: 'nope' });
    const res = await stack.call(bob, 'POST', '/ai/transcribe', { attachment_id: videoId });
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/Videos can't be transcribed/);
    expect(groq).not.toHaveBeenCalled();
  });

  it('refuses someone outside the chat', async () => {
    const { attachmentId } = await voiceNote();
    const eve = await stack.user('eve');
    fakeGroq({ text: 'secret' });
    const res = await stack.call(eve, 'POST', '/ai/transcribe', { attachment_id: attachmentId });
    expect(res.status).toBe(404);
    expect(groq).not.toHaveBeenCalled();
  });
});
