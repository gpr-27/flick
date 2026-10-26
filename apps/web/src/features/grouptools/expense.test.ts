import { describe, expect, it } from 'vitest';
import { balances, formatMoney, parseAmount } from './expense';

describe('expense split', () => {
  it('splits evenly and keeps the cents', () => {
    const b = balances([{ amount_cents: 1000, payer_id: 'a', split_among: ['a', 'b', 'c'] }]);
    expect(b).toEqual({ a: 666, b: -333, c: -333 });
    expect(Object.values(b).reduce((x, y) => x + y, 0)).toBe(0);
  });
  it('nets several expenses', () => {
    const b = balances([
      { amount_cents: 600, payer_id: 'a', split_among: ['a', 'b'] },
      { amount_cents: 200, payer_id: 'b', split_among: ['a', 'b'] },
    ]);
    expect(b).toEqual({ a: 200, b: -200 });
  });
  it('parses and formats amounts', () => {
    expect(parseAmount('12.5')).toBe(1250);
    expect(parseAmount('7')).toBe(700);
    expect(parseAmount('abc')).toBeNull();
    expect(parseAmount('0')).toBeNull();
    expect(formatMoney(-1250, 'EUR')).toBe('-12.50 EUR');
  });
});
