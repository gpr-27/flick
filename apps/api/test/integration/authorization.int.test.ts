/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-return -- test payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { AiChain, type ProviderAdapter, type ProviderCallParams } from '@chat/ai';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { aiServiceFromChain } from '../../src/modules/ai/service.js';
import {
  attachment,
  createDatabase,
  direct,
  group,
  send,
  startStack,
  type CallResult,
  type Stack,
  type TestDatabase,
  type TestUser,
} from './harness.js';

// AUTHORIZATION / IDOR MATRIX.
//
// A request that names an id (conversation, message, attachment, invite, call link, user) must
// never return data or change state for someone who has no right to it: a user who never joined,
// a member who was removed, a member who left. Every id-taking route is tried by each of them
// (and the same request is tried by an allowed user, so a wrong fixture cannot make the denial
// pass by accident). Blocked users, role limits and "you cannot probe whether an id exists" are
// checked below the matrix.

class FakeProvider implements ProviderAdapter {
  readonly provider = 'groq' as const;
  readonly account = '1';
  readonly models = ['fake-model'];
  complete({ request }: ProviderCallParams): Promise<string> {
    return Promise.resolve(
      request.responseFormat === 'json'
        ? '{"replies":["Sounds good","Not today","Maybe later?"]}'
        : 'fake answer',
    );
  }
  async *stream(params: ProviderCallParams): AsyncIterable<string> {
    yield await this.complete(params);
  }
}

let database: TestDatabase;
let stack: Stack;

beforeAll(async () => {
  database = await createDatabase('authz');
  stack = await startStack({
    databaseUrl: database.url,
    env: {
      LIVEKIT_URL: 'wss://livekit.example.test',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'devsecret-devsecret-devsecret-12345',
    },
    ai: aiServiceFromChain(new AiChain({ adapters: [new FakeProvider()] })),
  });
});
afterAll(async () => {
  await stack.stop();
  await database.drop();
});

interface World {
  alice: TestUser; // owner
  adam: TestUser; // admin
  bob: TestUser; // plain member
  rita: TestUser; // was a member, removed by the owner
  lena: TestUser; // was a member, left
  otto: TestUser; // never a member
  bruno: TestUser; // blocked by alice
  conv: string; // the group
  dm: string; // alice <-> bob
  message: string; // text by alice, contains the word "zzfind"
  poll: string;
  viewOnce: string; // view-once photo by alice
  photo: string; // photo by alice
  photoAttachment: string;
  dmMessage: string;
  invite: string;
  callLink: string;
  ghost: string; // an id that exists nowhere
}

async function world(): Promise<World> {
  const [alice, adam, bob, rita, lena, otto, bruno] = await Promise.all(
    ['alice', 'adam', 'bob', 'rita', 'lena', 'otto', 'bruno'].map((n) => stack.user(n)),
  );
  const w = { alice, adam, bob, rita, lena, otto, bruno } as World;
  w.conv = await group(stack, alice!, [adam!, bob!, rita!, lena!]);
  await stack.call(alice!, 'PATCH', `/conversations/${w.conv}/members/${adam!.id}`, {
    role: 'admin',
  });
  w.message = (
    await send(stack, alice!, w.conv, { type: 'text', text: 'the secret plan zzfind' })
  ).body.message_id;
  w.poll = (
    await send(stack, alice!, w.conv, {
      type: 'poll',
      question: 'Which?',
      options: ['a', 'b'],
      allow_multiple: false,
    })
  ).body.message_id;
  w.photoAttachment = await attachment(stack.db, alice!);
  w.photo = (
    await send(stack, alice!, w.conv, {
      type: 'image',
      attachment_id: w.photoAttachment,
      width: 2,
      height: 2,
    })
  ).body.message_id;
  w.viewOnce = (
    await send(stack, alice!, w.conv, {
      type: 'image',
      attachment_id: await attachment(stack.db, alice!),
      width: 2,
      height: 2,
      view_once: true,
    })
  ).body.message_id;
  // rita keeps a star and alice a pin; both must stop working for rita after the removal
  await stack.call(rita!, 'PUT', `/conversations/${w.conv}/messages/${w.message}/star`);
  await stack.call(alice!, 'POST', `/conversations/${w.conv}/pins`, { message_id: w.message });
  const invite = await stack.call(alice!, 'POST', `/conversations/${w.conv}/invites`, {});
  w.invite = invite.body.code;
  const link = await stack.call(alice!, 'POST', '/calls/links', {
    conversation_id: w.conv,
    media: 'video',
    expires_in_s: 3600,
  });
  w.callLink = link.body.code;
  w.dm = await direct(stack, alice!, bob!);
  w.dmMessage = (
    await send(stack, alice!, w.dm, { type: 'text', text: 'private dm zzfind' })
  ).body.message_id;
  // rita is removed by the owner; lena leaves on her own
  expect(
    (await stack.call(alice!, 'DELETE', `/conversations/${w.conv}/members/${rita!.id}`)).status,
  ).toBe(204);
  expect((await stack.call(lena!, 'POST', `/conversations/${w.conv}/leave`)).status).toBe(204);
  await stack.call(alice!, 'POST', '/blocks', { user_id: bruno!.id });
  w.ghost = randomUUID();
  return w;
}

