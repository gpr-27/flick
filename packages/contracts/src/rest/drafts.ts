import { z } from 'zod';
import { Id, IsoDateTime } from '../common.js';
import { LIMITS } from '../limits.js';

/** An unsent message, kept on the server so it follows you to another device. */
export const DraftParams = z.object({ conversation_id: Id });
export const PutDraftRequest = z.object({ body: z.string().min(1).max(LIMITS.MAX_TEXT_LENGTH) });
/** body is null when there is no draft for this chat. */
export const Draft = z.object({ body: z.string().nullable(), updated_at: IsoDateTime.nullable() });
export type Draft = z.infer<typeof Draft>;
