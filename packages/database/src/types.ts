// Kysely table types, kept in step with ../migrations by hand.
// - bigint columns are JS numbers (createPool installs that parser, see ./db.ts).
// - timestamptz reads as Date; bytea reads as Buffer.
// - jsonb objects can be passed as plain objects. jsonb ARRAYS must be passed as JSON strings,
//   because pg would otherwise send a JS array as a Postgres array.
// - Columns with a database default are Generated<> (optional on insert).
import type { ColumnType, Generated, Insertable, Selectable } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;
type CreatedAt = ColumnType<Date, Date | string | undefined, Date | string>;
type Int8 = ColumnType<number, number, number>;
type Int8Default = ColumnType<number, number | undefined, number>;
type Bytes = ColumnType<Buffer, Buffer | Uint8Array, Buffer | Uint8Array>;
type JsonDefault<T> = ColumnType<T, T | undefined, T>;

export type UserStatus = 'active' | 'disabled' | 'deleted';
export type PrivacyLevel = 'everyone' | 'contacts' | 'nobody';
export type DevicePlatform = 'web' | 'android' | 'ios' | 'desktop';
export type ConversationType = 'direct' | 'group';
export type MemberRole = 'owner' | 'admin' | 'member';
export type MessageType =
  | 'text'
  | 'image'
  | 'file'
  | 'voice'
  | 'video'
  | 'gif'
  | 'sticker'
  | 'poll'
  | 'system'
  | 'call_event';
export type AttachmentStatus = 'pending' | 'uploaded' | 'attached' | 'deleted';
export type JoinRequestStatus = 'pending' | 'approved' | 'rejected';
export type CallType = 'audio' | 'video';
export type CallStatus = 'ringing' | 'ongoing' | 'completed' | 'missed' | 'rejected';
export type MessageEventType = 'edited' | 'deleted' | 'reaction_added' | 'reaction_removed';
export type ReportStatus = 'open' | 'actioned' | 'dismissed';

export interface UsersTable {
  id: Generated<string>;
  username: string;
  email: string | null;
  // The Clerk user id. NULL for the bot and seeded demo users.
  clerk_id: string | null;
  display_name: string;
  avatar_object_key: string | null;
  avatar_url: string | null;
  about: string | null;
  status: Generated<UserStatus>;
  is_bot: Generated<boolean>;
  is_demo: Generated<boolean>;
  legacy_id: string | null;
  last_seen_at: Timestamp | null;
  created_at: CreatedAt;
  updated_at: CreatedAt;
}

export interface UserSettingsTable {
  user_id: string;
  last_seen_privacy: Generated<PrivacyLevel>;
  photo_privacy: Generated<PrivacyLevel>;
  about_privacy: Generated<PrivacyLevel>;
  groups_add_privacy: Generated<PrivacyLevel>;
  /** Language Flick answers in; null = the language of the message. */
  ai_language: string | null;
  read_receipts: Generated<boolean>;
  /** In-app guide progress (topic ids and times only). The shape is GuideState in contracts. */
  guide: Generated<unknown>;
}

export interface DevicesTable {
  id: Generated<string>;
  user_id: string;
  name: Generated<string>;
  platform: Generated<DevicePlatform>;
  created_at: CreatedAt;
  last_active_at: CreatedAt;
  revoked_at: Timestamp | null;
}

export interface ConversationsTable {
  id: Generated<string>;
  type: ConversationType;
  name: string | null;
  description: string | null;
  avatar_object_key: string | null;
  created_by: string | null;
  last_seq: Int8Default;
  last_message_at: Timestamp | null;
  disappearing_seconds: number | null;
  admin_only_send: Generated<boolean>;
  admin_only_edit: Generated<boolean>;
  approval_required: Generated<boolean>;
  // Set on a user's "Saved messages" chat (a chat with yourself); null on every other chat.
  saved_for: string | null;
  created_at: CreatedAt;
}

export interface DirectPairsTable {
  user_lo: string;
  user_hi: string;
  conversation_id: string;
}

