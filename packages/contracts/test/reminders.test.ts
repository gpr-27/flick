import { describe, expect, it } from 'vitest';
import { CreateReminderRequest, ENDPOINTS, LIMITS, Reminder } from '../src/index.js';

const id = '6f1c2a54-8d3e-4b7a-9c10-2f5e8a1b3c4d';
const remindAt = '2030-01-01T09:00:00.000Z';

describe('reminders contract', () => {
  it('accepts a message reminder, a chat reminder, and trims the note', () => {
    expect(
      CreateReminderRequest.parse({ message_id: id, remind_at: remindAt, note: ' hi ' }),
    ).toEqual({ message_id: id, remind_at: remindAt, note: 'hi' });
    expect(
      CreateReminderRequest.safeParse({ conversation_id: id, remind_at: remindAt }).success,
    ).toBe(true);
  });

  it('needs a target, a real time and a note within the limit', () => {
    expect(CreateReminderRequest.safeParse({ remind_at: remindAt }).success).toBe(false);
    expect(CreateReminderRequest.safeParse({ message_id: id, remind_at: 'soon' }).success).toBe(
      false,
    );
    expect(CreateReminderRequest.safeParse({ message_id: 'x', remind_at: remindAt }).success).toBe(
      false,
    );
    const note = 'x'.repeat(LIMITS.MAX_REMINDER_NOTE_LENGTH);
    expect(
      CreateReminderRequest.safeParse({ message_id: id, remind_at: remindAt, note }).success,
    ).toBe(true);
    expect(
      CreateReminderRequest.safeParse({ message_id: id, remind_at: remindAt, note: note + 'x' })
        .success,
    ).toBe(false);
    expect(
      CreateReminderRequest.safeParse({ message_id: id, remind_at: remindAt, note: '  ' }).success,
    ).toBe(false);
  });

  it('describes a reminder and lists the three endpoints', () => {
    const reminder = {
      id,
      conversation_id: id,
      message_id: null,
      note: null,
      remind_at: remindAt,
      status: 'pending',
      created_at: remindAt,
      sent_at: null,
      quote: null,
      author_name: null,
      chat_name: 'Priya',
      message_gone: false,
    };
    expect(Reminder.safeParse(reminder).success).toBe(true);
    expect(Reminder.safeParse({ ...reminder, status: 'cancelled' }).success).toBe(false);
    expect(Object.keys(ENDPOINTS.reminders)).toEqual(['create', 'list', 'cancel']);
    expect(ENDPOINTS.reminders.cancel.response).toBeNull();
  });
});
