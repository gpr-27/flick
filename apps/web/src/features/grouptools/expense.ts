// Expense split math, in whole cents so sums are exact. Pure.

export interface ExpenseLike {
  amount_cents: number;
  payer_id: string;
  split_among: readonly string[];
}

/** Positive = is owed money, negative = owes. Shares are rounded so the cents always add up. */
export function balances(expenses: readonly ExpenseLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const e of expenses) {
    const people = [...new Set(e.split_among)];
    if (people.length === 0) continue;
    const share = Math.floor(e.amount_cents / people.length);
    let extra = e.amount_cents - share * people.length;
    out[e.payer_id] = (out[e.payer_id] ?? 0) + e.amount_cents;
    for (const p of people) {
      const owed = share + (extra > 0 ? 1 : 0);
      if (extra > 0) extra--;
      out[p] = (out[p] ?? 0) - owed;
    }
  }
  return out;
}

export const formatMoney = (cents: number, currency = 'USD'): string => {
  const sign = cents < 0 ? '-' : '';
  return `${sign}${(Math.abs(cents) / 100).toFixed(2)} ${currency}`;
};

/** "12.50" or "12" to cents; null when it is not a positive amount. */
export function parseAmount(text: string): number | null {
  const m = /^\s*(\d{1,9})(?:[.,](\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  const cents = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || 0);
  return cents > 0 ? cents : null;
}
