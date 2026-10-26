import { describe, expect, it } from 'vitest';
import type { ConversationSummary } from '@chat/contracts';
import { messageHint, needsReply } from './heuristics';

describe('messageHint', () => {
  it('flags urgent, upset and shouting text, and leaves normal text alone', () => {
    expect(messageHint('call me asap')).toBe('urgent');
    expect(messageHint('where are you!!!')).toBe('urgent');
    expect(messageHint('this is unacceptable')).toBe('upset');
    expect(messageHint('YOU NEVER LISTEN TO ME')).toBe('upset');
    expect(messageHint('see you at 5')).toBeNull();
  });
});

describe('needsReply', () => {
  const conv = (sender: string, ageHours: number) =>
    ({
      is_saved: false,
      prefs: { archived: false },
      last_message: {
        sender_user_id: sender,
        created_at: new Date(Date.now() - ageHours * 3_600_000).toISOString(),
      },
    }) as unknown as ConversationSummary;
  it('needs the other person last and more than 2 hours', () => {
    expect(needsReply(conv('other', 3), 'me')).toBe(true);
    expect(needsReply(conv('other', 1), 'me')).toBe(false);
    expect(needsReply(conv('me', 5), 'me')).toBe(false);
  });
});
