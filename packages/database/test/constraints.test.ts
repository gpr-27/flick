import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { FLICK_BOT_USER_ID } from '../src/bot.js';

import {
  createTestDatabase,
  expectPgError,
  makeConversation,
  makeUser,
  type TestDatabase,
} from './helpers.js';

const UNIQUE = '23505';
const CHECK = '23514';

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.destroy();
});

describe('database constraints', () => {
  it('usernames are unique regardless of case', async () => {
    await t.db.insertInto('users').values({ username: 'Zed', display_name: 'Zed' }).execute();
    await expectPgError(
      t.db.insertInto('users').values({ username: 'zed', display_name: 'Z' }).execute(),
      UNIQUE,
      'users_username_uq',
    );
    await t.db
      .insertInto('users')
      .values({ username: 'clerk1', display_name: 'C', clerk_id: 'user_1' })
      .execute();
    await expectPgError(
      t.db
        .insertInto('users')
        .values({ username: 'clerk2', display_name: 'C', clerk_id: 'user_1' })
        .execute(),
      UNIQUE,
      'users_clerk_id_uq',
    );
  });

  it('one direct conversation per pair, stored with user_lo < user_hi', async () => {
    const a = await makeUser(t.db);
    const b = await makeUser(t.db);
    const [lo, hi] = [a.id, b.id].sort() as [string, string];
    const c1 = await makeConversation(t.db, 'direct', []);
    const c2 = await makeConversation(t.db, 'direct', []);
    await t.db
      .insertInto('direct_pairs')
      .values({ user_lo: lo, user_hi: hi, conversation_id: c1 })
      .execute();
    await expectPgError(
      t.db
        .insertInto('direct_pairs')
        .values({ user_lo: lo, user_hi: hi, conversation_id: c2 })
        .execute(),
      UNIQUE,
      'direct_pairs_pk',
    );
    await expectPgError(
      t.db
        .insertInto('direct_pairs')
        .values({ user_lo: hi, user_hi: lo, conversation_id: c2 })
        .execute(),
      CHECK,
      'direct_pairs_order_ck',
    );
  });

  it('a device cannot reuse a client_message_id', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', []);
    const row = {
      conversation_id: conv,
      sender_id: u.id,
      sender_device_id: u.deviceId,
      client_message_id: randomUUID(),
      type: 'text' as const,
    };
    await t.db
      .insertInto('messages')
      .values({ ...row, seq: 1 })
      .execute();
    await expectPgError(
      t.db
        .insertInto('messages')
        .values({ ...row, seq: 2 })
        .execute(),
      UNIQUE,
      'messages_sender_device_client_id_uq',
    );
  });

  it('a conversation cannot have two messages with the same seq', async () => {
    const conv = await makeConversation(t.db, 'group', []);
    await t.db
      .insertInto('messages')
      .values({ conversation_id: conv, seq: 1, type: 'system' })
      .execute();
    await expectPgError(
      t.db
        .insertInto('messages')
        .values({ conversation_id: conv, seq: 1, type: 'system' })
        .execute(),
      UNIQUE,
      'messages_conversation_seq_uq',
    );
  });

  it('a deleted message keeps no content', async () => {
    const conv = await makeConversation(t.db, 'group', []);
    await expectPgError(
      t.db
        .insertInto('messages')
        .values({
          conversation_id: conv,
          seq: 1,
          type: 'text',
          body_text: 'gone',
          deleted_at: new Date(),
        })
        .execute(),
      CHECK,
      'messages_tombstone_ck',
    );
  });

  it('a user cannot add the same reaction twice', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', []);
    const m = await t.db
      .insertInto('messages')
      .values({ conversation_id: conv, seq: 1, type: 'text', body_text: 'hi' })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto('reactions')
      .values({ message_id: m.id, user_id: u.id, emoji: '👍' })
      .execute();
    await t.db
      .insertInto('reactions')
      .values({ message_id: m.id, user_id: u.id, emoji: '🔥' })
      .execute();
    await expectPgError(
      t.db
        .insertInto('reactions')
        .values({ message_id: m.id, user_id: u.id, emoji: '👍' })
        .execute(),
      UNIQUE,
      'reactions_pk',
    );
  });

  it('a user votes for each poll option at most once', async () => {
    const u = await makeUser(t.db);
    const conv = await makeConversation(t.db, 'group', []);
    const poll = await t.db
      .insertInto('messages')
      .values({
        conversation_id: conv,
        seq: 1,
        type: 'poll',
        body_text: 'Lunch?',
        content: { options: ['pizza', 'sushi'] },
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await t.db
      .insertInto('poll_votes')
      .values({ message_id: poll.id, user_id: u.id, option_index: 0 })
      .execute();
    await expectPgError(
      t.db
        .insertInto('poll_votes')
        .values({ message_id: poll.id, user_id: u.id, option_index: 0 })
        .execute(),
      UNIQUE,
      'poll_votes_pk',
    );
  });

  it('the migration creates the Flick bot user', async () => {
    const bot = await t.db
      .selectFrom('users')
      .select(['username', 'is_bot'])
      .where('id', '=', FLICK_BOT_USER_ID)
      .executeTakeFirstOrThrow();
    expect(bot).toEqual({ username: 'flick', is_bot: true });
  });

  it('the Flick language is 2-40 characters or empty', async () => {
    const { id: user } = await makeUser(t.db);
    await t.db
      .insertInto('user_settings')
      .values({ user_id: user, ai_language: 'Hindi' })
      .execute();
    await t.db
      .updateTable('user_settings')
      .set({ ai_language: null })
      .where('user_id', '=', user)
      .execute();
    for (const bad of ['x', 'y'.repeat(41)]) {
      await expectPgError(
        t.db
          .updateTable('user_settings')
          .set({ ai_language: bad })
          .where('user_id', '=', user)
          .execute(),
        CHECK,
        'user_settings_ai_language_ck',
      );
    }
  });
});
