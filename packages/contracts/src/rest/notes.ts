import { z } from 'zod';
import { Id, IsoDateTime } from '../common.js';

export const NoteConversationParams = z.object({ conversation_id: Id });

/** A private note: only its author ever receives it. */
export const Note = z.object({ message_id: Id, body: z.string() });
export type Note = z.infer<typeof Note>;

export const NoteList = z.object({ notes: z.array(Note) });

export const PutNoteRequest = z.object({ body: z.string().trim().min(1).max(1000) });

/** The text of a message before each edit, oldest first. */
export const EditHistory = z.object({
  edits: z.array(z.object({ body_text: z.string().nullable(), edited_at: IsoDateTime })),
});
export type EditHistory = z.infer<typeof EditHistory>;
