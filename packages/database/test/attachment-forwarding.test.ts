import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { allocateSeqAndInsertMessage, type SendMessageInput } from '../src/queries/messages.js';
import { createTestDatabase, makeConversation, makeUser, type TestDatabase } from './helpers.js';

// Who may put an attachment into a message. The owner always may. Anyone else may only if the file is
// already in a chat they are in right now (that is what "forward" sends: the same attachment_id).
// The message being inserted must not count as that chat, or anybody could take anybody's file.

let t: TestDatabase;
beforeAll(async () => {
  t = await createTestDatabase();
});
afterAll(async () => {
  await t.destroy();
});

async function upload(ownerId: string) {
  const row = await t.db
    .insertInto('attachments')
    .values({
      owner_id: ownerId,
      object_key: randomUUID(),
      declared_mime: 'image/png',
      size_bytes: 10,
      sha256: Buffer.alloc(32),
      status: 'uploaded',
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

function send(
  conversationId: string,
  user: { id: string; deviceId: string },
  extra: Partial<SendMessageInput>,
) {
  return allocateSeqAndInsertMessage(t.db, {
    conversationId,
    senderId: user.id,
    senderDeviceId: user.deviceId,
    clientMessageId: randomUUID(),
    type: 'image',
    ...extra,
  });
}

describe('attachments in messages', () => {
  it('a member can forward a file they received into another chat of theirs', async () => {
    const [sender, reader, target] = await Promise.all([
      makeUser(t.db),
      makeUser(t.db),
      makeUser(t.db),
    ]);
    const source = await makeConversation(t.db, 'group', [
      { userId: sender.id },
      { userId: reader.id },
    ]);
    const mine = await makeConversation(t.db, 'group', [
      { userId: reader.id },
      { userId: target.id },
    ]);
    const file = await upload(sender.id);
    await send(source, sender, { attachmentId: file });
    const forwarded = await send(mine, reader, { attachmentId: file, forwarded: true });
    expect(forwarded.message.attachment_id).toBe(file);
  });

  it('someone who is in no chat with the file cannot use it, and the failed send leaves no seq, message or event', async () => {
    const [sender, stranger] = await Promise.all([makeUser(t.db), makeUser(t.db)]);
    const source = await makeConversation(t.db, 'group', [{ userId: sender.id }]);
    const strangers = await makeConversation(t.db, 'group', [{ userId: stranger.id }]);
    const file = await upload(sender.id);
    await send(source, sender, { attachmentId: file });

    await expect(send(strangers, stranger, { attachmentId: file })).rejects.toMatchObject({
      code: 'attachment_not_found',
    });
    const conv = await t.db
      .selectFrom('conversations')
      .select('last_seq')
      .where('id', '=', strangers)
      .executeTakeFirstOrThrow();
    expect(conv.last_seq).toBe(0);
    expect(
      await t.db
        .selectFrom('messages')
        .select('id')
        .where('conversation_id', '=', strangers)
        .execute(),
    ).toEqual([]);
    expect(
      await t.db.selectFrom('outbox').select('id').where('partition_key', '=', strangers).execute(),
    ).toEqual([]);
  });

  it('a file that was never sent anywhere stays private to its owner', async () => {
    const [owner, other] = await Promise.all([makeUser(t.db), makeUser(t.db)]);
    const chat = await makeConversation(t.db, 'group', [{ userId: other.id }]);
    const file = await upload(owner.id);
    await expect(send(chat, other, { attachmentId: file })).rejects.toMatchObject({
      code: 'attachment_not_found',
    });
  });

  it('a member who has left the chat that holds the file cannot take it from there', async () => {
    const [sender, leaver, target] = await Promise.all([
      makeUser(t.db),
      makeUser(t.db),
      makeUser(t.db),
    ]);
    const source = await makeConversation(t.db, 'group', [
      { userId: sender.id },
      { userId: leaver.id },
    ]);
    const mine = await makeConversation(t.db, 'group', [
      { userId: leaver.id },
      { userId: target.id },
    ]);
    const file = await upload(sender.id);
    await send(source, sender, { attachmentId: file });
    await t.db
      .updateTable('conversation_members')
      .set({ left_at: new Date() })
      .where('conversation_id', '=', source)
      .where('user_id', '=', leaver.id)
      .execute();
    await expect(send(mine, leaver, { attachmentId: file })).rejects.toMatchObject({
      code: 'attachment_not_found',
    });
  });

  it('a file whose message was deleted for everyone cannot be taken any more', async () => {
    const [sender, reader] = await Promise.all([makeUser(t.db), makeUser(t.db)]);
    const source = await makeConversation(t.db, 'group', [
      { userId: sender.id },
      { userId: reader.id },
    ]);
    const mine = await makeConversation(t.db, 'group', [{ userId: reader.id }]);
    const file = await upload(sender.id);
    const first = await send(source, sender, { attachmentId: file });
    // the same thing "delete for everyone" does: the row stays, the content and the file link go
    await t.db
      .updateTable('messages')
      .set({ deleted_at: new Date(), attachment_id: null })
      .where('id', '=', first.message.id)
      .execute();
    await expect(send(mine, reader, { attachmentId: file })).rejects.toMatchObject({
      code: 'attachment_not_found',
    });
  });

  it('a file that was deleted from storage (status deleted) cannot be used even by its owner', async () => {
    const owner = await makeUser(t.db);
    const chat = await makeConversation(t.db, 'group', [{ userId: owner.id }]);
    const file = await upload(owner.id);
    await t.db
      .updateTable('attachments')
      .set({ status: 'deleted' })
      .where('id', '=', file)
      .execute();
    await expect(send(chat, owner, { attachmentId: file })).rejects.toMatchObject({
      code: 'attachment_not_found',
    });
  });
});
