import { describe, expect, it } from 'vitest';
import { editDistance, findImpersonated, normalizeName } from './impersonation';

describe('impersonation', () => {
  it('normalises lookalikes', () => {
    expect(normalizeName('J0hn  Sm1th')).toBe('johnsmlth');
    expect(normalizeName('Zoë')).toBe('zoe');
  });
  it('measures edit distance', () => {
    expect(editDistance('kitten', 'sitten')).toBe(1);
    expect(editDistance('abc', 'abc')).toBe(0);
  });
  it('finds a copied name', () => {
    const known = ['Priya Sharma', 'Alex'];
    expect(findImpersonated('Pr1ya Sharma', known)).toBe('Priya Sharma');
    expect(findImpersonated('Priya Sharmaa', known)).toBe('Priya Sharma');
    expect(findImpersonated('Priya Sharma', known)).toBeNull(); // the same person
    expect(findImpersonated('Someone Else', known)).toBeNull();
    expect(findImpersonated('Alec', known)).toBeNull(); // too short to judge
  });
});
