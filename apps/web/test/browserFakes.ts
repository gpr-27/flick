import { vi, type Mock } from 'vitest';

export interface FakeNotificationClass {
  permission: NotificationPermission;
  created: { title: string; options: NotificationOptions | undefined }[];
  instances: { onclick: (() => void) | null }[];
}

export interface FakePush {
  pushManager: { getSubscription: Mock; subscribe: Mock };
  subscription: { endpoint: string; unsubscribe: Mock };
  requestPermission: Mock;
  FakeNotification: FakeNotificationClass;
}

export interface FakePushOptions {
  permission?: NotificationPermission;
  /** What requestPermission() answers when the user clicks the browser prompt. */
  answer?: NotificationPermission;
  subscribed?: boolean;
}

/** A fake service worker + PushManager + Notification, installed on the global objects. */
export const installFakePush = ({
  permission = 'default',
  answer = 'granted',
  subscribed = false,
}: FakePushOptions = {}): FakePush => {
  const subscription = {
    endpoint: 'https://push.example/abc',
    toJSON: () => ({ endpoint: 'https://push.example/abc', keys: { p256dh: 'p', auth: 'a' } }),
    unsubscribe: vi.fn(() => Promise.resolve(true)),
  };
  let current: typeof subscription | null = subscribed ? subscription : null;
  const pushManager = {
    getSubscription: vi.fn(() => Promise.resolve(current)),
    subscribe: vi.fn(() => {
      current = subscription;
      return Promise.resolve(subscription);
    }),
  };
  Object.defineProperty(navigator, 'serviceWorker', {
    value: { ready: Promise.resolve({ pushManager }) },
    configurable: true,
  });
  vi.stubGlobal('PushManager', function PushManager() {});

  const requestPermission = vi.fn(() => {
    FakeNotification.permission = answer;
    return Promise.resolve(answer);
  });
  class FakeNotification {
    static permission: NotificationPermission = permission;
    static requestPermission = requestPermission;
    static created: { title: string; options: NotificationOptions | undefined }[] = [];
    static instances: FakeNotification[] = [];
    onclick: (() => void) | null = null;
    constructor(title: string, options?: NotificationOptions) {
      FakeNotification.created.push({ title, options });
      FakeNotification.instances.push(this);
    }
    close = vi.fn();
  }
  vi.stubGlobal('Notification', FakeNotification);

  return { pushManager, subscription, requestPermission, FakeNotification };
};

export const removeFakePush = (): void => {
  Reflect.deleteProperty(navigator, 'serviceWorker');
  vi.unstubAllGlobals();
};
