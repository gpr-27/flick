import { describe, expect, it } from 'vitest';
import { collapsedText } from '../content/registry';

describe('collapsedText', () => {
  it('keeps a 65,000-character message small', () => {
    expect(collapsedText('x'.repeat(65_000)).length).toBeLessThanOrEqual(601);
  });
  it('keeps at most 12 lines', () => {
    const out = collapsedText(Array.from({ length: 40 }, (_, i) => `l${String(i)}`).join('\n'));
    expect(out.split('\n')).toHaveLength(12);
  });
});