interface Req {
  method: string;
  url: string;
  body?: unknown;
  headers?: Record<string, string>;
}
interface Entry {
  label: string;
  req(w: World): Req;
  /** Who is allowed to do this (the positive control). null = there is no valid success to compare to. */
  allowed: ((w: World) => TestUser) | null;
}

const JSON_ONLY = { accept: 'application/json' };
const alice = (w: World) => w.alice;
const bob = (w: World) => w.bob;

const ROUTES: Entry[] = [
  // ------------------------------------------------------------ the conversation
  {
    label: 'GET conversation',
    allowed: alice,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.conv}` }),
  },
  {
    label: 'PATCH conversation',
    allowed: alice,
    req: (w) => ({ method: 'PATCH', url: `/conversations/${w.conv}`, body: { title: 'Hijacked' } }),
  },
  {
    label: 'PATCH prefs',
    allowed: bob,
    req: (w) => ({
      method: 'PATCH',
      url: `/conversations/${w.conv}/prefs`,
      body: { archived: true },
    }),
  },
  {
    label: 'POST leave',
    allowed: bob,
    req: (w) => ({ method: 'POST', url: `/conversations/${w.conv}/leave` }),
  },
  {
    label: 'GET members',
    allowed: bob,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.conv}/members` }),
  },
  {
    label: 'POST members (add)',
    allowed: alice,
    req: (w) => ({
      method: 'POST',
      url: `/conversations/${w.conv}/members`,
      body: { user_ids: [w.bruno.id] },
    }),
  },
  {
    label: 'DELETE member',
    allowed: alice,
    req: (w) => ({ method: 'DELETE', url: `/conversations/${w.conv}/members/${w.bob.id}` }),
  },
  {
    label: 'PATCH member role',
    allowed: alice,
    req: (w) => ({
      method: 'PATCH',
      url: `/conversations/${w.conv}/members/${w.bob.id}`,
      body: { role: 'admin' },
    }),
  },
  {
    label: 'GET mention-candidates',
    allowed: bob,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.conv}/mention-candidates?q=a` }),
  },
  {
    label: 'POST invites',
    allowed: alice,
    req: (w) => ({ method: 'POST', url: `/conversations/${w.conv}/invites`, body: {} }),
  },
  {
    label: 'GET join-requests',
    allowed: alice,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.conv}/join-requests` }),
  },
  {
    label: 'POST join-request decision',
    allowed: null,
    req: (w) => ({
      method: 'POST',
      url: `/conversations/${w.conv}/join-requests/${w.ghost}`,
      body: { approve: true },
    }),
  },
  {
    label: 'GET direct conversation',
    allowed: bob,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.dm}` }),
  },
  // ------------------------------------------------------------ messages
  {
    label: 'POST message',
    allowed: bob,
    req: (w) => ({
      method: 'POST',
      url: `/conversations/${w.conv}/messages`,
      body: {
        client_message_id: `idor-${randomUUID().slice(0, 12)}`,
        content: { type: 'text', text: 'let me in' },
      },
    }),
  },
  {
    label: 'POST message (direct chat)',
    allowed: bob,
    req: (w) => ({
      method: 'POST',
      url: `/conversations/${w.dm}/messages`,
      body: {
        client_message_id: `idor-${randomUUID().slice(0, 12)}`,
        content: { type: 'text', text: 'let me in' },
      },
    }),
  },
  {
    label: 'GET history',
    allowed: bob,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.conv}/messages` }),
  },
  {
    label: 'GET history (direct chat)',
    allowed: bob,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.dm}/messages` }),
  },
  {
    label: 'GET conversation sync',
    allowed: bob,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.conv}/sync?after_seq=0` }),
  },
  {
    label: 'GET poll',
    allowed: bob,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.conv}/polls/${w.poll}` }),
  },
  {
    label: 'POST poll vote',
    allowed: bob,
    req: (w) => ({
      method: 'POST',
      url: `/conversations/${w.conv}/polls/${w.poll}/vote`,
      body: { option_indexes: [0] },
    }),
  },
  {
    label: 'PATCH (edit) message',
    allowed: alice,
    req: (w) => ({
      method: 'PATCH',
      url: `/conversations/${w.conv}/messages/${w.message}`,
      body: { content: { type: 'text', text: 'rewritten zzfind' } },
    }),
  },
  {
    label: 'DELETE message for me',
    allowed: bob,
    req: (w) => ({
      method: 'DELETE',
      url: `/conversations/${w.conv}/messages/${w.message}?for=me`,
    }),
  },
  {
    label: 'DELETE message for everyone',
    allowed: alice,
    req: (w) => ({
      method: 'DELETE',
      url: `/conversations/${w.conv}/messages/${w.message}?for=everyone`,
    }),
  },
  {
    label: 'PUT reaction',
    allowed: bob,
    req: (w) => ({
      method: 'PUT',
      url: `/conversations/${w.conv}/messages/${w.message}/reaction`,
      body: { emoji: '👍' },
    }),
  },
  {
    label: 'DELETE reaction',
    allowed: bob,
    req: (w) => ({
      method: 'DELETE',
      url: `/conversations/${w.conv}/messages/${w.message}/reaction`,
    }),
  },
  {
    label: 'PUT star',
    allowed: bob,
    req: (w) => ({ method: 'PUT', url: `/conversations/${w.conv}/messages/${w.message}/star` }),
  },
  {
    label: 'DELETE star',
    allowed: bob,
    req: (w) => ({ method: 'DELETE', url: `/conversations/${w.conv}/messages/${w.message}/star` }),
  },
  {
    label: 'POST pin',
    allowed: bob,
    req: (w) => ({
      method: 'POST',
      url: `/conversations/${w.conv}/pins`,
      body: { message_id: w.message },
    }),
  },
  {
    label: 'DELETE pin',
    allowed: bob,
    req: (w) => ({ method: 'DELETE', url: `/conversations/${w.conv}/pins/${w.message}` }),
  },
  {
    label: 'GET pins',
    allowed: bob,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.conv}/pins` }),
  },
  {
    label: 'POST open view-once',
    allowed: bob,
    req: (w) => ({ method: 'POST', url: `/conversations/${w.conv}/messages/${w.viewOnce}/open` }),
  },
  {
    label: 'GET message info',
    allowed: alice,
    req: (w) => ({ method: 'GET', url: `/conversations/${w.conv}/messages/${w.message}/info` }),
  },
  {
    label: 'POST read',
    allowed: bob,
    req: (w) => ({ method: 'POST', url: `/conversations/${w.conv}/read`, body: { seq: 1 } }),
  },
  {
    label: 'GET search in the conversation',
    allowed: bob,
    req: (w) => ({ method: 'GET', url: `/search?q=zzfind&conversation_id=${w.conv}` }),
  },
  // ------------------------------------------------------------ AI reads chat text
  {
    label: 'POST ai/summarize',
    allowed: bob,
    req: (w) => ({
      method: 'POST',
      url: '/ai/summarize',
      body: { conversation_id: w.conv },
      headers: JSON_ONLY,
    }),
  },
  {
    label: 'POST ai/suggest-replies',
    allowed: bob,
    req: (w) => ({
      method: 'POST',
      url: '/ai/suggest-replies',
      body: { conversation_id: w.conv },
      headers: JSON_ONLY,
    }),
  },
  {
    label: 'POST ai/chat with a conversation',
    allowed: bob,
    req: (w) => ({
      method: 'POST',
      url: '/ai/chat',
      body: { conversation_id: w.conv, messages: [{ role: 'user', content: 'what was said?' }] },
      headers: JSON_ONLY,
    }),
  },
  // ------------------------------------------------------------ calls
  {
    label: 'POST calls/livekit-token for a conversation',
    allowed: bob,
    req: (w) => ({
      method: 'POST',
      url: '/calls/livekit-token',
      body: { conversation_id: w.conv, media: 'audio' },
    }),
  },
  {
    label: 'POST calls/links',
    allowed: alice,
    req: (w) => ({
      method: 'POST',
      url: '/calls/links',
      body: { conversation_id: w.conv, media: 'audio', expires_in_s: 3600 },
    }),
  },
  {
    label: 'DELETE calls/links/:code (not the creator)',
    allowed: alice,
    req: (w) => ({ method: 'DELETE', url: `/calls/links/${w.callLink}` }),
  },
  {
    label: 'DELETE invites/:code (not an admin)',
    allowed: alice,
    req: (w) => ({ method: 'DELETE', url: `/invites/${w.invite}` }),
  },
  // ------------------------------------------------------------ media and reports
  {
    label: 'GET media download url',
    allowed: alice,
    req: (w) => ({ method: 'GET', url: `/media/${w.photoAttachment}/url` }),
  },
  {
    label: 'POST media complete (not the owner)',
    allowed: alice,
    req: (w) => ({ method: 'POST', url: `/media/${w.photoAttachment}/complete` }),
  },
  {
    label: 'POST report a message',
    allowed: bob,
    req: (w) => ({
      method: 'POST',
      url: '/reports',
      body: { conversation_id: w.conv, message_id: w.message, reason: 'spam' },
    }),
  },
];

