import { describe, expect, it } from 'vitest';
import { newMessageEvent } from '../../../../test/fakes';
import { eventSeq, groupByConversation, mergeEvents } from './merge';

const seqs = (events: Parameters<typeof eventSeq>[0][]): number[] => events.map(eventSeq);
const events = (...s: number[]) => s.map((n) => newMessageEvent(n));

describe('mergeEvents', () => {
  it('applies the next events in seq order, whatever order they arrive in', () => {
    const result = mergeEvents(2, events(5, 3, 4));
    expect(seqs(result.apply)).toEqual([3, 4, 5]);
    expect(result).toMatchObject({ lastSeq: 5, gap: false });
  });

  it('drops events it already has (a live event that sync also returned)', () => {
    const result = mergeEvents(4, events(2, 4, 5));
    expect(seqs(result.apply)).toEqual([5]);
    expect(result.lastSeq).toBe(5);
  });

  it('applies one event only once when the same seq arrives twice', () => {
    const result = mergeEvents(0, events(1, 1, 2, 2));
    expect(seqs(result.apply)).toEqual([1, 2]);
  });

  it('detects a gap, applies what is contiguous and holds back the rest', () => {
    const result = mergeEvents(2, events(3, 4, 7, 8));
    expect(seqs(result.apply)).toEqual([3, 4]);
    expect(result).toMatchObject({ lastSeq: 4, gap: true });
  });

  it('reports a gap right at the start', () => {
    const result = mergeEvents(10, events(12));
    expect(result).toMatchObject({ apply: [], lastSeq: 10, gap: true });
  });

  it('does nothing for an empty or fully known batch', () => {
    expect(mergeEvents(5, [])).toMatchObject({ apply: [], lastSeq: 5, gap: false });
    expect(mergeEvents(5, events(1, 2, 5))).toMatchObject({ apply: [], lastSeq: 5, gap: false });
  });

  it('gives the same result for any arrival order', () => {
    const forward = mergeEvents(0, events(1, 2, 3, 4));
    const shuffled = mergeEvents(0, events(3, 1, 4, 2));
    expect(seqs(shuffled.apply)).toEqual(seqs(forward.apply));
  });
});

describe('groupByConversation', () => {
  it('splits events by conversation and keeps arrival order inside each', () => {
    const a1 = newMessageEvent(1, { conversation_id: '0192f5a0-0000-7000-8000-0000000000a1' });
    const b1 = newMessageEvent(1, { conversation_id: '0192f5a0-0000-7000-8000-0000000000b1' });
    const a2 = newMessageEvent(2, { conversation_id: '0192f5a0-0000-7000-8000-0000000000a1' });
    const groups = groupByConversation([a1, b1, a2]);
    expect(groups.size).toBe(2);
    expect(groups.get('0192f5a0-0000-7000-8000-0000000000a1')).toEqual([a1, a2]);
  });
});
