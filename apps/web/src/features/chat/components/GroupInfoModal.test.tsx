import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/components/ui/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

import { useSessionStore } from '@/features/auth/useSessionStore';
import {
  BOB,
  CONV,
  ME,
  type FakeApi,
  installFakeServices,
  makeConversation,
  makeMessage,
} from '../../../../test/fakes';
import { InvitePage } from '../InvitePage';
import { useChatStore } from '../useChatStore';
import { GroupInfoModal } from './GroupInfoModal';
import { InviteLinkSection } from './InviteLinkSection';
import { SharedTab } from './SharedTab';

const CODE = 'abcdefghij1234567890';
const user = (id: string, name: string) => ({
  id,
  username: name.toLowerCase(),
  display_name: name,
  avatar_url: null,
  is_bot: false,
});

let api: FakeApi;
beforeEach(() => {
  vi.clearAllMocks();
  ({ api } = installFakeServices());
  useSessionStore.setState({ user: { id: ME } as never, status: 'authenticated' });
  useChatStore.getState().reset();
});

const group = (role: 'owner' | 'admin' | 'member') =>
  makeConversation({
    type: 'group',
    title: 'Team',
    peer: null,
    description: 'Weekly notes',
    my_role: role,
    member_count: 2,
  });

const stubMembers = () =>
  api.call.mockImplementation((endpoint: unknown) => {
    const { path } = endpoint as { path: string };
    if (path.endsWith('/members')) {
      return Promise.resolve({
        items: [
          { user: user(ME, 'Me'), role: 'owner', joined_at: '2026-01-01T00:00:00.000Z' },
          { user: user(BOB, 'Bob'), role: 'member', joined_at: '2026-01-02T00:00:00.000Z' },
        ],
        next_cursor: null,
      });
    }
    return Promise.resolve(undefined);
  });

describe('GroupInfoModal', () => {
  it('shows role badges and lets an admin promote a member', async () => {
    stubMembers();
    render(<GroupInfoModal conversation={group('owner')} open onClose={vi.fn()} />);
    expect(await screen.findByText('Owner')).toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Make Bob admin' }));
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/conversations/:conversation_id/members/:user_id' }),
      expect.objectContaining({ body: { role: 'admin' } }),
    );
  });

  it('saves a new name and description in one request', async () => {
    stubMembers();
    render(<GroupInfoModal conversation={group('admin')} open onClose={vi.fn()} />);
    const description = screen.getByLabelText('Group description');
    await userEvent.clear(description);
    await userEvent.type(description, 'New text');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH', path: '/conversations/:conversation_id' }),
      expect.objectContaining({ body: { description: 'New text' } }),
    );
  });

  it('flips a group switch', async () => {
    stubMembers();
    render(<GroupInfoModal conversation={group('owner')} open onClose={vi.fn()} />);
    await userEvent.click(screen.getByLabelText('Only admins can send messages'));
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'PATCH' }),
      expect.objectContaining({ body: { settings: { only_admins_send: true } } }),
    );
  });

  it('hides admin tools from a member and locks info when only admins may edit it', () => {
    stubMembers();
    const c = group('member');
    c.settings.only_admins_edit_info = true;
    render(<GroupInfoModal conversation={c} open onClose={vi.fn()} />);
    expect(screen.queryByLabelText('Group name')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Create invite link' })).toBeNull();
    expect(screen.getByText('Weekly notes')).toBeInTheDocument();
  });

  it('asks before leaving', async () => {
    stubMembers();
    const onClose = vi.fn();
    render(<GroupInfoModal conversation={group('member')} open onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Leave group' }));
    expect(api.call).not.toHaveBeenCalledWith(
      expect.objectContaining({ path: '/conversations/:conversation_id/leave' }),
      expect.anything(),
    );
    await userEvent.click(screen.getByRole('button', { name: 'Stay' }));
    await userEvent.click(screen.getByRole('button', { name: 'Leave group' }));
    await userEvent.click(screen.getByRole('button', { name: 'Leave' }));
    expect(onClose).toHaveBeenCalled();
    expect(api.call).toHaveBeenCalledWith(
      expect.objectContaining({ path: '/conversations/:conversation_id/leave' }),
      expect.anything(),
    );
  });
});

describe('InviteLinkSection', () => {
  it('creates, copies, resets and revokes the link', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    const second = 'zyxwvutsrq0987654321';
    api.call
      .mockResolvedValueOnce({ code: CODE, conversation_id: CONV, expires_at: null })
      .mockResolvedValueOnce({ code: second, conversation_id: CONV, expires_at: null });
    render(<InviteLinkSection conversationId={CONV} />);

    await userEvent.click(screen.getByRole('button', { name: /create invite link/i }));
    await userEvent.click(await screen.findByRole('button', { name: 'Copy invite link' }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/join/${CODE}`);

    await userEvent.click(screen.getByRole('button', { name: 'Reset link' }));
    await waitFor(() => {
      expect(screen.getByRole('textbox', { name: 'Invite link' })).toHaveValue(
        `${window.location.origin}/join/${second}`,
      );
    });
    // The old code is revoked after the new one exists.
    expect(api.call).toHaveBeenLastCalledWith(expect.anything(), { params: { code: CODE } });

    await userEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => {
      expect(screen.queryByRole('textbox', { name: 'Invite link' })).toBeNull();
    });
  });
});

describe('SharedTab', () => {
  it('lists links, and asks the server for another kind when a tab is chosen', async () => {
    api.call.mockResolvedValue({
      items: [
        makeMessage({
          content: { type: 'text', text: 'read https://example.com/post today' },
        }),
      ],
      next_cursor: null,
    });
    render(<SharedTab conversationId={CONV} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Links' }));
    const link = await screen.findByRole('link', { name: 'https://example.com/post' });
    expect(link).toHaveAttribute('href', 'https://example.com/post');
    expect(api.call.mock.lastCall?.[1]).toMatchObject({ query: { kind: 'links' } });
  });

  it('says so when a list is empty', async () => {
    api.call.mockResolvedValue({ items: [], next_cursor: null });
    render(<SharedTab conversationId={CONV} />);
    expect(await screen.findByText('No photos or videos yet.')).toBeInTheDocument();
  });
});

describe('InvitePage', () => {
  const open = () =>
    render(
      <MemoryRouter initialEntries={[`/join/${CODE}`]}>
        <Routes>
          <Route path="/join/:code" element={<InvitePage />} />
          <Route path="/" element={<p>home</p>} />
        </Routes>
      </MemoryRouter>,
    );

  it('shows the group and joins it', async () => {
    api.call
      .mockResolvedValueOnce({
        conversation_id: CONV,
        title: 'Team',
        avatar_url: null,
        member_count: 4,
        approval_required: false,
      })
      .mockResolvedValueOnce({ status: 'joined', conversation_id: CONV })
      .mockResolvedValue({ items: [], next_cursor: null });
    open();
    expect(await screen.findByRole('heading', { name: 'Team' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Join group' }));
    expect(await screen.findByText('home')).toBeInTheDocument();
  });

  it('says a bad link is not valid', async () => {
    api.call.mockRejectedValue(new Error('nope'));
    open();
    expect(await screen.findByText('Link not valid')).toBeInTheDocument();
  });
});
