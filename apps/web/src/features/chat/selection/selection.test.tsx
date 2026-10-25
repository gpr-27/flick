import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS, type MessageRecord } from '@chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '@/components/ui/notify';
import { useSessionStore } from '@/features/auth/useSessionStore';
import {
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
} from '../../../../test/fakes';
import { expectNoA11yViolations } from '../../../../test/a11y';
import { MessageBubble, type MessageBubbleProps } from '../components/MessageBubble';
import { buildRows } from '../threadRows';
import { useChatStore } from '../useChatStore';
import { SelectionBar } from './SelectionBar';
import { planSelection } from './selectionRules';
import { useSelectionStore } from './useSelectionStore';

const mine = (text: string, extra: Partial<MessageRecord> = {}): MessageRecord =>
  makeMessage({ sender_user_id: ME, content: { type: 'text', text }, ...extra });
const theirs = (text: string, extra: Partial<MessageRecord> = {}): MessageRecord =>
  makeMessage({ sender_user_id: 'someone-else', content: { type: 'text', text }, ...extra });

describe('selection rules', () => {
  it('copies the text messages in order, one per line', () => {
    const plan = planSelection([mine('one'), theirs('two')], ME);
    expect(plan.count).toBe(2);
    expect(plan.copyText).toBe('one\ntwo');
  });

  it('has nothing to copy when no chosen message has text', () => {
    const photo = makeMessage({
      content: { type: 'image', attachment_id: 'a', width: 1, height: 1 } as never,
    });
    expect(planSelection([photo], ME).copyText).toBeNull();
  });

  it('forwards only the messages that can be forwarded', () => {
    const poll = makeMessage({
      content: { type: 'poll', question: 'q', options: [], multiple: false } as never,
    });
    const text = mine('hi');
    expect(planSelection([text, poll], ME).forwardable).toEqual([text]);
  });

  it('stars the unstarred ones, and unstars everything only when all are starred', () => {
    const a = mine('a', { starred: true });
    const b = mine('b');
    const some = planSelection([a, b], ME);
    expect(some.starAction).toBe('star');
    expect(some.starTargets).toEqual([b]);
    const all = planSelection([a, mine('c', { starred: true })], ME);
    expect(all.starAction).toBe('unstar');
    expect(all.starTargets).toHaveLength(2);
  });

  it('offers delete for everyone only when every chosen message is mine', () => {
    expect(planSelection([mine('a'), mine('b')], ME).canDeleteForEveryone).toBe(true);
    expect(planSelection([mine('a'), theirs('b')], ME).canDeleteForEveryone).toBe(false);
    expect(planSelection([], ME).canDeleteForEveryone).toBe(false);
  });
});

describe('selection store', () => {
  beforeEach(() => {
    useSelectionStore.getState().clear();
  });

  it('ticks, unticks, and ends when the last one is unticked', () => {
    const { toggle } = useSelectionStore.getState();
    toggle('c1', 'm1');
    toggle('c1', 'm2');
    expect(useSelectionStore.getState().ids).toEqual(['m1', 'm2']);
    toggle('c1', 'm1');
    expect(useSelectionStore.getState().ids).toEqual(['m2']);
    toggle('c1', 'm2');
    expect(useSelectionStore.getState().ids).toEqual([]);
    expect(useSelectionStore.getState().conversationId).toBeNull();
  });

  it('never mixes two chats', () => {
    const { toggle } = useSelectionStore.getState();
    toggle('c1', 'm1');
    toggle('c2', 'm9');
    expect(useSelectionStore.getState().ids).toEqual(['m9']);
  });
});

