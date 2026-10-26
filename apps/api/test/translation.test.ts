import { describe, expect, it } from 'vitest';
import { protect, restore } from '../src/modules/ai/translation.js';

describe("don't-translate words", () => {
  it('wraps listed words in placeholders and restores them', () => {
    const { texts, words } = protect(['Hola, soy Priya de Acme.'], ['Priya', 'Acme']);
    expect(texts[0]).toBe('Hola, soy ⟦0⟧ de ⟦1⟧.');
    expect(restore('Hello, I am ⟦0⟧ from ⟦1⟧.', 'Hola, soy priya de ACME.', words)).toBe(
      'Hello, I am priya from ACME.',
    );
  });
  it('escapes regex characters in words', () => {
    const { texts } = protect(['a (b) c'], ['(b)']);
    expect(texts[0]).toBe('a ⟦0⟧ c');
  });
});
