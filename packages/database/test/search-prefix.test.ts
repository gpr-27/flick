import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  allocateSeqAndInsertMessage,
  prefixTsQuery,
  searchMessages,
} from '../src/queries/messages.js';
import { createTestDatabase, makeConversation, makeUser, type TestDatabase } from './helpers.js';

describe('prefixTsQuery', () => {
  it('turns every word into a prefix match', () => {
    expect(prefixTsQuery('tha')).toBe("'tha':*");
    expect(prefixTsQuery('Thank  you')).toBe("'Thank':* & 'you':*");
  });

  it('keeps only letters and digits, so text cannot change the query', () => {
    expect(prefixTsQuery("a' | b:* & !c")).toBe("'a':* & 'b':* & 'c':*");
    expect(prefixTsQuery('naïve 日本語 x_1')).toBe("'naïve':* & '日本語':* & 'x_1':*");
  });

  it('excludes a word marked with a minus, and returns null for nothing searchable', () => {
    expect(prefixTsQuery('lunch -noon')).toBe("'lunch':* & !'noon'");
    expect(prefixTsQuery('-noon')).toBeNull();
    expect(prefixTsQuery('  ?! ')).toBeNull();
    expect(prefixTsQuery('')).toBeNull();
  });
});

describe('searching by the start of a word', () => {
  let t: TestDatabase;
  let alice: Awaited<ReturnType<typeof makeUser>>;
  let room: string;

  beforeAll(async () => {
    t = await createTestDatabase();
    alice = await makeUser(t.db, { username: 'alice_s' });
    const bob = await makeUser(t.db, { username: 'bob_s' });
    room = await makeConversation(t.db, 'direct', [{ userId: alice.id }, { userId: bob.id }]);
    for (const bodyText of ['Thank you so much', 'Thanks!', 'THANK', 'lunch at noon', 'Tomorrow']) {
      await allocateSeqAndInsertMessage(t.db, {
        conversationId: room,
        senderId: alice.id,
        senderDeviceId: null,
        clientMessageId: null,
        type: 'text',
        bodyText,
      });
    }
  }, 60_000);

  afterAll(async () => {
    await t.destroy();
  });

  const find = async (q: string) =>
    (await searchMessages(t.db, alice.id, q, 20)).map((h) => h.body_text).sort();

  it('"tha" finds every message with a word that starts with it, in any letter case', async () => {
    expect(await find('tha')).toEqual(['THANK', 'Thank you so much', 'Thanks!']);
    expect(await find('THA')).toEqual(['THANK', 'Thank you so much', 'Thanks!']);
  });

  it('every typed word must match, each by its start', async () => {
    expect(await find('tha yo')).toEqual(['Thank you so much']);
    expect(await find('tha zzz')).toEqual([]);
  });

  it('a whole word still finds its message, a quoted phrase and a minus still work', async () => {
    expect(await find('thank')).toEqual(['THANK', 'Thank you so much', 'Thanks!']);
    expect(await find('lunch')).toEqual(['lunch at noon']);
    expect(await find('"thank you"')).toEqual(['Thank you so much']);
    expect(await find('thank -you')).toEqual(['THANK', 'Thanks!']);
  });

  it('hostile text is just text: no error, no match', async () => {
    expect(await find("'; drop table messages; --")).toEqual([]);
    expect(await find('!!!')).toEqual([]);
  });
});
