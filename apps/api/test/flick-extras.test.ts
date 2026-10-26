import { describe, expect, it } from 'vitest';
import { fetchPageText, firstUrl, htmlToText } from '../src/modules/ai/fetch-page.js';
import { explicitMemory, parseSuggestions } from '../src/modules/ai/flick-extras.js';

describe('explicitMemory', () => {
  it('takes the fact after "remember (that)"', () => {
    expect(explicitMemory('Remember that I am vegetarian')).toBe('I am vegetarian');
    expect(explicitMemory('please remember my dog is called Rex')).toBe('my dog is called Rex');
  });
  it('ignores other messages', () => {
    expect(explicitMemory('do you remember the movie?')).toBeNull();
    expect(explicitMemory('hello')).toBeNull();
  });
});

describe('parseSuggestions', () => {
  it('reads up to three suggestions, also inside a code fence', () => {
    expect(parseSuggestions('```json\n{"suggestions":["a","b","c","d"]}\n```')).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
  it('gives nothing for bad output', () => {
    expect(parseSuggestions('nope')).toEqual([]);
  });
});

describe('fetch-page', () => {
  it('finds the first link and drops trailing punctuation', () => {
    expect(firstUrl('see https://example.com/a?b=1, ok')).toBe('https://example.com/a?b=1');
    expect(firstUrl('no link')).toBeNull();
  });
  it('turns html into text without scripts', () => {
    const text = htmlToText(
      '<html><head><title>Hi</title></head><body><script>x()</script><p>Hello <b>you</b></p></body></html>',
    );
    expect(text).toBe('Hi\nHello you');
  });
  it('refuses private and loopback addresses and other schemes', async () => {
    expect(await fetchPageText('http://127.0.0.1:1/')).toBeNull();
    expect(await fetchPageText('http://[::1]/')).toBeNull();
    expect(await fetchPageText('http://10.0.0.5/')).toBeNull();
    expect(await fetchPageText('http://169.254.169.254/latest')).toBeNull();
    expect(await fetchPageText('file:///etc/passwd')).toBeNull();
    expect(await fetchPageText('http://localhost/')).toBeNull();
  });
});
