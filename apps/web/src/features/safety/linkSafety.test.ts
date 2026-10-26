import { describe, expect, it } from 'vitest';
import { assessLink } from './linkSafety';

describe('assessLink', () => {
  it('leaves normal links alone', () => {
    expect(assessLink('https://github.com/anthropics').level).toBe('ok');
    expect(assessLink('https://www.paypal.com/signin').level).toBe('ok');
    expect(assessLink('mailto:a@b.co').level).toBe('ok');
  });
  it('flags IP hosts, "@" and punycode as dangerous', () => {
    expect(assessLink('http://192.168.4.4/login').level).toBe('danger');
    expect(assessLink('https://paypal.com@evil.example/').level).toBe('danger');
    expect(assessLink('https://xn--pypal-4ve.com/').level).toBe('danger');
  });
  it('warns on shorteners and odd endings', () => {
    expect(assessLink('https://bit.ly/abc').level).toBe('warn');
    expect(assessLink('https://free-gift.xyz/').level).toBe('warn');
  });
  it('flags look-alike brand domains and http logins', () => {
    expect(assessLink('https://paypal-secure.example.com/').level).toBe('danger');
    expect(assessLink('http://mybank.example.org/login').level).toBe('danger');
  });
});
