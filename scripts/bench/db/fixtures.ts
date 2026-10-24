// Test data shared by the benchmark and the EXPLAIN script: which conversations, users and
// devices the queries are run with. The only thing it writes is one synthetic user.
import { sql, type Kysely } from 'kysely';

import type { Database } from '@chat/db';

export interface Target {
  conversation_id: string;
  user_id: string;
  device_id: string;
  last_seq: number;
}

export async function loadFixtures(db: Kysely<Database>) {
  // Busiest direct chat: the "hot conversation".
  const hot = (
    await sql<Target>`
    SELECT cm.conversation_id, cm.user_id, d.id AS device_id, c.last_seq
    FROM conversations c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.left_at IS NULL
    JOIN devices d ON d.user_id = cm.user_id AND d.revoked_at IS NULL
    WHERE c.type = 'direct' ORDER BY c.last_seq DESC LIMIT 1`.execute(db)
  ).rows[0]!;

  // 500 other chats, each with one member and one of that member's devices.
  const targets = (
    await sql<Target>`
    SELECT DISTINCT ON (cm.conversation_id)
           cm.conversation_id, cm.user_id, d.id AS device_id, c.last_seq
    FROM conversation_members cm
    JOIN conversations c ON c.id = cm.conversation_id AND NOT c.admin_only_send
    JOIN devices d ON d.user_id = cm.user_id AND d.revoked_at IS NULL
    WHERE cm.left_at IS NULL AND cm.conversation_id <> ${hot.conversation_id}
    ORDER BY cm.conversation_id, random()`.execute(db)
  ).rows
    .sort(() => Math.random() - 0.5)
    .slice(0, 500);

  // The busiest 50 chats, for history reads.
  const busy = (
    await sql<Target>`
    SELECT DISTINCT ON (c.id) c.id AS conversation_id, cm.user_id, d.id AS device_id, c.last_seq
    FROM (SELECT * FROM conversations ORDER BY last_seq DESC LIMIT 50) c
    JOIN conversation_members cm ON cm.conversation_id = c.id AND cm.left_at IS NULL
    JOIN devices d ON d.user_id = cm.user_id AND d.revoked_at IS NULL
    ORDER BY c.id, cm.user_id`.execute(db)
  ).rows;

  // A user in many chats: the seed's most-connected user (23 chats) and a synthetic one (1,000).
  const seedUser = (
    await sql<{ user_id: string }>`
    SELECT cm.user_id FROM conversation_members cm JOIN users u ON u.id = cm.user_id
    WHERE cm.left_at IS NULL AND u.username <> 'bench_many_chats'
    GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 1`.execute(db)
  ).rows[0]!;

  let manyChats = (
    await sql<{ id: string }>`SELECT id FROM users WHERE username = 'bench_many_chats'`.execute(db)
  ).rows[0];
  if (!manyChats) {
    manyChats = (
      await sql<{ id: string }>`
      INSERT INTO users (username, display_name) VALUES ('bench_many_chats', 'Bench many chats')
      RETURNING id`.execute(db)
    ).rows[0]!;
    await sql`
      INSERT INTO conversation_members (conversation_id, user_id)
      SELECT id, ${manyChats.id} FROM conversations ORDER BY random() LIMIT 1000`.execute(db);
  }

  const groups = (
    await sql<{ conversation_id: string; members: number; sender: string }>`
    SELECT cm.conversation_id, count(*)::int AS members, min(cm.user_id::text) AS sender
    FROM conversation_members cm JOIN conversations c ON c.id = cm.conversation_id
    WHERE cm.left_at IS NULL AND c.type = 'group' GROUP BY 1 ORDER BY 2 DESC`.execute(db)
  ).rows;
  const bigGroup = groups[0]!;
  const smallGroup = groups.find((g) => g.members >= 10 && g.members <= 15)!;

  return { hot, targets, busy, seedUser, manyChatsUser: manyChats.id, bigGroup, smallGroup };
}
