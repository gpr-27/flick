import { describe, expect, it } from 'vitest';
import { conversationUrl, parsePushPayload, toNotification } from './pushPayload';

const payload = { title: 'Bob', body: 'hello', conversation_id: 'c1', message_id: 'm1' };

describe('push payload', () => {
  it('parses what the worker sends', () => {
    expect(parsePushPayload(payload)).toEqual(payload);
  });

  it('rejects malformed payloads', () => {
    expect(parsePushPayload(null)).toBeNull();
    expect(parsePushPayload('text')).toBeNull();
    expect(parsePushPayload({ ...payload, message_id: undefined })).toBeNull();
  });

  it('uses message_id as the tag so repeats collapse, and links to the conversation', () => {
    const shown = toNotification(parsePushPayload(payload));
    expect(shown.title).toBe('Bob');
    expect(shown.options.body).toBe('hello');
    expect(shown.options.tag).toBe('m1');
    expect(shown.options.data.url).toBe('/?c=c1');
  });

  it('falls back to a generic notification', () => {
    const shown = toNotification(null);
    expect(shown.title).toBe('Flick');
    expect(shown.options.data.url).toBe('/');
  });

  it('encodes the conversation id', () => {
    expect(conversationUrl('a b')).toBe('/?c=a%20b');
  });
});
