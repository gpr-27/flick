/* eslint-disable @typescript-eslint/no-unsafe-member-access -- test payloads are untyped JSON */
import { FLICK_BOT_USER_ID } from '@chat/db';
import { Paginated, UserSummary } from '@chat/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createDatabase,
  startStack,
  type Stack,
  type TestDatabase,
  type TestUser,
} from './harness.js';

// GET /users/directory: everyone on Flick, A to Z by display name, then username, in pages.
//
// The paging rule that matters: following next_cursor until it is null returns every person
// exactly once, in order, whatever the page size, however names compare (case, accents, other
// alphabets, equal names) and even when people sign up between two pages.

const DirectoryPage = Paginated(UserSummary);

let database: TestDatabase;
let stack: Stack;
let caller: TestUser;

beforeAll(async () => {
  database = await createDatabase('dir');
  stack = await startStack({ databaseUrl: database.url });
  caller = await stack.user('caller', { display_name: 'Zz Caller' });
});
afterAll(async () => {
  await stack.stop();
  await database.drop();
});

type Item = { id: string; username: string; display_name: string; is_bot: boolean };

async function page(user: TestUser, query: string) {
  const res = await stack.call(user, 'GET', `/users/directory?${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  const parsed = DirectoryPage.safeParse(res.body);
  expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
  return res.body as { items: Item[]; next_cursor: string | null };
}

/** Follows next_cursor to the end. Returns every page. */
async function walk(user: TestUser, limit: number, extra = ''): Promise<Item[][]> {
  const pages: Item[][] = [];
  let cursor: string | null = null;
  for (let guard = 0; guard < 500; guard++) {
    const q: string = `limit=${String(limit)}${extra}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;
    const p = await page(user, q);
    pages.push(p.items);
    cursor = p.next_cursor;
    if (!cursor) return pages;
  }
  throw new Error('the cursor never ended');
}

const ids = (pages: Item[][]) => pages.flat().map((i) => i.id);

async function everyone(user: TestUser): Promise<Item[]> {
  return (await walk(user, 100)).flat();
}

describe('the whole list', () => {
  it('parses with the contract, never includes the caller, and includes the seeded Flick bot with is_bot', async () => {
    const [x, y] = await Promise.all([stack.user('x'), stack.user('y')]);
    const all = await everyone(caller);
    expect(all.map((i) => i.id)).not.toContain(caller.id);
    expect(all.map((i) => i.id)).toEqual(expect.arrayContaining([x.id, y.id]));
    const bot = all.find((i) => i.id === FLICK_BOT_USER_ID);
    expect(bot?.is_bot).toBe(true);
  });

  it('is sorted by display name case-insensitively, then username', async () => {
    const names = ['anna', 'Bob', 'alice', 'Carl', 'adam', 'ZED', 'bea'];
    const made = await Promise.all(names.map((n) => stack.user('case', { display_name: n })));
    const all = (await everyone(caller)).filter((i) => made.some((m) => m.id === i.id));
    expect(all.map((i) => i.display_name)).toEqual([
      'adam',
      'alice',
      'anna',
      'bea',
      'Bob',
      'Carl',
      'ZED',
    ]);
  });

  it('puts people with the same name next to each other, ordered by username, regardless of case', async () => {
    const made = await Promise.all(
      ['Sam', 'sam', 'SAM', 'Sam', 'sAm'].map((n) => stack.user('samegroup', { display_name: n })),
    );
    const all = (await everyone(caller)).filter((i) => made.some((m) => m.id === i.id));
    expect(all).toHaveLength(5);
    const usernames = all.map((i) => i.username);
    expect(usernames).toEqual([...usernames].sort());
  });
});

