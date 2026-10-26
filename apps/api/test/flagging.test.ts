import { describe, expect, it } from 'vitest';
import { flagReasons, slowModeWait } from '../src/modules/grouptools/flagging.js';

describe('flagReasons', () => {
  it('is empty for a normal message', () => {
    expect(flagReasons('See you at 6, bring the charger')).toEqual([]);
  });
  it('flags rude, spam, caps and link floods', () => {
    expect(flagReasons('you are an idiot')).toContain('rude language');
    expect(flagReasons('Click here for free money')).toContain('spam words');
    expect(flagReasons('BUY THIS RIGHT NOW EVERYONE')).toContain('all caps');
    expect(flagReasons('http://a.co http://b.co http://c.co')).toContain('many links');
  });
});

describe('slowModeWait', () => {
  it('counts down from the last message', () => {
    expect(slowModeWait(30, 1_000_000, 1_010_000)).toBe(20);
    expect(slowModeWait(30, 1_000_000, 1_031_000)).toBe(0);
    expect(slowModeWait(0, 1_000_000, 1_000_001)).toBe(0);
    expect(slowModeWait(30, null, 5)).toBe(0);
  });
});
