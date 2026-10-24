import { expect } from 'vitest';

/** `expect.objectContaining` typed as unknown, so it can sit inside another expected object. */
export const like = (shape: Record<string, unknown>): unknown => expect.objectContaining(shape);
