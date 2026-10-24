// Called by the chat store for every new message it applies. When the tab is hidden and the
// chat is not muted (or the message mentions me), show a browser Notification and play a sound.
// This is separate from Web Push: push covers a closed browser, this covers a background tab.
import type { ConversationSummary, MessageRecord } from '@chat/contracts';
import { useIncomingBanner } from './bannerStore';
import { excerptOf, shouldBanner, shouldNotify } from './rules';
import { playMessageSound } from './sound';
import { useNotificationPrefs } from './useNotificationPrefs';

export interface IncomingContext {
  summary: ConversationSummary;
  myId: string;
  senderName: string;
  /** Called when the user clicks the notification. */
  open: () => void;
  /** True when this chat is open and on screen. */
  inView?: boolean;
}

export const notifyIncoming = (message: MessageRecord, ctx: IncomingContext): void => {
  const input = {
    message,
    myId: ctx.myId,
    mutedUntil: ctx.summary.prefs.muted_until,
    tabHidden: document.hidden,
    now: Date.now(),
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
    if (useNotificationPrefs.getState().sound) playMessageSound();
    return;
  }
  const allowed = shouldNotify(input);
  if (!allowed || !message.content) return;

  if (useNotificationPrefs.getState().sound) playMessageSound();

  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const isGroup = ctx.summary.type === 'group';
  const text = excerptOf(message.content);
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