/** A response that gives nothing away: 403 or 404 with only an error body. */
function expectDenied(res: CallResult, what: string): void {
  expect(
    [403, 404],
    `${what}: got ${res.status} ${JSON.stringify(res.body).slice(0, 200)}`,
  ).toContain(res.status);
  const keys = Object.keys(res.body ?? {});
  expect(keys, `${what}: a denial must carry only an error, not data`).toEqual(['error']);
}

const authed = (w: World, user: TestUser, r: Req) =>
  stack.call(user, r.method, r.url, r.body, r.headers);

describe('positive control: the same requests succeed for someone who is allowed', () => {
  // Without this, a mistake in the fixture (a wrong id) would make every denial test pass for the wrong reason.
  for (const entry of ROUTES.filter((e) => e.allowed)) {
    it(`${entry.label}`, async () => {
      const w = await world(); // a fresh world: some of these requests change state
      const res = await authed(w, entry.allowed!(w), entry.req(w));
      expect(res.status, `${entry.label}: ${JSON.stringify(res.body)}`).toBeLessThan(300);
    });
  }
});

describe.each([
  ['never joined', (w: World) => w.otto],
  ['was removed by the owner', (w: World) => w.rita],
  ['left the group', (w: World) => w.lena],
])('a user who %s', (_name, who) => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });

  it.each(ROUTES.map((e) => [e.label, e] as const))('is denied: %s', async (_label, entry) => {
    const res = await authed(w, who(w), entry.req(w));
    expectDenied(res, entry.label);
  });

  it('left no trace: nothing was created, changed or read while they tried', async () => {
    const user = who(w);
    const before = await snapshot(w);
    for (const entry of ROUTES) await authed(w, user, entry.req(w));
    expect(await snapshot(w)).toEqual(before);
  });

  it('the chat list, search, starred, sync and call log show nothing of the group or the direct chat', async () => {
    const user = who(w);
    const list = await stack.call(user, 'GET', '/conversations?limit=100');
    expect(list.body.items.map((i: any) => i.id)).not.toContain(w.conv);
    expect(list.body.items.map((i: any) => i.id)).not.toContain(w.dm);

    const found = await stack.call(user, 'GET', '/search?q=zzfind');
    expect(found.status).toBe(200);
    expect(found.body.items).toEqual([]);

    const starred = await stack.call(user, 'GET', '/starred?limit=100');
    expect(starred.status).toBe(200);
    expect(starred.body.items.map((m: any) => m.message_id)).not.toContain(w.message);

    const sync = await stack.call(user, 'POST', '/sync', {
      cursors: [
        { conversation_id: w.conv, after_seq: 0 },
        { conversation_id: w.dm, after_seq: 0 },
      ],
      limit: 500,
    });
    expect(sync.status).toBe(200);
    expect(sync.body.events).toEqual([]);
    expect(sync.body.removed_conversation_ids.sort()).toEqual([w.conv, w.dm].sort());

    const calls = await stack.call(user, 'GET', '/calls');
    expect(calls.body.items.filter((c: any) => c.conversation_id === w.conv)).toEqual([]);
  });

  it('acknowledging delivery or reading in the group does not create a cursor', async () => {
    const user = who(w);
    const delivered = await stack.call(user, 'POST', '/receipts/delivered', {
      acks: [{ conversation_id: w.conv, seq: 3 }],
    });
    expect(delivered.status).toBeLessThan(500);
    const cursors = await stack.db
      .selectFrom('device_cursors')
      .select('delivered_seq')
      .where('device_id', '=', user.deviceId)
      .where('conversation_id', '=', w.conv)
      .execute();
    expect(cursors).toEqual([]);
  });

  it('cannot use someone else’s attachment by putting its id in their own message', async () => {
    const user = who(w);
    const chat = await group(stack, user, [w.bruno], 'my own chat');
    const res = await send(stack, user, chat, {
      type: 'image',
      attachment_id: w.photoAttachment,
      width: 2,
      height: 2,
    });
    expect(res.status).toBe(404);
    expect(Object.keys(res.body)).toEqual(['error']);
  });
});

