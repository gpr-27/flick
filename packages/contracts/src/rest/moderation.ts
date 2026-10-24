import { z } from 'zod';
import { Id, IsoDateTime, Paginated, UserSummary } from '../common.js';

export const BlockRequest = z.object({ user_id: Id });
export const BlockList = Paginated(z.object({ user: UserSummary, blocked_at: IsoDateTime }));

export const ReportRequest = z.object({
  user_id: Id.optional(),
  conversation_id: Id.optional(),
  message_id: Id.optional(),
  reason: z.enum(['spam', 'harassment', 'violence', 'sexual_content', 'scam', 'other']),
  details: z.string().max(2_000).optional(),
  /** Also block the reported user. */
  block: z.boolean().default(false),
});
export const ReportResponse = z.object({ report_id: Id });
