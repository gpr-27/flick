import { ENDPOINTS, type UnderstandRequest, type UnderstandResponse } from '@chat/contracts';
import type { z } from 'zod';
import { getApi } from '@/lib/services';

export type UnderstandResult = z.infer<typeof UnderstandResponse>;
export type UnderstandItem = UnderstandResult['items'][number];

/** One call for the catch-up card, topics, recap, "check this" and search answers. */
export const understand = (body: z.infer<typeof UnderstandRequest>): Promise<UnderstandResult> =>
  getApi().call(ENDPOINTS.ai.understand, { body });
