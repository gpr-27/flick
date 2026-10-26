import { describe, expect, it } from 'vitest';
import { joinSuggestion } from './writingText';
import { countChanges } from './writingText';

describe('joinSuggestion', () => {
  it('adds a space between words but not before punctuation', () => {
    expect(joinSuggestion('See you', 'tomorrow at 5')).toBe(' tomorrow at 5');
    expect(joinSuggestion('See you ', 'tomorrow')).toBe('tomorrow');
    expect(joinSuggestion('Ok', ', thanks')).toBe(', thanks');
    expect(joinSuggestion('Ok', '  ')).toBe('');
  });
});

describe('countChanges', () => {
  it('counts changed words', () => {
    expect(countChanges('i has a apple', 'I have an apple')).toBe(3);
    expect(countChanges('all good', 'all good')).toBe(0);
  });
});