describe('paging', () => {
  it('limit 1 walks the whole list one person at a time: nobody twice, nobody skipped, same order as one big page', async () => {
    await Promise.all(
      Array.from({ length: 6 }, (_, i) => stack.user('one', { display_name: `Page ${String(i)}` })),
    );
    const big = ids(await walk(caller, 100));
    const small = await walk(caller, 1);
    expect(small.slice(0, -1).every((p) => p.length === 1)).toBe(true);
    expect(ids(small)).toEqual(big);
    expect(new Set(ids(small)).size).toBe(ids(small).length);
  });

  it('every page size gives the same list', async () => {
    const reference = ids(await walk(caller, 100));
    for (const size of [
      1,
      2,
      3,
      5,
      7,
      reference.length - 1,
      reference.length,
      reference.length + 1,
    ]) {
      expect(ids(await walk(caller, size)), `page size ${String(size)}`).toEqual(reference);
    }
  });

  it('at an exact page boundary the last real page may point to one more page, which is empty and ends the walk', async () => {
    const reference = await everyone(caller);
    const exact = reference.length;
    const first = await page(caller, `limit=${String(exact)}`);
    expect(first.items).toHaveLength(exact);
    // a full page cannot know whether more follows, so a cursor is given; it must lead to an empty page and no cursor
    if (first.next_cursor) {
      const next = await page(
        caller,
        `limit=${String(exact)}&cursor=${encodeURIComponent(first.next_cursor)}`,
      );
      expect(next.items).toEqual([]);
      expect(next.next_cursor).toBeNull();
    }
    // one more than the list: a short page, so no cursor at all
    const roomy = await page(caller, `limit=${String(Math.min(100, exact + 1))}`);
    expect(roomy.next_cursor).toBeNull();
  });

  it('the maximum page size (100) and a limit larger than the list are fine', async () => {
    expect((await page(caller, 'limit=100')).items.length).toBeGreaterThan(0);
  });

  it('a cursor works for any caller (it is only a sort key) and is stable while people sign up between pages', async () => {
    const first = await page(caller, 'limit=3');
    expect(first.next_cursor).not.toBeNull();
    const last = first.items.at(-1)!;
    // someone signs up whose name sorts BEFORE the cursor: it must not shift the next page
    const before = await stack.user('early', { display_name: '!!! before everyone' });
    // and someone whose name sorts after it: it must show up in later pages
    const after = await stack.user('late', { display_name: 'zzzz after the cursor' });
    const rest: Item[] = [];
    let cursor: string | null = first.next_cursor;
    while (cursor) {
      const p = await page(caller, `limit=3&cursor=${encodeURIComponent(cursor)}`);
      rest.push(...p.items);
      cursor = p.next_cursor;
    }
    const seen = [...first.items, ...rest].map((i) => i.id);
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain(before.id);
    expect(seen).toContain(after.id);
    expect(seen.indexOf(last.id)).toBe(2);
    // a different person asking with the same cursor gets a consistent continuation
    const other = await stack.user('other');
    const again = await page(other, `limit=3&cursor=${encodeURIComponent(first.next_cursor!)}`);
    expect(again.items.length).toBe(3);
  });
});

describe('names that compare differently in different places', () => {
  // JavaScript and Postgres do not lower-case every character the same way (a Turkish dotted I,
  // a Greek final sigma, a German sharp s ...). The cursor travels through JavaScript, so a mismatch
  // would show up as a person listed twice or skipped at a page boundary.
  const NAMES = [
    'Émile',
    'élan',
    'Zoë',
    'Ñandú',
    'ångström',
    'Ölçü',
    'Çağlar',
    '李雷',
    '王芳',
    '山田太郎',
    'مريم',
    'שלום',
    'Дмитрий',
    'Ωmega',
    'ΑΣ',
    'Σίσυφος',
    'ΟΔΟΣ',
    'İstanbul',
    'Istanbul',
    'ıstakoz',
    'Straße',
    'STRASSE',
    'ǅungla',
    'ǆ',
    'ﬁnn',
    'Ǆ',
    '😀 smile',
    '🎉 party',
    '  padded  name',
    'áccent',
    'ÅNGSTRÖM',
  ];

  it('every name appears exactly once when walked one at a time, in the same order as a single page', async () => {
    const made = await Promise.all(
      NAMES.map((n, i) => stack.user(`u${String(i)}`, { display_name: n.trim() || 'blank' })),
    );
    const wanted = new Set(made.map((m) => m.id));
    const single = (await everyone(caller)).filter((i) => wanted.has(i.id));
    expect(single).toHaveLength(NAMES.length);
    for (const size of [1, 2, 3]) {
      const walked = ids(await walk(caller, size)).filter((id) => wanted.has(id));
      expect(new Set(walked).size, `size ${String(size)}: someone is listed twice`).toBe(
        walked.length,
      );
      expect(walked, `size ${String(size)}: the order differs from the single page`).toEqual(
        single.map((i) => i.id),
      );
    }
  });

  it('names with the same lower-case form but different characters stay in one stable order', async () => {
    const made = await Promise.all(
      ['İ', 'i', 'I', 'ı'].map((n, i) =>
        stack.user(`dot${String(i)}`, { display_name: `${n}zmir` }),
      ),
    );
    const wanted = new Set(made.map((m) => m.id));
    const single = (await everyone(caller)).filter((i) => wanted.has(i.id)).map((i) => i.id);
    expect(single).toHaveLength(4);
    expect(ids(await walk(caller, 1)).filter((id) => wanted.has(id))).toEqual(single);
  });
});

