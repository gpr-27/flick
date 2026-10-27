import type { Db } from '../../db.js';

// "Replies in your tone": a sample of what the user wrote lately, in any chat, shown to the
// model as an earlier line of theirs. Their own words only; nothing from other people.

const SAMPLE = { messages: 10, perMessageChars: 120, totalChars: 600 };

/** The user's last few short text messages, oldest first. */
export async function loadStyleSample(db: Db, userId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('messages')
    .select('body_text')
    .where('sender_id', '=', userId)
    .where('deleted_at', 'is', null)
    .where('body_text', 'is not', null)
    .where('type', '=', 'text')
    // A chat where the user switched "Allow Flick to read this chat" off is never a style source.
    .where(
      'conversation_id',
      'not in',
      db
        .selectFrom('ai_chat_privacy')
        .select('conversation_id')
        .where('user_id', '=', userId)
        .where('allow', '=', false),
    )
    .orderBy('created_at', 'desc')
    .limit(SAMPLE.messages)
    .execute();
  const out: string[] = [];
  let total = 0;
  for (const row of rows) {
    const text = row.body_text!.replace(/\s+/g, ' ').trim().slice(0, SAMPLE.perMessageChars);
    if (!text || total + text.length > SAMPLE.totalChars) continue;
    total += text.length;
    out.push(text);
  }
  return out.reverse();
}

/** One context line (written by "Me") that tells the model how the user usually writes. */
export function styleSampleLine(samples: string[]) {
  if (samples.length === 0) return null;
  return {
    sender: 'Me',
    fromMe: true,
    text: `(how I usually write: ${samples.map((s) => `"${s.replace(/"/g, "'")}"`).join(' / ')})`,
  };
}
