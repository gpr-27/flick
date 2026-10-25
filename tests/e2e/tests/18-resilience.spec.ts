import { test, expect, type Page, type WebSocketRoute } from '@playwright/test';
import {
  attachFile,
  bubble,
  makePng,
  openChat,
  openPair,
  send,
  signIn,
  startDirectChat,
  tick,
  uniqueName,
} from './support';

// Journeys 18: a bad network. The stack cannot be restarted from a test, so a server restart is
// not covered here (see the README).

/** Throttle the HTTP side of a page (CDP): every request waits `latencyMs`, bytes crawl. */
async function slowHttp(page: Page, latencyMs: number, bytesPerSecond: number): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  await cdp.send('Network.emulateNetworkConditions', {
    offline: false,
    latency: latencyMs,
    downloadThroughput: bytesPerSecond,
    uploadThroughput: bytesPerSecond,
  });
}

test('on a slow connection a chat, messages and a photo still get through', async ({ browser }) => {
  const delayMs = 1200;
  // Slow WebSocket: every frame, in both directions, waits before it goes on (CDP throttling does
  // not touch WebSockets, so this part is done by hand). Order is kept: all frames wait the same.
  const slowSocket = (page: Page): Promise<void> =>
    page.routeWebSocket(/\/socket\.io\//, (ws) => {
      const server = ws.connectToServer();
      ws.onMessage((frame) => {
        setTimeout(() => {
          server.send(frame);
        }, delayMs);
      });
      server.onMessage((frame) => {
        setTimeout(() => {
          ws.send(frame);
        }, delayMs);
      });
    });

  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'), { beforeLoad: slowSocket });
  await slowHttp(alice.page, 700, 40 * 1024);

  // Starting a chat needs a user search (slow HTTP) and a chat creation.
  await startDirectChat(alice.page, bob.name);
  // A text message waits in the outbox with a clock, then is accepted a few seconds later.
  await send(alice.page, 'sent over a slow line');
  await expect(tick(alice.page, 'sent over a slow line')).toHaveAccessibleName('Sending');
  await expect(tick(alice.page, 'sent over a slow line')).toHaveAccessibleName(
    /^(Sent|Delivered|Read)$/,
    {
      timeout: 45_000,
    },
  );
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, 'sent over a slow line')).toBeVisible({ timeout: 45_000 });

  // Several in a row arrive complete and in order, once each.
  for (const text of ['slow 1', 'slow 2', 'slow 3']) await send(alice.page, text);
  await expect(bob.page.getByRole('article')).toHaveText(
    [/sent over a slow line/, /slow 1/, /slow 2/, /slow 3/],
    { timeout: 60_000 },
  );

  // A photo goes up over the slow line (a presigned upload) and is shown to both.
  await attachFile(alice.page, 'Photo or video', {
    name: 'slow.png',
    mimeType: 'image/png',
    buffer: makePng(120, 80, [30, 160, 90]),
  });
  await alice.page.getByRole('button', { name: 'Send message' }).click();
  await expect(bob.page.getByRole('article').getByRole('img', { name: 'Image' })).toBeVisible({
    timeout: 60_000,
  });
});

test('after the WebSocket drops, the app reconnects and catches up with what it missed', async ({
  browser,
}) => {
  test.setTimeout(150_000);
  // Bob's socket goes through a proxy that can be cut: while `cut` is true every connection is
  // closed at once, as when a network gives out, and nothing reaches the server.
  let cut = false;
  const open: WebSocketRoute[] = [];
  let attempts = 0;
  const cuttable = (page: Page): Promise<void> =>
    page.routeWebSocket(/\/socket\.io\//, (ws) => {
      attempts += 1;
      if (cut) {
        void ws.close();
        return;
      }
      const server = ws.connectToServer();
      open.push(ws);
      ws.onMessage((frame) => {
        server.send(frame);
      });
      server.onMessage((frame) => {
        ws.send(frame);
      });
      server.onClose(() => void ws.close());
    });

  const alice = await signIn(browser, uniqueName('alice'));
  const bob = await signIn(browser, uniqueName('bob'), { beforeLoad: cuttable });
  await startDirectChat(alice.page, bob.name);
  await send(alice.page, 'before the drop');
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, 'before the drop')).toBeVisible();

  // The connection dies and stays dead for a while. Bob's app says so.
  cut = true;
  for (const ws of open.splice(0)) void ws.close();
  await expect(bob.page.getByText(/offline|reconnecting/i).first()).toBeVisible();
  await send(alice.page, 'while the line was down 1');
  await send(alice.page, 'while the line was down 2');
  await expect(tick(alice.page, 'while the line was down 2')).toHaveAccessibleName(
    /^(Sent|Delivered|Read)$/,
  );
  // The app keeps trying (and is refused); nothing leaked through.
  await expect.poll(() => attempts).toBeGreaterThan(1);
  await expect(bubble(bob.page, 'while the line was down 1')).toHaveCount(0);

  // The line comes back: Bob reconnects by himself, and the sync brings the two missed messages,
  // once each, in order, and tells Alice they were delivered.
  cut = false;
  await expect(bob.page.getByRole('article')).toHaveText(
    [/before the drop/, /while the line was down 1/, /while the line was down 2/],
    { timeout: 90_000 },
  );
  await expect(bob.page.getByText(/offline|reconnecting/i)).toHaveCount(0);
  await expect(tick(alice.page, 'while the line was down 2')).toHaveAccessibleName('Read');

  // And it keeps working live afterwards.
  await send(alice.page, 'live again');
  await expect(bubble(bob.page, 'live again')).toBeVisible();
});

test('a message written offline is sent when the line returns, and arrives exactly once', async ({
  browser,
}) => {
  const { alice, bob } = await openPair(browser, 'first');
  await alice.context.setOffline(true);
  await expect(alice.page.getByText(/offline|reconnecting/i).first()).toBeVisible();
  await send(alice.page, 'typed while offline');
  await expect(tick(alice.page, 'typed while offline')).toHaveAccessibleName('Sending');
  // Back online: the outbox sends it. Bob loads it fresh from the server: one copy.
  await alice.context.setOffline(false);
  await expect(tick(alice.page, 'typed while offline')).toHaveAccessibleName(
    /^(Sent|Delivered|Read)$/,
  );
  await bob.page.reload();
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, 'typed while offline')).toHaveCount(1);
});