export interface ConversationMembersTable {
  conversation_id: string;
  user_id: string;
  role: Generated<MemberRole>;
  joined_at: CreatedAt;
  left_at: Timestamp | null;
  read_seq: Int8Default;
  muted_until: Timestamp | null;
  archived: Generated<boolean>;
  pinned_at: Timestamp | null;
  favourite: Generated<boolean>;
  wallpaper: string | null;
  lock_hash: string | null;
}

export interface MessagesTable {
  id: Generated<string>;
  conversation_id: string;
  seq: Int8;
  sender_id: string | null;
  sender_device_id: string | null;
  client_message_id: string | null;
  type: MessageType;
  body_text: string | null;
  content: Record<string, unknown> | null;
  attachment_id: string | null;
  reply_to_id: string | null;
  forwarded: Generated<boolean>;
  view_once: Generated<boolean>;
  viewed_at: Timestamp | null;
  expire_at: Timestamp | null;
  mentions: ColumnType<string[], string[] | undefined, string[]>;
  is_legacy: Generated<boolean>;
  edited_at: Timestamp | null;
  deleted_at: Timestamp | null;
  created_at: CreatedAt;
  // Generated column; never written and rarely selected.
  search: ColumnType<string, never, never>;
}

export interface DeviceCursorsTable {
  device_id: string;
  conversation_id: string;
  delivered_seq: Int8Default;
  synced_seq: Int8Default;
  updated_at: CreatedAt;
}

export interface ReactionsTable {
  message_id: string;
  user_id: string;
  emoji: string;
  created_at: CreatedAt;
}

export interface PollVotesTable {
  message_id: string;
  user_id: string;
  option_index: number;
  voted_at: CreatedAt;
}

export interface PinnedMessagesTable {
  message_id: string;
  conversation_id: string;
  pinned_by: string | null;
  pinned_at: CreatedAt;
}

export interface StarredMessagesTable {
  user_id: string;
  message_id: string;
  starred_at: CreatedAt;
}

export interface AttachmentsTable {
  id: Generated<string>;
  owner_id: string;
  object_key: string;
  file_name: string | null;
  declared_mime: string;
  verified_mime: string | null;
  size_bytes: Int8;
  sha256: Bytes | null;
  status: Generated<AttachmentStatus>;
  created_at: CreatedAt;
}

export interface OutboxTable {
  id: Generated<number>;
  event_id: Generated<string>;
  topic: string;
  partition_key: string;
  payload: Record<string, unknown>;
  created_at: CreatedAt;
  published_at: Timestamp | null;
  attempts: Generated<number>;
  last_error: string | null;
}

export interface ProcessedEventsTable {
  consumer: string;
  event_id: string;
  processed_at: CreatedAt;
}

export interface AuditLogTable {
  id: Generated<number>;
  user_id: string | null;
  action: string;
  ip: string | null;
  metadata: JsonDefault<Record<string, unknown>>;
  created_at: CreatedAt;
}

export interface BlocksTable {
  blocker_id: string;
  blocked_id: string;
  created_at: CreatedAt;
}

export interface ContactsTable {
  owner_id: string;
  contact_user_id: string;
  nickname: string | null;
  created_at: CreatedAt;
}