async function snapshot(w: World) {
  const [messages, members, outbox, reactions, stars, pins, hidden, invites] = await Promise.all([
    stack.db
      .selectFrom('messages')
      .select(['id', 'body_text', 'deleted_at', 'edited_at'])
      .orderBy('id')
      .execute(),
    stack.db
      .selectFrom('conversation_members')
      .select(['conversation_id', 'user_id', 'role', 'left_at'])
      .orderBy('conversation_id')
      .orderBy('user_id')
      .execute(),
    stack.db
      .selectFrom('outbox')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .executeTakeFirstOrThrow(),
    stack.db.selectFrom('reactions').selectAll().execute(),
    stack.db
      .selectFrom('starred_messages')
      .select(['user_id', 'message_id'])
      .orderBy('user_id')
      .execute(),
    stack.db.selectFrom('pinned_messages').select(['message_id']).execute(),
    stack.db.selectFrom('hidden_messages').selectAll().execute(),
    stack.db.selectFrom('call_links').select(['id', 'revoked_at']).execute(),
  ]);
  const conv = await stack.db
    .selectFrom('conversations')
    .select(['id', 'name', 'last_seq'])
    .where('id', 'in', [w.conv, w.dm])
    .orderBy('id')
    .execute();
  return { messages, members, outbox: outbox.n, reactions, stars, pins, hidden, invites, conv };
}

