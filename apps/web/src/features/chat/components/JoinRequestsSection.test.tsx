import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ENDPOINTS } from '@chat/contracts';
import { BOB, CONV, fakeApi, installFakeServices, makeConversation } from '../../../../test/fakes';
import { useChatStore } from '../useChatStore';
import { GroupInfoModal } from './GroupInfoModal';
import { JoinRequestsSection } from './JoinRequestsSection';

const user = { id: BOB, username: 'bob', display_name: 'Bob', avatar_url: null, is_bot: false };
const page = {
  items: [{ id: 'req-1', user, created_at: '2026-01-01T00:00:00.000Z' }],
  next_cursor: null,
};

const serve = () => {
  const api = fakeApi();
  api.call.mockImplementation((endpoint) =>
    Promise.resolve(
      endpoint === ENDPOINTS.conversations.joinRequests
        ? page
        : endpoint === ENDPOINTS.conversations.decideJoinRequest
          ? null
          : { items: [], next_cursor: null },
    ),
  );
  installFakeServices(undefined, api);
  return api;
};

describe('JoinRequestsSection', () => {
  it('lists requests with a count and approves one', async () => {
    const api = serve();
    render(<JoinRequestsSection conversationId={CONV} />);

    expect(await screen.findByLabelText('1 pending')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Approve Bob' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.decideJoinRequest, {
      params: { conversation_id: CONV, request_id: 'req-1' },
      body: { approve: true },
    });
    await waitFor(() => {
      expect(screen.getByText('No one is waiting to join.')).toBeInTheDocument();
    });
  });

  it('denies a request', async () => {
    const api = serve();
    render(<JoinRequestsSection conversationId={CONV} />);
    await userEvent.click(await screen.findByRole('button', { name: 'Deny Bob' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.conversations.decideJoinRequest, {
      params: { conversation_id: CONV, request_id: 'req-1' },
      body: { approve: false },
    });
  });

  it('shows an error with retry', async () => {
    const api = fakeApi();
    api.call.mockRejectedValue(new Error('x'));
    installFakeServices(undefined, api);
    render(<JoinRequestsSection conversationId={CONV} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });
});

describe('GroupInfoModal join requests', () => {
  const open = (role: 'member' | 'admin') => {
    const api = serve();
    useChatStore.setState({ members: { [CONV]: [] } });
    const conversation = makeConversation({ type: 'group', title: 'G', peer: null, my_role: role });
    render(<GroupInfoModal conversation={conversation} open onClose={() => {}} />);
    return api;
  };

  it('shows the section to admins', async () => {
    open('admin');
    expect(await screen.findByRole('heading', { name: /Join requests/ })).toBeInTheDocument();
  });

  it('never shows it, or asks for it, for plain members', () => {
    const api = open('member');
    expect(screen.queryByRole('heading', { name: /Join requests/ })).not.toBeInTheDocument();
    expect(api.call).not.toHaveBeenCalledWith(
      ENDPOINTS.conversations.joinRequests,
      expect.anything(),
    );
  });
});