export interface InviteLinksTable {
  id: Generated<string>;
  conversation_id: string;
  created_by: string | null;
  token_hash: Bytes;
  expires_at: Timestamp | null;
  max_uses: number | null;
  use_count: Generated<number>;
  requires_approval: Generated<boolean>;
  revoked_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface CallLinksTable {
  id: Generated<string>;
  conversation_id: string;
  created_by: string | null;
  token_hash: Bytes;
  media: CallType;
  expires_at: Timestamp;
  max_uses: number | null;
  use_count: Generated<number>;
  revoked_at: Timestamp | null;
  created_at: CreatedAt;
}

export interface JoinRequestsTable {
  id: Generated<string>;
  conversation_id: string;
  user_id: string;
  status: Generated<JoinRequestStatus>;
  created_at: CreatedAt;
  decided_at: Timestamp | null;
  decided_by: string | null;
}

export interface CallLogsTable {
  id: Generated<string>;
  conversation_id: string;
  caller_id: string | null;
  type: CallType;
  status: Generated<CallStatus>;
  started_at: CreatedAt;
  answered_at: Timestamp | null;
  ended_at: Timestamp | null;
}

export interface PushSubscriptionsTable {
  id: Generated<string>;
  user_id: string;
  device_id: string | null;
  endpoint: string;
  p256dh: string;
  auth: string;
  created_at: CreatedAt;
  disabled_at: Timestamp | null;
}

export interface ReportsTable {
  id: Generated<string>;
  reporter_id: string | null;
  reported_user_id: string | null;
  conversation_id: string | null;
  reason: string;
  // A JSON array: pass JSON.stringify([...]) when inserting.
  evidence: ColumnType<unknown[], string | undefined, string>;
  status: Generated<ReportStatus>;
  created_at: CreatedAt;
  resolved_at: Timestamp | null;
}

export interface MessageEventsTable {
  conversation_id: string;
  seq: Int8;
  type: MessageEventType;
  message_id: string;
  user_id: string | null;
  emoji: string | null;
  created_at: CreatedAt;
}

export interface HiddenMessagesTable {
  user_id: string;
  message_id: string;
  hidden_at: CreatedAt;
}

export interface ViewOnceOpensTable {
  message_id: string;
  user_id: string;
  opened_at: CreatedAt;
}

export type ScheduledStatus = 'pending' | 'sent' | 'failed';

export interface ScheduledMessagesTable {
  id: Generated<string>;
  user_id: string;
  conversation_id: string;
  body_text: string;
  send_at: Timestamp;
  status: Generated<ScheduledStatus>;
  failed_reason: string | null;
  created_at: CreatedAt;
}

export type ReminderStatus = 'pending' | 'sent' | 'cancelled';

// "Remind me": the row stores only WHEN and WHAT (ids and an optional note). The message text is
// never copied here; it is read when the reminder is shown or sent, so deleting a message also
// removes it from its reminders.
export interface RemindersTable {
  id: Generated<string>;
  user_id: string;
  conversation_id: string;
  // null = a reminder about the whole chat
  message_id: string | null;
  note: string | null;
  remind_at: Timestamp;
  status: Generated<ReminderStatus>;
  created_at: CreatedAt;
  sent_at: Timestamp | null;
}

export interface Database {
  users: UsersTable;
  user_settings: UserSettingsTable;
  devices: DevicesTable;
  conversations: ConversationsTable;
  direct_pairs: DirectPairsTable;
  conversation_members: ConversationMembersTable;
  messages: MessagesTable;
  device_cursors: DeviceCursorsTable;
  reactions: ReactionsTable;
  poll_votes: PollVotesTable;
  pinned_messages: PinnedMessagesTable;
  starred_messages: StarredMessagesTable;
  attachments: AttachmentsTable;
  outbox: OutboxTable;
  processed_events: ProcessedEventsTable;
  audit_log: AuditLogTable;
  blocks: BlocksTable;
  contacts: ContactsTable;
  invite_links: InviteLinksTable;
  join_requests: JoinRequestsTable;
  call_logs: CallLogsTable;
  call_links: CallLinksTable;
  push_subscriptions: PushSubscriptionsTable;
  reports: ReportsTable;
  message_events: MessageEventsTable;
  hidden_messages: HiddenMessagesTable;
  view_once_opens: ViewOnceOpensTable;
  scheduled_messages: ScheduledMessagesTable;
  reminders: RemindersTable;
}

// Every application table; the seed truncates these and a test checks they all exist.
export const APP_TABLES: ReadonlyArray<keyof Database> = [
  'users',
  'user_settings',
  'devices',
  'conversations',
  'direct_pairs',
  'conversation_members',
  'messages',
  'device_cursors',
  'reactions',
  'poll_votes',
  'pinned_messages',
  'starred_messages',
  'attachments',
  'outbox',
  'processed_events',
  'audit_log',
  'blocks',
  'contacts',
  'invite_links',
  'join_requests',
  'call_logs',
  'call_links',
  'push_subscriptions',
  'reports',
  'message_events',
  'hidden_messages',
  'view_once_opens',
  'scheduled_messages',
  'reminders',
];

export type User = Selectable<UsersTable>;
export type Conversation = Selectable<ConversationsTable>;
export type Message = Selectable<MessagesTable>;
export type NewMessage = Insertable<MessagesTable>;
export type OutboxRow = Selectable<OutboxTable>;
