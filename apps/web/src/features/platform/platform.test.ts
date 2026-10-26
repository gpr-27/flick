import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from '../settings/settingsSchema';
import { handleCaptionMessage, useCaptions } from './captions';
import { passkeysAvailable } from './passkeys';

describe('captions', () => {
  it('shows a caption message and ignores other data', () => {
    expect(handleCaptionMessage('🎉')).toBe(false);
    expect(handleCaptionMessage('cc:hello there')).toBe(true);
    expect(useCaptions.getState().theirs).toBe('hello there');
  });
});

describe('passkeys', () => {
  it('is hidden without a Clerk user or when the dashboard has passkeys off', () => {
    expect(passkeysAvailable(undefined)).toBe(false);
    expect(passkeysAvailable({ user: null })).toBe(false);
  });
});

describe('platform settings', () => {
  it('keeps valid keyword lists and drops damaged ones', () => {
    expect(sanitizeSettings({ keywordAlerts: ['urgent'] }).keywordAlerts).toEqual(['urgent']);
    expect(sanitizeSettings({ keywordAlerts: [1] }).keywordAlerts).toEqual([]);
    expect(sanitizeSettings({ priorityContacts: 'x' }).priorityContacts).toEqual([]);
    expect(sanitizeSettings({}).dyslexiaFont).toBe(false);
  });
});
