import { vi } from 'vitest';

/** Replaces navigator for one test, keeping everything it already has (call vi.unstubAllGlobals after). */
export const stubNavigator = (extra: object): void => {
  vi.stubGlobal('navigator', Object.assign(Object.create(navigator) as object, extra));
};
