import { describe, expect, it } from 'vitest';
import { MessageContent, mentionsFlick } from '../src/index.js';
import { CONTENT, MSG } from './fixtures.js';

describe('message content', () => {
  it('accepts one example of every type', () => {
    for (const example of Object.values(CONTENT))
      expect(MessageContent.safeParse(example).success, example.type).toBe(true);
  });

  it('rejects bad content', () => {
    const bad = [
      { type: 'text', text: '   ' }, // blank
      { type: 'hologram' },
      { type: 'location', lat: 1, lng: 1 }, // dropped type
      { ...CONTENT.poll, options: ['Pizza'] }, // too few options
      { ...CONTENT.poll, options: ['Pizza', 'Pizza'] }, // duplicates
      { ...CONTENT.voice, waveform: [101] }, // sample out of range
      { ...CONTENT.gif, url: 'javascript:alert(1)' },
      { ...CONTENT.text, reply_to: 'not-a-uuid' },
    ];
    for (const content of bad)
      expect(MessageContent.safeParse(content).success, JSON.stringify(content)).toBe(false);
  });

  it('every type takes reply_to, forwarded, view_once and mentions', () => {
    const extras = { reply_to: MSG, forwarded: true, view_once: true, mentions: [] };
    for (const example of Object.values(CONTENT))
      expect(MessageContent.safeParse({ ...example, ...extras }).success, example.type).toBe(true);
  });

  it('detects @flick mentions', () => {
    expect(mentionsFlick('@flick what is 2+2?')).toBe(true);
    expect(mentionsFlick('hey @Flick, summarise this')).toBe(true);
    expect(mentionsFlick('email me at bob@flick.com')).toBe(false);
    expect(mentionsFlick('@flickering lights')).toBe(false);
  });
});
