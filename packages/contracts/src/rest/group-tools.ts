import { z } from 'zod';
import { Id, IsoDateTime } from '../common.js';

/** Group safety and shared tools: slow mode, welcome text, flagged messages, analytics, cards, group AI. */
export const GroupToolsParams = z.object({ conversation_id: Id });
export const CardParams = z.object({ conversation_id: Id, message_id: Id });

export const GroupToolsSettings = z.object({
  slow_mode_seconds: z.number().int().min(0).max(86_400),
  welcome_text: z.string().max(1_000).nullable(),
});
export const UpdateGroupToolsRequest = z.object({
  slow_mode_seconds: z.number().int().min(0).max(86_400).optional(),
  welcome_text: z.string().trim().max(1_000).nullable().optional(),
});

export const FlaggedMessage = z.object({
  message_id: Id,
  sender_id: Id.nullable(),
  sender_name: z.string(),
  text: z.string(),
  reasons: z.array(z.string()),
  created_at: IsoDateTime,
});
export const FlaggedResponse = z.object({ items: z.array(FlaggedMessage) });

export const AnalyticsResponse = z.object({
  total: z.number().int(),
  days: z.number().int(),
  top_members: z.array(z.object({ user_id: Id, name: z.string(), count: z.number().int() })),
  /** 24 counts, index = hour of day in UTC. */
  busiest_hours: z.array(z.number().int()).length(24),
  last_message_at: IsoDateTime.nullable(),
});

/** What a card (checklist or game) does. The server applies it to the stored content. */
export const CardAction = z.discriminatedUnion('op', [
  z.object({ op: z.literal('toggle'), index: z.number().int().min(0).max(49) }),
  z.object({ op: z.literal('move'), cell: z.number().int().min(0).max(8) }),
  z.object({ op: z.literal('vote'), choice: z.enum(['a', 'b']) }),
]);
export const CardResponse = z.object({ content: z.record(z.string(), z.unknown()) });

export const GroupAiRequest = z.object({
  task: z.enum(['mood', 'icebreaker', 'itinerary', 'flag']),
});
export const LinkCheckRequest = z.object({ url: z.string().max(2_000) });
export const AiTextResponse = z.object({ text: z.string() });
