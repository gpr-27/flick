// Ticks (sent / delivered / read) derived from receipts, for direct chats and groups.
import { tickState } from '@chat/contracts';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BOB,
  CONV,
  ME,
  installFakeServices,
  makeConversation,
  makeMessage,
  nextId,
} from '../../../test/fakes';
import type { OutboxItem } from './outbox/outboxMachine';
import { buildRows, rowStatus, type RowStatus } from './threadRows';
import { useChatStore } from './useChatStore';

const C = nextId();
const D = nextId();
const cursor = (delivered_seq: number, read_seq: number) => ({ delivered_seq, read_seq });
const rowFor = (seq: number) => buildRows([makeMessage({ seq, sender_user_id: ME })], [], CONV)[0]!;

describe('tickState (contracts): table', () => {
  // [name, message seq, recipients [delivered, read], expected]
  const table: [string, number, [number, number][], string][] = [
    ['no recipients yet', 5, [], 'sent'],
    ['nothing reported', 5, [[0, 0]], 'sent'],
    ['delivered below seq', 5, [[4, 0]], 'sent'],
    ['delivered exactly seq', 5, [[5, 0]], 'delivered'],
    ['delivered beyond seq', 5, [[9, 0]], 'delivered'],
    ['read exactly seq', 5, [[5, 5]], 'read'],
    ['read beyond delivered (read implies delivered)', 5, [[0, 5]], 'read'],
    ['read below seq but delivered above', 5, [[7, 3]], 'delivered'],
    [
      'group: one of two delivered',
      5,
      [
        [5, 0],
        [0, 0],
      ],
      'sent',
    ],
    [
      'group: both delivered',
      5,
      [
        [5, 0],
        [6, 0],
      ],
      'delivered',
    ],
    [
      'group: both delivered, one read',
      5,
      [
        [5, 5],
        [6, 0],
      ],
      'delivered',
    ],
    [
      'group: both read',
      5,
      [
        [5, 5],
        [6, 6],
      ],
      'read',
    ],
    [
      'group: one read before the other delivered',
      5,
      [
        [0, 5],
        [0, 0],
      ],
      'sent',
    ],
    ['seq 0 (a local message)', 0, [[0, 0]], 'read'],
  ];
  it.each(table)('%s', (_name, seq, recipients, expected) => {
    expect(
      tickState(
        seq,
        recipients.map(([d, r]) => cursor(d, r)),
      ),
    ).toBe(expected);
  });

  it('never moves backwards as cursors only grow (monotonic)', () => {
    const order: Record<string, number> = { sent: 0, delivered: 1, read: 2 };
    let previous = 0;
    for (const [d, r] of [
      [0, 0],
      [3, 0],
      [5, 0],
      [5, 2],
      [6, 5],
      [9, 9],
    ] as const) {
      const now = order[tickState(5, [cursor(d, r)])]!;
      expect(now).toBeGreaterThanOrEqual(previous);
      previous = now;
    }
  });
});

describe('rowStatus: direct and group', () => {
  // [name, recipient count, receipts, expected]
  const table: [
    string,
    number,
    Record<string, ReturnType<typeof cursor>> | undefined,
    RowStatus,
  ][] = [
    ['direct, no receipts at all', 1, undefined, 'sent'],
    ['direct, delivered', 1, { [BOB]: cursor(5, 0) }, 'delivered'],
    ['direct, read', 1, { [BOB]: cursor(5, 5) }, 'read'],
    ['group of 3, nobody has reported', 2, undefined, 'sent'],
    ['group of 3, one delivered, one silent', 2, { [C]: cursor(5, 0) }, 'sent'],
    ['group of 3, both delivered', 2, { [C]: cursor(5, 0), [D]: cursor(5, 0) }, 'delivered'],
    [
      'group of 3, one read, one only delivered',
      2,
      { [C]: cursor(5, 5), [D]: cursor(5, 0) },
      'delivered',
    ],
    ['group of 3, both read', 2, { [C]: cursor(5, 5), [D]: cursor(5, 5) }, 'read'],
    ['group of 3, one read and one silent', 2, { [C]: cursor(5, 5) }, 'sent'],
    [
      'group of 4, two reported delivered, third silent',
      3,
      { [C]: cursor(5, 0), [D]: cursor(5, 0) },
      'sent',
    ],
    [
      'a member who left (more receipts than recipients) does not break it',
      1,
      { [C]: cursor(5, 5), [D]: cursor(5, 5) },
      'read',
    ],
    ['no recipients (a chat with only me)', 0, undefined, 'sent'],
  ];
  it.each(table)('%s', (_name, recipients, receipts, expected) => {
    expect(rowStatus(rowFor(5), receipts, recipients)).toBe(expected);
  });

  it('an older message is already delivered when only a newer one is not', () => {
    const receipts = { [BOB]: cursor(5, 0) };
    expect(rowStatus(rowFor(5), receipts, 1)).toBe('delivered');
    expect(rowStatus(rowFor(6), receipts, 1)).toBe('sent');
  });

  describe('messages still in the outbox show their own state, never ticks', () => {
    const item = (status: 'pending' | 'failed'): OutboxItem => ({
      client_message_id: 'c1',
      conversation_id: CONV,
      user_id: ME,
      content: { type: 'text', text: 'x' },
      created_at: 1,
      status,
      error: status === 'failed' ? { code: 'E', message: 'm', retryable: true } : null,
    });
    it.each(['pending', 'failed'] as const)('%s', (status) => {
      const [row] = buildRows([], [item(status)], CONV);
      expect(rowStatus(row!, { [BOB]: cursor(99, 99) }, 1)).toBe(status);
    });
  });
});

describe('receipts through the store', () => {
  beforeEach(() => {
    installFakeServices();
    useChatStore.getState().reset();
    useChatStore.setState({ conversations: { [CONV]: makeConversation() } });
  });

  it('a delivery then a read receipt walks a direct message sent -> delivered -> read', () => {
    const row = rowFor(5);
    const status = () => rowStatus(row, useChatStore.getState().receipts[CONV], 1);
    expect(status()).toBe('sent');
    useChatStore
      .getState()
      .receiptUpdate({ conversation_id: CONV, user_id: BOB, delivered_seq: 5 });
    expect(status()).toBe('delivered');
    useChatStore.getState().receiptUpdate({ conversation_id: CONV, user_id: BOB, read_seq: 5 });
    expect(status()).toBe('read');
    // A stale delivered receipt arriving late cannot undo a read.
    useChatStore
      .getState()
      .receiptUpdate({ conversation_id: CONV, user_id: BOB, delivered_seq: 2 });
    expect(status()).toBe('read');
  });

  it('a group message needs every member', () => {
    const row = rowFor(5);
    const status = () => rowStatus(row, useChatStore.getState().receipts[CONV], 2);
    useChatStore.getState().receiptUpdate({ conversation_id: CONV, user_id: C, read_seq: 5 });
    expect(status()).toBe('sent');
    useChatStore.getState().receiptUpdate({ conversation_id: CONV, user_id: D, delivered_seq: 5 });
    expect(status()).toBe('delivered');
    useChatStore.getState().receiptUpdate({ conversation_id: CONV, user_id: D, read_seq: 5 });
    expect(status()).toBe('read');
  });
});
