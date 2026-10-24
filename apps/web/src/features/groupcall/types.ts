import type { z } from 'zod';
import type {
  CallLink as CallLinkSchema,
  CallLogEntry as CallLogEntrySchema,
} from '@chat/contracts';

// calls.ts in @chat/contracts exports the schemas only, so the types are derived here.
export type CallLink = z.infer<typeof CallLinkSchema>;
export type CallLogEntry = z.infer<typeof CallLogEntrySchema>;
