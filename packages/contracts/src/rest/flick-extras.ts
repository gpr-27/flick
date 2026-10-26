import { z } from 'zod';
import { Id, IsoDateTime } from '../common.js';

// Talking to Flick: memories, topics, feedback and follow-up suggestions.

export const MAX_MEMORY_LENGTH = 300;
export const MAX_MEMORIES = 200;
export const MAX_TOPIC_TITLE_LENGTH = 80;

export const FlickMemory = z.object({ id: Id, fact: z.string(), created_at: IsoDateTime });
export type FlickMemory = z.infer<typeof FlickMemory>;
export const FlickMemoryList = z.object({ memories: z.array(FlickMemory) });
export const FlickMemoryParams = z.object({ id: Id });
export const FlickMemoryBody = z.object({ fact: z.string().trim().min(1).max(MAX_MEMORY_LENGTH) });

export const FlickTopic = z.object({
  id: Id,
  title: z.string(),
  /** The topic starts at the first message with this seq (or higher). */
  started_message_seq: z.number().int().min(0),
  created_at: IsoDateTime,
});
export type FlickTopic = z.infer<typeof FlickTopic>;
export const FlickTopicList = z.object({ topics: z.array(FlickTopic) });
export const FlickTopicParams = z.object({ id: Id });
export const FlickNewTopicBody = z.object({
  title: z.string().trim().min(1).max(MAX_TOPIC_TITLE_LENGTH).optional(),
});
export const FlickTopicTitleBody = z.object({
  title: z.string().trim().min(1).max(MAX_TOPIC_TITLE_LENGTH),
});

export const FlickFeedbackBody = z.object({
  message_id: Id,
  rating: z.enum(['up', 'down']),
});

export const FlickFollowupsBody = z.object({ message_id: Id });
export const FlickFollowups = z.object({ suggestions: z.array(z.string().max(120)).max(3) });
