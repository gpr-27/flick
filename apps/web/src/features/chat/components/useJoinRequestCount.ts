import { useEffect, useState } from 'react';
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';

/** How many people wait to join this group (admins only). Re-read whenever `refreshKey` changes. */
export function useJoinRequestCount(
  conversationId: string,
  enabled: boolean,
  refreshKey: unknown,
): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    getApi()
      .call(ENDPOINTS.conversations.joinRequests, {
        params: { conversation_id: conversationId },
        query: {},
      })
      .then(
        (page) => {
          if (alive) setCount(page.items.length);
        },
        () => undefined, // no badge is better than an error on the header
      );
    return () => {
      alive = false;
    };
  }, [conversationId, enabled, refreshKey]);
  return enabled ? count : 0;
}
