import { describe, expect, it } from 'vitest';
import {
  ConversationSummary,
  DeleteMessageQuery,
  ENDPOINTS,
  type Endpoint,
  LIMITS,
  LivekitTokenRequest,
  PageQuery,
  PresignUploadRequest,
  SubmitMessageRequest,
  UpdateConversationRequest,
  buildPath,
} from '../src/index.js';
import { CONTENT, CONV, MSG } from './fixtures.js';

const all: [string, Endpoint][] = Object.entries(ENDPOINTS).flatMap(([group, defs]) =>
  Object.entries(defs as Record<string, Endpoint>).map(
    ([name, def]) => [`${group}.${name}`, def] as [string, Endpoint],
  ),
);

describe('endpoint list', () => {
  it('has no duplicate method + path', () => {
    const keys = all.map(([, e]) => `${e.method} ${e.path}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('uses relative paths only (the base path comes from config)', () => {
    for (const [name, e] of all) expect(e.path.startsWith('/api'), name).toBe(false);
  });

  it('declares a params schema exactly for paths with :params', () => {
    for (const [name, e] of all) {
      const names = [...e.path.matchAll(/:([a-z_]+)/g)].map((m) => m[1]).sort();
      const keys = e.params
        ? Object.keys((e.params as unknown as { shape: object }).shape).sort()
        : [];
      expect(keys, name).toEqual(names);
    }
  });
});

describe('buildPath', () => {
  it('joins the base and encodes params', () => {
    expect(
      buildPath('https://flick.example.com/api/', ENDPOINTS.messages.react.path, {
        conversation_id: CONV,
        message_id: MSG,
      }),
    ).toBe(`https://flick.example.com/api/conversations/${CONV}/messages/${MSG}/reaction`);
    expect(buildPath('', '/users/:user_id', { user_id: 'a/b' })).toBe('/users/a%2Fb');
    expect(() => buildPath('', '/users/:user_id')).toThrow(/user_id/);
  });
});

describe('request schemas', () => {
  it('coerces query strings and applies the default page size', () => {
    expect(PageQuery.parse({})).toEqual({ limit: LIMITS.DEFAULT_PAGE_SIZE });
    expect(PageQuery.parse({ limit: '7' })).toEqual({ limit: 7 });
    expect(PageQuery.safeParse({ limit: String(LIMITS.MAX_PAGE_SIZE + 1) }).success).toBe(false);
  });

  it('validates the important rules', () => {
    expect(
      SubmitMessageRequest.safeParse({ client_message_id: 'client_msg_456', content: CONTENT.text })
        .success,
    ).toBe(true);
    expect(
      SubmitMessageRequest.safeParse({
        client_message_id: 'client_msg_456',
        content: CONTENT.system,
      }).success,
    ).toBe(false);
    expect(DeleteMessageQuery.safeParse({ for: 'everyone' }).success).toBe(true);
    expect(DeleteMessageQuery.safeParse({ for: 'nobody' }).success).toBe(false);
    expect(LivekitTokenRequest.safeParse({}).success).toBe(false); // needs conversation_id or call_link
    expect(
      PresignUploadRequest.safeParse({
        purpose: 'avatar',
        mime: 'image/png',
        size: 50 * 1024 * 1024,
      }).success,
    ).toBe(false);
    expect(
      UpdateConversationRequest.safeParse({ settings: { disappearing_timer_s: 86_400 } }).success,
    ).toBe(true);
    expect(
      UpdateConversationRequest.safeParse({ settings: { disappearing_timer_s: 5 } }).success,
    ).toBe(false);
  });
});

describe('chat list preview', () => {
  it('turns a last message it cannot read into "no preview", so the list still loads', () => {
    const preview = ConversationSummary.shape.last_message;
    // What the server once sent for a voice note: no type, no attachment.
    expect(preview.parse({ content: { waveform: [1, 2], duration_ms: 5 } })).toBeNull();
    expect(preview.parse(null)).toBeNull();
  });
});
