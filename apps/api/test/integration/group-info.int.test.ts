/* eslint-disable @typescript-eslint/no-unsafe-member-access -- test responses are untyped JSON */
import { allocateSeqAndInsertMessage } from '@chat/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './support.js';

// Group info: the description, and the "media, links and files" tab.
let t: Awaited<ReturnType<typeof startTestApp>>;
beforeAll(async () => {
  t = await startTestApp();
});
afterAll(async () => {
  await t.stop();
});

async function group() {
  const owner = await t.makeUser();
  const member = await t.makeUser();
  const res = await t.call(owner, 'POST', '/conversations/group', {
    title: 'Team',
    member_ids: [member],
  });
  return { owner, member, id: res.body.id as string };
}

describe('group description', () => {
  it('admins set and clear it; members cannot; the summary carries it', async () => {
    const g = await group();
    const conv = `/conversations/${g.id}`;
    const body = { description: '  Weekly sync notes  ' };
    // Members may edit group info until an admin restricts it to admins.
    await t.call(g.owner, 'PATCH', conv, { settings: { only_admins_edit_info: true } });
    expect((await t.call(g.member, 'PATCH', conv, body)).status).toBe(403);

    const set = await t.call(g.owner, 'PATCH', conv, body);
    expect(set.status).toBe(200);
    expect(set.body.description).toBe('Weekly sync notes');
    expect((await t.call(g.member, 'GET', conv)).body.description).toBe('Weekly sync notes');

    const cleared = await t.call(g.owner, 'PATCH', conv, { description: '' });
    expect(cleared.body.description).toBeNull();
  });
});

describe('media, links and files tab', () => {
  it('lists each kind newest first, pages by seq, and is for members only', async () => {
    const g = await group();
    const text = (bodyText: string) =>
      allocateSeqAndInsertMessage(t.db, {
        conversationId: g.id,
        senderId: g.owner,
        senderDeviceId: null,
        clientMessageId: null,
        type: 'text',
        bodyText,
        authorize: false,
      });
    await text('no link here');
    await text('see https://example.com/a');
    await text('and HTTP://example.com/b');

    const attachment = await t.db
      .insertInto('attachments')
      .values({
        owner_id: g.owner,
        object_key: `files/${g.id}.pdf`,
        file_name: 'plan.pdf',
        declared_mime: 'application/pdf',
        verified_mime: 'application/pdf',
        size_bytes: 1000,
        sha256: Buffer.alloc(32, 1),
        status: 'attached',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await allocateSeqAndInsertMessage(t.db, {
      conversationId: g.id,
      senderId: g.owner,
      senderDeviceId: null,
      clientMessageId: null,
      type: 'file',
      content: { file_name: 'plan.pdf', size_bytes: 1000, mime: 'application/pdf' },
      attachmentId: attachment.id,
      authorize: false,
    });
    const base = `/conversations/${g.id}/shared`;

    const first = await t.call(g.member, 'GET', `${base}?kind=links&limit=1`);
    expect(first.status).toBe(200);
    expect(first.body.items).toHaveLength(1);
    expect(first.body.items[0].content.text).toContain('HTTP://example.com/b');
    expect(first.body.next_cursor).not.toBeNull();

    const rest = await t.call(
      g.member,
      'GET',
      `${base}?kind=links&before_seq=${first.body.next_cursor as string}`,
    );
    expect(rest.body.items).toHaveLength(1);
    expect(rest.body.items[0].content.text).toContain('https://example.com/a');
    expect(rest.body.next_cursor).toBeNull();

    const files = await t.call(g.owner, 'GET', `${base}?kind=files`);
    expect(files.body.items).toHaveLength(1);
    expect(files.body.items[0].content.type).toBe('file');
    expect((await t.call(g.owner, 'GET', `${base}?kind=media`)).body.items).toHaveLength(0);

    expect((await t.call(g.owner, 'GET', `${base}?kind=bogus`)).status).toBe(400);
    const outsider = await t.makeUser();
    expect((await t.call(outsider, 'GET', `${base}?kind=media`)).status).toBe(404);
  });
});
