import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ENDPOINTS, LIMITS } from '@chat/contracts';
import { useChatStore } from '@/features/chat/useChatStore';
import { fakeApi, installFakeServices, makeConversation, nextId } from '../../../test/fakes';
import { ScheduleDialog } from './ScheduleDialog';
import { ScheduledDialog } from './ScheduledDialog';
import { parsePicked, pickableRange, presets, toInputValue } from './times';

const NOW = new Date(2026, 5, 10, 14, 30, 0); // local time, so the tests do not depend on a time zone

describe('times', () => {
  it('formats a date for the datetime-local field in local time', () => {
    expect(toInputValue(new Date(2026, 0, 5, 9, 7))).toBe('2026-01-05T09:07');
  });

  it('offers in-an-hour and tomorrow-at-nine', () => {
    const [hour, tomorrow] = presets(NOW);
    expect(hour?.at.getTime()).toBe(NOW.getTime() + 3_600_000);
    expect(toInputValue(tomorrow!.at)).toBe('2026-06-11T09:00');
  });

  it('accepts a time in range and explains why it refuses the others', () => {
    const { min, max } = pickableRange(NOW);
    expect(parsePicked(toInputValue(new Date(NOW.getTime() + 3_600_000)), NOW).ok).toBe(true);
    expect(parsePicked('', NOW)).toEqual({ ok: false, error: 'Pick a date and time.' });
    expect(parsePicked(toInputValue(new Date(NOW.getTime() + 30_000)), NOW).ok).toBe(false);
    expect(parsePicked(toInputValue(new Date(max.getTime() + 86_400_000)), NOW)).toEqual({
      ok: false,
      error: 'Pick a time within the next year.',
    });
    expect(min.getTime() - NOW.getTime()).toBeGreaterThan(LIMITS.SCHEDULE_MIN_LEAD_S * 1000);
  });
});

describe('ScheduleDialog', () => {
  it('sends the typed text and the chosen time to the server, then reports back', async () => {
    const api = fakeApi();
    installFakeServices(undefined, api);
    const conversation = makeConversation();
    let scheduled = false;
    render(
      <ScheduleDialog
        conversation={conversation}
        text="see you soon"
        open
        onClose={() => undefined}
        onScheduled={() => {
          scheduled = true;
        }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'In 1 hour' }));
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));

    await waitFor(() => {
      expect(scheduled).toBe(true);
    });
    const [endpoint, args] = api.call.mock.calls[0] as [
      unknown,
      { params: object; body: { text: string; send_at: string } },
    ];
    expect(endpoint).toBe(ENDPOINTS.scheduled.create);
    expect(args.params).toEqual({ conversation_id: conversation.id });
    expect(args.body.text).toBe('see you soon');
    const lead = new Date(args.body.send_at).getTime() - Date.now();
    expect(lead).toBeGreaterThan(55 * 60_000);
    expect(lead).toBeLessThan(65 * 60_000);
  });

  it('keeps the dialog open and shows the server error when scheduling fails', async () => {
    const api = fakeApi();
    api.call.mockRejectedValue(new Error('nope'));
    installFakeServices(undefined, api);
    let scheduled = false;
    render(
      <ScheduleDialog
        conversation={makeConversation()}
        text="hello"
        open
        onClose={() => undefined}
        onScheduled={() => {
          scheduled = true;
        }}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Schedule' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(scheduled).toBe(false);
  });
});

describe('ScheduledDialog', () => {
  beforeEach(() => {
    useChatStore.getState().reset();
  });

  it('lists scheduled messages and cancels one', async () => {
    const conversation = makeConversation();
    useChatStore.setState({ conversations: { [conversation.id]: conversation } });
    const waiting = {
      id: nextId(),
      conversation_id: conversation.id,
      text: 'happy birthday',
      send_at: '2030-01-01T00:00:00.000Z',
      status: 'pending',
      failed_reason: null,
      created_at: '2029-12-01T00:00:00.000Z',
    };
    const failed = {
      ...waiting,
      id: nextId(),
      text: 'late one',
      status: 'failed',
      failed_reason: 'You are no longer in this chat.',
    };
    const api = fakeApi();
    api.call.mockImplementation((endpoint) =>
      Promise.resolve(
        endpoint === ENDPOINTS.scheduled.list ? { items: [waiting, failed] } : undefined,
      ),
    );
    installFakeServices(undefined, api);

    render(<ScheduledDialog open onClose={() => undefined} />);

    expect(await screen.findByText('happy birthday')).toBeInTheDocument();
    expect(screen.getByText(/You are no longer in this chat/)).toBeInTheDocument();

    await userEvent.click(screen.getAllByRole('button', { name: /Cancel scheduled message/ })[0]!);
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.scheduled.cancel, {
      params: { scheduled_id: waiting.id },
    });
    await waitFor(() => {
      expect(screen.queryByText('happy birthday')).not.toBeInTheDocument();
    });
    expect(screen.getByText('late one')).toBeInTheDocument();
  });

  it('says so when nothing is scheduled', async () => {
    const api = fakeApi();
    api.call.mockResolvedValue({ items: [] });
    installFakeServices(undefined, api);
    render(<ScheduledDialog open onClose={() => undefined} />);
    expect(await screen.findByText(/Nothing scheduled/)).toBeInTheDocument();
  });
});