describe('role limits inside the group', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });

  it('a plain member cannot change roles, settings, add or remove people, or create links', async () => {
    const denied = [
      stack.call(w.bob, 'PATCH', `/conversations/${w.conv}`, {
        settings: { only_admins_send: true },
      }),
      stack.call(w.bob, 'PATCH', `/conversations/${w.conv}/members/${w.bob.id}`, { role: 'owner' }),
      stack.call(w.bob, 'PATCH', `/conversations/${w.conv}/members/${w.bob.id}`, { role: 'admin' }),
      stack.call(w.bob, 'DELETE', `/conversations/${w.conv}/members/${w.alice.id}`),
      stack.call(w.bob, 'POST', '/calls/links', {
        conversation_id: w.conv,
        media: 'audio',
        expires_in_s: 60,
      }),
      stack.call(w.bob, 'DELETE', `/invites/${w.invite}`),
      stack.call(w.bob, 'DELETE', `/calls/links/${w.callLink}`),
      stack.call(w.bob, 'GET', `/conversations/${w.conv}/join-requests`),
    ];
    for (const res of await Promise.all(denied)) expectDenied(res, 'plain member');
    const members = await stack.call(w.alice, 'GET', `/conversations/${w.conv}/members`);
    const roles = Object.fromEntries(members.body.items.map((m: any) => [m.user.id, m.role]));
    expect(roles[w.bob.id]).toBe('member');
    expect(roles[w.alice.id]).toBe('owner');
  });

  it('renaming is open to every member by default and limited to admins once the group says so', async () => {
    expect(
      (await stack.call(w.bob, 'PATCH', `/conversations/${w.conv}`, { title: 'by bob' })).status,
    ).toBe(200);
    await stack.call(w.alice, 'PATCH', `/conversations/${w.conv}`, {
      settings: { only_admins_edit_info: true },
    });
    expectDenied(
      await stack.call(w.bob, 'PATCH', `/conversations/${w.conv}`, { title: 'again' }),
      'rename',
    );
    expect(
      (await stack.call(w.adam, 'PATCH', `/conversations/${w.conv}`, { title: 'by adam' })).status,
    ).toBe(200);
  });

  it('a member can edit and delete only their own messages; an admin may delete for everyone but not edit', async () => {
    const edit = await stack.call(
      w.bob,
      'PATCH',
      `/conversations/${w.conv}/messages/${w.message}`,
      {
        content: { type: 'text', text: 'forged' },
      },
    );
    expect(edit.status).toBe(403);
    const del = await stack.call(
      w.bob,
      'DELETE',
      `/conversations/${w.conv}/messages/${w.message}?for=everyone`,
    );
    expect(del.status).toBe(403);
    const adminEdit = await stack.call(
      w.adam,
      'PATCH',
      `/conversations/${w.conv}/messages/${w.message}`,
      {
        content: { type: 'text', text: 'forged' },
      },
    );
    expect(adminEdit.status).toBe(403);
    const row = await stack.db
      .selectFrom('messages')
      .select(['body_text', 'deleted_at'])
      .where('id', '=', w.message)
      .executeTakeFirstOrThrow();
    expect(row).toEqual({ body_text: 'the secret plan zzfind', deleted_at: null });
    const adminDelete = await stack.call(
      w.adam,
      'DELETE',
      `/conversations/${w.conv}/messages/${w.photo}?for=everyone`,
    );
    expect(adminDelete.status).toBe(204);
  });

  it('message info is for the sender only', async () => {
    const res = await stack.call(
      w.bob,
      'GET',
      `/conversations/${w.conv}/messages/${w.message}/info`,
    );
    expect(res.status).toBe(403);
  });

  it('nobody opens their own view-once message, and a message of another chat cannot be reached through this chat’s URL', async () => {
    const own = await stack.call(
      w.alice,
      'POST',
      `/conversations/${w.conv}/messages/${w.viewOnce}/open`,
    );
    expect(own.status).toBe(403);
    // bob is in both chats, but the DM message must not be reachable through the group’s URL
    for (const [method, suffix] of [
      ['PUT', 'star'],
      ['PUT', 'reaction'],
      ['GET', 'info'],
    ] as const) {
      const res = await stack.call(
        w.bob,
        method,
        `/conversations/${w.conv}/messages/${w.dmMessage}/${suffix}`,
        method === 'PUT' && suffix === 'reaction' ? { emoji: '👍' } : undefined,
      );
      expect(res.status, `${method} ${suffix} across chats`).toBe(404);
    }
    const pin = await stack.call(w.bob, 'POST', `/conversations/${w.conv}/pins`, {
      message_id: w.dmMessage,
    });
    expect(pin.status).toBe(404);
    const reply = await send(stack, w.bob, w.conv, {
      type: 'text',
      text: 'x',
      reply_to: w.dmMessage,
    });
    expect(reply.status).toBe(400);
  });
});

