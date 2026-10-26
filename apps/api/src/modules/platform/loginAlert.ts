import { FLICK_BOT_USER_ID, allocateSeqAndInsertMessage } from '@chat/db';
import type { Db } from '../../db.js';

/**
 * "Signed in from a new device": a message from the Flick bot in the person's Saved messages, which
 * the normal notification path turns into a notification. Skipped for a first-ever device and when
 * the person switched the alert off. Never throws: sign-in must not fail because of an alert.
 */
export async function alertNewDevice(db: Db, userId: string, deviceName: string): Promise<void> {
  try {
    const others = await db
      .selectFrom('devices')
      .select('id')
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null)
      .limit(2)
      .execute();
    if (others.length < 2) return; // only this device exists
    const setting = await db
      .selectFrom('user_settings')
      .select('login_alerts')
      .where('user_id', '=', userId)
      .executeTakeFirst();
    if (setting && !setting.login_alerts) return;
    const saved = await db
      .selectFrom('conversations')
      .select('id')
      .where('saved_for', '=', userId)
      .executeTakeFirst();
    if (!saved) return;
    await allocateSeqAndInsertMessage(db, {
      conversationId: saved.id,
      senderId: FLICK_BOT_USER_ID,
      senderDeviceId: null,
      clientMessageId: null,
      type: 'text',
      bodyText: `New sign-in: your account was signed in from ${deviceName}. If this was not you, open Settings > Devices and sign out of other devices.`,
      content: null,
      authorize: false,
    });
  } catch {
    // best effort
  }
}
