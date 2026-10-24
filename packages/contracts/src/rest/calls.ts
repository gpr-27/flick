import { z } from 'zod';
import { Cursor, Id, IsoDateTime, Paginated } from '../common.js';

// 1:1 calls: WebRTC with signalling over the WebSocket (call_* events) and TURN from coturn.
// Group calls and call links: LiveKit. Without LiveKit config these return FEATURE_DISABLED.

const CallMedia = z.enum(['audio', 'video']);

/** Short-lived coturn credentials. */
export const TurnCredentials = z.object({
  ice_servers: z.array(
    z.object({
      urls: z.array(z.string().regex(/^(stun|turn|turns):/)),
      username: z.string().optional(),
      credential: z.string().optional(),
    }),
  ),
  expires_at: IsoDateTime,
});

/** Start or join the group call of a conversation, or join by call link. Exactly one is set. */
export const LivekitTokenRequest = z
  .object({
    conversation_id: Id.optional(),
    // Used when this request starts the call (it goes into the "started a group call" message).
    media: CallMedia.default('video'),
    call_link: z
      .string()
      .regex(/^[A-Za-z0-9_-]{10,32}$/)
      .optional(),
  })
  .refine(
    (v) => (v.conversation_id === undefined) !== (v.call_link === undefined),
    'set conversation_id or call_link',
  );

/** Who is in a group call right now. `active` is false once the last person has left. */
export const GroupCallPresence = z.object({ active: z.boolean(), participants: z.number().int() });

/** Sent every ~25 s while someone is in the call, and once with `leave` when they hang up. */
export const GroupCallBeat = z.object({
  conversation_id: Id,
  action: z.enum(['beat', 'leave']).default('beat'),
});

export const GroupCallParams = z.object({ conversation_id: Id });

export const LivekitToken = z.object({
  call_id: Id,
  url: z.url({ protocol: /^wss?$/ }),
  token: z.string().min(16),
  expires_at: IsoDateTime,
});

export const CreateCallLinkRequest = z.object({
  conversation_id: Id, // a group; the creator must be an admin of it
  media: CallMedia,
  expires_in_s: z
    .number()
    .int()
    .min(60)
    .max(7 * 24 * 3600)
    .default(24 * 3600),
  max_uses: z.number().int().min(1).max(1000).optional(),
});
export const CallLink = z.object({
  code: z.string().regex(/^[A-Za-z0-9_-]{10,32}$/),
  conversation_id: Id,
  media: CallMedia,
  created_by: Id.nullable(),
  expires_at: IsoDateTime,
});
export const CallLinkParams = z.object({ code: CallLink.shape.code });

export const CallLogEntry = z.object({
  call_id: Id,
  conversation_id: Id.nullable(),
  media: CallMedia,
  group: z.boolean(),
  direction: z.enum(['incoming', 'outgoing']),
  outcome: z.enum(['missed', 'declined', 'ended']),
  started_at: IsoDateTime,
  duration_s: z.number().int().min(0),
  participant_ids: z.array(Id),
});

export const CallLogQuery = z.object({
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
export const CallLog = Paginated(CallLogEntry);