describe('media: who may fetch a download URL', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });

  it('members of the chat that holds the file may; strangers, removed and departed members may not', async () => {
    const ok = await stack.call(w.bob, 'GET', `/media/${w.photoAttachment}/url`);
    expect(ok.status).toBe(200);
    for (const who of [w.otto, w.rita, w.lena, w.bruno]) {
      expectDenied(await stack.call(who, 'GET', `/media/${w.photoAttachment}/url`), 'download');
    }
  });

  it('an upload that is in no chat yet is private to its owner', async () => {
    const mine = await attachment(stack.db, w.alice);
    expect((await stack.call(w.alice, 'GET', `/media/${mine}/url`)).status).toBe(200);
    expectDenied(await stack.call(w.bob, 'GET', `/media/${mine}/url`), 'unattached upload');
  });

  it('the file stops being downloadable for a member once they are removed', async () => {
    const [a, b] = [await stack.user('a'), await stack.user('b')];
    const chat = await group(stack, a, [b]);
    const file = await attachment(stack.db, a);
    await send(stack, a, chat, { type: 'image', attachment_id: file, width: 1, height: 1 });
    expect((await stack.call(b, 'GET', `/media/${file}/url`)).status).toBe(200);
    await stack.call(a, 'DELETE', `/conversations/${chat}/members/${b.id}`);
    expectDenied(await stack.call(b, 'GET', `/media/${file}/url`), 'removed member');
  });

  it('a file deleted for everyone is no longer downloadable by the other members', async () => {
    const [a, b] = [await stack.user('a'), await stack.user('b')];
    const chat = await group(stack, a, [b]);
    const file = await attachment(stack.db, a);
    const sent = await send(stack, a, chat, {
      type: 'image',
      attachment_id: file,
      width: 1,
      height: 1,
    });
    await stack.call(
      a,
      'DELETE',
      `/conversations/${chat}/messages/${sent.body.message_id}?for=everyone`,
    );
    expectDenied(await stack.call(b, 'GET', `/media/${file}/url`), 'deleted photo');
  });

  it('forwarding: a member may re-send a file they received, a stranger may not, a member who left may not', async () => {
    const [sender, reader, target, stranger] = await Promise.all(
      ['s', 'r', 't', 'x'].map((n) => stack.user(n)),
    );
    const source = await group(stack, sender!, [reader!]);
    const file = await attachment(stack.db, sender!);
    await send(stack, sender!, source, { type: 'image', attachment_id: file, width: 1, height: 1 });
    const own = await group(stack, reader!, [target!]);
    const content = { type: 'image', attachment_id: file, width: 1, height: 1, forwarded: true };

    expect((await send(stack, reader!, own, content)).status).toBe(200);
    const strangerChat = await group(stack, stranger!, [target!]);
    expect((await send(stack, stranger!, strangerChat, content)).status).toBe(404);

    // someone who left the chat the file came from can no longer take it from there
    const leaver = await stack.user('leaver');
    const source2 = await group(stack, sender!, [leaver]);
    const file2 = await attachment(stack.db, sender!);
    await send(stack, sender!, source2, {
      type: 'image',
      attachment_id: file2,
      width: 1,
      height: 1,
    });
    await stack.call(leaver, 'POST', `/conversations/${source2}/leave`);
    const leaverChat = await group(stack, leaver, [target!]);
    const resend = await send(stack, leaver, leaverChat, { ...content, attachment_id: file2 });
    expect(resend.status).toBe(404);
  });
});

