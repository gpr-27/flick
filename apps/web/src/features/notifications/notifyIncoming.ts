// Called by the chat store for every new message it applies. When the tab is hidden and the
// chat is not muted (or the message mentions me), show a browser Notification and play a sound.
// This is separate from Web Push: push covers a closed browser, this covers a background tab.
// Settings > Notifications decide the sound, vibration, previews and quiet hours.
import type { ConversationSummary, MessageRecord } from '@chat/contracts';
import { inQuietHours } from '@/features/settings/policy';
import { useSettingsStore } from '@/features/settings/useSettingsStore';
import { useIncomingBanner } from './bannerStore';
import { excerptOf, shouldBanner, shouldNotify } from './rules';
import { serverQuiet } from '@/features/productivity/quiet';
import { playIncomingFor } from '../organise/chatLook';
import { holdForDigest } from './digest';
import { hasKeyword, mentionsUser } from './rules';

export interface IncomingContext {
  summary: ConversationSummary;
  myId: string;
  senderName: string;
  /** Called when the user clicks the notification. */
  open: () => void;
  /** True when this chat is open and on screen. */
  inView?: boolean;
}

/** "Archived chats stay archived" is off: a message from someone else takes the chat out. */
const unarchiveIfAsked = (message: MessageRecord, ctx: IncomingContext): void => {
  const { keepArchived } = useSettingsStore.getState();
  if (keepArchived || !ctx.summary.prefs.archived || message.sender_user_id === ctx.myId) return;
  // Loaded when needed: the organise code imports the chat store, which imports this file.
  void import('@/features/organise/prefs').then((m) =>
    m.updatePrefs(ctx.summary.id, { archived: false }),
  );
};

export const notifyIncoming = (message: MessageRecord, ctx: IncomingContext): void => {
  unarchiveIfAsked(message, ctx);

  const input = {
    message,
    myId: ctx.myId,
    mutedUntil: ctx.summary.prefs.muted_until,
    tabHidden: document.hidden,
    now: Date.now(),
    keywords: useSettingsStore.getState().keywordAlerts,
  };
  // App open and visible, message in another chat: a banner and a soft sound.
  if (message.content && shouldBanner({ ...input, inView: ctx.inView ?? false })) {
    const isGroup = ctx.summary.type === 'group';
    const text = excerptOf(message.content);
    useIncomingBanner.getState().show({
      conversationId: ctx.summary.id,
      title: isGroup ? (ctx.summary.title ?? 'Group') : ctx.senderName,
      text: isGroup ? `${ctx.senderName}: ${text}` : text,
    });
    const prefs = useSettingsStore.getState();
    if (prefs.messageSound && !inQuietHours(prefs) && !serverQuiet(message.sender_user_id))
      playIncomingFor(ctx.summary.id, prefs.soundVolume);
    return;
  }
  const allowed = shouldNotify(input);
  if (!allowed || !message.content) return;

  const settings = useSettingsStore.getState();
  // A digest holds back non-urgent notifications (mentions and keywords are urgent).
  if (
    message.content.type === 'text' &&
    holdForDigest(
      ctx.summary.id,
      ctx.summary.type === 'group' ? (ctx.summary.title ?? 'Group') : ctx.senderName,
      message.content.text,
      mentionsUser(message.content, ctx.myId) || hasKeyword(message.content, input.keywords),
    )
  )
    return;
  // Quiet hours silence the sound, the buzz and the desktop notification. Messages still arrive.
  if (inQuietHours(settings) || serverQuiet(message.sender_user_id)) return;

  if (settings.messageSound) playIncomingFor(ctx.summary.id, settings.soundVolume);
  if (settings.vibration && typeof navigator.vibrate === 'function') navigator.vibrate(200);

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const isGroup = ctx.summary.type === 'group';
  const text = settings.messagePreviews ? excerptOf(message.content) : 'New message';
  const notification = new Notification(isGroup ? (ctx.summary.title ?? 'Group') : ctx.senderName, {
    body: isGroup ? `${ctx.senderName}: ${text}` : text,
    // One notification per conversation: a newer message replaces the older one.
    tag: `conversation-${ctx.summary.id}`,
    icon: '/icons/icon-192.png',
  });
  notification.onclick = () => {
    window.focus();
    ctx.open();
    notification.close();
  };
};
