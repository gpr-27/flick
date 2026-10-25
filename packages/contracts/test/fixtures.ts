// One valid example of every content type and every WS event. The `satisfies`
// clauses make a missing example a compile error.
import type { z } from 'zod';
import type {
  CLIENT_PAYLOADS,
  ContentType,
  MessageContent,
  SERVER_PAYLOADS,
} from '../src/index.js';

export const id = (n: number) => `0192f5a0-0000-7000-8000-${n.toString(16).padStart(12, '0')}`;
export const ALICE = id(1);
export const BOB = id(2);
export const DEVICE = id(10);
export const CONV = id(20);
export const MSG = id(30);
export const FILE = id(40);
export const CALL = id(50);
export const NOW = '2026-10-24T12:00:00.000Z';
export const TS = 1_792_756_800_000;

export const CONTENT = {
  text: { type: 'text', text: 'Hello!', mentions: [BOB], reply_to: MSG },
  image: {
    type: 'image',
    attachment_id: FILE,
    width: 800,
    height: 600,
    caption: 'look',
    view_once: true,
  },
  video: { type: 'video', attachment_id: FILE, width: 1280, height: 720, duration_ms: 5_000 },
  file: { type: 'file', attachment_id: FILE, file_name: 'notes.pdf', size: 12_345 },
  voice: { type: 'voice', attachment_id: FILE, duration_ms: 4_200, waveform: [0, 40, 100, 20] },
  gif: {
    type: 'gif',
    gif_id: 'abc',
    url: 'https://media.giphy.com/a.gif',
    width: 320,
    height: 240,
  },
  sticker: { type: 'sticker', sticker_id: 'st1', url: 'https://media.giphy.com/s.gif' },
  poll: { type: 'poll', question: 'Lunch?', options: ['Pizza', 'Sushi'], allow_multiple: false },
  poll_vote: { type: 'poll_vote', poll_message_id: MSG, option_indexes: [1] },
  system: { type: 'system', event: 'member_added', actor_user_id: ALICE, target_user_ids: [BOB] },
  call_event: {
    type: 'call_event',
    call_id: CALL,
    media: 'video',
    outcome: 'ended',
    started_at: NOW,
    duration_s: 61,
  },
} satisfies { [K in ContentType]: z.input<typeof MessageContent> & { type: K } };

export const RECORD = {
  message_id: MSG,
  conversation_id: CONV,
  seq: 42,
  sender_user_id: ALICE,
  client_message_id: 'client_msg_456',
  content: { type: 'text' as const, text: 'Hello!' },
  created_at: NOW,
  edited_at: null,
  deleted_at: null,
  expires_at: null,
  reactions: [{ emoji: '👍', user_ids: [BOB] }],
  starred: false,
  viewed: false,
};

export const SUMMARY = {
  id: CONV,
  type: 'group' as const,
  is_saved: false,
  title: 'Team',
  avatar_url: null,
  description: null,
  peer: null,
  member_count: 3,
  my_role: 'member' as const,
  last_seq: 42,
  read_seq: 40,
  unread_count: 2,
  last_message: RECORD,
  peer_receipts: [
    { user_id: BOB, delivered_seq: 42, read_seq: 41 },
    { user_id: ALICE, delivered_seq: 0, read_seq: 0 },
  ],
  created_at: NOW,
  settings: {
    only_admins_send: false,
    only_admins_edit_info: true,
    approval_required: false,
    disappearing_timer_s: 0,
  },
  prefs: {
    archived: false,
    pinned: true,
    favorite: false,
    muted_until: null,
    locked: false,
    lock_hash: null,
    wallpaper: null,
    marked_unread: false,
  },
};

const SDP = { type: 'offer' as const, sdp: 'v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n' };
const ANSWER = { type: 'answer' as const, sdp: 'v=0\r\no=- 3 4 IN IP4 127.0.0.1\r\n' };
const REACTION = { conversation_id: CONV, seq: 43, message_id: MSG, user_id: BOB, emoji: '👍' };

type ClientPayloads = { [K in keyof typeof CLIENT_PAYLOADS]: z.input<(typeof CLIENT_PAYLOADS)[K]> };
type ServerPayloads = { [K in keyof typeof SERVER_PAYLOADS]: z.input<(typeof SERVER_PAYLOADS)[K]> };

export const CLIENT_EVENTS = {
  send_message: {
    conversation_id: CONV,
    client_message_id: 'client_msg_456',
    content: CONTENT.text,
  },
  delivery_ack: { acks: [{ conversation_id: CONV, seq: 42 }] },
  read_ack: { conversation_id: CONV, seq: 42 },
  typing_start: { conversation_id: CONV },
  typing_stop: { conversation_id: CONV },
  activity: { conversation_id: CONV, activity: 'recording_voice', state: 'start' },
  sync_request: { cursors: [{ conversation_id: CONV, after_seq: 40 }] },
  presence_subscribe: { user_ids: [BOB] },
  call_offer: { call_id: CALL, conversation_id: CONV, media: 'video', sdp: SDP },
  call_answer: { call_id: CALL, sdp: ANSWER },
  call_ice: {
    call_id: CALL,
    candidate: {
      candidate: 'candidate:1 1 udp 2122260223 10.0.0.1 54400 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    },
  },
  call_end: { call_id: CALL, reason: 'hangup' },
  call_reject: { call_id: CALL },
  call_busy: { call_id: CALL },
  call_renegotiate: { call_id: CALL, sdp: SDP },
} satisfies ClientPayloads;

export const SERVER_EVENTS = {
  new_message: { message: RECORD },
  message_edited: {
    conversation_id: CONV,
    seq: 44,
    message_id: MSG,
    content: { type: 'text', text: 'Hello (edited)' },
    edited_at: NOW,
  },
  message_deleted: {
    conversation_id: CONV,
    seq: 45,
    message_id: MSG,
    deleted_by: ALICE,
    deleted_at: NOW,
  },
  reaction_added: REACTION,
  reaction_removed: REACTION,
  receipt_update: { conversation_id: CONV, user_id: BOB, delivered_seq: 42, read_seq: 41 },
  typing_start: { conversation_id: CONV, user_id: BOB },
  typing_stop: { conversation_id: CONV, user_id: BOB },
  activity: { conversation_id: CONV, user_id: BOB, activity: 'recording_voice', state: 'start' },
  presence_update: { user_id: BOB, online: false, last_seen_at: NOW },
  conversation_updated: { conversation_id: CONV, conversation: SUMMARY },
  pins_changed: { conversation_id: CONV, message_id: MSG, pinned: true, actor_user_id: BOB },
  user_updated: { user_id: BOB, display_name: 'Bob B', username: 'bob', avatar_url: null },
  call_offer: { call_id: CALL, conversation_id: CONV, media: 'audio', sdp: SDP, from_user_id: BOB },
  call_answer: { call_id: CALL, sdp: ANSWER, from_user_id: BOB },
  call_ice: { call_id: CALL, candidate: null, from_user_id: BOB },
  call_end: { call_id: CALL, reason: 'answered_elsewhere', from_user_id: BOB },
  call_reject: { call_id: CALL, from_user_id: BOB },
  call_busy: { call_id: CALL, from_user_id: BOB },
  call_renegotiate: { call_id: CALL, sdp: ANSWER, from_user_id: BOB },
  call_unavailable: { call_id: CALL, reason: 'blocked' },
} satisfies ServerPayloads;