describe('blocked users', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });

  it('cannot message the person who blocked them in a direct chat', async () => {
    const [blocker, blocked] = [await stack.user('blocker'), await stack.user('blocked')];
    const dm = await direct(stack, blocker, blocked);
    await stack.call(blocker, 'POST', '/blocks', { user_id: blocked.id });
    const sent = await send(stack, blocked, dm, { type: 'text', text: 'hello?' });
    expect(sent.status).toBe(403);
    expect(sent.body.error.code).toBe('BLOCKED');
    // nothing was stored, and the blocker cannot start a new chat with the blocked user either
    const rows = await stack.db
      .selectFrom('messages')
      .select('id')
      .where('conversation_id', '=', dm)
      .execute();
    expect(rows).toEqual([]);
    const again = await stack.call(w.alice, 'POST', '/conversations/direct', {
      user_id: w.bruno.id,
    });
    expect(again.status).toBe(403);
  });

  it('cannot see the profile of the blocker, find them by search, or list them in the directory', async () => {
    expect((await stack.call(w.bruno, 'GET', `/users/${w.alice.id}`)).status).toBe(404);
    const search = await stack.call(w.bruno, 'GET', `/users/search?q=${w.alice.name.slice(0, 8)}`);
    expect(search.body.items.map((u: any) => u.id)).not.toContain(w.alice.id);
    const dir = await stack.call(w.bruno, 'GET', '/users/directory?limit=100');
    expect(dir.body.items.map((u: any) => u.id)).not.toContain(w.alice.id);
  });

  it('the blocker still sees the blocked person only in their own block list', async () => {
    const list = await stack.call(w.alice, 'GET', '/blocks');
    expect(list.body.items.map((b: any) => b.user.id)).toEqual([w.bruno.id]);
    expect((await stack.call(w.bruno, 'GET', '/blocks')).body.items).toEqual([]);
  });

  it('can still read what they already had (blocking is not removal) but gets nothing new', async () => {
    const [x, y] = [await stack.user('x'), await stack.user('y')];
    const dm = await direct(stack, x, y);
    await send(stack, y, dm, { type: 'text', text: 'before the block' });
    await stack.call(x, 'POST', '/blocks', { user_id: y.id });
    expect((await send(stack, y, dm, { type: 'text', text: 'after the block' })).status).toBe(403);
    const history = await stack.call(y, 'GET', `/conversations/${dm}/messages`);
    expect(history.body.items.map((m: any) => m.content.text)).toEqual(['before the block']);
  });
});

