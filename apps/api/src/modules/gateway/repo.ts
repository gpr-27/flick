// The few Postgres questions the gateway asks. Redis only holds short-lived state, so membership
// and blocks always come from here.
import type { Db } from '../../db.js';

export interface GatewayRepo {
  activeMemberIds(conversationId: string): Promise<string[]>;
  /** The other member of a direct conversation, or null if it is not direct or the user is not in it. */
  directPeer(conversationId: string, userId: string): Promise<string | null>;
  isBlockedEitherWay(a: string, b: string): Promise<boolean>;
  /** Of `candidateIds`, the users who share at least one conversation with `userId`. */
  usersSharingConversation(userId: string, candidateIds: string[]): Promise<string[]>;
  touchLastSeen(userId: string): Promise<void>;
  /** Last-seen per user as others may see it: null when unknown or hidden by privacy settings. */
  visibleLastSeen(userIds: string[]): Promise<Map<string, string | null>>;
  /** True when the user has at least one working Web Push subscription (a call could ring them). */
  hasPushSubscription(userId: string): Promise<boolean>;
  displayName(userId: string): Promise<string>;
}

export function createGatewayRepo(db: Db): GatewayRepo {
  return {
    async activeMemberIds(conversationId) {
      const rows = await db
        .selectFrom('conversation_members')
        .select('user_id')
        .where('conversation_id', '=', conversationId)
        .where('left_at', 'is', null)
        .execute();
      return rows.map((r) => r.user_id);
    },

    async directPeer(conversationId, userId) {
      const rows = await db
        .selectFrom('conversation_members as m')
        .innerJoin('conversations as c', 'c.id', 'm.conversation_id')
        .select('m.user_id')
        .where('m.conversation_id', '=', conversationId)
        .where('c.type', '=', 'direct')
        .where('m.left_at', 'is', null)
        .execute();
      const ids = rows.map((r) => r.user_id);
      if (!ids.includes(userId)) return null;
      return ids.find((id) => id !== userId) ?? null;
    },

    async isBlockedEitherWay(a, b) {
      const row = await db
        .selectFrom('blocks')
        .select('blocker_id')
        .where((eb) =>
          eb.or([
            eb.and([eb('blocker_id', '=', a), eb('blocked_id', '=', b)]),
            eb.and([eb('blocker_id', '=', b), eb('blocked_id', '=', a)]),
          ]),
        )
        .executeTakeFirst();
      return row !== undefined;
    },

    async usersSharingConversation(userId, candidateIds) {
      if (candidateIds.length === 0) return [];
      const rows = await db
        .selectFrom('conversation_members as a')
        .innerJoin('conversation_members as b', 'b.conversation_id', 'a.conversation_id')
        .select('b.user_id')
        .distinct()
        .where('a.user_id', '=', userId)
        .where('a.left_at', 'is', null)
        .where('b.left_at', 'is', null)
        .where('b.user_id', 'in', candidateIds)
        .execute();
      return rows.map((r) => r.user_id);
    },

    async touchLastSeen(userId) {
      await db
        .updateTable('users')
        .set({ last_seen_at: new Date() })
        .where('id', '=', userId)
        .execute();
    },

    async visibleLastSeen(userIds) {
      const result = new Map<string, string | null>();
      if (userIds.length === 0) return result;
      const rows = await db
        .selectFrom('users as u')
        .leftJoin('user_settings as s', 's.user_id', 'u.id')
        .select(['u.id', 'u.last_seen_at', 's.last_seen_privacy'])
        .where('u.id', 'in', userIds)
        .execute();
      for (const r of rows) {
        // Only "everyone" shows last seen; "contacts" and "nobody" hide it.
        const visible = (r.last_seen_privacy ?? 'everyone') === 'everyone';
        result.set(r.id, visible && r.last_seen_at ? new Date(r.last_seen_at).toISOString() : null);
      }
      return result;
    },

    async hasPushSubscription(userId) {
      const row = await db
        .selectFrom('push_subscriptions')
        .select('id')
        .where('user_id', '=', userId)
        .where('disabled_at', 'is', null)
        .limit(1)
        .executeTakeFirst();
      return row !== undefined;
    },

    async displayName(userId) {
      const row = await db
        .selectFrom('users')
        .select('display_name')
        .where('id', '=', userId)
        .executeTakeFirst();
      return row?.display_name || 'Someone';
    },
  };
}
