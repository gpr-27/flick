import { describe, expect, it } from 'vitest';
import {
  DENIED_STEPS,
  describeCallPermission,
  platformOf,
  type PlatformInfo,
} from './callPermission';

const desktop: PlatformInfo = {
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Chrome/130',
  standalone: false,
  maxTouchPoints: 0,
};
const iphone: PlatformInfo = {
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604',
  standalone: false,
  maxTouchPoints: 5,
};
const android: PlatformInfo = {
  userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/130 Mobile',
  standalone: false,
  maxTouchPoints: 5,
};

describe('platformOf', () => {
  it('tells iPhone, iPad (which says it is a Mac), Android and desktop apart', () => {
    expect(platformOf(iphone)).toBe('ios');
    expect(
      platformOf({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
        standalone: false,
        maxTouchPoints: 5,
      }),
    ).toBe('ios');
    expect(
      platformOf({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X)',
        standalone: false,
        maxTouchPoints: 0,
      }),
    ).toBe('desktop');
    expect(platformOf(android)).toBe('android');
    expect(platformOf(desktop)).toBe('desktop');
  });
});

describe('describeCallPermission', () => {
  it('asks in context, with the reason, when permission is still open', () => {
    const view = describeCallPermission('unsubscribed', desktop);
    expect(view).toMatchObject({ kind: 'ask', button: 'Allow notifications' });
    expect((view as { text: string }).text).toBe(
      'Allow notifications so you receive calls when Flick is closed.',
    );
  });

  it('explains how to recover when notifications are blocked, per platform', () => {
    for (const info of [desktop, android, iphone]) {
      const view = describeCallPermission('denied', info);
      expect(view.kind).toBe('denied');
      expect((view as { steps: string[] }).steps).toEqual(DENIED_STEPS[platformOf(info)]);
    }
    expect(DENIED_STEPS.ios.join(' ')).toMatch(/Settings/);
  });

  it('on an iPhone in Safari (not installed) says to add Flick to the Home Screen first', () => {
    const view = describeCallPermission('unsupported', iphone);
    expect(view.kind).toBe('install');
    expect((view as { text: string }).text).toMatch(/Add to Home Screen/);
    expect((view as { text: string }).text).toMatch(/16\.4/);
  });

  it('says calls only ring while open where push is not supported at all', () => {
    expect(describeCallPermission('unsupported', desktop).kind).toBe('unsupported');
    expect(describeCallPermission('unsupported', { ...iphone, standalone: true }).kind).toBe(
      'unsupported',
    );
  });

  it('when on, makes no promise of a phone-like ring', () => {
    const view = describeCallPermission('subscribed', desktop) as { kind: string; text: string };
    expect(view.kind).toBe('enabled');
    expect(view.text).toMatch(/best-effort/);
    expect(view.text).toMatch(/does not ring like a phone/);
  });

  it('shows nothing while loading', () => {
    expect(describeCallPermission('loading', desktop)).toEqual({ kind: 'loading' });
  });
});