describe('ids reveal nothing: an existing foreign id and an id that exists nowhere look the same', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });

  it('conversation-scoped routes answer a stranger identically for a real group and a made-up one', async () => {
    const routes: [string, (id: string) => string, unknown?][] = [
      ['GET', (id) => `/conversations/${id}`],
      ['GET', (id) => `/conversations/${id}/messages`],
      ['GET', (id) => `/conversations/${id}/members`],
      ['GET', (id) => `/conversations/${id}/pins`],
      ['POST', (id) => `/conversations/${id}/read`, { seq: 1 }],
      ['GET', (id) => `/conversations/${id}/sync?after_seq=0`],
      ['GET', (id) => `/search?q=zzfind&conversation_id=${id}`],
    ];
    for (const [method, url, body] of routes) {
      const real = await stack.call(w.otto, method, url(w.conv), body);
      const fake = await stack.call(w.otto, method, url(w.ghost), body);
      expect(real.status, `${method} ${url('<id>')}`).toBe(fake.status);
      expect(real.body.error.code).toBe(fake.body.error.code);
    }
  });

  it('message-scoped routes answer a member identically for a foreign message and a made-up one', async () => {
    for (const [method, suffix] of [
      ['PUT', 'star'],
      ['GET', 'info'],
      ['POST', 'open'],
    ] as const) {
      const foreign = await stack.call(
        w.bob,
        method,
        `/conversations/${w.conv}/messages/${w.dmMessage}/${suffix}`,
      );
      const ghost = await stack.call(
        w.bob,
        method,
        `/conversations/${w.conv}/messages/${w.ghost}/${suffix}`,
      );
      expect(foreign.status, `${method} ${suffix}`).toBe(ghost.status);
    }
  });

  it('media and links: unknown and forbidden are the same answer', async () => {
    expect((await stack.call(w.otto, 'GET', `/media/${w.photoAttachment}/url`)).status).toBe(
      (await stack.call(w.otto, 'GET', `/media/${w.ghost}/url`)).status,
    );
    expect((await stack.call(w.bob, 'DELETE', `/calls/links/${w.callLink}`)).status).toBe(
      (await stack.call(w.bob, 'DELETE', '/calls/links/AAAAAAAAAAAAAAAAAAAA')).status,
    );
  });

  it('a user that does not exist is a 404 on profile, block and report, never a 500', async () => {
    expect((await stack.call(w.bob, 'GET', `/users/${w.ghost}`)).status).toBe(404);
    expect((await stack.call(w.bob, 'POST', '/blocks', { user_id: w.ghost })).status).toBe(404);
    const report = await stack.call(w.bob, 'POST', '/reports', {
      user_id: w.ghost,
      reason: 'spam',
    });
    expect(report.status).toBeLessThan(500);
    expect(report.status).toBeGreaterThanOrEqual(400);
  });

  it('reporting someone else’s message needs membership of that chat', async () => {
    const stranger = await stack.call(w.otto, 'POST', '/reports', {
      conversation_id: w.conv,
      message_id: w.message,
      reason: 'spam',
    });
    expect(stranger.status).toBe(404);
    const reports = await stack.db
      .selectFrom('reports')
      .select('id')
      .where('reporter_id', '=', w.otto.id)
      .execute();
    expect(reports).toEqual([]);
  });
});

describe('user-owned resources', () => {
  let w: World;
  beforeAll(async () => {
    w = await world();
  });

  it('a user cannot make someone else’s upload their avatar or the group’s picture', async () => {
    const mine = await attachment(stack.db, w.alice);
    const own = await stack.call(w.bob, 'PATCH', '/users/me', { avatar_attachment_id: mine });
    expect(own.status).toBe(404);
    const group_ = await stack.call(w.adam, 'PATCH', `/conversations/${w.conv}`, {
      avatar_attachment_id: mine,
    });
    expect(group_.status).toBeGreaterThanOrEqual(400);
    expect(group_.status).toBeLessThan(500);
  });

  it('unsubscribing someone else’s push endpoint changes nothing', async () => {
    const endpoint = 'https://push.example.test/owned-by-alice';
    expect(
      (
        await stack.call(w.alice, 'POST', '/push/subscribe', {
          endpoint,
          keys: { p256dh: 'a', auth: 'b' },
        })
      ).status,
    ).toBe(204);
    await stack.call(w.bob, 'POST', '/push/unsubscribe', { endpoint });
    const rows = await stack.db
      .selectFrom('push_subscriptions')
      .select('user_id')
      .where('endpoint', '=', endpoint)
      .execute();
    expect(rows).toEqual([{ user_id: w.alice.id }]);
  });

  it('an invite or call link code gives access only to what it names, and a revoked one is dead', async () => {
    const preview = await stack.call(w.otto, 'GET', `/invites/${w.invite}`);
    expect(preview.status).toBe(200);
    expect(Object.keys(preview.body).sort()).toEqual([
      'approval_required',
      'avatar_url',
      'conversation_id',
      'member_count',
      'title',
    ]);
    // the preview must not leak the member list or messages
    expect(JSON.stringify(preview.body)).not.toContain(w.alice.id);
    expect((await stack.call(w.alice, 'DELETE', `/invites/${w.invite}`)).status).toBe(204);
    expect((await stack.call(w.otto, 'GET', `/invites/${w.invite}`)).status).toBe(404);
    expect((await stack.call(w.otto, 'POST', `/invites/${w.invite}/join`)).status).toBe(404);

    expect((await stack.call(w.alice, 'DELETE', `/calls/links/${w.callLink}`)).status).toBe(204);
    expect((await stack.call(w.otto, 'GET', `/calls/links/${w.callLink}`)).status).toBe(404);
    expect(
      (await stack.call(w.otto, 'POST', '/calls/livekit-token', { call_link: w.callLink })).status,
    ).toBe(404);
  });
});
