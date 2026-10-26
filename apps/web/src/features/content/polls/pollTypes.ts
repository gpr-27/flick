import type { z } from 'zod';
import type { PollTally as PollTallySchema } from '@chat/contracts';

export type PollTally = z.infer<typeof PollTallySchema>;
