import { randomUUID } from 'node:crypto';
import { GetObjectCommand, HeadObjectCommand } from '@aws-sdk/client-s3';
import { createDb, migrateUp, type Database } from '@chat/db';
import type { Kysely } from 'kysely';
import pg from 'pg';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.js';
import { loadConfig } from '../../src/config.js';
import { createLogger } from '../../src/logger.js';
import { createRedis } from '../../src/redis.js';
import { avatarVariantKey } from '../../src/modules/media/domain/avatars.js';
import { createStorage } from '../../src/modules/media/domain/storage.js';
import { sweepAbandonedUploads } from '../../src/modules/media/domain/sweep.js';
import { assertAttachmentUsable, markAttached } from '../../src/modules/media/repo/attach.js';

// Needs real Postgres, Redis and MinIO (see scripts/dev/test-deps-up.sh). It makes its own
// database on the Postgres server and leaves the bucket's other objects alone.
const env = { ...process.env, LOG_LEVEL: 'silent' };
const config = loadConfig(env);
const redis = createRedis(config.REDIS_URL);
const storage = createStorage(config)!;
const adminUrl = new URL(config.DATABASE_URL);
const dbName = `media_${randomUUID().replace(/-/g, '').slice(0, 12)}`;

let db: Kysely<Database>;
let app: Awaited<ReturnType<typeof buildApp>>;
let alice: string; // uploads files
let bob: string; // member of the conversation the file is sent in
let carol: string; // not a member
let conversationId: string;

