import { z } from 'zod';
import { Id } from './common.js';

/**
 * Shared-tool message kinds: a checklist, an expense and a small game.
 * Their state (ticks, moves, votes) lives in the message content and changes through
 * POST /conversations/:id/messages/:id/card/act, never through an edit.
 */
const base = {
  reply_to: Id.optional(),
  forwarded: z.boolean().optional(),
  view_once: z.boolean().optional(),
  mentions: z.array(Id).max(256).optional(),
};

export const ChecklistContent = z.object({
  type: z.literal('checklist'),
  title: z.string().trim().min(1).max(100),
  items: z
    .array(z.object({ text: z.string().trim().min(1).max(200), done: z.boolean().default(false) }))
    .min(1)
    .max(50),
  ...base,
});

export const ExpenseContent = z.object({
  type: z.literal('expense'),
  description: z.string().trim().min(1).max(100),
  /** Whole minor units (cents), so sums are exact. */
  amount_cents: z.number().int().positive().max(1_000_000_000),
  currency: z.string().trim().min(1).max(8).default('USD'),
  payer_id: Id,
  split_among: z.array(Id).min(1).max(256),
  ...base,
});

export const GAME_KINDS = ['tictactoe', 'wyr'] as const;

export const GameContent = z.object({
  type: z.literal('game'),
  game: z.enum(GAME_KINDS),
  /** Would you rather: the two options. Unused by tic-tac-toe. */
  options: z.array(z.string().trim().min(1).max(120)).length(2).optional(),
  /** Game state; shape depends on the game (see the web games module). */
  state: z.record(z.string(), z.unknown()).default({}),
  ...base,
});