describe('selection bar', () => {
  const m1 = mine('first');
  const m2 = mine('second');
  const other = theirs('from them');
  let api: ReturnType<typeof installFakeServices>['api'];

  beforeEach(() => {
    ({ api } = installFakeServices());
    useChatStore.getState().reset();
    useSelectionStore.getState().clear();
    useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
    useChatStore.setState({
      conversations: { [CONV]: makeConversation() },
      threads: {
        [CONV]: {
          messages: [m1, m2, other],
          status: 'ready',
          hasOlder: false,
          loadingOlder: false,
          error: null,
        } as never,
      },
    });
    vi.spyOn(notify, 'success').mockImplementation(() => '');
    vi.spyOn(notify, 'error').mockImplementation(() => '');
  });

  const mount = (ids: string[]) => {
    useSelectionStore.setState({ conversationId: CONV, ids });
    return render(<SelectionBar messages={[m1, m2, other]} ids={ids} myId={ME} />);
  };

  it('shows how many are chosen and has no Reply', () => {
    mount([m1.message_id, m2.message_id]);
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reply/i })).not.toBeInTheDocument();
  });

  it('copies the chosen text and ends the selection', async () => {
    const user = userEvent.setup();
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    mount([m1.message_id, m2.message_id]);
    await user.click(screen.getByRole('button', { name: 'Copy' }));
    expect(write).toHaveBeenCalledWith('first\nsecond');
    await waitFor(() => {
      expect(useSelectionStore.getState().ids).toEqual([]);
    });
  });

  it('stars the chosen messages', async () => {
    const user = userEvent.setup();
    mount([m1.message_id, m2.message_id]);
    await user.click(screen.getByRole('button', { name: 'Star' }));
    const starred = api.call.mock.calls.filter((c) => c[0] === ENDPOINTS.messages.star);
    expect(starred).toHaveLength(2);
  });

  it('opens the forward dialog for the chosen messages', async () => {
    const user = userEvent.setup();
    mount([m1.message_id, other.message_id]);
    await user.click(screen.getByRole('button', { name: 'Forward' }));
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('2 messages')).toBeInTheDocument();
  });

  it('offers both delete choices when everything is mine, and deletes each message', async () => {
    const user = userEvent.setup();
    mount([m1.message_id, m2.message_id]);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    await user.click(screen.getByRole('button', { name: 'Delete for everyone' }));
    const deletes = api.call.mock.calls.filter((c) => c[0] === ENDPOINTS.messages.delete);
    expect(deletes).toHaveLength(2);
    expect((deletes[0]?.[1] as { query: { for: string } }).query.for).toBe('everyone');
  });

  it('offers only delete for me when someone else wrote one of them', async () => {
    const user = userEvent.setup();
    mount([m1.message_id, other.message_id]);
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.queryByRole('button', { name: 'Delete for everyone' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete for me' }));
    const deletes = api.call.mock.calls.filter((c) => c[0] === ENDPOINTS.messages.delete);
    expect(deletes).toHaveLength(2);
    expect((deletes[0]?.[1] as { query: { for: string } }).query.for).toBe('me');
  });

  it('closes with the X and with Escape', async () => {
    const user = userEvent.setup();
    const { unmount } = mount([m1.message_id]);
    await user.click(screen.getByRole('button', { name: 'Cancel selection' }));
    expect(useSelectionStore.getState().ids).toEqual([]);
    unmount();

    mount([m1.message_id]);
    await user.keyboard('{Escape}');
    expect(useSelectionStore.getState().ids).toEqual([]);
  });

  it('has no accessibility violations', async () => {
    const { container } = mount([m1.message_id]);
    await expectNoA11yViolations(container);
  });
});

describe('a message while choosing', () => {
  const props = (overrides: Partial<MessageBubbleProps> = {}): MessageBubbleProps => {
    const [row] = buildRows([mine('pick me', { seq: 3 })], [], CONV);
    return {
      row: row!,
      myId: ME,
      sender: null,
      isGroup: false,
      status: 'sent',
      quoted: null,
      quotedName: '',
      showDate: false,
      onReact: vi.fn(),
      onReply: vi.fn(),
      onEdit: vi.fn(),
      onDelete: vi.fn(),
      onRetry: vi.fn(),
      onDiscard: vi.fn(),
      content: { onOpenImage: vi.fn() },
      onJumpTo: vi.fn(),
      ...overrides,
    };
  };

  it('starts the selection from the menu', async () => {
    const user = userEvent.setup();
    const p = props({ onSelect: vi.fn() });
    render(<MessageBubble {...p} />);
    await user.pointer({ keys: '[MouseRight]', target: screen.getByText('pick me') });
    await user.click(screen.getByRole('menuitem', { name: 'Select' }));
    expect(p.onSelect).toHaveBeenCalledWith(p.row.message);
  });

  it('ticks on a tap anywhere on it, and shows the tick', async () => {
    const user = userEvent.setup();
    const p = props({ selecting: true, selected: true, onSelect: vi.fn() });
    render(<MessageBubble {...p} />);
    expect(screen.getByRole('checkbox', { name: 'Select message' })).toBeChecked();
    await user.click(screen.getByText('pick me'));
    expect(p.onSelect).toHaveBeenCalledWith(p.row.message);
  });

  it('has no menu, reply or heart while choosing', async () => {
    const user = userEvent.setup();
    const p = props({ selecting: true, onSelect: vi.fn() });
    render(<MessageBubble {...p} />);
    await user.dblClick(screen.getByText('pick me'));
    expect(p.onReact).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Reply to this message' })).not.toBeInTheDocument();
  });

  it('has no accessibility violations while choosing', async () => {
    const { container } = render(
      <MessageBubble {...props({ selecting: true, selected: true, onSelect: vi.fn() })} />,
    );
    await expectNoA11yViolations(container);
  });
});
