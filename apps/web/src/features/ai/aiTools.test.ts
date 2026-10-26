import { describe, expect, it } from 'vitest';
import { detectLanguage, foreignLanguage } from './languageDetect';
import { parseToneAnswer } from './toneCheck';

describe('detectLanguage', () => {
  it('knows scripts and common words', () => {
    expect(detectLanguage('నేను రేపు వస్తాను')).toBe('Telugu');
    expect(detectLanguage('the plan is to meet you at noon')).toBe('English');
    expect(detectLanguage('je ne sais pas ce que vous voulez')).toBe('French');
    expect(detectLanguage('ok')).toBeNull();
  });
  it('only flags text that differs from the UI language', () => {
    expect(foreignLanguage('the plan is to meet you at noon')).toBeNull();
    expect(foreignLanguage('ich weiss nicht was das ist')).toBe('German');
  });
});

describe('parseToneAnswer', () => {
  it('reads OK and flagged answers', () => {
    expect(parseToneAnswer('OK')).toEqual({ ok: true });
    expect(parseToneAnswer('NOTE: Sounds blunt.\nSOFTER: Could you send it today?')).toEqual({
      ok: false,
      note: 'Sounds blunt.',
      softer: 'Could you send it today?',
    });
  });
});
