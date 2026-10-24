import type { ContentType, MessageContent } from '@chat/contracts';
import type { MessageRow } from '@chat/db';

// Messages are stored as columns plus one jsonb blob. The text-like field of each type goes
// into body_text so full-text search covers it; the rest of the type's fields stay in `content`.
export const TEXT_FIELD: Partial<Record<ContentType, string>> = {
  text: 'text',
  image: 'caption',
  video: 'caption',
  file: 'caption',
  gif: 'caption',
  poll: 'question',
};

export interface StoredContent {
  type: Exclude<ContentType, 'poll_vote'>;
  bodyText: string | null;
  content: Record<string, unknown> | null;
  attachmentId: string | null;
  replyToId: string | null;
  forwarded: boolean;
  viewOnce: boolean;
  mentions: string[];
}

export function toStored(input: MessageContent): StoredContent {
  if (input.type === 'poll_vote') throw new Error('poll votes are not stored as messages');
  const fields: Record<string, unknown> = { ...input };
  const take = (key: string): unknown => {
    const value = fields[key];
    delete fields[key];
    return value;
  };
  take('type');
  const textKey = TEXT_FIELD[input.type];
  const stored: StoredContent = {
    type: input.type,
    bodyText: textKey ? ((take(textKey) as string | undefined) ?? null) : null,
    attachmentId: (take('attachment_id') as string | undefined) ?? null,
    replyToId: (take('reply_to') as string | undefined) ?? null,
    forwarded: (take('forwarded') as boolean | undefined) ?? false,
    viewOnce: (take('view_once') as boolean | undefined) ?? false,
    mentions: [...new Set((take('mentions') as string[] | undefined) ?? [])],
    content: null,
  };
  if (Object.keys(fields).length > 0) stored.content = fields;
  return stored;
}

/** The inverse of toStored: rebuilds the contract's content object from a row. */
export function fromRow(row: MessageRow): MessageContent {
  const content: Record<string, unknown> = { ...row.content, type: row.type };
  const textKey = TEXT_FIELD[row.type];
  if (textKey && row.body_text !== null) content[textKey] = row.body_text;
  if (row.attachment_id) content.attachment_id = row.attachment_id;
  if (row.reply_to_id) content.reply_to = row.reply_to_id;
  if (row.forwarded) content.forwarded = true;
  if (row.view_once) content.view_once = true;
  if (row.mentions.length > 0) content.mentions = row.mentions;
  return content as MessageContent;
}
