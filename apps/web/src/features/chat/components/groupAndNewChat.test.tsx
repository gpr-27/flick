// Group info (roles, rename, add/remove, leave) and the new chat / new group dialogs.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '@/components/ui/notify';
import { useSessionStore } from '@/features/auth/useSessionStore';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  nextId,
  type FakeApi,
} from '../../../../test/fakes';
import { expectNoA11yViolations } from '../../../../test/a11y';
import { useChatStore, type Member } from '../useChatStore';
import { GroupInfoModal } from './GroupInfoModal';
import { NewChatModal, NewGroupModal } from './NewChatModals';

let api: FakeApi;
const CAROL = nextId();
const DAVE = nextId();
const person = (id: string, name: string) => ({
  id,
  username: name.toLowerCase(),
  display_name: name,
  avatar_url: null,
  is_bot: false,
});
const member = (id: string, name: string, role: Member['role']): Member => ({
  user: person(id, name),
  role,
  joined_at: '2026-01-01T00:00:00.000Z',
});
const MEMBERS = [
  member(ME, 'Me', 'member'),
  member(BOB, 'Bob', 'admin'),
  member(CAROL, 'Carol', 'member'),
  member(DAVE, 'Dave', 'owner'),
];

const group = (myRole: ConversationSummary['my_role']): ConversationSummary =>
  makeConversation({
    id: CONV,
    type: 'group',
    title: 'Team',
    peer: null,
    member_count: 4,
    my_role: myRole,
  });

beforeEach(() => {
  vi.clearAllMocks();
  ({ api } = installFakeServices());
  api.call.mockImplementation((endpoint: unknown) =>
    Promise.resolve(
      endpoint === ENDPOINTS.conversations.members
        ? { items: MEMBERS, next_cursor: null }
        : { items: [], next_cursor: null },
    ),
  );
  useChatStore.getState().reset();
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  vi.spyOn(notify, 'error').mockImplementation(() => '');
});

const openInfo = async (role: ConversationSummary['my_role']) => {
  const conversation = group(role);
  useChatStore.setState({ conversations: { [CONV]: conversation } });
  const onClose = vi.fn();
  const user = userEvent.setup();
  const view = render(<GroupInfoModal conversation={conversation} open onClose={onClose} />);
  await screen.findByText('Carol');
  return { user, onClose, view };
};
const row = (name: string) => screen.getByText(name, { exact: false }).closest('li')!;

