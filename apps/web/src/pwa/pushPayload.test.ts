import { describe, expect, it } from 'vitest';
import { pickWindow, type WindowInfo } from './clickTarget';
import {
  conversationUrl,
  parsePushPayload,
  previousOf,
  testNotification,
  toNotification,
} from './pushPayload';

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

  it('tags by chat, links to the message, and groups repeats', () => {
    const first = toNotification(parsePushPayload({ ...payload, seq: 7 }));
    expect(first.title).toBe('Bob');
    expect(first.options.body).toBe('hello');
    expect(first.options.tag).toBe('chat:c1');
    expect(first.options.renotify).toBe(true);
    expect(first.options.data).toMatchObject({ url: '/?c=c1&m=m1&s=7', count: 1 });

    const second = toNotification(
      parsePushPayload({ ...payload, message_id: 'm2', seq: 8, sender_name: 'Bob' }),
      previousOf(first.options.data),
    );
    expect(second.options.body).toBe('2 new messages');
    expect(second.options.data).toMatchObject({ count: 2, ids: ['m1', 'm2'] });
    // The same push arriving again (a retry) is not counted twice.
    const again = toNotification(
      parsePushPayload({ ...payload, message_id: 'm2' }),
      previousOf(second.options.data),
    );
    expect(again.options.data).toMatchObject({ count: 2 });
  });

  it('shows a test push and picks the window to focus', () => {
    expect(testNotification({ title: 'T', body: 'B' }).options.tag).toBe('flick-test');
    expect(
      pickWindow([
        { focused: false, visibilityState: 'hidden' },
        { focused: false, visibilityState: 'visible' },
      ]),
    ).toMatchObject({ visibilityState: 'visible' });
    expect(pickWindow<WindowInfo>([])).toBeUndefined();
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
