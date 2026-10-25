/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- test payloads are untyped JSON */
import {
  HistoryResponse,
  MessageRecord,
  PinnedList,
  SERVER_PAYLOADS,
  StarredList,
  SyncEvent,
  SyncPagePayload,
  type ContentType,
} from '@chat/contracts';
import { FLICK_BOT_USER_ID, allocateSeqAndInsertMessage } from '@chat/db';
import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { recordCall } from '../../src/modules/calls/repo/call-log.js';
import {
  attachment,
  cmid,
  createDatabase,
  direct,
  group,
  send,
  startStack,
  waitForOutboxDrained,
  waitUntil,
  type Client,
  type Stack,
  type TestDatabase,
  type TestUser,
} from './harness.js';

// THE CONTENT-TYPE MATRIX.
//
// The bug this guards against: the chat list built its own "last message" from raw columns and
// dropped `type`/`attachment_id`, so one voice note or photo as the newest message made the whole
// list fail to parse in production. Every way the server shows a message must produce a record
// that the contract schema (MessageRecord) accepts, and must agree with the others.
//
// For every content type (and the states a message can be in: edited, deleted, deleted for me,
// expired, view-once opened, with a reaction) one message is created, and then read back through
// every read path: chat list, single conversation, history, sync (POST /sync and the
// per-conversation GET), search, pins, starred, and the live Socket.IO new_message event
// (to another user and to the sender's other device). Forwarding is tried for the types the
// web app can forward.
//
// Note the chat list is parsed with MessageRecord directly: ConversationSummary.last_message
// has `.catch(null)`, which would hide exactly the failure we are looking for.

let database: TestDatabase;
let stack: Stack;

beforeAll(async () => {
  database = await createDatabase('matrix');
  stack = await startStack({ databaseUrl: database.url });
});
afterAll(async () => {
  await stack.stop();
  await database.drop();
});

type Viewer = 'reader' | 'sender';
type Kind =
  | 'full' //      content visible (or null because a view-once was opened)
  | 'deleted' //   deleted for everyone: a tombstone everywhere, but not in search
  | 'hidden'; //   deleted for me / expired: tombstone in sync and chat list, absent from history

interface Ctx {
  alice: TestUser; // sender
  bob: TestUser; // reader
  carol: TestUser; // forward target
  conv: string; // alice <-> bob
  fwd: string; // bob <-> carol
  token: string; // a unique word to find the message by search
}

interface Made {
  id: string;
  /** The content as the reader should see it before anything happens to the message. */
  content: Record<string, any> | null;
  /** Set when the message was sent through the API by alice. */
  clientMessageId?: string;
  senderId: string | null;
}

interface Case {
  name: string;
  type: ContentType;
  /** Does the text of this message go into search? */
  searchable?: boolean;
  make(c: Ctx): Promise<Made>;
  /** Something that happens to the message afterwards (edit, delete, open ...). */
  after?(c: Ctx, made: Made): Promise<void>;
  /** What each viewer should end up seeing. */
  view?(viewer: Viewer, made: Made): { kind: Kind; content: Record<string, any> | null };
  reactions?: { emoji: string; user_ids: (c: Ctx) => string[] }[];
  expiring?: boolean;
  forwardable?: boolean;
}

const word = () =>
  `zq${Math.random()
    .toString(36)
    .replace(/[^a-z]/g, '')
    .slice(0, 10)}x`;

