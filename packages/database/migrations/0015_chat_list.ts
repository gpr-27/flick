import { sql, type Kysely } from 'kysely';

// Chat list actions that only change the caller's own view of a chat:
//  - "Delete chat" / "Clear chat": cleared_seq is the last seq the member had when they deleted.
//    Every read (history, sync, search, shared media, export, last message) skips seq <= cleared_seq.
//    deleted_at hides the chat from the list until a newer message arrives; "clear" (used for the
//    assistant and Saved messages) keeps the chat and leaves deleted_at empty.
//  - marked_unread: "Mark as unread" shows a dot on the chat until it is opened.
export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE conversation_members
      ADD COLUMN cleared_seq    bigint      NOT NULL DEFAULT 0,
      ADD COLUMN deleted_at     timestamptz,
      ADD COLUMN marked_unread  boolean     NOT NULL DEFAULT false,
      ADD CONSTRAINT conversation_members_cleared_seq_ck CHECK (cleared_seq >= 0);
  `.execute(db);
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE conversation_members
      DROP CONSTRAINT conversation_members_cleared_seq_ck,
      DROP COLUMN marked_unread,
      DROP COLUMN deleted_at,
      DROP COLUMN cleared_seq;
  `.execute(db);
}
