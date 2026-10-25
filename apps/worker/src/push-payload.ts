// The JSON the service worker receives for a message (apps/web/src/pwa/pushPayload.ts reads it),
// and the per-device rules that decide what it says or whether to send it at all.
import { HIDDEN_PREVIEW, previewOf, titleOf } from '@chat/shared';
import type { Notification } from './notifications.js';

/** A device's own choices, stored with its subscription (contracts: PushPrefs). */
export interface DevicePrefs {
  previews?: boolean;
  quiet?: { from_min: number; to_min: number; offset_min: number } | null;
}

/** Reads the stored jsonb defensively: a bad value means "no preference", never a crash. */
export function parsePrefs(raw: unknown): DevicePrefs {
  if (typeof raw !== 'object' || raw === null) return {};
  const p = raw as Record<string, unknown>;
  const q = p.quiet as Record<string, unknown> | null | undefined;
  const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
  return {
    previews: typeof p.previews === 'boolean' ? p.previews : undefined,
    quiet:
      q && num(q.from_min) && num(q.to_min) && num(q.offset_min)
        ? { from_min: q.from_min, to_min: q.to_min, offset_min: q.offset_min }
        : null,
  };
}

/** True when `now` falls inside the device's quiet window (which may cross midnight). */
export function inQuietHours(prefs: DevicePrefs, now: Date): boolean {
  const q = prefs.quiet;
  if (!q || q.from_min === q.to_min) return false;
  const utcMin = now.getUTCHours() * 60 + now.getUTCMinutes();
  const local = (((utcMin + q.offset_min) % 1440) + 1440) % 1440;
  return q.from_min < q.to_min
    ? local >= q.from_min && local < q.to_min
    : local >= q.from_min || local < q.to_min;
}

/** Web Push allows about 4 KB; this stays far below it (names and previews are cut short). */
export function messagePushPayload(n: Notification, prefs: DevicePrefs): string {
  return JSON.stringify({
    type: 'message',
    kind: n.kind,
    title: titleOf(n.sender_name, n.group_name),
    body:
      prefs.previews === false
        ? HIDDEN_PREVIEW
        : previewOf({ type: n.type, bodyText: n.body_text, viewOnce: n.view_once }),
    conversation_id: n.conversation_id,
    message_id: n.message_id,
    seq: n.seq,
    group: n.group_name !== null,
    sender_name: n.sender_name,
    ...(n.group_name ? { group_name: n.group_name } : {}),
  });
}
