import { test, expect, type Browser, type Page } from '@playwright/test';
import { signIn, startDirectChat, uniqueName, type Person } from './support';

// Journey (i): calling someone whose app is closed. The server parks the offer for 45 seconds and
// queues a push (the worker only logs it here: there are no VAPID keys, and a headless browser
// has no push service). What can be checked in a browser is the part that does not need a push
// service: a person who opens Flick inside the window, the way a tap on the notification's
// "Answer" does (`/?answer=<call id>`), gets the incoming call; after the caller hangs up they
// do not. The real push, the notification and its buttons need a phone and are not tested here.
test.use({
  permissions: ['microphone', 'camera'],
  launchOptions: {
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
  },
});

/**
 * Records the call ids a browser sends in call_offer, read from its WebSocket frames (Socket.IO
 * "42[...]"). Install it before the page loads: only sockets opened afterwards are seen.
 */
function trackCallIds() {
  const ids: string[] = [];
  return {
    install: (page: Page): Promise<void> => {
      page.on('websocket', (ws) => {
        ws.on('framesent', ({ payload }) => {
          const text = typeof payload === 'string' ? payload : payload.toString();
          const match = /^42\d*\["call_offer",\{.*?"call_id":"([0-9a-f-]{36})"/.exec(text);
          if (match) ids.push(match[1]!);
        });
      });
      return Promise.resolve();
    },
    /** The id of the call placed after `already` calls. */
    async nth(already: number): Promise<string> {
      await expect.poll(() => ids.length).toBeGreaterThan(already);
      return ids[already]!;
    },
  };
}

/** Gives the person a push subscription, as the Settings switch would (a fake endpoint: nothing is sent). */
async function subscribeToPush(person: Person): Promise<void> {
  const status = await person.page.evaluate(async () => {
    const api = new URL(
      performance
        .getEntriesByType('resource')
        .map((e) => e.name)
        .find((n) => n.includes('/users/me'))!,
    );
    const base = api.href.slice(0, api.href.indexOf('/users/me'));
    const res = await fetch(`${base}/push/subscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer fake:${sessionStorage.getItem('flick.e2e_user')}`,
        'X-Device-Id': localStorage.getItem('flick.device_id')!,
      },
      body: JSON.stringify({
        endpoint: `https://push.example.test/${crypto.randomUUID()}`,
        keys: { p256dh: 'p256dh-test', auth: 'auth-test' },
      }),
    });
    return res.status;
  });
  expect(status).toBe(204);
}

/**
 * Opens Flick as `name` at `path`, like a tap on a notification does. The fake login is remembered
 * in sessionStorage (the app removes the query string at start, `?as=` included), so it is set up
 * front instead.
 */
async function openFlick(browser: Browser, name: string, path: string): Promise<Page> {
  const context = await browser.newContext({ permissions: ['microphone', 'camera'] });
  await context.addInitScript((user) => {
    sessionStorage.setItem('flick.e2e_user', user);
  }, name);
  const page = await context.newPage();
  await page.goto(path);
  return page;
}

test('a callee who opens Flick within the window gets the call; after a hang-up they do not', async ({
  browser,
}) => {
  const bobName = uniqueName('bob');
  const bob = await signIn(browser, bobName);
  const calls = trackCallIds();
  const alice = await signIn(browser, uniqueName('alice'), { beforeLoad: calls.install });
  await startDirectChat(alice.page, bob.name);
  await subscribeToPush(bob);
  await bob.context.close(); // Bob's app is closed: no connected device

  // Alice calls. She is not told "offline" or "not reachable": Bob can be rung by push.
  await alice.page.getByRole('button', { name: `Start voice call with ${bob.name}` }).click();
  const callId = await calls.nth(0);
  await expect(alice.page.getByRole('dialog', { name: /Voice call with/ })).toBeVisible();
  await expect(alice.page.getByText('Calling…').first()).toBeVisible();

  // Bob taps "Answer" on the notification: the app opens at /?answer=<call id> and the parked
  // offer is handed over right after it connects.
  const bobAgain = await openFlick(browser, bobName, `/?answer=${callId}`);
  const incoming = bobAgain.getByRole('alertdialog');
  await expect(incoming).toBeVisible();
  await expect(incoming.getByText('Incoming voice call…')).toBeVisible();
  await expect(incoming.getByRole('button', { name: 'Accept call' })).toBeFocused();

  // He accepts: it is an ordinary call from here on.
  // (The button bounces, so Playwright never sees it as stable: Enter on the focused button it is.)
  await bobAgain.keyboard.press('Enter');
  await expect(bobAgain.getByRole('dialog', { name: /Voice call with/ })).toBeVisible();
  await expect(alice.page.getByText('Calling…')).toHaveCount(0);

  await alice.page.getByRole('button', { name: 'End call' }).click();
  await expect(alice.page.getByRole('dialog', { name: /Voice call with/ })).toHaveCount(0);

  // A second call: Alice rings, gives up, and only then does Bob open the app.
  await bobAgain.context().close(); // Bob's app is closed again
  await alice.page.getByRole('button', { name: `Start voice call with ${bob.name}` }).click();
  const secondId = await calls.nth(1);
  await expect(alice.page.getByText('Calling…').first()).toBeVisible();
  await alice.page.getByRole('button', { name: 'End call' }).click();

  const bobLate = await openFlick(browser, bobName, `/?answer=${secondId}`);
  await expect(bobLate.getByText('That call has ended.')).toBeVisible({ timeout: 20_000 });
  await expect(bobLate.getByRole('alertdialog')).toHaveCount(0);
});

test('a callee with no push subscription is "not reachable" at once', async ({ browser }) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'));
  await startDirectChat(alice.page, bob.name);
  await bob.context.close();

  await alice.page.getByRole('button', { name: `Start voice call with ${bob.name}` }).click();
  await expect(alice.page.getByText(/is not reachable right now/)).toBeVisible({ timeout: 5_000 });
  await expect(alice.page.getByRole('dialog', { name: /Voice call with/ })).toHaveCount(0);
});
