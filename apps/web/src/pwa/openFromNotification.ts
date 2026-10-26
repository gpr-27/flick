// Opening a conversation (or answering a call) from a notification. Two entry points land here:
//   - a cold start at `/?c=<conversation_id>` or `/?answer=<call_id>` (the SW opened a new window);
//   - a message from the SW to an already open window.
// The app may not have its chat list yet, so the id is parked in a tiny store and the chat view
// picks it up when the conversation exists.
import { create } from 'zustand';
import { useDraftStore } from '@/features/organise/drafts';

interface PendingOpen {
  conversationId: string | null;
  /** The message a tapped notification was about, with its seq (needed to find it in the history). */
  messageId: string | null;
  seq: number | null;
  /** A call the user tapped "Answer" on; the incoming-call screen should appear for it. */
  answerCallId: string | null;
}

export const usePendingOpen = create<PendingOpen>()(() => ({
  conversationId: null,
  messageId: null,
  seq: null,
  answerCallId: null,
}));

/** `?answer=<call id>` from a URL or search string, or null. */
export const answerCallIdFromUrl = (url: string): string | null => {
  try {
    return new URL(url, 'http://app.local').searchParams.get('answer');
  } catch {
    return null;
  }
};

/** `?c=<id>` from a URL or search string, or null. */
export const conversationIdFromUrl = (url: string): string | null => {
  try {
    return new URL(url, 'http://app.local').searchParams.get('c');
  } catch {
    return null;
  }
};

/** `?m=<message id>&s=<seq>` from a URL: the message a notification pointed at. */
export const messageTargetFromUrl = (
  url: string,
): { messageId: string | null; seq: number | null } => {
  try {
    const params = new URL(url, 'http://app.local').searchParams;
    const seq = Number(params.get('s'));
    return {
      messageId: params.get('m'),
      seq: params.get('s') !== null && Number.isInteger(seq) && seq >= 0 ? seq : null,
    };
  } catch {
    return { messageId: null, seq: null };
  }
};

/** "Reply" typed in a desktop notification (`?reply=`) becomes the unsent draft of that chat. */
const applyReplyParam = (url: string, conversationId: string | null): void => {
  try {
    const text = new URL(url, 'http://app.local').searchParams.get('reply');
    if (text && conversationId) useDraftStore.getState().setDraft(conversationId, text);
  } catch {
    // not a URL: nothing to apply
  }
};

/** Read `?c=` once at startup and clean the address bar. */
export const consumeLaunchParam = (): void => {
  const id = conversationIdFromUrl(window.location.href);
  const callId = answerCallIdFromUrl(window.location.href);
  if (!id && !callId) return;
  applyReplyParam(window.location.href, id);
  usePendingOpen.setState({
    conversationId: id,
    answerCallId: callId,
    ...messageTargetFromUrl(window.location.href),
  });
  window.history.replaceState(null, '', window.location.pathname);
};

/** The service worker tells the page that the browser replaced the push subscription. */
export const PUSH_CHANGED_EVENT = 'flick:push-subscription-changed';

export const handleServiceWorkerMessage = (event: MessageEvent): void => {
  const data = event.data as { type?: string; url?: string } | null;
  if (data?.type === 'push-subscription-changed') {
    window.dispatchEvent(new Event(PUSH_CHANGED_EVENT));
    return;
  }
  if (data?.type !== 'open-url' || typeof data.url !== 'string') return;
  const id = conversationIdFromUrl(data.url);
  applyReplyParam(data.url, id);
  if (id) usePendingOpen.setState({ conversationId: id, ...messageTargetFromUrl(data.url) });
  const callId = answerCallIdFromUrl(data.url);
  if (callId) usePendingOpen.setState({ answerCallId: callId });
};
