/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-return -- test payloads are untyped JSON */
import { randomUUID } from 'node:crypto';
import { AiChain, type ProviderAdapter, type ProviderCallParams } from '@chat/ai';
import { ENDPOINTS, buildPath, type Endpoint } from '@chat/contracts';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
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

// API CONTRACT CONFORMANCE.
//
// For every endpoint in ENDPOINTS: one real call by an authorised user with valid input, and the
// JSON that comes back is parsed with THAT endpoint's own `response` schema (the one the web
// client parses with). Also: every endpoint of the contract is registered as a route, and every
// registered route is in the contract or in the short list of known extras.
//
// Endpoints that cannot be called for real are listed in NOT_CALLED with the reason, and the test
// "every endpoint is covered" fails if an endpoint is in neither list.

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

/** Endpoints that are not exercised by a live call, with the reason. */
const NOT_CALLED: Record<string, string> = {
  'media.linkPreview':
    'fetches a public web page; the SSRF guard (correctly) refuses loopback/private addresses, so a local fixture server cannot be used, and CI has no internet. Covered by packages/link-preview tests; only its error path is checked below.',
};

let database: TestDatabase;
let stack: Stack;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  // GIPHY is an external service: its answer is faked, everything on our side is real.
  vi.stubGlobal('fetch', async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith('https://api.giphy.com/')) {
      const image = {
        url: 'https://media.giphy.com/media/x/giphy.gif',
        width: '200',
        height: '100',
      };
      return new Response(
        JSON.stringify({
          data: [
            { id: 'g1', title: 'a gif', images: { original: image, fixed_width_small: image } },
            { id: 'bad', images: {} }, // an item in an unexpected shape is skipped, not fatal
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return realFetch(input, init);
  });
  database = await createDatabase('conf');
  stack = await startStack({
    databaseUrl: database.url,
    env: {
      GIPHY_API_KEY: 'test-key',
      LIVEKIT_URL: 'wss://livekit.example.test',
      LIVEKIT_API_KEY: 'devkey',
      LIVEKIT_API_SECRET: 'devsecret-devsecret-devsecret-12345',
      VAPID_PUBLIC_KEY: 'BPublicKeyForTests',
    },
    ai: aiServiceFromChain(new AiChain({ adapters: [new FakeProvider()] })),
  });
});
afterAll(async () => {
  vi.unstubAllGlobals();
  await stack.stop();
  await database.drop();
});

const flat = Object.entries(ENDPOINTS).flatMap(([group, defs]) =>
  Object.entries(defs as Record<string, Endpoint>).map(([name, def]) => ({
    key: `${group}.${name}`,
    def,
  })),
);

const url = (def: Endpoint, params: Record<string, string> = {}) => buildPath('', def.path, params);

function conforms(def: Endpoint, res: CallResult, status = 200): void {
  expect(res.status, `${def.method} ${def.path}: ${JSON.stringify(res.body)}`).toBe(
    def.response === null ? 204 : status,
  );
  if (def.response === null) {
    expect(res.body === '' || res.body == null).toBe(true);
    return;
  }
  const parsed = def.response.safeParse(res.body);
  expect(
    parsed.success,
    `${def.method} ${def.path} response does not match its schema: ${JSON.stringify(parsed.error?.issues)}`,
  ).toBe(true);
}

/** Calls an endpoint of the contract as `user`. */
function call(
  user: TestUser | null,
  def: Endpoint,
  options: {
    params?: Record<string, string>;
    query?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  return stack.call(
    user,
    def.method,
    `${url(def, options.params)}${options.query ? `?${options.query}` : ''}`,
    options.body,
    options.headers,
  );
}

// ------------------------------------------------------------------ meta

describe('the contract and the server agree on which endpoints exist', () => {
  it('every endpoint of ENDPOINTS is a registered route', () => {
    for (const { key, def } of flat) {
      expect(
        stack.app.hasRoute({ method: def.method, url: def.path }),
        `${key}: ${def.method} ${def.path} is in the contract but not served`,
      ).toBe(true);
    }
  });

  it('every endpoint is either called below or listed in NOT_CALLED with a reason', () => {
    const covered = new Set(Object.keys(SCENARIOS));
    const missing = flat.map((e) => e.key).filter((k) => !covered.has(k) && !(k in NOT_CALLED));
    expect(missing, `endpoints with no conformance scenario: ${missing.join(', ')}`).toEqual([]);
    const stale = [...covered, ...Object.keys(NOT_CALLED)].filter(
      (k) => !flat.some((e) => e.key === k),
    );
    expect(stale, 'scenarios for endpoints that no longer exist').toEqual([]);
  });
});

// ------------------------------------------------------------------ the scenarios

interface Fixture {
  alice: TestUser;
  bob: TestUser;
  carol: TestUser;
  dave: TestUser;
  conv: string; // group: alice owner, bob, carol
  dm: string; // alice <-> bob
  messageId: string; // a text message by alice in conv
  pollId: string;
}

async function fixture(): Promise<Fixture> {
  const [alice, bob, carol, dave] = await Promise.all([
    stack.user('alice'),
    stack.user('bob'),
    stack.user('carol'),
    stack.user('dave'),
  ]);
  const conv = await group(stack, alice, [bob, carol]);
  const dm = await direct(stack, alice, bob);
  const message = await send(stack, alice, conv, { type: 'text', text: 'hello conformance' });
  const poll = await send(stack, alice, conv, {
    type: 'poll',
    question: 'Which?',
    options: ['a', 'b'],
    allow_multiple: false,
  });
  return {
    alice,
    bob,
    carol,
    dave,
    conv,
    dm,
    messageId: message.body.message_id,
    pollId: poll.body.message_id,
  };
}

type Scenario = (f: Fixture, def: Endpoint) => Promise<void>;

const E = ENDPOINTS;
const JSON_ONLY = { accept: 'application/json' };
const C = (f: Fixture) => ({ conversation_id: f.conv });
const M = (f: Fixture, id = f.messageId) => ({ conversation_id: f.conv, message_id: id });

/** The harness login does not look at revocation (the real one does), so the table is checked. */
const revokedAt = async (deviceId: string) =>
  (
    await stack.db
      .selectFrom('devices')
      .select('revoked_at')
      .where('id', '=', deviceId)
      .executeTakeFirstOrThrow()
  ).revoked_at;

const inOneHour = () => new Date(Date.now() + 3_600_000).toISOString();

const SCENARIOS: Record<string, Scenario> = {
  // ------------------------------------------------------------------ users
  'users.me': async (f, def) => conforms(def, await call(f.alice, def)),
  'users.updateMe': async (f, def) =>
    conforms(def, await call(f.alice, def, { body: { display_name: 'Alice A', about: 'hi' } })),
  'users.search': async (f, def) =>
    conforms(def, await call(f.alice, def, { query: 'q=bob&limit=5' })),
  'users.directory': async (f, def) =>
    conforms(def, await call(f.alice, def, { query: 'limit=5' })),
  'users.profile': async (f, def) =>
    conforms(def, await call(f.alice, def, { params: { user_id: f.bob.id } })),
  'users.usernameAvailable': async (f, def) => {
    const free = await call(f.alice, def, { query: 'u=surely_unused_name' });
    conforms(def, free);
    expect(free.body).toEqual({ available: true });
    const taken = await call(f.alice, def, { query: `u=${f.bob.name}` });
    conforms(def, taken);
    expect(taken.body).toEqual({ available: false, reason: 'taken' });
  },
  'users.byUsername': async (f, def) => {
    const res = await call(f.alice, def, { params: { username: f.bob.name } });
    conforms(def, res);
    expect(res.body.id).toBe(f.bob.id);
  },
  'users.stats': async (f, def) => conforms(def, await call(f.alice, def)),
  'users.settings': async (f, def) => conforms(def, await call(f.alice, def)),
  'users.updateSettings': async (f, def) => {
    const res = await call(f.alice, def, { body: { groups_add: 'nobody', ai_language: 'fr' } });
    conforms(def, res);
    expect(res.body.ai_language).toBe('fr');
  },
  'users.guide': async (f, def) => conforms(def, await call(f.alice, def)),
  'users.updateGuide': async (f, def) => {
    const res = await call(f.alice, def, {
      body: { seen: { 'welcome.tour': '2026-01-01T00:00:00.000Z' }, enabled: true },
    });
    conforms(def, res);
    expect(res.body.seen['welcome.tour']).toBeDefined();
  },
  // export, deleteAccount and clearFlickChat run as a throwaway user: they read or destroy the
  // caller's own data, which must not be the fixture's.
  'users.export': async (f, def) => {
    const temp = await stack.user('exporter');
    await send(stack, temp, await direct(stack, temp, f.bob), { type: 'text', text: 'in export' });
    const res = await call(temp, def);
    conforms(def, res);
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename=/);
    expect(JSON.stringify(res.body)).toContain('in export');
  },
  'users.deleteAccount': async (f, def) => {
    const temp = await stack.user('leaver');
    conforms(def, await call(temp, def, { body: { username: temp.name } }));
    // the account is anonymised and every device of it is signed out
    const row = await stack.db
      .selectFrom('users')
      .select('status')
      .where('id', '=', temp.id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('deleted');
    expect(await revokedAt(temp.deviceId)).not.toBeNull();
  },
  'users.clearFlickChat': async (f, def) => {
    const temp = await stack.user('clearer');
    conforms(def, await call(temp, def));
  },
  'users.privacy': async (f, def) => conforms(def, await call(f.alice, def)),
  'users.updatePrivacy': async (f, def) =>
    conforms(def, await call(f.alice, def, { body: { read_receipts: false } })),

  // ------------------------------------------------------------------ devices
  'devices.list': async (f, def) => {
    const res = await call(f.alice, def);
    conforms(def, res);
    expect((res.body.items as { current: boolean }[]).filter((d) => d.current)).toHaveLength(1);
  },
  'devices.revoke': async (f, def) => {
    const temp = await stack.user('multi');
    const other = await stack.device(temp);
    conforms(def, await call(temp, def, { params: { device_id: other.deviceId } }));
    expect(await revokedAt(other.deviceId)).not.toBeNull();
    expect(await revokedAt(temp.deviceId)).toBeNull();
  },
  'devices.revokeOthers': async (f, def) => {
    const temp = await stack.user('multi');
    const other = await stack.device(temp);
    conforms(def, await call(temp, def));
    expect(await revokedAt(other.deviceId)).not.toBeNull();
    expect(await revokedAt(temp.deviceId)).toBeNull();
  },

  // ------------------------------------------------------------------ conversations
  'conversations.list': async (f, def) => {
    const res = await call(f.alice, def, { query: 'filter=all&limit=10' });
    conforms(def, res);
    expect(res.body.items.length).toBeGreaterThan(0);
  },
  'conversations.get': async (f, def) => conforms(def, await call(f.alice, def, { params: C(f) })),
  'conversations.createDirect': async (f, def) =>
    conforms(def, await call(f.alice, def, { body: { user_id: f.carol.id } })),
  'conversations.openSaved': async (f, def) => conforms(def, await call(f.alice, def)),
  'conversations.createGroup': async (f, def) =>
    conforms(
      def,
      await call(f.alice, def, { body: { title: 'Fresh', member_ids: [f.bob.id] } }),
      201,
    ),
  'conversations.update': async (f, def) =>
    conforms(def, await call(f.alice, def, { params: C(f), body: { title: 'Renamed' } })),
  'conversations.updatePrefs': async (f, def) =>
    conforms(def, await call(f.alice, def, { params: C(f), body: { archived: true } })),
  'conversations.leave': async (f, def) => {
    const g = await group(stack, f.alice, [f.bob, f.carol], 'to leave');
    conforms(def, await call(f.carol, def, { params: { conversation_id: g } }));
  },
  'conversations.members': async (f, def) =>
    conforms(def, await call(f.alice, def, { params: C(f), query: 'limit=2' })),
  'conversations.addMembers': async (f, def) =>
    conforms(def, await call(f.alice, def, { params: C(f), body: { user_ids: [f.dave.id] } })),
  'conversations.removeMember': async (f, def) => {
    const g = await group(stack, f.alice, [f.bob, f.carol], 'to remove from');
    conforms(
      def,
      await call(f.alice, def, { params: { conversation_id: g, user_id: f.carol.id } }),
    );
  },
  'conversations.setRole': async (f, def) =>
    conforms(
      def,
      await call(f.alice, def, {
        params: { conversation_id: f.conv, user_id: f.bob.id },
        body: { role: 'admin' },
      }),
    ),
  'conversations.shared': async (f, def) => {
    await send(stack, f.alice, f.conv, { type: 'text', text: 'see https://example.com/page' });
    conforms(def, await call(f.bob, def, { params: C(f), query: 'kind=links&limit=5' }));
    conforms(def, await call(f.bob, def, { params: C(f), query: 'kind=media' }));
  },
  'conversations.mentionCandidates': async (f, def) =>
    conforms(def, await call(f.alice, def, { params: C(f), query: 'q=b' })),
  'conversations.createInvite': async (f, def) =>
    conforms(def, await call(f.alice, def, { params: C(f), body: {} }), 201),
  'conversations.previewInvite': async (f, def) => {
    const invite = await call(f.alice, E.conversations.createInvite, { params: C(f), body: {} });
    conforms(def, await call(f.dave, def, { params: { code: invite.body.code } }));
  },
  'conversations.joinInvite': async (f, def) => {
    const g = await group(stack, f.alice, [f.bob], 'invite me');
    const invite = await call(f.alice, E.conversations.createInvite, {
      params: { conversation_id: g },
      body: {},
    });
    conforms(def, await call(f.dave, def, { params: { code: invite.body.code } }));
  },
  'conversations.revokeInvite': async (f, def) => {
    const invite = await call(f.alice, E.conversations.createInvite, { params: C(f), body: {} });
    conforms(def, await call(f.alice, def, { params: { code: invite.body.code } }));
  },
  'conversations.joinRequests': async (f, def) => {
    const g = await group(stack, f.alice, [f.bob], 'approval');
    await call(f.alice, E.conversations.update, {
      params: { conversation_id: g },
      body: { settings: { approval_required: true } },
    });
    const invite = await call(f.alice, E.conversations.createInvite, {
      params: { conversation_id: g },
      body: {},
    });
    const joined = await call(f.dave, E.conversations.joinInvite, {
      params: { code: invite.body.code },
    });
    expect(joined.body.status).toBe('requested');
    const res = await call(f.alice, def, { params: { conversation_id: g } });
    conforms(def, res);
    expect(res.body.items).toHaveLength(1);
  },
  'conversations.decideJoinRequest': async (f, def) => {
    const g = await group(stack, f.alice, [f.bob], 'approval 2');
    await call(f.alice, E.conversations.update, {
      params: { conversation_id: g },
      body: { settings: { approval_required: true } },
    });
    const invite = await call(f.alice, E.conversations.createInvite, {
      params: { conversation_id: g },
      body: {},
    });
    await call(f.carol, E.conversations.joinInvite, { params: { code: invite.body.code } });
    const list = await call(f.alice, E.conversations.joinRequests, {
      params: { conversation_id: g },
    });
    conforms(
      def,
      await call(f.alice, def, {
        params: { conversation_id: g, request_id: list.body.items[0].id },
        body: { approve: true },
      }),
    );
  },

  // ------------------------------------------------------------------ messages
  'messages.send': async (f, def) =>
    conforms(
      def,
      await call(f.alice, def, {
        params: C(f),
        body: { client_message_id: 'conformance-send-1', content: { type: 'text', text: 'x' } },
      }),
    ),
  'messages.history': async (f, def) =>
    conforms(def, await call(f.bob, def, { params: C(f), query: 'limit=5' })),
  'messages.getPoll': async (f, def) =>
    conforms(def, await call(f.bob, def, { params: M(f, f.pollId) })),
  'messages.votePoll': async (f, def) =>
    conforms(
      def,
      await call(f.bob, def, { params: M(f, f.pollId), body: { option_indexes: [0] } }),
    ),
  'messages.sync': async (f, def) =>
    conforms(
      def,
      await call(f.bob, def, {
        body: { cursors: [{ conversation_id: f.conv, after_seq: 0 }], limit: 50 },
      }),
    ),
  'messages.edit': async (f, def) =>
    conforms(
      def,
      await call(f.alice, def, {
        params: M(f),
        body: { content: { type: 'text', text: 'hello edited' } },
      }),
    ),
  'messages.delete': async (f, def) => {
    const m = await send(stack, f.alice, f.conv, { type: 'text', text: 'delete me' });
    conforms(
      def,
      await call(f.alice, def, { params: M(f, m.body.message_id), query: 'for=everyone' }),
    );
  },
  'messages.react': async (f, def) =>
    conforms(def, await call(f.bob, def, { params: M(f), body: { emoji: '👍' } })),
  'messages.unreact': async (f, def) => {
    await call(f.bob, E.messages.react, { params: M(f), body: { emoji: '🎉' } });
    conforms(def, await call(f.bob, def, { params: M(f) }));
  },
  'messages.star': async (f, def) => conforms(def, await call(f.bob, def, { params: M(f) })),
  'messages.unstar': async (f, def) => {
    await call(f.bob, E.messages.star, { params: M(f) });
    conforms(def, await call(f.bob, def, { params: M(f) }));
  },
  'messages.starred': async (f, def) => {
    await call(f.bob, E.messages.star, { params: M(f) });
    const res = await call(f.bob, def, { query: 'limit=10' });
    conforms(def, res);
    expect(res.body.items.length).toBeGreaterThan(0);
  },
  'messages.pin': async (f, def) =>
    conforms(def, await call(f.alice, def, { params: C(f), body: { message_id: f.messageId } })),
  'messages.unpin': async (f, def) => {
    await call(f.alice, E.messages.pin, { params: C(f), body: { message_id: f.messageId } });
    conforms(def, await call(f.alice, def, { params: M(f) }));
  },
  'messages.pins': async (f, def) => {
    await call(f.alice, E.messages.pin, { params: C(f), body: { message_id: f.messageId } });
    const res = await call(f.bob, def, { params: C(f) });
    conforms(def, res);
    expect(res.body.items.length).toBeGreaterThan(0);
  },
  'messages.openViewOnce': async (f, def) => {
    const m = await send(stack, f.alice, f.conv, {
      type: 'image',
      attachment_id: await attachment(stack.db, f.alice),
      width: 2,
      height: 2,
      view_once: true,
    });
    conforms(def, await call(f.bob, def, { params: M(f, m.body.message_id) }));
  },
  'messages.info': async (f, def) => conforms(def, await call(f.alice, def, { params: M(f) })),
  'messages.search': async (f, def) =>
    conforms(def, await call(f.alice, def, { query: 'q=conformance' })),
  'messages.delivered': async (f, def) =>
    conforms(
      def,
      await call(f.bob, def, { body: { acks: [{ conversation_id: f.conv, seq: 1 }] } }),
    ),
  'messages.read': async (f, def) =>
    conforms(def, await call(f.bob, def, { params: C(f), body: { seq: 1 } })),

  // ------------------------------------------------------------------ media (real MinIO)
  'media.presignUpload': async (f, def) =>
    conforms(
      def,
      await call(f.alice, def, {
        body: { purpose: 'message', mime: 'image/png', size: PNG.length },
      }),
    ),
  'media.complete': async (f, def) => {
    const id = await uploadPng(f.alice, { complete: false });
    conforms(def, await call(f.alice, def, { params: { attachment_id: id } }));
  },
  'media.download': async (f, def) => {
    const id = await uploadPng(f.alice, { complete: true });
    conforms(def, await call(f.alice, def, { params: { attachment_id: id } }));
  },
  'media.gifSearch': async (f, def) => {
    const res = await call(f.alice, def, { query: 'q=cat&limit=3' });
    conforms(def, res);
    expect(res.body.items).toHaveLength(1);
  },
  'media.gifTrending': async (f, def) =>
    conforms(def, await call(f.alice, def, { query: 'limit=3' })),

  // ------------------------------------------------------------------ calls
  'calls.turn': async (f, def) => conforms(def, await call(f.alice, def)),
  'calls.livekitToken': async (f, def) =>
    conforms(def, await call(f.alice, def, { body: { conversation_id: f.conv, media: 'audio' } })),
  'calls.groupPresence': async (f, def) => conforms(def, await call(f.bob, def, { params: C(f) })),
  'calls.groupBeat': async (f, def) => {
    const g = await group(stack, f.alice, [f.bob], 'beat');
    const beat = await call(f.bob, def, { body: { conversation_id: g } });
    conforms(def, beat);
    expect(beat.body).toEqual({ active: true, participants: 1 });
    const left = await call(f.bob, def, { body: { conversation_id: g, action: 'leave' } });
    conforms(def, left);
    expect(left.body).toEqual({ active: false, participants: 0 });
  },
  // Public: no login, the one-time token from the push is the proof (seeded here like the gateway
  // does when it parks a call).
  'calls.declineFromPush': async (f, def) => {
    const callId = randomUUID();
    const token = 'a-one-time-token-of-enough-length';
    await stack.redis.set(
      `call:decline-token:${callId}`,
      JSON.stringify({ user_id: f.bob.id, token }),
      'PX',
      30_000,
    );
    conforms(def, await call(null, def, { body: { call_id: callId, token } }));
  },
  'calls.createLink': async (f, def) =>
    conforms(
      def,
      await call(f.alice, def, {
        body: { conversation_id: f.conv, media: 'video', expires_in_s: 3600 },
      }),
      201,
    ),
  'calls.getLink': async (f, def) => {
    const link = await call(f.alice, E.calls.createLink, {
      body: { conversation_id: f.conv, media: 'video', expires_in_s: 3600 },
    });
    conforms(def, await call(f.dave, def, { params: { code: link.body.code } }));
  },
  'calls.revokeLink': async (f, def) => {
    const link = await call(f.alice, E.calls.createLink, {
      body: { conversation_id: f.conv, media: 'audio', expires_in_s: 3600 },
    });
    conforms(def, await call(f.alice, def, { params: { code: link.body.code } }));
  },
  'calls.log': async (f, def) => conforms(def, await call(f.alice, def, { query: 'limit=5' })),

  // ------------------------------------------------------------------ scheduled
  'scheduled.create': async (f, def) =>
    conforms(
      def,
      await call(f.alice, def, { params: C(f), body: { text: 'later', send_at: inOneHour() } }),
      201,
    ),
  'scheduled.list': async (f, def) => {
    await call(f.alice, E.scheduled.create, {
      params: C(f),
      body: { text: 'listed', send_at: inOneHour() },
    });
    const res = await call(f.alice, def);
    conforms(def, res);
    expect(res.body.items.length).toBeGreaterThan(0);
  },
  'scheduled.cancel': async (f, def) => {
    const made = await call(f.alice, E.scheduled.create, {
      params: C(f),
      body: { text: 'cancel me', send_at: inOneHour() },
    });
    conforms(def, await call(f.alice, def, { params: { scheduled_id: made.body.id } }));
  },

  // ------------------------------------------------------------------ reminders
  'reminders.create': async (f, def) =>
    conforms(
      def,
      await call(f.alice, def, {
        body: { message_id: f.messageId, remind_at: inOneHour(), note: 'look again' },
      }),
      201,
    ),
  'reminders.list': async (f, def) => {
    await call(f.alice, E.reminders.create, {
      body: { conversation_id: f.conv, remind_at: inOneHour() },
    });
    const res = await call(f.alice, def, { query: 'limit=5' });
    conforms(def, res);
    expect(res.body.items.length).toBeGreaterThan(0);
  },
  'reminders.cancel': async (f, def) => {
    const made = await call(f.alice, E.reminders.create, {
      body: { message_id: f.messageId, remind_at: inOneHour() },
    });
    conforms(def, await call(f.alice, def, { params: { reminder_id: made.body.id } }));
  },

  // ------------------------------------------------------------------ ai (fake provider)
  'ai.status': async (f, def) => {
    const res = await call(f.alice, def);
    conforms(def, res);
    expect(res.body.enabled).toBe(true);
  },
  // The AI routes answer JSON only when the client sends Accept: application/json (the web
  // client always does); without it they stream server-sent events.
  'ai.summarize': async (f, def) =>
    conforms(
      def,
      await call(f.bob, def, { body: { conversation_id: f.conv }, headers: JSON_ONLY }),
    ),
  'ai.suggestReplies': async (f, def) =>
    conforms(
      def,
      await call(f.bob, def, { body: { conversation_id: f.conv }, headers: JSON_ONLY }),
    ),
  'ai.translate': async (f, def) =>
    conforms(
      def,
      await call(f.bob, def, { body: { text: 'hello', targetLang: 'fr' }, headers: JSON_ONLY }),
    ),
  'ai.ask': async (f, def) =>
    conforms(
      def,
      await call(f.bob, def, {
        body: { messages: [{ role: 'user', content: 'hi' }] },
        headers: JSON_ONLY,
      }),
    ),

  // ------------------------------------------------------------------ push
  'push.vapidKey': async (f, def) => {
    const res = await call(f.alice, def);
    conforms(def, res);
    expect(res.body.public_key).toBe('BPublicKeyForTests');
  },
  'push.subscribe': async (f, def) =>
    conforms(
      def,
      await call(f.alice, def, {
        body: { endpoint: 'https://push.example.test/abc', keys: { p256dh: 'k1', auth: 'k2' } },
      }),
    ),
  'push.unsubscribe': async (f, def) =>
    conforms(
      def,
      await call(f.alice, def, { body: { endpoint: 'https://push.example.test/abc' } }),
    ),

  // ------------------------------------------------------------------ moderation
  'moderation.block': async (f, def) =>
    conforms(def, await call(f.alice, def, { body: { user_id: f.dave.id } })),
  'moderation.unblock': async (f, def) => {
    await call(f.alice, E.moderation.block, { body: { user_id: f.dave.id } });
    conforms(def, await call(f.alice, def, { params: { user_id: f.dave.id } }));
  },
  'moderation.blocks': async (f, def) => {
    await call(f.alice, E.moderation.block, { body: { user_id: f.carol.id } });
    const res = await call(f.alice, def);
    conforms(def, res);
    expect(res.body.items.length).toBeGreaterThan(0);
  },
  'moderation.report': async (f, def) =>
    conforms(
      def,
      await call(f.bob, def, {
        body: { conversation_id: f.conv, message_id: f.messageId, reason: 'spam', block: false },
      }),
    ),
};

// A 1x1 PNG, so the server's content sniffing accepts it as image/png.
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/** presign -> upload to MinIO -> (complete). Returns the attachment id. */
async function uploadPng(user: TestUser, options: { complete: boolean }): Promise<string> {
  const presign = await stack.call(user, 'POST', '/media/presign', {
    purpose: 'message',
    mime: 'image/png',
    size: PNG.length,
  });
  expect(presign.status, JSON.stringify(presign.body)).toBe(200);
  const form = new FormData();
  for (const [k, v] of Object.entries(presign.body.fields as Record<string, string>))
    form.append(k, v);
  form.append('file', new Blob([PNG], { type: 'image/png' }), 'x.png');
  const up = await realFetch(presign.body.url, { method: 'POST', body: form });
  expect(up.status, await up.text()).toBeLessThan(300);
  if (options.complete) {
    const done = await stack.call(user, 'POST', `/media/${presign.body.attachment_id}/complete`);
    expect(done.status, JSON.stringify(done.body)).toBe(200);
  }
  return presign.body.attachment_id;
}

describe('every endpoint answers valid input with JSON that matches its own response schema', () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await fixture();
  });

  for (const { key, def } of flat) {
    if (key in NOT_CALLED) {
      it.skip(`${def.method} ${def.path} (${key}) is not called: ${NOT_CALLED[key]}`, () =>
        undefined);
      continue;
    }
    it(`${def.method} ${def.path}  [${key}]`, async () => {
      const scenario = SCENARIOS[key];
      expect(scenario, `no scenario for ${key}`).toBeDefined();
      await scenario!(f, def);
    });
  }

  it('GET /link-preview: a refused address is a clean standard error, not a 500', async () => {
    const res = await stack.call(
      f.alice,
      'GET',
      `/link-preview?url=${encodeURIComponent('http://127.0.0.1:1/private')}`,
    );
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
  });

  it('send/history/pins/polls use the same envelope for lists: { items, next_cursor } or { items }', async () => {
    const res = await stack.call(f.bob, 'GET', `/conversations/${f.conv}/messages?limit=1`);
    expect(Object.keys(res.body).sort()).toEqual(['items', 'next_cursor']);
    expect(res.body.next_cursor).not.toBeNull();
    const next = await stack.call(
      f.bob,
      'GET',
      `/conversations/${f.conv}/messages?limit=1&before_seq=${res.body.items[0].seq}`,
    );
    expect(next.body.items[0].seq).toBeLessThan(res.body.items[0].seq);
  });
});
