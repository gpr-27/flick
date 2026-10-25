import { z } from 'zod';
import { PageQuery } from '../common.js';
import { MessageAccepted } from '../message.js';
import { SyncPagePayload, SyncRequestPayload } from '../ws/events.js';
import * as Ai from './ai.js';
import * as Calls from './calls.js';
import * as Conv from './conversations.js';
import * as Devices from './devices.js';
import * as Extras from './extras.js';
import * as Media from './media.js';
import * as Msg from './messages.js';
import * as Mod from './moderation.js';
import * as Push from './push.js';
import * as Reminders from './reminders.js';
import * as Scheduled from './scheduled.js';
import * as Users from './users.js';

export interface Endpoint {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  /** Relative to the API base, which comes from config. `:name` marks a path param. */
  path: `/${string}`;
  /** false = public (no Clerk session needed). */
  auth: boolean;
  params?: z.ZodType;
  query?: z.ZodType;
  body?: z.ZodType;
  /** null = 204 No Content. */
  response: z.ZodType | null;
}

/** Every REST endpoint. The API registers routes from this list; the web client builds its fetcher from it. */
export const ENDPOINTS = {
  users: {
    me: { method: 'GET', path: '/users/me', auth: true, response: Users.Me },
    updateMe: {
      method: 'PATCH',
      path: '/users/me',
      auth: true,
      body: Users.UpdateMeRequest,
      response: Users.Me,
    },
    search: {
      method: 'GET',
      path: '/users/search',
      auth: true,
      query: Users.UserSearchQuery,
      response: Users.UserSearchResponse,
    },
    directory: {
      method: 'GET',
      path: '/users/directory',
      auth: true,
      query: Users.DirectoryQuery,
      response: Users.UserSearchResponse,
    },
    profile: {
      method: 'GET',
      path: '/users/:user_id',
      auth: true,
      params: Users.UserParams,
      response: Users.UserProfile,
    },
    usernameAvailable: {
      method: 'GET',
      path: '/users/username-available',
      auth: true,
      query: Users.UsernameAvailableQuery,
      response: Users.UsernameAvailability,
    },
    byUsername: {
      method: 'GET',
      path: '/users/by-username/:username',
      auth: true,
      params: Users.UsernameParams,
      response: Users.UserProfile,
    },
    stats: { method: 'GET', path: '/users/me/stats', auth: true, response: Users.UserStats },
    settings: {
      method: 'GET',
      path: '/users/me/settings',
      auth: true,
      response: Users.AccountSettings,
    },
    updateSettings: {
      method: 'PATCH',
      path: '/users/me/settings',
      auth: true,
      body: Users.UpdateSettingsRequest,
      response: Users.AccountSettings,
    },
    /** The in-app guide progress (tour and tips); follows the person across devices. */
    guide: { method: 'GET', path: '/users/me/guide', auth: true, response: Users.GuideState },
    updateGuide: {
      method: 'PATCH',
      path: '/users/me/guide',
      auth: true,
      body: Users.UpdateGuideRequest,
      response: Users.GuideState,
    },
    /** Streams a JSON file (Content-Disposition: attachment); the web client saves it as a file. */
    export: { method: 'GET', path: '/users/me/export', auth: true, response: z.unknown() },
    deleteAccount: {
      method: 'POST',
      path: '/users/me/delete',
      auth: true,
      body: Users.DeleteAccountRequest,
      response: null,
    },
    /** Deletes my chat with the Flick assistant for me only. */
    clearFlickChat: { method: 'DELETE', path: '/users/me/flick-chat', auth: true, response: null },
    privacy: {
      method: 'GET',
      path: '/users/me/privacy',
      auth: true,
      response: Users.PrivacySettings,
    },
    updatePrivacy: {
      method: 'PATCH',
      path: '/users/me/privacy',
      auth: true,
      body: Users.UpdatePrivacyRequest,
      response: Users.PrivacySettings,
    },
  },
  devices: {
    list: { method: 'GET', path: '/devices', auth: true, response: Devices.DeviceList },
    revoke: {
      method: 'DELETE',
      path: '/devices/:device_id',
      auth: true,
      params: Devices.DeviceParams,
      response: null,
    },
    revokeOthers: { method: 'POST', path: '/devices/revoke-others', auth: true, response: null },
  },
  conversations: {
    list: {
      method: 'GET',
      path: '/conversations',
      auth: true,
      query: Conv.ConversationListQuery,
      response: Conv.ConversationList,
    },
    get: {
      method: 'GET',
      path: '/conversations/:conversation_id',
      auth: true,
      params: Conv.ConversationParams,
      response: Conv.ConversationSummary,
    },
    createDirect: {
      method: 'POST',
      path: '/conversations/direct',
      auth: true,
      body: Conv.CreateDirectRequest,
      response: Conv.ConversationSummary,
    },
    /** Your chat with yourself ("Saved messages"); created on first use. */
    openSaved: {
      method: 'POST',
      path: '/conversations/saved',
      auth: true,
      response: Conv.ConversationSummary,
    },
    createGroup: {
      method: 'POST',
      path: '/conversations/group',
      auth: true,
      body: Conv.CreateGroupRequest,
      response: Conv.ConversationSummary,
    },
    update: {
      method: 'PATCH',
      path: '/conversations/:conversation_id',
      auth: true,
      params: Conv.ConversationParams,
      body: Conv.UpdateConversationRequest,
      response: Conv.ConversationSummary,
    },
    updatePrefs: {
      method: 'PATCH',
      path: '/conversations/:conversation_id/prefs',
      auth: true,
      params: Conv.ConversationParams,
      body: Conv.UpdateChatPrefsRequest,
      response: Conv.ChatPrefs,
    },
    leave: {
      method: 'POST',
      path: '/conversations/:conversation_id/leave',
      auth: true,
      params: Conv.ConversationParams,
      response: null,
    },
    members: {
      method: 'GET',
      path: '/conversations/:conversation_id/members',
      auth: true,
      params: Conv.ConversationParams,
      query: PageQuery,
      response: Conv.MemberList,
    },
    addMembers: {
      method: 'POST',
      path: '/conversations/:conversation_id/members',
      auth: true,
      params: Conv.ConversationParams,
      body: Conv.AddMembersRequest,
      response: Conv.AddMembersResponse,
    },
    removeMember: {
      method: 'DELETE',
      path: '/conversations/:conversation_id/members/:user_id',
      auth: true,
      params: Conv.MemberParams,
      response: null,
    },
    setRole: {
      method: 'PATCH',
      path: '/conversations/:conversation_id/members/:user_id',
      auth: true,
      params: Conv.MemberParams,
      body: Conv.UpdateRoleRequest,
      response: Conv.Member,
    },
    mentionCandidates: {
      method: 'GET',
      path: '/conversations/:conversation_id/mention-candidates',
      auth: true,
      params: Conv.ConversationParams,
      query: Conv.MentionQuery,
      response: Conv.MentionCandidates,
    },
    shared: {
      method: 'GET',
      path: '/conversations/:conversation_id/shared',
      auth: true,
      params: Conv.ConversationParams,
      query: Conv.SharedQuery,
      response: Conv.SharedPage,
    },
    createInvite: {
      method: 'POST',
      path: '/conversations/:conversation_id/invites',
      auth: true,
      params: Conv.ConversationParams,
      body: Conv.CreateInviteRequest,
      response: Conv.Invite,
    },
    previewInvite: {
      method: 'GET',
      path: '/invites/:code',
      auth: true,
      params: Conv.InviteParams,
      response: Conv.InvitePreview,
    },
    joinInvite: {
      method: 'POST',
      path: '/invites/:code/join',
      auth: true,
      params: Conv.InviteParams,
      response: Conv.JoinResponse,
    },
    revokeInvite: {
      method: 'DELETE',
      path: '/invites/:code',
      auth: true,
      params: Conv.InviteParams,
      response: null,
    },
    joinRequests: {
      method: 'GET',
      path: '/conversations/:conversation_id/join-requests',
      auth: true,
      params: Conv.ConversationParams,
      query: PageQuery,
      response: Conv.JoinRequestList,
    },
    decideJoinRequest: {
      method: 'POST',
      path: '/conversations/:conversation_id/join-requests/:request_id',
      auth: true,
      params: Conv.JoinRequestParams,
      body: Conv.DecideJoinRequest,
      response: null,
    },
  },
  messages: {
    send: {
      method: 'POST',
      path: '/conversations/:conversation_id/messages',
      auth: true,
      params: Conv.ConversationParams,
      body: Msg.SubmitMessageRequest,
      response: MessageAccepted,
    },
    history: {
      method: 'GET',
      path: '/conversations/:conversation_id/messages',
      auth: true,
      params: Conv.ConversationParams,
      query: Msg.HistoryQuery,
      response: Msg.HistoryResponse,
    },
    getPoll: {
      method: 'GET',
      path: '/conversations/:conversation_id/polls/:message_id',
      auth: true,
      params: Msg.MessageParams,
      response: Msg.PollTally,
    },
    votePoll: {
      method: 'POST',
      path: '/conversations/:conversation_id/polls/:message_id/vote',
      auth: true,
      params: Msg.MessageParams,
      body: Msg.VoteRequest,
      response: Msg.PollTally,
    },
    sync: {
      method: 'POST',
      path: '/sync',
      auth: true,
      body: SyncRequestPayload,
      response: SyncPagePayload,
    },
    edit: {
      method: 'PATCH',
      path: '/conversations/:conversation_id/messages/:message_id',
      auth: true,
      params: Msg.MessageParams,
      body: Msg.EditMessageRequest,
      response: null,
    },
    delete: {
      method: 'DELETE',
      path: '/conversations/:conversation_id/messages/:message_id',
      auth: true,
      params: Msg.MessageParams,
      query: Msg.DeleteMessageQuery,
      response: null,
    },
    react: {
      method: 'PUT',
      path: '/conversations/:conversation_id/messages/:message_id/reaction',
      auth: true,
      params: Msg.MessageParams,
      body: Msg.ReactRequest,
      response: null,
    },
    unreact: {
      method: 'DELETE',
      path: '/conversations/:conversation_id/messages/:message_id/reaction',
      auth: true,
      params: Msg.MessageParams,
      response: null,
    },
    star: {
      method: 'PUT',
      path: '/conversations/:conversation_id/messages/:message_id/star',
      auth: true,
      params: Msg.MessageParams,
      response: null,
    },
    unstar: {
      method: 'DELETE',
      path: '/conversations/:conversation_id/messages/:message_id/star',
      auth: true,
      params: Msg.MessageParams,
      response: null,
    },
    starred: {
      method: 'GET',
      path: '/starred',
      auth: true,
      query: PageQuery,
      response: Msg.StarredList,
    },
    pin: {
      method: 'POST',
      path: '/conversations/:conversation_id/pins',
      auth: true,
      params: Conv.ConversationParams,
      body: Msg.PinRequest,
      response: null,
    },
    unpin: {
      method: 'DELETE',
      path: '/conversations/:conversation_id/pins/:message_id',
      auth: true,
      params: Msg.MessageParams,
      response: null,
    },
    pins: {
      method: 'GET',
      path: '/conversations/:conversation_id/pins',
      auth: true,
      params: Conv.ConversationParams,
      response: Msg.PinnedList,
    },
    openViewOnce: {
      method: 'POST',
      path: '/conversations/:conversation_id/messages/:message_id/open',
      auth: true,
      params: Msg.MessageParams,
      response: Msg.ViewOnceOpened,
    },
    info: {
      method: 'GET',
      path: '/conversations/:conversation_id/messages/:message_id/info',
      auth: true,
      params: Msg.MessageParams,
      response: Msg.MessageInfo,
    },
    search: {
      method: 'GET',
      path: '/search',
      auth: true,
      query: Msg.SearchQuery,
      response: Msg.SearchResponse,
    },
    delivered: {
      method: 'POST',
      path: '/receipts/delivered',
      auth: true,
      body: Msg.DeliveredRequest,
      response: null,
    },
    read: {
      method: 'POST',
      path: '/conversations/:conversation_id/read',
      auth: true,
      params: Conv.ConversationParams,
      body: Msg.ReadRequest,
      response: null,
    },
  },
  media: {
    presignUpload: {
      method: 'POST',
      path: '/media/presign',
      auth: true,
      body: Media.PresignUploadRequest,
      response: Media.PresignUploadResponse,
    },
    complete: {
      method: 'POST',
      path: '/media/:attachment_id/complete',
      auth: true,
      params: Media.AttachmentParams,
      response: Media.Attachment,
    },
    download: {
      method: 'GET',
      path: '/media/:attachment_id/url',
      auth: true,
      params: Media.AttachmentParams,
      response: Media.DownloadUrl,
    },
    gifSearch: {
      method: 'GET',
      path: '/gifs/search',
      auth: true,
      query: Extras.GifSearchQuery,
      response: Extras.GifSearchResponse,
    },
    gifTrending: {
      method: 'GET',
      path: '/gifs/trending',
      auth: true,
      query: Extras.GifSearchQuery,
      response: Extras.GifSearchResponse,
    },
    linkPreview: {
      method: 'GET',
      path: '/link-preview',
      auth: true,
      query: Extras.LinkPreviewQuery,
      response: Extras.LinkPreview,
    },
  },
  calls: {
    turn: { method: 'GET', path: '/calls/turn', auth: true, response: Calls.TurnCredentials },
    livekitToken: {
      method: 'POST',
      path: '/calls/livekit-token',
      auth: true,
      body: Calls.LivekitTokenRequest,
      response: Calls.LivekitToken,
    },
    groupPresence: {
      method: 'GET',
      path: '/calls/group/:conversation_id',
      auth: true,
      params: Calls.GroupCallParams,
      response: Calls.GroupCallPresence,
    },
    groupBeat: {
      method: 'POST',
      path: '/calls/group/presence',
      auth: true,
      body: Calls.GroupCallBeat,
      response: Calls.GroupCallPresence,
    },
    createLink: {
      method: 'POST',
      path: '/calls/links',
      auth: true,
      body: Calls.CreateCallLinkRequest,
      response: Calls.CallLink,
    },
    getLink: {
      method: 'GET',
      path: '/calls/links/:code',
      auth: true,
      params: Calls.CallLinkParams,
      response: Calls.CallLink,
    },
    revokeLink: {
      method: 'DELETE',
      path: '/calls/links/:code',
      auth: true,
      params: Calls.CallLinkParams,
      response: null,
    },
    declineFromPush: {
      method: 'POST',
      path: '/calls/decline-from-push',
      auth: false,
      body: Calls.DeclineFromPushRequest,
      response: null,
    },
    log: {
      method: 'GET',
      path: '/calls',
      auth: true,
      query: Calls.CallLogQuery,
      response: Calls.CallLog,
    },
  },
  scheduled: {
    create: {
      method: 'POST',
      path: '/conversations/:conversation_id/scheduled',
      auth: true,
      params: Conv.ConversationParams,
      body: Scheduled.ScheduleMessageRequest,
      response: Scheduled.ScheduledMessage,
    },
    list: { method: 'GET', path: '/scheduled', auth: true, response: Scheduled.ScheduledList },
    cancel: {
      method: 'DELETE',
      path: '/scheduled/:scheduled_id',
      auth: true,
      params: Scheduled.ScheduledParams,
      response: null,
    },
  },
  reminders: {
    create: {
      method: 'POST',
      path: '/reminders',
      auth: true,
      body: Reminders.CreateReminderRequest,
      response: Reminders.Reminder,
    },
    list: {
      method: 'GET',
      path: '/reminders',
      auth: true,
      query: Reminders.ReminderListQuery,
      response: Reminders.ReminderList,
    },
    cancel: {
      method: 'DELETE',
      path: '/reminders/:reminder_id',
      auth: true,
      params: Reminders.ReminderParams,
      response: null,
    },
  },
  ai: {
    status: { method: 'GET', path: '/ai/status', auth: true, response: Ai.AiStatus },
    summarize: {
      method: 'POST',
      path: '/ai/summarize',
      auth: true,
      body: Ai.AiConversationRequest,
      response: Ai.AskAiResponse,
    },
    suggestReplies: {
      method: 'POST',
      path: '/ai/suggest-replies',
      auth: true,
      body: Ai.AiConversationRequest,
      response: Ai.SuggestRepliesResponse,
    },
    translate: {
      method: 'POST',
      path: '/ai/translate',
      auth: true,
      body: Ai.AiTranslateRequest,
      response: Ai.AskAiResponse,
    },
    ask: {
      method: 'POST',
      path: '/ai/chat',
      auth: true,
      body: Ai.AskAiRequest,
      response: Ai.AskAiResponse,
    },
  },
  push: {
    vapidKey: { method: 'GET', path: '/push/vapid-key', auth: true, response: Push.VapidKey },
    subscribe: {
      method: 'POST',
      path: '/push/subscribe',
      auth: true,
      body: Push.PushSubscribeRequest,
      response: null,
    },
    unsubscribe: {
      method: 'POST',
      path: '/push/unsubscribe',
      auth: true,
      body: Push.PushUnsubscribeRequest,
      response: null,
    },
  },
  moderation: {
    block: { method: 'POST', path: '/blocks', auth: true, body: Mod.BlockRequest, response: null },
    unblock: {
      method: 'DELETE',
      path: '/blocks/:user_id',
      auth: true,
      params: Users.UserParams,
      response: null,
    },
    blocks: {
      method: 'GET',
      path: '/blocks',
      auth: true,
      query: PageQuery,
      response: Mod.BlockList,
    },
    report: {
      method: 'POST',
      path: '/reports',
      auth: true,
      body: Mod.ReportRequest,
      response: Mod.ReportResponse,
    },
  },
} as const satisfies Record<string, Record<string, Endpoint>>;

/**
 * Join a configured base (e.g. "https://flick.example.com/api") with an endpoint
 * path, URL-encoding each `:param`. Throws on a missing param.
 */
export function buildPath(base: string, path: string, params: Record<string, string> = {}): string {
  const filled = path.replace(/:([a-z_]+)/g, (_match, name: string) => {
    const value = params[name];
    if (!value) throw new Error(`missing path param "${name}" for ${path}`);
    return encodeURIComponent(value);
  });
  return base.replace(/\/+$/, '') + filled;
}
