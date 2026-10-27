import { sql, type Kysely } from 'kysely';

// Resuming a finished Flick topic: the new topic marker points at the topic it continues, so the
// assistant can read that topic's earlier conversation again.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE ai_topics
      ADD COLUMN resumes_topic_id uuid REFERENCES ai_topics (id) ON DELETE SET NULL
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE ai_topics DROP COLUMN resumes_topic_id`.execute(db);
}
