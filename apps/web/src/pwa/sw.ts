// Flick's service worker (built by vite-plugin-pwa, "injectManifest" strategy).
// Three jobs, nothing else:
//   1. precache the app shell (JS, CSS, index.html, icons) so the app opens offline;
//   2. show a notification for each push (a message, or an incoming call with Answer/Decline
//      buttons) and focus/open the app when it is clicked;
//   3. apply an update when the page asks for it.
// It never caches API responses, uploads or tokens: only the build output listed in
// self.__WB_MANIFEST, plus index.html as the answer to page navigations.
import {
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import {
  callNotification,
  declineRequest,
  missedCallNotification,
  parseCallPush,
  planClick,
  type ShownCallNotification,
} from './callPush';
import { pickWindow } from './clickTarget';
import {
  chatTag,
  parsePushPayload,
  parseTestPush,
  previousOf,
  testNotification,
  toNotification,
  type ShownNotification,
} from './pushPayload';

// This file is compiled with the DOM lib (not "webworker"), so declare the few worker APIs used.
interface WorkerClient {
  focus: () => Promise<unknown>;
  postMessage: (message: unknown) => void;
  focused: boolean;
  visibilityState: string;
}
interface WorkerEvent extends Event {
  waitUntil: (promise: Promise<unknown>) => void;
}
interface PushEventLike extends WorkerEvent {
  data: { json: () => unknown } | null;
}
interface ClickEventLike extends WorkerEvent {
  /** The button that was pressed ("answer", "decline"), or "" for a tap on the notification. */
  action: string;
  notification: { close: () => void; data?: { url?: string } };
}
interface SubscriptionChangeEventLike extends WorkerEvent {
  oldSubscription?: { options?: { applicationServerKey?: ArrayBuffer | null } } | null;
}
interface MessageEventLike extends Event {
  data: unknown;
}
interface WorkerManifest {
  __WB_MANIFEST: { url: string; revision: string | null }[];
}
interface WorkerScope {
  registration: {
    showNotification: (title: string, options: object) => Promise<void>;
    getNotifications: (filter: { tag: string }) => Promise<{ data?: unknown }[]>;
    pushManager: { subscribe: (options: object) => Promise<unknown> };
  };
  clients: {
    matchAll: (options: object) => Promise<WorkerClient[]>;
    openWindow: (url: string) => Promise<unknown>;
  };
  skipWaiting: () => Promise<void>;
  addEventListener: (type: string, listener: (event: never) => void) => void;
}
const sw = self as unknown as WorkerScope;

cleanupOutdatedCaches();
// The build replaces the literal text `self.__WB_MANIFEST` with the list of files to precache.
precacheAndRoute((self as unknown as WorkerManifest).__WB_MANIFEST);
// Page loads (any client route) get the cached shell. /api and the health check go to the network.
registerRoute(
  new NavigationRoute(createHandlerBoundToURL('/index.html'), {
    denylist: [/^\/api\//, /^\/healthz/],
  }),
);

/**
 * Turns one push into the notification to show. A call push rings (Answer / Decline); a message
 * push joins the open notification of the same chat ("Bob: 3 new messages"); anything unreadable
 * still becomes a generic notification, because a push that shows nothing costs the site its
 * notification permission.
 */
async function notificationFor(raw: unknown): Promise<ShownNotification | ShownCallNotification> {
  const call = parseCallPush(raw);
  if (call) return call.type === 'call' ? callNotification(call) : missedCallNotification(call);
  const test = parseTestPush(raw);
  if (test) return testNotification(test);
  const payload = parsePushPayload(raw);
  let previous = null;
  if (payload) {
    try {
      const open = await sw.registration.getNotifications({
        tag: chatTag(payload.conversation_id),
      });
      previous = previousOf(open[0]?.data);
    } catch {
      // cannot look: show it as a first message
    }
  }
  return toNotification(payload, previous);
}

sw.addEventListener('push', (event: PushEventLike) => {
  event.waitUntil(
    (async () => {
      let raw: unknown = null;
      try {
        raw = event.data?.json() ?? null;
      } catch {
        // not JSON: fall back to the generic notification
      }
      let shown;
      try {
        shown = await notificationFor(raw);
      } catch {
        shown = toNotification(null);
      }
      await sw.registration.showNotification(shown.title, shown.options);
    })(),
  );
});

// The browser replaced our subscription (the push service rotated it). Subscribe again with the
// same key at once, then tell open windows: the service worker has no login, so the page tells the
// server about the new endpoint.
sw.addEventListener('pushsubscriptionchange', (event: SubscriptionChangeEventLike) => {
  event.waitUntil(
    (async () => {
      const key = event.oldSubscription?.options?.applicationServerKey;
      if (key) {
        try {
          await sw.registration.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: key,
          });
        } catch {
          // the page will try again when it opens
        }
      }
      const open = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of open) client.postMessage({ type: 'push-subscription-changed' });
    })(),
  );
});

sw.addEventListener('notificationclick', (event: ClickEventLike) => {
  event.notification.close();
  const plan = planClick(event.action, event.notification.data ?? {});
  if (plan.type === 'decline') {
    // No login here: the token that came in the push proves who is declining. Best effort.
    const { url, init } = declineRequest(
      import.meta.env.VITE_API_URL as string,
      plan.callId,
      plan.token,
    );
    event.waitUntil(
      fetch(url, init).then(
        () => undefined,
        () => undefined,
      ),
    );
    return;
  }
  const url = plan.url;
  event.waitUntil(
    (async () => {
      const open = await sw.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = pickWindow(open);
      if (existing) {
        existing.postMessage({ type: 'open-url', url });
        try {
          await existing.focus();
          return;
        } catch {
          // the browser refused to focus it: open a window instead
        }
      }
      await sw.clients.openWindow(url);
    })(),
  );
});

// The page sends this when the user taps "Reload" on the update toast.
sw.addEventListener('message', (event: MessageEventLike) => {
  const data = event.data as { type?: string } | null;
  if (data?.type === 'SKIP_WAITING') void sw.skipWaiting();
});
