import { z } from 'zod';
import { Id, IsoDateTime } from '../common.js';

/** Incoming webhooks: a URL that posts a text message into one chat as a bot. */
export const WebhookParams = z.object({ conversation_id: Id });
export const WebhookItemParams = z.object({ conversation_id: Id, webhook_id: Id });
export const CreateWebhookRequest = z.object({ name: z.string().trim().min(1).max(40) });
export const WebhookItem = z.object({
  id: Id,
  name: z.string(),
  created_at: IsoDateTime,
});
export const WebhookList = z.object({ items: z.array(WebhookItem) });
/** The token is returned once, here, and never again. Post to POST /hooks/{id}/{token}. */
export const CreatedWebhook = WebhookItem.extend({ token: z.string() });
/** Body of POST /hooks/:id/:token. */
export const HookPostBody = z.object({ text: z.string().trim().min(1).max(4000) });

/** The address that forwards email into the person's Saved messages; null when the feature is off. */
export const EmailAlias = z.object({ address: z.string().nullable() });

/** Media stored per chat, for Settings > Storage. */
export const MediaUsage = z.object({
  total_bytes: z.number().int().nonnegative(),
  items: z.array(
    z.object({
      conversation_id: Id,
      name: z.string(),
      files: z.number().int().nonnegative(),
      bytes: z.number().int().nonnegative(),
    }),
  ),
});

/** "Your week in Flick". */
export const WeekStats = z.object({
  messages_sent: z.number().int().nonnegative(),
  voice_minutes: z.number().nonnegative(),
  busiest_chats: z.array(
    z.object({ conversation_id: Id, name: z.string(), messages: z.number().int().nonnegative() }),
  ),
});

/** Whether a "signed in from a new device" alert is sent to this account. */
export const LoginAlertSetting = z.object({ enabled: z.boolean() });