async function makeUser(name: string): Promise<string> {
  const u = await db
    .insertInto('users')
    .values({
      username: `${name}_${randomUUID().slice(0, 6)}`,
      display_name: name,
      email: `${name}-${randomUUID()}@example.com`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return u.id;
}

interface Presigned {
  attachment_id: string;
  url: string;
  fields: Record<string, string>;
}

const as = (userId: string) => ({ 'x-test-user': userId });

async function presign(user: string, body: object) {
  return app.inject({ method: 'POST', url: '/media/presign', headers: as(user), payload: body });
}

/** What the browser does: POST the form fields from the presign response, then the file last. */
async function upload(presigned: { url: string; fields: Record<string, string> }, bytes: Buffer) {
  const form = new FormData();
  for (const [k, v] of Object.entries(presigned.fields)) form.append(k, v);
  form.append('file', new Blob([new Uint8Array(bytes)]));
  return fetch(presigned.url, { method: 'POST', body: form });
}

const complete = (user: string, id: string) =>
  app.inject({ method: 'POST', url: `/media/${id}/complete`, headers: as(user) });

async function objectExists(key: string): Promise<boolean> {
  return storage.client.send(new HeadObjectCommand({ Bucket: storage.bucket, Key: key })).then(
    () => true,
    () => false,
  );
}

const png = (w = 40, h = 30) =>
  sharp({ create: { width: w, height: h, channels: 3, background: '#3366cc' } })
    .png()
    .toBuffer();

beforeAll(async () => {
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  await admin.end();
  adminUrl.pathname = `/${dbName}`;
  db = createDb(new pg.Pool({ connectionString: adminUrl.toString(), max: 5 }));
  await migrateUp(db);

  [alice, bob, carol] = await Promise.all([makeUser('alice'), makeUser('bob'), makeUser('carol')]);
  const conv = await db
    .insertInto('conversations')
    .values({ type: 'group', name: 'g' })
    .returning('id')
    .executeTakeFirstOrThrow();
  conversationId = conv.id;
  await db
    .insertInto('conversation_members')
    .values([alice, bob].map((user_id) => ({ conversation_id: conversationId, user_id })))
    .execute();

  app = await buildApp({
    config,
    logger: createLogger('silent'),
    db: db,
    redis,
    checks: [],
    isShuttingDown: () => false,
    // Stands in for the auth module: the user id comes from a test header.
    authenticate: async (req, reply) => {
      const userId = req.headers['x-test-user'];
      if (typeof userId !== 'string')
        return void (await reply.code(401).send({ error: { message: 'no' } }));
      req.auth = { userId, deviceId: randomUUID() };
    },
  });
  await app.ready();
});

afterAll(async () => {
  await app.close();
  await db.destroy();
  await redis.quit();
  adminUrl.pathname = '/postgres';
  const admin = new pg.Client({ connectionString: adminUrl.toString() });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  await admin.end();
});

describe('presigned upload', () => {
  it('accepts a file within the declared size and S3 rejects one over it', async () => {
    const bytes = await png();
    const res = await presign(alice, {
      purpose: 'message',
      mime: 'image/png',
      size: bytes.length,
      file_name: '../../etc/pa ss<wd>.png',
    });
    expect(res.statusCode).toBe(200);
    const p = res.json<Presigned>();

    // Storage itself enforces the size: the API never sees these bytes.
    const tooBig = await upload(p, Buffer.concat([bytes, Buffer.from('x')]));
    expect(tooBig.status).toBe(400); // EntityTooLarge
    const ok = await upload(p, bytes);
    expect(ok.status).toBe(204);

    const done = await complete(alice, p.attachment_id);
    expect(done.statusCode).toBe(200);
    expect(done.json()).toMatchObject({
      status: 'ready',
      mime: 'image/png',
      size: bytes.length,
      file_name: 'pa ss_wd_.png',
    });

    const row = await db
      .selectFrom('attachments')
      .selectAll()
      .where('id', '=', p.attachment_id)
      .executeTakeFirstOrThrow();
    expect(row.object_key).toBe(`messages/${alice}/${p.attachment_id}`); // no part of the file name
    expect(row.sha256).toHaveLength(32);
  });

  it('rejects and deletes a file whose bytes are not the declared type', async () => {
    const text = Buffer.from('this is not a png at all');
    const p = (
      await presign(alice, { purpose: 'message', mime: 'image/png', size: text.length })
    ).json<Presigned>();
    expect((await upload(p, text)).status).toBe(204);

    const res = await complete(alice, p.attachment_id);
    expect(res.statusCode).toBe(415);
    expect(await objectExists(`messages/${alice}/${p.attachment_id}`)).toBe(false);
    const row = await db
      .selectFrom('attachments')
      .select('status')
      .where('id', '=', p.attachment_id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('deleted');
  });

  it('accepts a UTF-8 text file declared as text/plain', async () => {
    const text = Buffer.from('hello, wörld \u2713\nsecond line\n', 'utf8');
    const p = (
      await presign(alice, {
        purpose: 'message',
        mime: 'text/plain',
        size: text.length,
        file_name: 'notes.txt',
      })
    ).json<Presigned>();
    expect((await upload(p, text)).status).toBe(204);
    const res = await complete(alice, p.attachment_id);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ mime: string; status: string }>()).toMatchObject({
      mime: 'text/plain',
      status: 'ready',
    });
  });

  it('refuses binary data, invalid UTF-8 and disguised files declared as text/plain', async () => {
    const bad = [
      Buffer.from([0x68, 0x69, 0x00, 0x01, 0x02, 0x03]), // NUL bytes
      Buffer.from([0x68, 0x69, 0xff, 0xfe, 0xfd]), // not UTF-8
      await png(), // has a signature of another type
    ];
    for (const bytes of bad) {
      const p = (
        await presign(alice, { purpose: 'message', mime: 'text/plain', size: bytes.length })
      ).json<Presigned>();
      expect((await upload(p, bytes)).status).toBe(204);
      const res = await complete(alice, p.attachment_id);
      expect(res.statusCode).toBe(415);
      expect(await objectExists(`messages/${alice}/${p.attachment_id}`)).toBe(false);
    }
  });

  it('does not allow text/plain for avatars', async () => {
    expect(
      (await presign(alice, { purpose: 'avatar', mime: 'text/plain', size: 10 })).statusCode,
    ).toBe(415);
  });

  it('refuses types that are not allowed and sizes over the purpose limit', async () => {
    expect(
      (await presign(alice, { purpose: 'message', mime: 'application/x-msdownload', size: 10 }))
        .statusCode,
    ).toBe(415);
    expect(
      (await presign(alice, { purpose: 'avatar', mime: 'image/gif', size: 10 })).statusCode,
    ).toBe(415);
    expect(
      (await presign(alice, { purpose: 'avatar', mime: 'image/png', size: 6 * 1024 * 1024 }))
        .statusCode,
    ).toBe(400);
  });

  it('asks the client to retry when the file has not arrived yet', async () => {
    const p = (
      await presign(alice, { purpose: 'message', mime: 'image/png', size: 100 })
    ).json<Presigned>();
    expect((await complete(alice, p.attachment_id)).statusCode).toBe(409);
  });
});

describe('download and attach', () => {
  it('gives a URL to the owner and to members, and 404 to everyone else', async () => {
    const bytes = await png();
    const p = (
      await presign(alice, { purpose: 'message', mime: 'image/png', size: bytes.length })
    ).json<Presigned>();
    await upload(p, bytes);
    await complete(alice, p.attachment_id);
    await db
      .insertInto('messages')
      .values({
        conversation_id: conversationId,
        seq: 1,
        sender_id: alice,
        type: 'image',
        attachment_id: p.attachment_id,
      })
      .execute();

    for (const user of [alice, bob]) {
      const res = await app.inject({ url: `/media/${p.attachment_id}/url`, headers: as(user) });
      expect(res.statusCode).toBe(200);
      const file = await fetch(res.json<{ url: string }>().url);
      expect(Buffer.from(await file.arrayBuffer()).equals(bytes)).toBe(true);
    }
    const denied = await app.inject({ url: `/media/${p.attachment_id}/url`, headers: as(carol) });
    expect(denied.statusCode).toBe(404);

    // A member who left loses access too.
    await db
      .updateTable('conversation_members')
      .set({ left_at: new Date() })
      .where('user_id', '=', bob)
      .execute();
    expect(
      (await app.inject({ url: `/media/${p.attachment_id}/url`, headers: as(bob) })).statusCode,
    ).toBe(404);
    await db
      .updateTable('conversation_members')
      .set({ left_at: null })
      .where('user_id', '=', bob)
      .execute();
  });

  it('lets only the owner attach a finished upload, once', async () => {
    const bytes = await png();
    const p = (
      await presign(alice, { purpose: 'message', mime: 'image/png', size: bytes.length })
    ).json<Presigned>();
    const id: string = p.attachment_id;

    await expect(assertAttachmentUsable(db, alice, id)).rejects.toMatchObject({
      code: 'UPLOAD_INCOMPLETE',
    });
    await upload(p, bytes);
    await complete(alice, id);
    await expect(assertAttachmentUsable(db, bob, id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(assertAttachmentUsable(db, alice, id)).resolves.toMatchObject({ id });

    expect(await markAttached(db, id)).toBe(true);
    expect(await markAttached(db, id)).toBe(false);
    await expect(assertAttachmentUsable(db, alice, id)).rejects.toMatchObject({ code: 'CONFLICT' });
  });
});

describe('avatars', () => {
  it('are resized into small fixed squares and readable by any signed-in user', async () => {
    const bytes = await png(600, 400);
    const p = (
      await presign(alice, { purpose: 'avatar', mime: 'image/png', size: bytes.length })
    ).json<Presigned>();
    await upload(p, bytes);
    expect((await complete(alice, p.attachment_id)).statusCode).toBe(200);

    const key = `avatars/${alice}/${p.attachment_id}`;
    for (const size of [64, 256]) {
      const obj = await storage.client.send(
        new GetObjectCommand({ Bucket: storage.bucket, Key: avatarVariantKey(key, size) }),
      );
      const meta = await sharp(Buffer.from(await obj.Body!.transformToByteArray())).metadata();
      expect([meta.width, meta.height, meta.format]).toEqual([size, size, 'webp']);
    }
    const res = await app.inject({ url: `/media/${p.attachment_id}/url`, headers: as(carol) });
    expect(res.statusCode).toBe(200);
  });
});

describe('sweepAbandonedUploads', () => {
  it('removes old pending uploads and their objects, and keeps fresh and finished ones', async () => {
    const old = (
      await presign(alice, { purpose: 'message', mime: 'image/png', size: 100 })
    ).json<Presigned>();
    const fresh = (
      await presign(alice, { purpose: 'message', mime: 'image/png', size: 100 })
    ).json<Presigned>();
    const finished = (
      await presign(alice, { purpose: 'message', mime: 'image/png', size: (await png()).length })
    ).json<Presigned>();
    await upload(finished, await png());
    await complete(alice, finished.attachment_id);
    await upload(old, Buffer.alloc(100)); // started and uploaded but never completed
    const ids = [old, finished].map((p) => p.attachment_id);
    await db
      .updateTable('attachments')
      .set({ created_at: new Date(Date.now() - 48 * 3600_000) })
      .where('id', 'in', ids)
      .execute();

    const removed = await sweepAbandonedUploads(db, storage, new Date(Date.now() - 24 * 3600_000));

    expect(removed).toBe(1);
    expect(await objectExists(`messages/${alice}/${old.attachment_id}`)).toBe(false);
    const left = await db
      .selectFrom('attachments')
      .select('id')
      .where('id', 'in', [old.attachment_id, fresh.attachment_id, finished.attachment_id])
      .execute();
    expect(left.map((r) => r.id).sort()).toEqual(
      [fresh.attachment_id, finished.attachment_id].sort(),
    );
  });
});

describe('link preview route', () => {
  it('needs a signed-in user and is rate limited per user', async () => {
    const url = '/link-preview?url=' + encodeURIComponent('http://127.0.0.1/');
    expect((await app.inject({ url })).statusCode).toBe(401);

    // A private address is refused by the SSRF guard (422), which proves the request got past auth and the limiter.
    const user = randomUUID();
    const statuses: number[] = [];
    for (let i = 0; i < 32; i++)
      statuses.push((await app.inject({ url, headers: as(user) })).statusCode);
    expect(statuses[0]).toBe(422);
    expect(statuses.at(-1)).toBe(429);
    // Another user still gets through.
    expect((await app.inject({ url, headers: as(randomUUID()) })).statusCode).toBe(422);
  });
});
