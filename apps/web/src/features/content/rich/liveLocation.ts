// Live location: one text message that is edited with the new position every 30 s until the time
// is up or the person taps "Stop sharing". Edits have no time limit on the server, but if an
// edit is ever refused the next position goes out as a fresh message and sharing carries on.
import { ENDPOINTS } from '@chat/contracts';
import { getApi } from '@/lib/services';
import { locationText } from './richMessages';

const UPDATE_MS = 30_000;

interface Share {
  conversationId: string;
  messageId: string;
  until: Date;
  timer: ReturnType<typeof setInterval>;
}
const shares = new Map<string, Share>(); // by conversation id
const listeners = new Set<() => void>();
const changed = (): void => {
  listeners.forEach((l) => {
    l();
  });
};

export const subscribeLive = (l: () => void): (() => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};
export const isSharing = (conversationId: string): boolean => shares.has(conversationId);

export const getPosition = (): Promise<GeolocationPosition> =>
  new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) reject(new Error('Location is not available here.'));
    else
      navigator.geolocation.getCurrentPosition(resolve, reject, {
        enableHighAccuracy: true,
        timeout: 15_000,
      });
  });

const post = async (conversationId: string, text: string): Promise<string> => {
  const res = await getApi().call(ENDPOINTS.messages.send, {
    params: { conversation_id: conversationId },
    body: {
      client_message_id: crypto.randomUUID(),
      content: { type: 'text', text, no_preview: true },
    },
  });
  return res.message_id;
};

export const sendOneOffLocation = async (conversationId: string): Promise<void> => {
  const p = await getPosition();
  await post(conversationId, locationText(p.coords.latitude, p.coords.longitude, { live: false }));
};

export const startLiveLocation = async (conversationId: string, minutes: number): Promise<void> => {
  stopLiveLocation(conversationId);
  const until = new Date(Date.now() + minutes * 60_000);
  const p = await getPosition();
  const messageId = await post(
    conversationId,
    locationText(p.coords.latitude, p.coords.longitude, { live: true, until }),
  );
  const share: Share = {
    conversationId,
    messageId,
    until,
    timer: setInterval(() => {
      void update(share);
    }, UPDATE_MS),
  };
  shares.set(conversationId, share);
  changed();
};

const update = async (share: Share): Promise<void> => {
  if (Date.now() >= share.until.getTime()) {
    await finish(share);
    return;
  }
  try {
    const p = await getPosition();
    const text = locationText(p.coords.latitude, p.coords.longitude, {
      live: true,
      until: share.until,
    });
    try {
      await edit(share, text);
    } catch {
      share.messageId = await post(share.conversationId, text); // the edit window closed
    }
  } catch {
    /* no position this time: try again at the next tick */
  }
};

const edit = (share: Share, text: string): Promise<unknown> =>
  getApi().call(ENDPOINTS.messages.edit, {
    params: { conversation_id: share.conversationId, message_id: share.messageId },
    body: { content: { type: 'text', text, no_preview: true } },
  });

const finish = async (share: Share): Promise<void> => {
  clearInterval(share.timer);
  shares.delete(share.conversationId);
  changed();
  try {
    const p = await getPosition();
    await edit(
      share,
      locationText(p.coords.latitude, p.coords.longitude, { live: true, ended: true }),
    );
  } catch {
    /* the last text stays; it names the end time */
  }
};

export const stopLiveLocation = (conversationId: string): void => {
  const share = shares.get(conversationId);
  if (share) void finish(share);
};
