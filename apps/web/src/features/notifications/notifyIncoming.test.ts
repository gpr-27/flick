import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConversationSummary } from '@chat/contracts';
import { installFakePush, removeFakePush } from '../../../test/browserFakes';
import { BOB, CONV, ME, installFakeServices, makeMessage } from '../../../test/fakes';
import { notifyIncoming } from './notifyIncoming';

const summary = (mutedUntil: string | null = null) =>
  ({
    id: CONV,
    type: 'direct',
    title: null,
    prefs: { muted_until: mutedUntil },
  }) as ConversationSummary;

const live = (content?: Parameters<typeof makeMessage>[0]) =>
  makeMessage({ sender_user_id: BOB, created_at: new Date().toISOString(), ...content });

const hide = (hidden: boolean) => vi.spyOn(document, 'hidden', 'get').mockReturnValue(hidden);

let open: () => void;
beforeEach(() => {
  installFakeServices(); // quiet hours are looked up on the server
  open = vi.fn();
});
afterEach(removeFakePush);

describe('notifyIncoming', () => {
  it('shows one Notification per conversation (tag) when the tab is hidden', () => {
    const { FakeNotification } = installFakePush({ permission: 'granted' });
    hide(true);
    notifyIncoming(live(), { summary: summary(), myId: ME, senderName: 'Bob', open });

    expect(FakeNotification.created).toHaveLength(1);
    expect(FakeNotification.created[0]?.title).toBe('Bob');
    expect(FakeNotification.created[0]?.options?.tag).toBe(`conversation-${CONV}`);
  });

  it('does nothing while the tab is visible', () => {
    const { FakeNotification } = installFakePush({ permission: 'granted' });
    hide(false);
    notifyIncoming(live(), { summary: summary(), myId: ME, senderName: 'Bob', open });
    expect(FakeNotification.created).toHaveLength(0);
  });

  it('is silent for a muted chat but not for a mention', () => {
    const { FakeNotification } = installFakePush({ permission: 'granted' });
    hide(true);
    const muted = summary(new Date(Date.now() + 3_600_000).toISOString());
    notifyIncoming(live(), { summary: muted, myId: ME, senderName: 'Bob', open });
    expect(FakeNotification.created).toHaveLength(0);

    const mention = live({ content: { type: 'text', text: 'hi', mentions: [ME] } });
    notifyIncoming(mention, { summary: muted, myId: ME, senderName: 'Bob', open });
    expect(FakeNotification.created).toHaveLength(1);
  });

  it('opens the conversation when the notification is clicked', () => {
    const { FakeNotification } = installFakePush({ permission: 'granted' });
    hide(true);
    const click = vi.fn();
    notifyIncoming(live(), { summary: summary(), myId: ME, senderName: 'Bob', open: click });
    vi.spyOn(window, 'focus').mockImplementation(() => undefined);
    FakeNotification.instances[0]?.onclick?.();
    expect(click).toHaveBeenCalledOnce();
  });
});
