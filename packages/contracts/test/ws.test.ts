import { describe, expect, it } from 'vitest';
import { CLIENT_PAYLOADS, LIMITS, SERVER_PAYLOADS } from '../src/index.js';
import { CLIENT_EVENTS, CONTENT, CONV, SERVER_EVENTS } from './fixtures.js';

describe('event map', () => {
  it('has a valid example for every event, in both directions', () => {
    for (const [name, schema] of Object.entries(CLIENT_PAYLOADS)) {
      const example = CLIENT_EVENTS[name as keyof typeof CLIENT_EVENTS];
      expect(schema.safeParse(example).success, name).toBe(true);
    }
    for (const [name, schema] of Object.entries(SERVER_PAYLOADS)) {
      const example = SERVER_EVENTS[name as keyof typeof SERVER_EVENTS];
      expect(schema.safeParse(example).success, name).toBe(true);
    }
  });

  it('has no leftovers of the old protocol', () => {
    for (const gone of ['auth', 'heartbeat', 'live_location', 'sync_required'])
      expect(Object.keys(CLIENT_PAYLOADS)).not.toContain(gone);
  });
});

describe('client payload rules', () => {
  const parse = (event: keyof typeof CLIENT_PAYLOADS, payload: unknown) =>
    CLIENT_PAYLOADS[event].safeParse(payload).success;

  it('enforces the text length limit exactly', () => {
    const send = (text: string) => ({
      ...CLIENT_EVENTS.send_message,
      content: { type: 'text', text },
    });
    expect(parse('send_message', send('a'.repeat(LIMITS.MAX_TEXT_LENGTH)))).toBe(true);
    expect(parse('send_message', send('a'.repeat(LIMITS.MAX_TEXT_LENGTH + 1)))).toBe(false);
  });

  it('does not let clients send system or call_event content', () => {
    for (const content of [CONTENT.system, CONTENT.call_event])
      expect(parse('send_message', { ...CLIENT_EVENTS.send_message, content })).toBe(false);
  });

  it('rejects bad ids, empty or oversized ack lists and oversized sync pages', () => {
    expect(parse('read_ack', { conversation_id: 'not-a-uuid', seq: 1 })).toBe(false);
    expect(parse('read_ack', { conversation_id: CONV, seq: -1 })).toBe(false);
    expect(parse('delivery_ack', { acks: [] })).toBe(false);
    const tooMany = Array.from({ length: LIMITS.MAX_ACKS_PER_FRAME + 1 }, () => ({
      conversation_id: CONV,
      seq: 1,
    }));
    expect(parse('delivery_ack', { acks: tooMany })).toBe(false);
    expect(parse('sync_request', { cursors: [], limit: LIMITS.MAX_SYNC_PAGE_SIZE + 1 })).toBe(
      false,
    );
    expect(parse('call_offer', { ...CLIENT_EVENTS.call_offer, media: 'hologram' })).toBe(false);
  });
});
