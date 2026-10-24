import { z } from 'zod';
import { HttpUrl, Id, IsoDateTime } from './common.js';
import { LIMITS } from './limits.js';

/**
 * Message content: the `content` object of send_message, one small schema per type.
 * Media types point at an attachment that was uploaded first (see rest/media.ts).
 */

/** Optional fields every content type may carry. */
const base = {
  reply_to: Id.optional(), // message_id being replied to
  forwarded: z.boolean().optional(),
  view_once: z.boolean().optional(),
  mentions: z.array(Id).max(256).optional(), // user ids, for highlighting (a mention does not bypass mute)
};

const caption = z.string().max(LIMITS.MAX_CAPTION_LENGTH).optional();

export const TextContent = z.object({
  type: z.literal('text'),
  text: z.string().trim().min(1).max(LIMITS.MAX_TEXT_LENGTH),
  // Only the @flick bot sets these: which provider and model wrote the reply (shown under it).
  ai_provider: z.string().max(40).optional(),
  ai_model: z.string().max(100).optional(),
  ...base,
});

export const ImageContent = z.object({
  type: z.literal('image'),
  attachment_id: Id,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  caption,
  ...base,
});

export const VideoContent = z.object({
  type: z.literal('video'),
  attachment_id: Id,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  duration_ms: z.number().int().positive(),
  caption,
  ...base,
});

export const FileContent = z.object({
  type: z.literal('file'),
  attachment_id: Id,
  file_name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  caption,
  ...base,
});

export const VoiceContent = z.object({
  type: z.literal('voice'),
  attachment_id: Id,
  duration_ms: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 1000),
  /** Loudness samples 0-100, drawn as bars before the audio is downloaded. */
  waveform: z.array(z.number().int().min(0).max(100)).min(1).max(128),
  ...base,
});

/** GIFs and stickers come from the server's GIPHY proxy (see rest/extras.ts). */
export const GifContent = z.object({
  type: z.literal('gif'),
  gif_id: z.string().min(1).max(64),
  url: HttpUrl,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  caption,
  ...base,
});

export const StickerContent = z.object({
  type: z.literal('sticker'),
  sticker_id: z.string().min(1).max(64),
  url: HttpUrl,
  ...base,
});

export const PollContent = z
  .object({
    type: z.literal('poll'),
    question: z.string().trim().min(1).max(300),
    options: z.array(z.string().trim().min(1).max(100)).min(2).max(12),
    allow_multiple: z.boolean(),
    ...base,
  })
  .refine((p) => new Set(p.options).size === p.options.length, {
    message: 'options must be unique',
    path: ['options'],
  });

/** A vote replaces the voter's previous choice; an empty list removes the vote. */
export const PollVoteContent = z.object({
  type: z.literal('poll_vote'),
  poll_message_id: Id,
  option_indexes: z.array(z.number().int().min(0).max(11)).max(12),
  ...base,
});

/** Written by the server only ("Alice added Bob"); clients cannot send it. */
export const SystemContent = z.object({
  type: z.literal('system'),
  event: z.enum([
    'group_created',
    'member_added',
    'member_removed',
    'member_left',
    'role_changed',
    'renamed',
    'timer_changed',
  ]),
  actor_user_id: Id.nullable(),
  target_user_ids: z.array(Id).max(256),
  ...base,
});

/**
 * Written by the server so a call shows in the chat: when a 1:1 call ends, and ('started',
 * duration 0, group true) when someone starts a group call.
 */
export const CallEventContent = z.object({
  type: z.literal('call_event'),
  call_id: Id,
  media: z.enum(['audio', 'video']),
  outcome: z.enum(['missed', 'declined', 'ended', 'started']),
  group: z.boolean().optional(),
  started_at: IsoDateTime,
  duration_s: z.number().int().min(0),
  ...base,
});

export const MessageContent = z.discriminatedUnion('type', [
  TextContent,
  ImageContent,
  VideoContent,
  FileContent,
  VoiceContent,
  GifContent,
  StickerContent,
  PollContent,
  PollVoteContent,
  SystemContent,
  CallEventContent,
]);
export type MessageContent = z.infer<typeof MessageContent>;
export type ContentType = MessageContent['type'];

/** Content types only the server may create. */
export const SERVER_ONLY_CONTENT: readonly ContentType[] = ['system', 'call_event'];

/** The seeded Flick bot user (migration 0001_identity). Messages it posts have this sender. */
export const FLICK_BOT_USER_ID = '00000000-0000-4000-8000-00000000f11c';

/** True if a text mentions the AI bot, e.g. "@flick what time is it in Tokyo?". */
export function mentionsFlick(text: string): boolean {
  return /(^|\s)@flick\b/i.test(text);
}
