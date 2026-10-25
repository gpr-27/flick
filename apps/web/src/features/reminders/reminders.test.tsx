import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { ENDPOINTS, type Reminder } from '@chat/contracts';
import { fakeApi, installFakeServices, nextId } from '../../../test/fakes';
import { ReminderDialog } from './ReminderDialog';
import { ReminderMark } from './ReminderMark';
import { RemindersDialog } from './RemindersDialog';
import { useReminderStore } from './reminderStore';
import { describeWhen, parsePicked, pickableRange, presets } from './times';
import { toInputValue } from '@/features/scheduled/times';

const NOW = new Date(2026, 5, 10, 14, 30, 0); // local time, so tests do not depend on a time zone

const makeReminder = (over: Partial<Reminder> = {}): Reminder => ({
  id: nextId(),
  conversation_id: nextId(),
  message_id: nextId(),
  note: null,
  remind_at: '2030-01-01T09:00:00.000Z',
  status: 'pending',
  created_at: '2029-12-01T00:00:00.000Z',
  sent_at: null,
  quote: 'bring the passport',
  author_name: 'Priya',
  chat_name: 'Priya',
  message_gone: false,
  ...over,
});

beforeEach(() => {
  useReminderStore.getState().reset();
});

describe('times', () => {
  it('computes the quick picks from a fixed now', () => {
    const list = presets(NOW);
    expect(list.map((p) => p.label)).toEqual([
      'In 1 hour',
      'This evening (6 pm)',
      'Tomorrow 9 am',
      'Next week',
    ]);
    expect(list[0]!.at.getTime()).toBe(NOW.getTime() + 3_600_000);
    expect(toInputValue(list[1]!.at)).toBe('2026-06-10T18:00');
    expect(toInputValue(list[2]!.at)).toBe('2026-06-11T09:00');
    expect(toInputValue(list[3]!.at)).toBe('2026-06-17T09:00');
  });

  it('leaves out this evening once 6 pm has passed or is too close', () => {
    const late = new Date(2026, 5, 10, 17, 59, 0);
    expect(presets(late).map((p) => p.label)).not.toContain('This evening (6 pm)');
  });

  it('refuses times outside the allowed range', () => {
    const { max } = pickableRange(NOW);
    expect(parsePicked('', NOW).ok).toBe(false);
    expect(parsePicked(toInputValue(new Date(NOW.getTime() + 30_000)), NOW).ok).toBe(false);
    expect(parsePicked(toInputValue(new Date(NOW.getTime() + 600_000)), NOW).ok).toBe(true);
    expect(parsePicked(toInputValue(new Date(max.getTime() + 86_400_000)), NOW).ok).toBe(false);
  });

  it('describes today, tomorrow and later', () => {
    expect(describeWhen(new Date(2026, 5, 10, 18, 0), NOW)).toMatch(/^today at/);
    expect(describeWhen(new Date(2026, 5, 11, 9, 0), NOW)).toMatch(/^tomorrow at/);
    expect(describeWhen(new Date(2026, 5, 17, 9, 0), NOW)).toMatch(/^on /);
  });
});

describe('ReminderDialog', () => {
  it('sends the chosen quick pick and note for a message, and adds it to the store', async () => {
    const api = fakeApi();
    const created = makeReminder({ note: 'pack it' });
    api.call.mockResolvedValue(created);
    installFakeServices(undefined, api);
    let closed = false;
    render(
      <ReminderDialog
        open
        now={NOW}
        target={{ conversationId: 'c1', messageId: 'm1' }}
        preview="bring the passport"
        onClose={() => {
          closed = true;
        }}
      />,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Tomorrow 9 am' }));
    await userEvent.type(screen.getByLabelText(/Note/), 'pack it');
    await userEvent.click(screen.getByRole('button', { name: 'Set reminder' }));

    await waitFor(() => {
      expect(closed).toBe(true);
    });
    const [endpoint, args] = api.call.mock.calls[0] as [
      unknown,
      { body: { message_id: string; remind_at: string; note: string } },
    ];
    expect(endpoint).toBe(ENDPOINTS.reminders.create);
    expect(args.body.message_id).toBe('m1');
    expect(args.body.note).toBe('pack it');
    expect(args.body.remind_at).toBe(new Date(2026, 5, 11, 9, 0).toISOString());
    expect(useReminderStore.getState().items).toEqual([created]);
  });

  it('asks about the chat when there is no message, and shows a server error', async () => {
    const api = fakeApi();
    api.call.mockRejectedValue(new Error('nope'));
    installFakeServices(undefined, api);
    render(
      <ReminderDialog
        open
        now={NOW}
        target={{ conversationId: 'c1' }}
        preview="Chat with Priya"
        onClose={() => undefined}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Set reminder' }));
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    const [, args] = api.call.mock.calls[0] as [unknown, { body: Record<string, unknown> }];
    expect(args.body.conversation_id).toBe('c1');
    expect(args.body).not.toHaveProperty('message_id');
  });
});

describe('RemindersDialog', () => {
  it('lists waiting reminders with a quote and cancels one', async () => {
    const waiting = makeReminder({ note: 'before Friday' });
    const gone = makeReminder({ quote: null, message_gone: true, chat_name: 'Dev' });
    const api = fakeApi();
    api.call.mockImplementation((endpoint) =>
      Promise.resolve(
        endpoint === ENDPOINTS.reminders.list
          ? { items: [waiting, gone], next_cursor: null }
          : undefined,
      ),
    );
    installFakeServices(undefined, api);

    render(<RemindersDialog open onClose={() => undefined} />);

    expect(await screen.findByText('"bring the passport"')).toBeInTheDocument();
    expect(screen.getByText('before Friday')).toBeInTheDocument();
    expect(screen.getByText(/was deleted/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Cancel reminder for Priya' }));
    expect(api.call).toHaveBeenCalledWith(ENDPOINTS.reminders.cancel, {
      params: { reminder_id: waiting.id },
    });
    await waitFor(() => {
      expect(screen.queryByText('"bring the passport"')).not.toBeInTheDocument();
    });
  });

  it('shows the empty and the error states', async () => {
    const api = fakeApi();
    api.call.mockResolvedValue({ items: [], next_cursor: null });
    installFakeServices(undefined, api);
    const { unmount } = render(<RemindersDialog open onClose={() => undefined} />);
    expect(await screen.findByText(/No reminders/)).toBeInTheDocument();
    unmount();

    useReminderStore.getState().reset();
    api.call.mockRejectedValue(new Error('down'));
    render(<RemindersDialog open onClose={() => undefined} />);
    expect(await screen.findByRole('alert')).toBeInTheDocument();
  });
});

describe('ReminderMark', () => {
  it('shows only for a message with a waiting reminder', () => {
    const r = makeReminder({ message_id: 'm-with' });
    useReminderStore.setState({
      items: [r, makeReminder({ message_id: 'm-sent', status: 'sent' })],
    });
    const { rerender } = render(<ReminderMark messageId="m-with" />);
    expect(screen.getByRole('img', { name: 'Reminder set' })).toBeInTheDocument();
    rerender(<ReminderMark messageId="m-sent" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    rerender(<ReminderMark messageId="m-none" />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });
});