async function sendAsAlice(c: Ctx, content: Record<string, any>): Promise<Made> {
  const clientMessageId = cmid();
  const res = await stack.call(c.alice, 'POST', `/conversations/${c.conv}/messages`, {
    client_message_id: clientMessageId,
    content,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return { id: res.body.message_id, content, clientMessageId, senderId: c.alice.id };
}

const img = (c: Ctx) => attachment(stack.db, c.alice, 'image');

const SENDABLE: Case[] = [
  {
    name: 'plain text',
    type: 'text',
    searchable: true,
    forwardable: true,
    make: (c) => sendAsAlice(c, { type: 'text', text: `hello ${c.token}` }),
  },
  {
    name: 'text with emoji, accents and newlines',
    type: 'text',
    searchable: true,
    forwardable: true,
    make: (c) => sendAsAlice(c, { type: 'text', text: `héllo wörld 👋🏽\nline two ${c.token}` }),
  },
  {
    name: 'text of the maximum length (16000 characters)',
    type: 'text',
    searchable: true,
    forwardable: true,
    make: (c) => sendAsAlice(c, { type: 'text', text: `${c.token} ${'a'.repeat(15_980)}` }),
  },
  {
    name: 'text that mentions a member',
    type: 'text',
    forwardable: true,
    searchable: true,
    make: (c) => sendAsAlice(c, { type: 'text', text: `hi ${c.token}`, mentions: [c.bob.id] }),
  },
  {
    name: 'text marked forwarded',
    type: 'text',
    forwardable: true,
    searchable: true,
    make: (c) => sendAsAlice(c, { type: 'text', text: `fwd ${c.token}`, forwarded: true }),
  },
  {
    name: 'text that replies to another message',
    type: 'text',
    searchable: true,
    forwardable: true,
    async make(c) {
      const first = await sendAsAlice(c, { type: 'text', text: 'the original' });
      return sendAsAlice(c, { type: 'text', text: `reply ${c.token}`, reply_to: first.id });
    },
  },
  {
    name: 'image with a caption',
    type: 'image',
    searchable: true,
    forwardable: true,
    async make(c) {
      return sendAsAlice(c, {
        type: 'image',
        attachment_id: await img(c),
        width: 640,
        height: 480,
        caption: `sunset ${c.token}`,
      });
    },
  },
  {
    name: 'image without a caption',
    type: 'image',
    forwardable: true,
    async make(c) {
      return sendAsAlice(c, { type: 'image', attachment_id: await img(c), width: 10, height: 20 });
    },
  },
  {
    name: 'view-once image',
    type: 'image',
    async make(c) {
      return sendAsAlice(c, {
        type: 'image',
        attachment_id: await img(c),
        width: 640,
        height: 480,
        view_once: true,
      });
    },
  },
  {
    name: 'video with a caption',
    type: 'video',
    searchable: true,
    forwardable: true,
    async make(c) {
      return sendAsAlice(c, {
        type: 'video',
        attachment_id: await attachment(stack.db, c.alice, 'video'),
        width: 1280,
        height: 720,
        duration_ms: 12_345,
        caption: `clip ${c.token}`,
      });
    },
  },
  {
    name: 'view-once video',
    type: 'video',
    async make(c) {
      return sendAsAlice(c, {
        type: 'video',
        attachment_id: await attachment(stack.db, c.alice, 'video'),
        width: 1280,
        height: 720,
        duration_ms: 1000,
        view_once: true,
      });
    },
  },
  {
    name: 'file with a caption',
    type: 'file',
    searchable: true,
    forwardable: true,
    async make(c) {
      return sendAsAlice(c, {
        type: 'file',
        attachment_id: await attachment(stack.db, c.alice, 'file'),
        file_name: 'report.pdf',
        size: 1234,
        caption: `see ${c.token}`,
      });
    },
  },
  {
    name: 'voice note',
    type: 'voice',
    forwardable: true,
    async make(c) {
      return sendAsAlice(c, {
        type: 'voice',
        attachment_id: await attachment(stack.db, c.alice, 'voice'),
        duration_ms: 4200,
        waveform: [0, 10, 50, 100, 33],
      });
    },
  },
  {
    name: 'view-once voice note',
    type: 'voice',
    async make(c) {
      return sendAsAlice(c, {
        type: 'voice',
        attachment_id: await attachment(stack.db, c.alice, 'voice'),
        duration_ms: 1500,
        waveform: [5, 5, 5],
        view_once: true,
      });
    },
  },
  {
    name: 'gif with a caption',
    type: 'gif',
    searchable: true,
    forwardable: true,
    make: (c) =>
      sendAsAlice(c, {
        type: 'gif',
        gif_id: 'abc123',
        url: 'https://media.giphy.com/media/abc123/giphy.gif',
        width: 480,
        height: 270,
        caption: `lol ${c.token}`,
      }),
  },
  {
    name: 'sticker',
    type: 'sticker',
    forwardable: true,
    make: (c) =>
      sendAsAlice(c, {
        type: 'sticker',
        sticker_id: 'st_1',
        url: 'https://media.giphy.com/media/st_1/giphy.gif',
      }),
  },
  {
    name: 'poll',
    type: 'poll',
    searchable: true,
    make: (c) =>
      sendAsAlice(c, {
        type: 'poll',
        question: `lunch ${c.token}?`,
        options: ['pizza', 'sushi', 'salad'],
        allow_multiple: true,
      }),
  },
];

const DELETED: Pick<Case, 'view'> = {
  view: () => ({ kind: 'deleted', content: null }),
};

const STATES: Case[] = [
  {
    name: 'edited text',
    type: 'text',
    searchable: true,
    forwardable: true,
    async make(c) {
      return sendAsAlice(c, { type: 'text', text: `before ${c.token}` });
    },
    async after(c, made) {
      const res = await stack.call(
        c.alice,
        'PATCH',
        `/conversations/${c.conv}/messages/${made.id}`,
        { content: { type: 'text', text: `after ${c.token}` } },
      );
      expect(res.status).toBe(204);
      made.content = { type: 'text', text: `after ${c.token}` };
    },
  },
  {
    name: 'edited image caption',
    type: 'image',
    searchable: true,
    async make(c) {
      return sendAsAlice(c, {
        type: 'image',
        attachment_id: await img(c),
        width: 5,
        height: 5,
        caption: `old ${c.token}`,
      });
    },
    async after(c, made) {
      const next = { ...made.content!, caption: `new ${c.token}` };
      const res = await stack.call(
        c.alice,
        'PATCH',
        `/conversations/${c.conv}/messages/${made.id}`,
        { content: next },
      );
      expect(res.status).toBe(204);
      made.content = next;
    },
  },
  {
    name: 'text deleted for everyone',
    type: 'text',
    searchable: true,
    ...DELETED,
    make: (c) => sendAsAlice(c, { type: 'text', text: `gone ${c.token}` }),
    async after(c, made) {
      const res = await stack.call(
        c.alice,
        'DELETE',
        `/conversations/${c.conv}/messages/${made.id}?for=everyone`,
      );
      expect(res.status).toBe(204);
    },
  },
  {
    name: 'voice note deleted for everyone',
    type: 'voice',
    ...DELETED,
    async make(c) {
      return sendAsAlice(c, {
        type: 'voice',
        attachment_id: await attachment(stack.db, c.alice, 'voice'),
        duration_ms: 900,
        waveform: [1, 2, 3],
      });
    },
    async after(c, made) {
      const res = await stack.call(
        c.alice,
        'DELETE',
        `/conversations/${c.conv}/messages/${made.id}?for=everyone`,
      );
      expect(res.status).toBe(204);
    },
  },
  {
    name: 'photo deleted for everyone',
    type: 'image',
    ...DELETED,
    async make(c) {
      return sendAsAlice(c, { type: 'image', attachment_id: await img(c), width: 5, height: 5 });
    },
    async after(c, made) {
      const res = await stack.call(
        c.bob,
        'DELETE',
        `/conversations/${c.conv}/messages/${made.id}?for=everyone`,
      );
      // bob is not the sender and a direct chat has no admins
      expect(res.status).toBe(403);
      const ok = await stack.call(
        c.alice,
        'DELETE',
        `/conversations/${c.conv}/messages/${made.id}?for=everyone`,
      );
      expect(ok.status).toBe(204);
    },
  },
  {
    name: 'text deleted for me by the reader (the sender still sees it)',
    type: 'text',
    searchable: true,
    make: (c) => sendAsAlice(c, { type: 'text', text: `hidden ${c.token}` }),
    view: (viewer, made) =>
      viewer === 'reader'
        ? { kind: 'hidden', content: null }
        : { kind: 'full', content: made.content },
    async after(c, made) {
      const res = await stack.call(
        c.bob,
        'DELETE',
        `/conversations/${c.conv}/messages/${made.id}?for=me`,
      );
      expect(res.status).toBe(204);
    },
  },
  {
    name: 'voice note deleted for me by the reader',
    type: 'voice',
    make: async (c) =>
      sendAsAlice(c, {
        type: 'voice',
        attachment_id: await attachment(stack.db, c.alice, 'voice'),
        duration_ms: 900,
        waveform: [1, 2, 3],
      }),
    view: (viewer, made) =>
      viewer === 'reader'
        ? { kind: 'hidden', content: null }
        : { kind: 'full', content: made.content },
    async after(c, made) {
      const res = await stack.call(
        c.bob,
        'DELETE',
        `/conversations/${c.conv}/messages/${made.id}?for=me`,
      );
      expect(res.status).toBe(204);
    },
  },
  {
    name: 'text in a chat with a disappearing timer, before it expires',
    type: 'text',
    searchable: true,
    expiring: true,
    forwardable: true,
    make: (c) => sendAsAlice(c, { type: 'text', text: `fleeting ${c.token}` }),
  },
  {
    name: 'text whose disappearing timer has run out (worker has not purged it yet)',
    type: 'text',
    searchable: true,
    expiring: true,
    make: (c) => sendAsAlice(c, { type: 'text', text: `expired ${c.token}` }),
    view: () => ({ kind: 'hidden', content: null }),
    async after(c, made) {
      await sql`UPDATE messages SET expire_at = now() - interval '1 second' WHERE id = ${made.id}`.execute(
        stack.db,
      );
    },
  },
  {
    name: 'image whose disappearing timer has run out',
    type: 'image',
    expiring: true,
    async make(c) {
      return sendAsAlice(c, { type: 'image', attachment_id: await img(c), width: 5, height: 5 });
    },
    view: () => ({ kind: 'hidden', content: null }),
    async after(_c, made) {
      await sql`UPDATE messages SET expire_at = now() - interval '1 second' WHERE id = ${made.id}`.execute(
        stack.db,
      );
    },
  },
  {
    name: 'view-once photo after the reader opened it (reader sees no content)',
    type: 'image',
    searchable: true,
    async make(c) {
      return sendAsAlice(c, {
        type: 'image',
        attachment_id: await img(c),
        width: 5,
        height: 5,
        caption: `secret ${c.token}`,
        view_once: true,
      });
    },
    view: (viewer, made) => ({ kind: 'full', content: viewer === 'reader' ? null : made.content }),
    async after(c, made) {
      const res = await stack.call(
        c.bob,
        'POST',
        `/conversations/${c.conv}/messages/${made.id}/open`,
      );
      expect(res.status).toBe(200);
    },
  },
  {
    name: 'view-once voice note after the reader opened it',
    type: 'voice',
    async make(c) {
      return sendAsAlice(c, {
        type: 'voice',
        attachment_id: await attachment(stack.db, c.alice, 'voice'),
        duration_ms: 800,
        waveform: [9],
        view_once: true,
      });
    },
    view: (viewer, made) => ({ kind: 'full', content: viewer === 'reader' ? null : made.content }),
    async after(c, made) {
      const res = await stack.call(
        c.bob,
        'POST',
        `/conversations/${c.conv}/messages/${made.id}/open`,
      );
      expect(res.status).toBe(200);
    },
  },
  {
    name: 'text with a reaction',
    type: 'text',
    searchable: true,
    forwardable: true,
    reactions: [{ emoji: '👍', user_ids: (c) => [c.bob.id] }],
    make: (c) => sendAsAlice(c, { type: 'text', text: `react ${c.token}` }),
    async after(c, made) {
      const res = await stack.call(
        c.bob,
        'PUT',
        `/conversations/${c.conv}/messages/${made.id}/reaction`,
        { emoji: '👍' },
      );
      expect(res.status).toBe(204);
    },
  },
  {
    name: 'photo with a reaction',
    type: 'image',
    reactions: [{ emoji: '❤️', user_ids: (c) => [c.bob.id] }],
    async make(c) {
      return sendAsAlice(c, { type: 'image', attachment_id: await img(c), width: 5, height: 5 });
    },
    async after(c, made) {
      const res = await stack.call(
        c.bob,
        'PUT',
        `/conversations/${c.conv}/messages/${made.id}/reaction`,
        { emoji: '❤️' },
      );
      expect(res.status).toBe(204);
    },
  },
];

const SERVER_WRITTEN: Case[] = [
  {
    name: 'text from the @flick bot with the provider and model that wrote it',
    type: 'text',
    searchable: true,
    forwardable: true,
    async make(c) {
      const { message } = await allocateSeqAndInsertMessage(stack.db, {
        conversationId: c.conv,
        senderId: FLICK_BOT_USER_ID,
        senderDeviceId: null,
        clientMessageId: null,
        type: 'text',
        bodyText: `an answer ${c.token}`,
        content: { ai_provider: 'groq', ai_model: 'llama-3.3-70b-versatile' },
        authorize: false, // the bot is not a member of the chats it answers in
      });
      return {
        id: message.id,
        senderId: FLICK_BOT_USER_ID,
        content: {
          type: 'text',
          text: `an answer ${c.token}`,
          ai_provider: 'groq',
          ai_model: 'llama-3.3-70b-versatile',
        },
      };
    },
  },
  {
    name: 'text from the bot without a model (older answers)',
    type: 'text',
    async make(c) {
      const { message } = await allocateSeqAndInsertMessage(stack.db, {
        conversationId: c.conv,
        senderId: FLICK_BOT_USER_ID,
        senderDeviceId: null,
        clientMessageId: null,
        type: 'text',
        bodyText: 'plain bot answer',
        authorize: false,
      });
      return {
        id: message.id,
        senderId: FLICK_BOT_USER_ID,
        content: { type: 'text', text: 'plain bot answer' },
      };
    },
  },
  ...(['missed', 'rejected', 'completed'] as const).flatMap((status) =>
    (['audio', 'video'] as const).map((media): Case => ({
      name: `${media} call event (${status})`,
      type: 'call_event',
      async make(c) {
        const callId = crypto.randomUUID();
        const startedAt = new Date(Date.now() - 60_000);
        await recordCall(stack.db, {
          callId,
          conversationId: c.conv,
          callerId: c.alice.id,
          media,
          outcome: status,
          startedAt,
          answeredAt: status === 'completed' ? new Date(startedAt.getTime() + 5_000) : null,
          endedAt: new Date(startedAt.getTime() + 65_000),
        });
        const row = await stack.db
          .selectFrom('messages')
          .select(['id', 'content'])
          .where('conversation_id', '=', c.conv)
          .where('type', '=', 'call_event')
          .orderBy('seq', 'desc')
          .executeTakeFirstOrThrow();
        return {
          id: row.id,
          senderId: c.alice.id,
          content: { ...(row.content as Record<string, any>), type: 'call_event' },
        };
      },
    })),
  ),
  {
    name: 'group call started (call_event with group: true)',
    type: 'call_event',
    async make(c) {
      const content = {
        type: 'call_event',
        call_id: crypto.randomUUID(),
        media: 'video',
        outcome: 'started',
        group: true,
        started_at: new Date().toISOString(),
        duration_s: 0,
      };
      const { message } = await allocateSeqAndInsertMessage(stack.db, {
        conversationId: c.conv,
        senderId: c.alice.id,
        senderDeviceId: null,
        clientMessageId: null,
        type: 'call_event',
        content,
        authorize: false,
      });
      return { id: message.id, senderId: c.alice.id, content };
    },
  },
  {
    name: 'system message written by the server',
    type: 'system',
    async make(c) {
      const content = {
        type: 'system',
        event: 'member_added',
        actor_user_id: c.alice.id,
        target_user_ids: [c.bob.id],
      };
      const { message } = await allocateSeqAndInsertMessage(stack.db, {
        conversationId: c.conv,
        senderId: null,
        senderDeviceId: null,
        clientMessageId: null,
        type: 'system',
        content,
        authorize: false,
      });
      return { id: message.id, senderId: null, content };
    },
  },
];

// ------------------------------------------------------------------ read paths

type Rec = Record<string, any>;

async function listLast(viewer: TestUser, conv: string): Promise<Rec | undefined> {
  const res = await stack.call(viewer, 'GET', '/conversations?limit=100');
  expect(res.status).toBe(200);
  const item = res.body.items.find((i: Rec) => i.id === conv);
  expect(item, 'conversation missing from the chat list').toBeDefined();
  return item.last_message ?? undefined;
}

async function getLast(viewer: TestUser, conv: string): Promise<Rec | undefined> {
  const res = await stack.call(viewer, 'GET', `/conversations/${conv}`);
  expect(res.status).toBe(200);
  return res.body.last_message ?? undefined;
}

async function historyItem(viewer: TestUser, conv: string, id: string): Promise<Rec | undefined> {
  const res = await stack.call(viewer, 'GET', `/conversations/${conv}/messages?limit=100`);
  expect(res.status).toBe(200);
  return res.body.items.find((m: Rec) => m.message_id === id);
}

async function syncManyRecord(viewer: TestUser, conv: string, id: string) {
  const res = await stack.call(viewer, 'POST', '/sync', {
    cursors: [{ conversation_id: conv, after_seq: 0 }],
    limit: 500,
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  expect(SyncPagePayload.safeParse(res.body).success).toBe(true);
  const events: Rec[] = res.body.events;
  return {
    events,
    record: events.find((e) => e.type === 'new_message' && e.payload.message.message_id === id)
      ?.payload.message as Rec | undefined,
  };
}

async function syncOneRecord(viewer: TestUser, conv: string, id: string) {
  const res = await stack.call(viewer, 'GET', `/conversations/${conv}/sync?after_seq=0&limit=500`);
  expect(res.status).toBe(200);
  for (const e of res.body.events) expect(SyncEvent.safeParse(e).success).toBe(true);
  return res.body.events.find(
    (e: Rec) => e.type === 'new_message' && e.payload.message.message_id === id,
  )?.payload.message as Rec | undefined;
}

function strictParse(record: unknown, where: string): void {
  const parsed = MessageRecord.safeParse(record);
  expect(parsed.success, `${where}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
}

function expectRecord(
  record: Rec | undefined,
  where: string,
  expected: {
    id: string;
    conv: string;
    senderId: string | null;
    content: Rec | null;
    tombstone: boolean;
    clientMessageId: string | null;
    reactions?: Rec[];
  },
): void {
  expect(record, `${where}: record missing`).toBeDefined();
  strictParse(record, where);
  const r = record!;
  expect(r.message_id, where).toBe(expected.id);
  expect(r.conversation_id, where).toBe(expected.conv);
  expect(r.sender_user_id, where).toBe(expected.senderId);
  expect(r.content, `${where}: content`).toEqual(expected.content);
  if (expected.tombstone) expect(r.deleted_at, `${where}: tombstone`).not.toBeNull();
  else expect(r.deleted_at, `${where}: not a tombstone`).toBeNull();
  expect(r.client_message_id, `${where}: client_message_id`).toBe(expected.clientMessageId);
  if (expected.reactions) expect(r.reactions, `${where}: reactions`).toEqual(expected.reactions);
}

// ------------------------------------------------------------------ the matrix

describe.each([
  ...SENDABLE.map((c) => ['sent by a client', c] as const),
  ...STATES.map((c) => ['and then', c] as const),
  ...SERVER_WRITTEN.map((c) => ['written by the server', c] as const),
])('%s: %s', (_group, spec) => {
  let ctx: Ctx;
  let made: Made;
  let bobLive: Client;
  let aliceOtherDevice: Client;
  let liveRecord: Rec | undefined;
  let sentContent: Rec | null = null;

  const viewerOf = (viewer: Viewer) => (viewer === 'reader' ? ctx.bob : ctx.alice);
  const view = (viewer: Viewer) =>
    spec.view?.(viewer, made) ?? { kind: 'full' as Kind, content: made.content };
  const expected = (viewer: Viewer) => {
    const v = view(viewer);
    return {
      id: made.id,
      conv: ctx.conv,
      senderId: made.senderId,
      content: v.kind === 'full' ? v.content : null,
      tombstone: v.kind !== 'full',
      clientMessageId: viewer === 'sender' ? (made.clientMessageId ?? null) : null,
      reactions: spec.reactions?.map((r) => ({ emoji: r.emoji, user_ids: r.user_ids(ctx) })) ?? [],
    };
  };

  beforeAll(async () => {
    const [alice, bob, carol] = await Promise.all([
      stack.user('alice'),
      stack.user('bob'),
      stack.user('carol'),
    ]);
    const conv = await direct(stack, alice, bob);
    const fwd = await direct(stack, bob, carol);
    ctx = { alice, bob, carol, conv, fwd, token: word() };
    if (spec.expiring) {
      const timer = await stack.call(alice, 'PATCH', `/conversations/${conv}`, {
        settings: { disappearing_timer_s: 86_400 },
      });
      expect(timer.status, JSON.stringify(timer.body)).toBe(200);
    }
    bobLive = await stack.connect(bob);
    aliceOtherDevice = await stack.connect(await stack.device(alice));
    made = await spec.make(ctx);
    await waitUntil(
      () => bobLive.messages().some((m) => m.message_id === made.id),
      8_000,
      'the live new_message',
    );
    liveRecord = bobLive.messages().find((m) => m.message_id === made.id);
    sentContent = structuredClone(made.content);
    await spec.after?.(ctx, made);
    await waitForOutboxDrained(stack.db);
  });

  afterAll(() => {
    bobLive?.close();
    aliceOtherDevice?.close();
  });

  it('chat list: last_message parses as a MessageRecord and matches the history', async () => {
    for (const viewer of ['reader', 'sender'] as const) {
      const record = await listLast(viewerOf(viewer), ctx.conv);
      expectRecord(record, `chat list (${viewer})`, expectedLast(viewer));
    }
  });

  // The newest message of the chat is not always the one under test: server-written events (a
  // timer change) can come after it. Look at the real newest row instead of assuming.
  function expectedLast(viewer: Viewer) {
    return expected(viewer);
  }

  it('single conversation: last_message parses as a MessageRecord', async () => {
    for (const viewer of ['reader', 'sender'] as const) {
      const record = await getLast(viewerOf(viewer), ctx.conv);
      expectRecord(record, `GET /conversations/:id (${viewer})`, expectedLast(viewer));
    }
  });

  it('history: parses; a message hidden from the viewer is left out, a deleted one is a tombstone', async () => {
    for (const viewer of ['reader', 'sender'] as const) {
      const v = view(viewer);
      const record = await historyItem(viewerOf(viewer), ctx.conv, made.id);
      if (v.kind === 'hidden') {
        expect(record, `history (${viewer}) must not return it`).toBeUndefined();
        continue;
      }
      expectRecord(record, `history (${viewer})`, expected(viewer));
      const res = await stack.call(
        viewerOf(viewer),
        'GET',
        `/conversations/${ctx.conv}/messages?limit=100`,
      );
      const parsed = HistoryResponse.safeParse(res.body);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('sync (POST /sync and GET /conversations/:id/sync): the message comes back as a valid new_message', async () => {
    for (const viewer of ['reader', 'sender'] as const) {
      const many = await syncManyRecord(viewerOf(viewer), ctx.conv, made.id);
      expectRecord(many.record, `POST /sync (${viewer})`, expected(viewer));
      const one = await syncOneRecord(viewerOf(viewer), ctx.conv, made.id);
      expectRecord(one, `GET /conversations/:id/sync (${viewer})`, expected(viewer));
      // seqs in one page are strictly increasing
      const seqs = many.events.map((e) => e.payload.seq ?? e.payload.message?.seq);
      expect([...seqs].sort((a, b) => a - b)).toEqual(seqs);
    }
  });

  it('search: found by its text when it has any and is still visible, never when it is not', async () => {
    for (const viewer of ['reader', 'sender'] as const) {
      const v = view(viewer);
      const res = await stack.call(
        viewerOf(viewer),
        'GET',
        `/search?q=${ctx.token}&conversation_id=${ctx.conv}`,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      for (const hit of res.body.items) strictParse(hit.message, `search (${viewer})`);
      const hits = res.body.items.filter((h: Rec) => h.message.message_id === made.id);
      if (spec.searchable && v.kind === 'full' && v.content !== null) {
        expect(hits, `search (${viewer}) should find it`).toHaveLength(1);
        expectRecord(hits[0].message, `search (${viewer})`, expected(viewer));
        expect(hits[0].snippet).toContain(ctx.token);
      } else {
        // deleted, expired, deleted for me, or a view-once the viewer opened: its text must not leak
        expect(hits, `search (${viewer}) must not return it`).toHaveLength(0);
      }
      const everywhere = await stack.call(viewerOf(viewer), 'GET', `/search?q=${ctx.token}`);
      expect(everywhere.status).toBe(200);
    }
  });

  it('pins: a visible message can be pinned and comes back as a valid record', async () => {
    for (const viewer of ['reader', 'sender'] as const) {
      const v = view(viewer);
      const pin = await stack.call(viewerOf(viewer), 'POST', `/conversations/${ctx.conv}/pins`, {
        message_id: made.id,
      });
      expect(pin.status, JSON.stringify(pin.body)).toBeLessThan(500);
      const list = await stack.call(viewerOf(viewer), 'GET', `/conversations/${ctx.conv}/pins`);
      expect(list.status).toBe(200);
      const parsed = PinnedList.safeParse(list.body);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      const found = list.body.items.find((m: Rec) => m.message_id === made.id);
      if (v.kind === 'full') {
        expect(pin.status).toBe(204);
        expectRecord(found, `pins (${viewer})`, expected(viewer));
      } else {
        expect(found, `pins (${viewer}) must not return a gone message`).toBeUndefined();
      }
      await stack.call(viewerOf(viewer), 'DELETE', `/conversations/${ctx.conv}/pins/${made.id}`);
    }
  });

  it('starred: a star shows the message in /starred as a valid record (tombstone if deleted)', async () => {
    for (const viewer of ['reader', 'sender'] as const) {
      const v = view(viewer);
      const star = await stack.call(
        viewerOf(viewer),
        'PUT',
        `/conversations/${ctx.conv}/messages/${made.id}/star`,
      );
      expect(star.status, JSON.stringify(star.body)).toBeLessThan(500);
      const list = await stack.call(viewerOf(viewer), 'GET', '/starred?limit=100');
      expect(list.status).toBe(200);
      const parsed = StarredList.safeParse(list.body);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
      const found = list.body.items.find((m: Rec) => m.message_id === made.id);
      if (v.kind === 'hidden') {
        expect(
          found,
          `starred (${viewer}) must not return a message hidden from them`,
        ).toBeUndefined();
      } else {
        expect(found?.starred, `starred (${viewer})`).toBe(true);
        expectRecord(found, `starred (${viewer})`, { ...expected(viewer) });
      }
      await stack.call(
        viewerOf(viewer),
        'DELETE',
        `/conversations/${ctx.conv}/messages/${made.id}/star`,
      );
    }
  });

  it('live: the Socket.IO new_message event parses, for the other user and for the sender’s other device', async () => {
    expect(liveRecord, 'bob got a live new_message').toBeDefined();
    strictParse(liveRecord, 'live (reader)');
    expect(liveRecord!.message_id).toBe(made.id);
    expect(liveRecord!.sender_user_id).toBe(made.senderId);
    expect(liveRecord!.client_message_id).toBeNull(); // a recipient never sees the sender's key
    // at the moment of sending the reader sees the full content (before any later edit/delete)
    expect(liveRecord!.content).toEqual(sentContent);
    if (spec.expiring) expect(liveRecord!.expires_at).not.toBeNull();

    await waitUntil(
      () => aliceOtherDevice.messages().some((m) => m.message_id === made.id),
      5_000,
      'the sender’s other device',
    );
    const own = aliceOtherDevice.messages().find((m) => m.message_id === made.id)!;
    strictParse(own, 'live (sender other device)');
    expect(own.client_message_id).toBe(made.clientMessageId ?? null);
  });

  it('every event this client received matches its contract schema', () => {
    for (const client of [bobLive, aliceOtherDevice]) {
      for (const { name, payload } of client.events) {
        const schema = (SERVER_PAYLOADS as Record<string, { safeParse(v: unknown): any }>)[name];
        if (!schema) continue;
        const parsed = schema.safeParse(payload);
        expect(parsed.success, `${name}: ${JSON.stringify(parsed.error?.issues)}`).toBe(true);
        // ConversationSummary.last_message has .catch(null), so check the preview strictly too
        if (name === 'conversation_updated' && payload.conversation?.last_message) {
          strictParse(payload.conversation.last_message, 'conversation_updated.last_message');
        }
      }
    }
  });

  // only for the types the web app can forward (see forwardContent in apps/web messageActions.ts)
  if (spec.forwardable)
    it('forward: the reader forwards it to another chat and it round-trips there', async () => {
      const content: Rec = { ...(made.content as Rec), forwarded: true };
      delete content.reply_to;
      delete content.mentions;
      delete content.view_once;
      const res = await stack.call(ctx.bob, 'POST', `/conversations/${ctx.fwd}/messages`, {
        client_message_id: cmid(),
        content,
      });
      expect(res.status, `forwarding a ${spec.type}: ${JSON.stringify(res.body)}`).toBe(200);
      const copy = await historyItem(ctx.carol, ctx.fwd, res.body.message_id);
      expectRecord(copy, 'forwarded copy (carol history)', {
        id: res.body.message_id,
        conv: ctx.fwd,
        senderId: ctx.bob.id,
        content,
        tombstone: false,
        clientMessageId: null,
        reactions: [],
      });
      const last = await listLast(ctx.carol, ctx.fwd);
      expectRecord(last, 'forwarded copy (carol chat list)', {
        id: res.body.message_id,
        conv: ctx.fwd,
        senderId: ctx.bob.id,
        content,
        tombstone: false,
        clientMessageId: null,
        reactions: [],
      });
    });
});

// ------------------------------------------------------------------ system messages

describe('system messages: every event the server writes', () => {
  it('group_created, member_added, renamed, role_changed, timer_changed, member_removed, member_left all parse everywhere', async () => {
    const [owner, m1, m2, m3] = await Promise.all([
      stack.user('own'),
      stack.user('m1'),
      stack.user('m2'),
      stack.user('m3'),
    ]);
    const conv = await group(stack, owner, [m1, m2]);
    const seen = new Set<string>();

    async function expectLastSystem(event: string) {
      await waitForOutboxDrained(stack.db);
      for (const viewer of [owner, m1]) {
        const last = await listLast(viewer, conv);
        strictParse(last, `chat list after ${event}`);
        expect(last?.content?.type, `chat list after ${event}`).toBe('system');
        expect(last?.content?.event).toBe(event);
        const hist = await stack.call(viewer, 'GET', `/conversations/${conv}/messages?limit=100`);
        for (const m of hist.body.items) strictParse(m, `history after ${event}`);
        expect(hist.body.items[0].content.event).toBe(event);
        const sync = await syncManyRecord(viewer, conv, last!.message_id);
        expectRecord(sync.record, `sync after ${event}`, {
          id: last!.message_id,
          conv,
          senderId: last!.sender_user_id,
          content: last!.content,
          tombstone: false,
          clientMessageId: null,
          reactions: [],
        });
      }
      seen.add(event);
    }

    await expectLastSystem('group_created');
    expect(
      (await stack.call(owner, 'POST', `/conversations/${conv}/members`, { user_ids: [m3.id] }))
        .status,
    ).toBe(200);
    await expectLastSystem('member_added');
    expect(
      (await stack.call(owner, 'PATCH', `/conversations/${conv}`, { title: 'Renamed' })).status,
    ).toBe(200);
    await expectLastSystem('renamed');
    expect(
      (
        await stack.call(owner, 'PATCH', `/conversations/${conv}/members/${m2.id}`, {
          role: 'admin',
        })
      ).status,
    ).toBe(200);
    await expectLastSystem('role_changed');
    expect(
      (
        await stack.call(owner, 'PATCH', `/conversations/${conv}`, {
          settings: { disappearing_timer_s: 604_800 },
        })
      ).status,
    ).toBe(200);
    await expectLastSystem('timer_changed');
    expect(
      (await stack.call(owner, 'DELETE', `/conversations/${conv}/members/${m3.id}`)).status,
    ).toBe(204);
    await expectLastSystem('member_removed');
    expect((await stack.call(m2, 'POST', `/conversations/${conv}/leave`)).status).toBe(204);
    await expectLastSystem('member_left');

    expect([...seen].sort()).toEqual(
      [
        'group_created',
        'member_added',
        'member_left',
        'member_removed',
        'renamed',
        'role_changed',
        'timer_changed',
      ].sort(),
    );
  });
});

// ------------------------------------------------------------------ poll vote result

describe('poll votes', () => {
  it('a vote returns a valid tally, never becomes a message row, and the poll message stays valid', async () => {
    const [alice, bob] = await Promise.all([stack.user('alice'), stack.user('bob')]);
    const conv = await direct(stack, alice, bob);
    const created = await send(stack, alice, conv, {
      type: 'poll',
      question: 'Tea or coffee?',
      options: ['tea', 'coffee'],
      allow_multiple: false,
    });
    const pollId = created.body.message_id;
    const vote = await stack.call(bob, 'POST', `/conversations/${conv}/polls/${pollId}/vote`, {
      option_indexes: [1],
    });
    expect(vote.status).toBe(200);
    expect(vote.body.options[1].voter_ids).toEqual([bob.id]);
    const tally = await stack.call(alice, 'GET', `/conversations/${conv}/polls/${pollId}`);
    expect(tally.body).toEqual(vote.body);

    // a poll_vote is not accepted as a message: clients use the vote endpoint
    const asMessage = await send(stack, bob, conv, {
      type: 'poll_vote',
      poll_message_id: pollId,
      option_indexes: [0],
    });
    expect(asMessage.status).toBe(400);

    const rows = await stack.db
      .selectFrom('messages')
      .select('type')
      .where('conversation_id', '=', conv)
      .execute();
    expect(rows.map((r) => r.type)).toEqual(['poll']);
    const last = await listLast(alice, conv);
    strictParse(last, 'chat list after a vote');
    expect(last?.content?.type).toBe('poll');
  });
});

// ------------------------------------------------------------------ the production bug, by name

describe('regression: a voice note or photo as the newest message must not break the chat list', () => {
  it('a list with one chat per content type parses completely, including ConversationList', async () => {
    const reader = await stack.user('reader');
    const kinds: Record<string, Record<string, any>> = {};
    const owners: TestUser[] = [];
    for (const kind of ['voice', 'image', 'video', 'file', 'gif', 'sticker', 'poll', 'text']) {
      const sender = await stack.user(`s${kind}`);
      owners.push(sender);
      const conv = await direct(stack, sender, reader);
      const content: Record<string, any> =
        kind === 'voice'
          ? {
              type: 'voice',
              attachment_id: await attachment(stack.db, sender, 'voice'),
              duration_ms: 1000,
              waveform: [1],
            }
          : kind === 'image'
            ? {
                type: 'image',
                attachment_id: await attachment(stack.db, sender, 'image'),
                width: 1,
                height: 1,
              }
            : kind === 'video'
              ? {
                  type: 'video',
                  attachment_id: await attachment(stack.db, sender, 'video'),
                  width: 1,
                  height: 1,
                  duration_ms: 5,
                }
              : kind === 'file'
                ? {
                    type: 'file',
                    attachment_id: await attachment(stack.db, sender, 'file'),
                    file_name: 'a.pdf',
                    size: 1,
                  }
                : kind === 'gif'
                  ? { type: 'gif', gif_id: 'g', url: 'https://x.test/g.gif', width: 1, height: 1 }
                  : kind === 'sticker'
                    ? { type: 'sticker', sticker_id: 's', url: 'https://x.test/s.gif' }
                    : kind === 'poll'
                      ? { type: 'poll', question: 'q?', options: ['a', 'b'], allow_multiple: false }
                      : { type: 'text', text: 'hi' };
      expect((await send(stack, sender, conv, content)).status).toBe(200);
      kinds[conv] = content;
    }
    const res = await stack.call(reader, 'GET', '/conversations?limit=100');
    expect(res.status).toBe(200);
    expect(res.body.items).toHaveLength(8);
    for (const item of res.body.items) {
      const last = item.last_message;
      expect(last, 'a chat with a message must have a preview').not.toBeNull();
      strictParse(last, `chat list item ${item.id}`);
      expect(last.content).toEqual(kinds[item.id]); // type and attachment_id survive
    }
  });
});
