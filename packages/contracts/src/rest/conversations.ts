import { z } from 'zod';
import {
  ConversationType,
  Cursor,
  HttpUrl,
  Id,
  IsoDateTime,
  MemberRole,
  Paginated,
  Seq,
  UserSummary,
} from '../common.js';
import { MessageRecord } from '../message.js';
import { DISAPPEARING_TIMERS, LIMITS } from '../limits.js';

const Title = z.string().trim().min(1).max(100);
/** Empty text clears the description. */
const Description = z.string().trim().max(500);
const DisappearingTimer = z
  .number()
  .int()
  .refine((s) => (DISAPPEARING_TIMERS as readonly number[]).includes(s), 'unsupported timer');

/** Group-wide settings, changed by admins. */
export const GroupSettings = z.object({
  only_admins_send: z.boolean(),
  only_admins_edit_info: z.boolean(),
  /** Joining by invite link needs an admin's approval. */
  approval_required: z.boolean(),
  /** 0 = off. New messages get expires_at = created_at + timer. */
  disappearing_timer_s: DisappearingTimer,
});

/** The caller's own chat-list settings for this conversation; synced across their devices. */
export const ChatPrefs = z.object({
  archived: z.boolean(),
  pinned: z.boolean(),
  favorite: z.boolean(),
  muted_until: IsoDateTime.nullable(),
  /** Chat lock: the client asks for a PIN before opening. */
  locked: z.boolean(),
  /**
   * Hash of the lock passcode, made by the client. The server only stores and returns it so the
   * owner's other devices can check the passcode. It is a UI convenience lock, not security:
   * the messages are still readable through the API.
   */
  lock_hash: z.string().min(16).max(256).nullable(),
  wallpaper: z.string().max(64).nullable(),
  /** "Mark as unread": the list shows a dot until the chat is opened. */
  marked_unread: z.boolean(),
});

export type ChatPrefs = z.infer<typeof ChatPrefs>;

/**
 * How far another member has got in the conversation, so the sender's ticks are right after a
 * reload (live receipt_update events only cover what happens while connected).
 * When either side turned read receipts off, read_seq is 0 and delivered_seq excludes reads.
 */
export const PeerReceipt = z.object({
  user_id: Id,
  delivered_seq: Seq,
  read_seq: Seq,
});
export type PeerReceipt = z.infer<typeof PeerReceipt>;

export const ConversationSummary = z.object({
  id: Id,
  type: ConversationType,
  /** True for your own "Saved messages" chat (peer is null; show "Saved messages"). */
  is_saved: z.boolean(),
  /** null for direct chats; show the other user's name. */
  title: z.string().max(100).nullable(),
  avatar_url: HttpUrl.nullable(),
  /** The group's description; null when none is set (and always for direct chats). */
  description: Description.nullable(),
  /** The other user, for direct chats. */
  peer: UserSummary.nullable(),
  member_count: z.number().int().min(0),
  my_role: MemberRole,
  /** Highest seq in the conversation. */
  last_seq: Seq,
  /** The caller's read cursor; unread_count is derived from it. */
  read_seq: Seq,
  unread_count: z.number().int().min(0),
  // A preview the client cannot read (for example a message type from a newer server) becomes
  // "no preview" instead of making the whole chat list fail to load.
  last_message: MessageRecord.nullable().catch(null),
  /**
   * The other members' receipt cursors. Sent for direct chats and for groups of up to
   * LIMITS.INLINE_FANOUT_MAX_MEMBERS members; empty for bigger groups (their ticks come from
   * live events only).
   */
  peer_receipts: z.array(PeerReceipt).default([]),
  created_at: IsoDateTime,
  settings: GroupSettings,
  prefs: ChatPrefs,
});
export type ConversationSummary = z.infer<typeof ConversationSummary>;

export const ConversationParams = z.object({ conversation_id: Id });

export const ConversationListQuery = z.object({
  filter: z.enum(['all', 'unread', 'groups', 'favorites', 'archived']).default('all'),
  cursor: Cursor.optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.MAX_PAGE_SIZE).default(LIMITS.DEFAULT_PAGE_SIZE),
});
/** Ordered by pinned first, then latest activity (keyset, no OFFSET). */
export const ConversationList = Paginated(ConversationSummary);

/** Returns the existing chat if there is one: the DB keeps one direct chat per user pair. */
export const CreateDirectRequest = z.object({ user_id: Id });

export const CreateGroupRequest = z.object({
  title: Title,
  member_ids: z.array(Id).max(255),
  avatar_attachment_id: Id.optional(),
});

export const UpdateConversationRequest = z
  .object({
    title: Title,
    description: Description,
    avatar_attachment_id: Id.nullable(),
    settings: GroupSettings.partial(),
  })
  .partial();

// ------------------------------------------------- media, links and files tab

/** media = photos, videos and GIFs; files = documents; links = text messages with a web link. */
export const SharedKind = z.enum(['media', 'files', 'links']);
export const SharedQuery = z.object({
  kind: SharedKind,
  before_seq: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(LIMITS.MAX_PAGE_SIZE).default(LIMITS.DEFAULT_PAGE_SIZE),
});
export const SharedPage = Paginated(MessageRecord);

export const UpdateChatPrefsRequest = ChatPrefs.partial();

// ------------------------------------------------------------------ members

export const Member = z.object({ user: UserSummary, role: MemberRole, joined_at: IsoDateTime });
export const MemberList = Paginated(Member);

export const MemberParams = z.object({ conversation_id: Id, user_id: Id });

export const AddMembersRequest = z.object({ user_ids: z.array(Id).min(1).max(256) });
export const AddMembersResponse = z.object({
  added: z.array(Id),
  /** e.g. the user's privacy settings forbid it, or the group is full. */
  failed: z.array(z.object({ user_id: Id, code: z.string() })),
});

export const UpdateRoleRequest = z.object({ role: MemberRole });

// ------------------------------------------------------- invites and joins

export const InviteCode = z.string().regex(/^[A-Za-z0-9_-]{16,32}$/);
export const InviteParams = z.object({ code: InviteCode });

export const CreateInviteRequest = z.object({
  expires_in_s: z
    .number()
    .int()
    .min(60)
    .max(30 * 86_400)
    .optional(),
  max_uses: z.number().int().min(1).max(LIMITS.MAX_GROUP_MEMBERS).optional(),
});

export const Invite = z.object({
  code: InviteCode,
  conversation_id: Id,
  expires_at: IsoDateTime.nullable(),
});

/** What a user sees before joining by link. */
export const InvitePreview = z.object({
  conversation_id: Id,
  title: z.string().max(100),
  avatar_url: HttpUrl.nullable(),
  member_count: z.number().int().min(0),
  approval_required: z.boolean(),
});

export const JoinResponse = z.object({
  status: z.enum(['joined', 'requested']),
  conversation_id: Id,
});

export const JoinRequest = z.object({
  id: Id,
  user: UserSummary,
  created_at: IsoDateTime,
});
export const JoinRequestList = Paginated(JoinRequest);

export const JoinRequestParams = z.object({ conversation_id: Id, request_id: Id });
export const DecideJoinRequest = z.object({ approve: z.boolean() });

// ------------------------------------------------------------ @mention list

export const MentionQuery = z.object({
  /** Prefix of the username or display name. */
  q: z.string().trim().max(64).default(''),
  limit: z.coerce.number().int().min(1).max(LIMITS.MAX_PAGE_SIZE).default(20),
});
export const MentionCandidates = z.object({ items: z.array(UserSummary) });
