import { describe, expect, it } from 'vitest';
import { ME, makeConversation, newMessageEvent } from '../../../test/fakes';
import { applyEventToSummary } from './threadOps';

describe('applyEventToSummary', () => {
  it('counts a message from someone else as unread when the chat is not in view', () => {
    const next = applyEventToSummary(makeConversation(), newMessageEvent(1), {
      myId: ME,
      inView: false,
    });
    expect(next.unread_count).toBe(1);
  });

  // markRead sends the read_ack only while read_seq is behind; if this moved read_seq the sender
  // would never get the "read" tick for a message that arrived while the chat was open.
  it('shows no unread badge in view, but leaves read_seq for markRead to acknowledge', () => {
    const next = applyEventToSummary(
      makeConversation({ last_seq: 2, read_seq: 2 }),
      newMessageEvent(3),
      {
        myId: ME,
        inView: true,
      },
    );
    expect(next.unread_count).toBe(0);
    expect(next.read_seq).toBe(2);
    expect(next.last_seq).toBe(3);
  });
});
