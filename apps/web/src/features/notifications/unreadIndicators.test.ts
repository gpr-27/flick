import { describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@chat/contracts';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
} from '../../../test/fakes';
import { useChatStore } from '../chat/useChatStore';
import { useIncomingBanner } from './bannerStore';
import { markAllRead } from './markAllRead';
import { useMentions } from './mentions';
import { notifyIncoming } from './notifyIncoming';
import { shouldBanner } from './rules';
import { setAppBadge, titleWithUnread, totalUnread } from './unreadTotal';

const conv = (unread: number, mutedUntil: string | null = null): ConversationSummary =>
  makeConversation({ unread_count: unread, prefs: { muted_until: mutedUntil } as never });

describe('unread total', () => {
  it('sums unread but skips muted chats', () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    expect(totalUnread([conv(2), conv(5, future), conv(1)])).toBe(3);
  });

  it('builds the tab title with a 99+ cap', () => {
    expect(titleWithUnread(0)).toBe('Flick');
    expect(titleWithUnread(3)).toBe('(3) Flick');
    expect(titleWithUnread(150)).toBe('(99+) Flick');
  });

  it('sets and clears the app badge when supported, and is safe when not', () => {
    const set = vi.fn().mockResolvedValue(undefined);
    const clear = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { setAppBadge: set, clearAppBadge: clear });
    setAppBadge(4);
    setAppBadge(0);
    expect(set).toHaveBeenCalledWith(4);
    expect(clear).toHaveBeenCalled();
    Object.assign(navigator, { setAppBadge: undefined, clearAppBadge: undefined });
    expect(() => {
      setAppBadge(2);
    }).not.toThrow();
  });
});

describe('in-app banner', () => {
  const live = () => makeMessage({ sender_user_id: BOB, created_at: new Date().toISOString() });
  const base = { myId: ME, mutedUntil: null, tabHidden: false, now: Date.now() };

  it('shows for another chat, not for the open chat or a muted one', () => {
    expect(shouldBanner({ ...base, message: live(), inView: false })).toBe(true);
    expect(shouldBanner({ ...base, message: live(), inView: true })).toBe(false);
    const muted = new Date(Date.now() + 3_600_000).toISOString();
    expect(shouldBanner({ ...base, message: live(), inView: false, mutedUntil: muted })).toBe(
      false,
    );
  });

  it('notifyIncoming fills the banner store', () => {
    vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
    useIncomingBanner.getState().dismiss();
    const summary = { id: CONV, type: 'direct', title: null, prefs: { muted_until: null } };
    notifyIncoming(live(), {
      summary: summary as ConversationSummary,
      myId: ME,
      senderName: 'Bob',
      open: vi.fn(),
    });
    expect(useIncomingBanner.getState().current).toMatchObject({
      conversationId: CONV,
      title: 'Bob',
    });
  });
});

describe('mark all as read', () => {
  const setup = () => {
    const { transport } = installFakeServices();
    useChatStore.getState().reset();
    const c = conv(2);
    useChatStore.setState({ conversations: { [c.id]: c } });
    return { transport, c };
  };

  it('does nothing while offline', () => {
    const { transport, c } = setup();
    transport.setState('idle');
    expect(markAllRead()).toBe(0);
    expect(useChatStore.getState().conversations[c.id]?.unread_count).toBe(2);
  });

  it('acks each unread chat and clears the counts and mention marks', () => {
    const { transport, c } = setup();
    useMentions.getState().mark(c.id);
    expect(markAllRead()).toBe(1);
    expect(transport.sentOf('read_ack')).toHaveLength(1);
    expect(useChatStore.getState().conversations[c.id]?.unread_count).toBe(0);
    expect(useMentions.getState().chats).toEqual({});
  });
});
