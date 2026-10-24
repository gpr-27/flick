import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallStore } from '@/features/calls/useCallStore';
import { useChatStore } from '@/features/chat/useChatStore';
import {
  BOB,
  CONV,
  type FakeApi,
  installFakeServices,
  makeConversation,
  nextId,
} from '../../../test/fakes';
import { CallLogPage } from './CallLogPage';
import { formatCallDuration } from './format';

const entry = (over: Record<string, unknown>) => ({
  call_id: nextId(),
  conversation_id: CONV,
  media: 'audio',
  group: false,
  direction: 'incoming',
  outcome: 'ended',
  started_at: new Date().toISOString(),
  duration_s: 75,
  participant_ids: [BOB],
  ...over,
});

let api: FakeApi;
beforeEach(() => {
  ({ api } = installFakeServices());
  useChatStore.getState().reset();
  const conv = makeConversation();
  useChatStore.setState({ conversations: { [conv.id]: conv } });
});

const open = () =>
  render(
    <MemoryRouter>
      <CallLogPage />
    </MemoryRouter>,
  );

describe('call log', () => {
  it('lists missed, incoming and outgoing calls with durations', async () => {
    api.call.mockResolvedValue({
      items: [
        entry({ outcome: 'missed', duration_s: 0 }),
        entry({ direction: 'outgoing', media: 'video' }),
        entry({ group: true, direction: 'incoming' }),
      ],
      next_cursor: null,
    });
    open();
    expect(await screen.findByText(/Missed voice call/)).toBeInTheDocument();
    expect(screen.getByText(/Outgoing video call.*1:15/)).toBeInTheDocument();
    expect(screen.getByText(/Incoming group call/)).toBeInTheDocument();
  });

  it('calls back a 1:1 call (not a group call)', async () => {
    const initiateCall = vi.spyOn(useCallStore.getState(), 'initiateCall').mockResolvedValue();
    api.call.mockResolvedValue({
      items: [entry({ media: 'video' }), entry({ group: true })],
      next_cursor: null,
    });
    open();
    const buttons = await screen.findAllByRole('button', { name: /back/i });
    expect(buttons).toHaveLength(1);
    await userEvent.click(buttons[0] as HTMLElement);
    expect(initiateCall).toHaveBeenCalledWith(CONV, expect.objectContaining({ id: BOB }), 'video');
  });

  it('shows an empty state and an error state', async () => {
    api.call.mockResolvedValueOnce({ items: [], next_cursor: null });
    const { unmount } = open();
    expect(await screen.findByText('No calls yet')).toBeInTheDocument();
    unmount();
    api.call.mockRejectedValueOnce(new Error('boom'));
    open();
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });

  it('formats durations', () => {
    expect(formatCallDuration(75)).toBe('1:15');
    expect(formatCallDuration(3725)).toBe('1:02:05');
  });
});