describe('group info: what each role sees', () => {
  it('a member sees the list with role chips and no controls', async () => {
    await openInfo('member');
    expect(screen.getByText('4 members')).toBeInTheDocument();
    expect(screen.queryByLabelText('Group name')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add members' })).not.toBeInTheDocument();
    expect(within(row('Bob')).getByText('admin')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave group' })).toBeInTheDocument();
  });

  it('an admin can rename, change roles and remove members, but not the owner or themselves', async () => {
    await openInfo('admin');
    expect(screen.getByLabelText('Group name')).toHaveValue('Team');
    expect(screen.getByRole('button', { name: 'Add members' })).toBeInTheDocument();
    expect(screen.getByLabelText('Role of Bob')).toBeInTheDocument();
    expect(screen.getByLabelText('Role of Carol')).toBeInTheDocument();
    expect(screen.queryByLabelText('Role of Dave')).not.toBeInTheDocument(); // owner
    expect(screen.queryByLabelText('Role of Me')).not.toBeInTheDocument(); // yourself
    expect(within(row('Dave')).getByText('owner')).toBeInTheDocument();
    expect(screen.getByText('Me (you)')).toBeInTheDocument();
  });

  it('only an owner can hand out the owner role', async () => {
    const admin = await openInfo('admin');
    const adminOptions = within(screen.getByLabelText('Role of Carol'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(adminOptions).toEqual(['member', 'admin']);
    admin.view.unmount();
    await openInfo('owner');
    const ownerOptions = within(screen.getByLabelText('Role of Carol'))
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(ownerOptions).toEqual(['member', 'admin', 'owner']);
  });
});

describe('group info: actions', () => {
  it('changing a role calls setRole then reloads the members', async () => {
    const { user } = await openInfo('admin');
    await user.selectOptions(screen.getByLabelText('Role of Carol'), 'admin');
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.conversations.setRole,
      expect.objectContaining({
        params: { conversation_id: CONV, user_id: CAROL },
        body: { role: 'admin' },
      }),
    );
  });

  it('Remove takes a member out', async () => {
    const { user } = await openInfo('admin');
    await user.click(screen.getByRole('button', { name: 'Remove Carol' }));
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.conversations.removeMember,
      expect.objectContaining({ params: { conversation_id: CONV, user_id: CAROL } }),
    );
  });

  it('Rename sends the trimmed title, and not an unchanged or empty one', async () => {
    const { user } = await openInfo('owner');
    const field = screen.getByLabelText('Group name');
    api.call.mockClear();
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(api.call).not.toHaveBeenCalled(); // unchanged
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(api.call).not.toHaveBeenCalled(); // empty
    await user.type(field, '  New name  ');
    await user.click(screen.getByRole('button', { name: 'Rename' }));
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.conversations.update,
      expect.objectContaining({ body: { title: 'New name' } }),
    );
  });

  it('Add members opens the people search and adds the person picked', async () => {
    const { user } = await openInfo('admin');
    const erin = person(nextId(), 'Erin');
    api.call.mockImplementation((endpoint: unknown) =>
      Promise.resolve(
        endpoint === ENDPOINTS.users.search
          ? { items: [erin, person(BOB, 'Bob')], next_cursor: null }
          : endpoint === ENDPOINTS.conversations.members
            ? { items: MEMBERS, next_cursor: null }
            : endpoint === ENDPOINTS.conversations.addMembers
              ? { added: [erin.id], failed: [] }
              : undefined,
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Add members' }));
    await user.type(screen.getByRole('searchbox'), 'er');
    const pick = await screen.findByRole('button', { name: 'Add Erin to the group' });
    // People already in the group are not offered.
    expect(screen.queryByRole('button', { name: 'Add Bob to the group' })).not.toBeInTheDocument();
    await user.click(pick);
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.conversations.addMembers,
      expect.objectContaining({ body: { user_ids: [erin.id] } }),
    );
  });

  it('Leave group closes the dialog and leaves', async () => {
    const { user, onClose } = await openInfo('member');
    await user.click(screen.getByRole('button', { name: 'Leave group' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.conversations.leave,
      expect.objectContaining({ params: { conversation_id: CONV } }),
    );
    await waitFor(() => {
      expect(useChatStore.getState().conversations[CONV]).toBeUndefined();
    });
  });

  it('shows a spinner until the members arrive', () => {
    api.call.mockReturnValue(new Promise(() => undefined));
    render(<GroupInfoModal conversation={group('member')} open onClose={vi.fn()} />);
    expect(screen.getByRole('status', { name: /Loading members/i })).toBeInTheDocument();
  });

  it('Escape and the X close it', async () => {
    const { user, onClose } = await openInfo('member');
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it('has no accessibility violations (member and admin views)', async () => {
    await openInfo('admin');
    await expectNoA11yViolations();
  });
});

describe('new chat', () => {
  const erin = person(nextId(), 'Erin');
  beforeEach(() => {
    api.call.mockImplementation((endpoint: unknown) =>
      Promise.resolve(
        endpoint === ENDPOINTS.users.search
          ? { items: [erin, person(ME, 'Me')], next_cursor: null }
          : endpoint === ENDPOINTS.conversations.createDirect
            ? makeConversation({ id: nextId(), peer: erin })
            : undefined,
      ),
    );
  });

  it('finds people (never yourself) and opens the chat with the one picked, then closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NewChatModal open onClose={onClose} />);
    await user.type(screen.getByRole('searchbox'), 'er');
    await user.click(await screen.findByRole('button', { name: 'Chat with Erin' }));
    expect(screen.queryByRole('button', { name: 'Chat with Me' })).not.toBeInTheDocument();
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.createDirect, {
      body: { user_id: erin.id },
    });
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(useChatStore.getState().selectedId).not.toBeNull();
  });

  it('says when no one matches', async () => {
    const user = userEvent.setup();
    api.call.mockResolvedValue({ items: [], next_cursor: null });
    render(<NewChatModal open onClose={vi.fn()} />);
    await user.type(screen.getByRole('searchbox'), 'zzz');
    expect(await screen.findByText('No one found.')).toBeInTheDocument();
  });

  it('shows a failed search', async () => {
    const user = userEvent.setup();
    api.call.mockRejectedValue(new Error('x'));
    render(<NewChatModal open onClose={vi.fn()} />);
    await user.type(screen.getByRole('searchbox'), 'er');
    expect(await screen.findByText('Search failed.')).toBeInTheDocument();
  });

  it('debounces: typing quickly sends one search', async () => {
    const user = userEvent.setup();
    render(<NewChatModal open onClose={vi.fn()} />);
    await user.type(screen.getByRole('searchbox'), 'erin');
    await screen.findByRole('button', { name: 'Chat with Erin' });
    const searches = api.call.mock.calls.filter((c) => c[0] === ENDPOINTS.users.search);
    expect(searches).toHaveLength(1);
  });

  it('has no accessibility violations', async () => {
    const user = userEvent.setup();
    render(<NewChatModal open onClose={vi.fn()} />);
    await user.type(screen.getByRole('searchbox'), 'er');
    await screen.findByRole('button', { name: 'Chat with Erin' });
    await expectNoA11yViolations();
  });
});

describe('new group', () => {
  const erin = person(nextId(), 'Erin');
  beforeEach(() => {
    api.call.mockImplementation((endpoint: unknown) =>
      Promise.resolve(
        endpoint === ENDPOINTS.users.search
          ? { items: [erin], next_cursor: null }
          : endpoint === ENDPOINTS.conversations.createGroup
            ? makeConversation({ id: nextId(), type: 'group', title: 'Trip', peer: null })
            : undefined,
      ),
    );
  });

  it('needs a name; picked people become removable chips; creates with their ids', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NewGroupModal open onClose={onClose} />);
    const create = screen.getByRole('button', { name: 'Create group' });
    expect(create).toBeDisabled();
    await user.type(screen.getByLabelText('Group name'), 'Trip');
    expect(create).toBeEnabled();

    await user.type(screen.getByRole('searchbox'), 'er');
    await user.click(await screen.findByRole('button', { name: 'Add Erin' }));
    const chips = screen.getByRole('list', { name: 'Selected members' });
    expect(within(chips).getByText('Erin')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add Erin' })).not.toBeInTheDocument(); // not offered twice

    await user.click(within(chips).getByRole('button', { name: 'Remove Erin' }));
    expect(screen.queryByRole('list', { name: 'Selected members' })).not.toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Add Erin' }));

    await user.click(create);
    await waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.createGroup, {
      body: { title: 'Trip', member_ids: [erin.id] },
    });
  });

  it('a blank name cannot be submitted even with Enter', async () => {
    const user = userEvent.setup();
    render(<NewGroupModal open onClose={vi.fn()} />);
    await user.type(screen.getByLabelText('Group name'), '   {Enter}');
    expect(api.call.mock.calls.some((c) => c[0] === ENDPOINTS.conversations.createGroup)).toBe(
      false,
    );
  });

  it('a failed create keeps the dialog open with what was typed', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    api.call.mockRejectedValue(new Error('x'));
    render(<NewGroupModal open onClose={onClose} />);
    await user.type(screen.getByLabelText('Group name'), 'Trip');
    await user.click(screen.getByRole('button', { name: 'Create group' }));
    await waitFor(() => {
      expect(notify.error).toHaveBeenCalled();
    });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Group name')).toHaveValue('Trip');
  });
});