describe('who is left out', () => {
  it('people who blocked the caller are not listed; people the caller blocked still are', async () => {
    const [blocker, blocked, neutral] = await Promise.all([
      stack.user('blocker', { display_name: 'Blocker B' }),
      stack.user('blocked', { display_name: 'Blocked B' }),
      stack.user('neutral', { display_name: 'Neutral B' }),
    ]);
    expect((await stack.call(blocker, 'POST', '/blocks', { user_id: caller.id })).status).toBe(204);
    expect((await stack.call(caller, 'POST', '/blocks', { user_id: blocked.id })).status).toBe(204);
    const list = (await everyone(caller)).map((i) => i.id);
    expect(list).not.toContain(blocker.id);
    expect(list).toContain(blocked.id);
    expect(list).toContain(neutral.id);
    // the same walk, one at a time, agrees
    expect(ids(await walk(caller, 1))).toEqual(list);
    // and the blocker does not see the caller either way round? (they blocked them: still listed for the blocker)
    const theirs = (await everyone(blocker)).map((i) => i.id);
    expect(theirs).toContain(caller.id);
  });

  it('disabled and deleted accounts are not listed', async () => {
    const disabled = await stack.user('off', { display_name: 'Disabled D', status: 'disabled' });
    const deleted = await stack.user('gone', { display_name: 'Deleted D', status: 'deleted' });
    const active = await stack.user('on', { display_name: 'Active D' });
    const list = (await everyone(caller)).map((i) => i.id);
    expect(list).not.toContain(disabled.id);
    expect(list).not.toContain(deleted.id);
    expect(list).toContain(active.id);
    expect(ids(await walk(caller, 1))).toEqual(list);
  });

  it('bots are listed and marked, so the app can show them as an assistant', async () => {
    const bot = await stack.user('helper', { display_name: 'Helper Bot', is_bot: true });
    const all = await everyone(caller);
    expect(all.find((i) => i.id === bot.id)?.is_bot).toBe(true);
    expect(all.find((i) => i.id === FLICK_BOT_USER_ID)?.is_bot).toBe(true);
  });

  it('a user becoming disabled between two pages does not break the walk', async () => {
    const people = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        stack.user('flip', { display_name: `Flip ${String(i)}` }),
      ),
    );
    const first = await page(caller, 'limit=2');
    await stack.db
      .updateTable('users')
      .set({ status: 'disabled' })
      .where('id', '=', people[3]!.id)
      .execute();
    const seen = [...first.items.map((i) => i.id)];
    let cursor = first.next_cursor;
    while (cursor) {
      const p = await page(caller, `limit=2&cursor=${encodeURIComponent(cursor)}`);
      seen.push(...p.items.map((i) => i.id));
      cursor = p.next_cursor;
    }
    expect(new Set(seen).size).toBe(seen.length);
    expect(seen).not.toContain(people[3]!.id);
  });
});

describe('bad cursors', () => {
  it.each([
    ['not base64 at all', '%%%'],
    ['base64 of text that is not JSON', Buffer.from('hello').toString('base64url')],
    ['JSON of the wrong shape', Buffer.from('{"name":1,"username":2}').toString('base64url')],
    ['JSON array', Buffer.from('[1,2]').toString('base64url')],
    ['JSON null', Buffer.from('null').toString('base64url')],
    [
      'a NUL in the name',
      Buffer.from(JSON.stringify({ name: 'a\u0000b', username: 'x' })).toString('base64url'),
    ],
    ['400 characters of junk', 'A'.repeat(400)],
  ])('%s is a 400 with the standard error', async (_name, cursor) => {
    const res = await stack.call(
      caller,
      'GET',
      `/users/directory?cursor=${encodeURIComponent(cursor)}`,
    );
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
  });
});
