// Lightweight client logger. Errors and warnings always surface; info/debug
// are limited to non-production builds so end users' consoles stay clean.
import { config } from '@/config/env';

const verbose = !config.isProduction && config.env !== 'test';
const tag = '[chat]';

export const logger = {
  error: (...args: unknown[]): void => {
    console.error(tag, ...args);
  },
  warn: (...args: unknown[]): void => {
    console.warn(tag, ...args);
  },
  info: (...args: unknown[]): void => {
    if (verbose) console.info(tag, ...args);
  },
  debug: (...args: unknown[]): void => {
    if (verbose) console.debug(tag, ...args);
  },
};

export default logger;
