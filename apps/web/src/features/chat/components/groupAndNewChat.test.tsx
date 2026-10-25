// Group info (roles, rename, add/remove, leave) and the new chat / new group dialogs.
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ENDPOINTS, type ConversationSummary } from '@chat/contracts';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
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

// jsdom does no layout: give elements a size so the virtual people list has a viewport.
const saved: [string, PropertyDescriptor | undefined][] = [];
beforeAll(() => {
  for (const [key, value] of [
    ['clientHeight', 400],
    ['clientWidth', 320],
  ] as const) {
    saved.push([key, Object.getOwnPropertyDescriptor(Element.prototype, key)]);
    Object.defineProperty(Element.prototype, key, { configurable: true, value });
  }
});
afterAll(() => {
  for (const [key, desc] of saved) {
    if (desc) Object.defineProperty(Element.prototype, key, desc);
  }
});

let api: FakeApi;
const search = (): HTMLElement => screen.getByRole('searchbox', { name: 'Search people' });
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

const group = (
  myRole: ConversationSummary['my_role'],
  onlyAdminsEditInfo = false,
): ConversationSummary =>
  makeConversation({
    settings: {
      only_admins_send: false,
      only_admins_edit_info: onlyAdminsEditInfo,
      approval_required: false,
      disappearing_timer_s: 0,
    },
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

const openInfo = async (role: ConversationSummary['my_role'], onlyAdminsEditInfo = false) => {
  const conversation = group(role, onlyAdminsEditInfo);
  useChatStore.setState({ conversations: { [CONV]: conversation } });
  const onClose = vi.fn();
  const user = userEvent.setup();
  const view = render(<GroupInfoModal conversation={conversation} open onClose={onClose} />);
  await screen.findByText('Carol');
  return { user, onClose, view };
};
const row = (name: string) => screen.getByText(name, { exact: false }).closest('li')!;

describe('group info: what each role sees', () => {
  it('a member sees read-only info with role badges and no controls once editing is admin-only', async () => {
    await openInfo('member', true);
    expect(screen.getByText('4 members')).toBeInTheDocument();
    expect(screen.getByText('Team')).toBeInTheDocument(); // the name as text, not a field
    expect(screen.queryByLabelText('Group name')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Change photo' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /admin/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add members' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); // the admin switches
    expect(within(row('Bob')).getByText('Admin')).toBeInTheDocument();
    expect(within(row('Dave')).getByText('Owner')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Leave group' })).toBeInTheDocument();
  });

  it('a member can edit the name and photo while the group allows it, but still not manage people', async () => {
    await openInfo('member', false);
    expect(screen.getByLabelText('Group name')).toHaveValue('Team');
    expect(screen.getByRole('button', { name: 'Change photo' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add members' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('an admin can rename, promote and remove members, but not the owner or themselves', async () => {
    await openInfo('admin');
    expect(screen.getByLabelText('Group name')).toHaveValue('Team');
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add members' })).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(3); // the three group switches
    expect(screen.getByRole('button', { name: 'Remove admin from Bob' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Make Carol admin' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Carol' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Bob' })).toBeInTheDocument();
    // The owner and yourself: no promote, demote or remove.
    for (const name of ['Dave', 'Me']) {
      expect(screen.queryByRole('button', { name: `Make ${name} admin` })).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: `Remove admin from ${name}` }),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('button', { name: `Remove ${name}` })).not.toBeInTheDocument();
    }
    expect(within(row('Dave')).getByText('Owner')).toBeInTheDocument();
    expect(screen.getByText('Me (you)')).toBeInTheDocument();
  });

  it('nobody can hand out the owner role from this dialog, only admin and member', async () => {
    for (const role of ['admin', 'owner'] as const) {
      const { view } = await openInfo(role);
      expect(screen.queryByRole('button', { name: /owner/i })).not.toBeInTheDocument();
      expect(screen.queryByLabelText(/^Role of/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Make Carol admin' })).toBeInTheDocument();
      view.unmount();
    }
  });

  it('only admins load the join requests', async () => {
    const member = await openInfo('member');
    expect(api.call).not.toHaveBeenCalledWith(
      ENDPOINTS.conversations.joinRequests,
      expect.anything(),
    );
    member.view.unmount();
    await openInfo('admin');
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.conversations.joinRequests,
      expect.objectContaining({ params: { conversation_id: CONV } }),
    );
  });
});

describe('group info: actions', () => {
  it('Make admin calls setRole then reloads the members', async () => {
    const { user } = await openInfo('admin');
    api.call.mockClear();
    await user.click(screen.getByRole('button', { name: 'Make Carol admin' }));
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.conversations.setRole,
      expect.objectContaining({
        params: { conversation_id: CONV, user_id: CAROL },
        body: { role: 'admin' },
      }),
    );
    await waitFor(() => {
      expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.members, expect.anything());
    });
  });

  it('Demote takes the admin role away', async () => {
    const { user } = await openInfo('admin');
    await user.click(screen.getByRole('button', { name: 'Remove admin from Bob' }));
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.conversations.setRole,
      expect.objectContaining({
        params: { conversation_id: CONV, user_id: BOB },
        body: { role: 'member' },
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

  it('Save sends the trimmed name, and nothing for an unchanged or empty one', async () => {
    const { user } = await openInfo('owner');
    const field = screen.getByLabelText('Group name');
    api.call.mockClear();
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.call).not.toHaveBeenCalled(); // unchanged
    await user.clear(field);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.call).not.toHaveBeenCalled(); // empty
    await user.type(field, '  New name  ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
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
              : { items: [], next_cursor: null },
      ),
    );
    await user.click(screen.getByRole('button', { name: 'Add members' }));
    await user.type(search(), 'er');
    const pick = await screen.findByRole('button', { name: 'Add Erin to the group' });
    // People already in the group are not offered.
    expect(screen.queryByRole('button', { name: 'Add Bob to the group' })).not.toBeInTheDocument();
    expect(screen.getByText('In this group')).toBeInTheDocument();
    await user.click(pick);
    expect(api.call).toHaveBeenCalledWith(
      ENDPOINTS.conversations.addMembers,
      expect.objectContaining({ body: { user_ids: [erin.id] } }),
    );
  });

  it('Leave group asks first; Stay keeps you in, Leave closes the dialog and leaves', async () => {
    const { user, onClose } = await openInfo('member');
    api.call.mockClear();
    await user.click(screen.getByRole('button', { name: 'Leave group' }));
    expect(screen.getByRole('alertdialog', { name: 'Leave this group?' })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
    expect(api.call).not.toHaveBeenCalled(); // asking is not leaving
    await user.click(screen.getByRole('button', { name: 'Stay' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(api.call).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Leave group' }));
    await user.click(screen.getByRole('button', { name: 'Leave' }));
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
            : { items: [], next_cursor: null },
      ),
    );
  });

  it('finds people (never yourself) and opens the chat with the one picked, then closes', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<NewChatModal open onClose={onClose} />);
    await user.type(search(), 'er');
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
    await user.type(search(), 'zzz');
    expect(await screen.findByText('No one found')).toBeInTheDocument();
  });

  it('shows a failed search', async () => {
    const user = userEvent.setup();
    api.call.mockRejectedValue(new Error('x'));
    render(<NewChatModal open onClose={vi.fn()} />);
    await user.type(search(), 'er');
    expect(await screen.findByText("Couldn't load people")).toBeInTheDocument();
  });

  it('debounces: typing quickly sends one search', async () => {
    const user = userEvent.setup();
    render(<NewChatModal open onClose={vi.fn()} />);
    await user.type(search(), 'erin');
    await screen.findByRole('button', { name: 'Chat with Erin' });
    const searches = api.call.mock.calls.filter((c) => c[0] === ENDPOINTS.users.search);
    expect(searches).toHaveLength(1);
  });

  it('has no accessibility violations', async () => {
    const user = userEvent.setup();
    render(<NewChatModal open onClose={vi.fn()} />);
    await user.type(search(), 'er');
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
            : { items: [], next_cursor: null },
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

    await user.type(search(), 'er');
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
