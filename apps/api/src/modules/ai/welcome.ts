import { FLICK_BOT_USER_ID, allocateSeqAndInsertMessage } from '@chat/db';
import { sql } from 'kysely';
import type { Db } from '../../db.js';
import { openDirect } from '../conversations/repo/groups.js';

// The first message in everyone's chat with Flick. It is an ordinary message from the bot, so it
// takes seq 1, goes through the outbox, is delivered to every device and shows as unread.
// The bot never answers it: it ignores messages written by itself.

/** Markdown characters in a display name are escaped so a name cannot format the message. */
const escapeMarkdown = (name: string): string => name.replace(/([\\`*_{}[\]()#+\-.!|~>])/g, '\\$1');

export function welcomeText(displayName: string): string {
  const name = escapeMarkdown(displayName.trim().slice(0, 64)) || 'there';
  return `Hi ${name}, welcome to Flick! I'm Flick, your built-in assistant. I live right here in this chat, and I can help with questions, writing, ideas and anything about this app.

Here are a few things to try:
- **Ask me anything.** Type a question below, like "explain how vaccines work in simple words".
- **Use me in any group.** Type @flick followed by your question, or reply to one of my answers.
- **Catch up fast.** Open a busy chat and ask me to summarise what you missed.
- **Say it your way.** Tap the camera to share a photo, or hold the microphone to send a voice note.
- **Make it yours.** Tap your profile to add a photo and choose your look, language and privacy.

I know how Flick works and what is going on in your account, so you can also ask me "how do I schedule a message?" or "how many unread chats do I have?".`;
}

/**
 * Makes sure the person's chat with Flick starts with the welcome message.
 *
 * - `create: true` (a new account) also creates the chat.
 * - `create: false` (a person who signed in before) only fills a Flick chat that has no message
 *   at all, so someone who already talked to Flick, or cleared the chat, gets nothing.
 *
 * Safe to repeat and to run at the same moment on two devices: the conversation row is locked
 * and the chat is checked for messages before writing, so only one run can add the message.
 * Returns true when this call wrote the welcome.
 */
export async function ensureFlickWelcome(
  db: Db,
  userId: string,
  options: { create: boolean },
): Promise<boolean> {
  const user = await db
    .selectFrom('users')
    .select(['display_name', 'is_bot'])
    .where('id', '=', userId)
    .executeTakeFirst();
  if (!user || user.is_bot || userId === FLICK_BOT_USER_ID) return false;

  let conversationId: string;
  if (options.create) {
    conversationId = await openDirect(db, userId, FLICK_BOT_USER_ID);
  } else {
    const [lo, hi] =
      userId < FLICK_BOT_USER_ID ? [userId, FLICK_BOT_USER_ID] : [FLICK_BOT_USER_ID, userId];
    const pair = await db
      .selectFrom('direct_pairs')
      .select('conversation_id')
      .where('user_lo', '=', lo)
      .where('user_hi', '=', hi)
      .executeTakeFirst();
    if (!pair) return false;
    conversationId = pair.conversation_id;
  }

  return db.transaction().execute(async (trx) => {
    // Lock the chat so a second device waits here and then sees the first one's message.
    const locked = await sql<{ last_seq: number }>`
      SELECT last_seq FROM conversations WHERE id = ${conversationId}::uuid FOR UPDATE
    `.execute(trx);
    if (!locked.rows[0] || Number(locked.rows[0].last_seq) > 0) return false;
    const member = await trx
      .selectFrom('conversation_members')
      .select('user_id')
      .where('conversation_id', '=', conversationId)
      .where('user_id', '=', userId)
      .where('left_at', 'is', null)
      .executeTakeFirst();
    if (!member) return false;
    await allocateSeqAndInsertMessage(trx, {
      conversationId,
      senderId: FLICK_BOT_USER_ID,
      senderDeviceId: null,
      clientMessageId: null,
      type: 'text',
      bodyText: welcomeText(user.display_name),
      content: { welcome: true },
      authorize: false, // like every bot reply
    });
    return true;
  });
}
