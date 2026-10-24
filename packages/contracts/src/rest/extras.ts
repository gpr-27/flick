import { z } from 'zod';
import { HttpUrl } from '../common.js';

// GIF/sticker search goes through the server's GIPHY proxy, so the API key stays
// on the server and users' IPs are not sent to GIPHY. Without GIPHY_API_KEY the
// endpoint returns FEATURE_DISABLED.

export const GifSearchQuery = z.object({
  kind: z.enum(['gif', 'sticker']).default('gif'),
  /** Omit for trending. */
  q: z.string().trim().min(1).max(100).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(24),
});

export const GifResult = z.object({
  id: z.string().min(1).max(64),
  title: z.string(),
  url: HttpUrl,
  preview_url: HttpUrl,
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});

export const GifSearchResponse = z.object({ items: z.array(GifResult) });

// Link previews are fetched by the server with SSRF protection (no private IPs,
// size and time limits) and cached in Redis.

export const LinkPreviewQuery = z.object({ url: z.url({ protocol: /^https?$/ }).max(2_048) });

export const LinkPreview = z.object({
  url: HttpUrl,
  title: z.string().nullable(),
  description: z.string().nullable(),
  image_url: HttpUrl.nullable(),
  site_name: z.string().nullable(),
});
