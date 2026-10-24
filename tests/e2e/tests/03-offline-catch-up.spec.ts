import { test, expect } from '@playwright/test';
import { bubble, openChat, send, signIn, startDirectChat, uniqueName } from './support';

// Journey (c): a person loses their connection, messages pile up, and when the connection comes
// back every missed message appears once, in the order it was sent. The browser fetches what it
// missed with the sync call and the server keeps a sequence number per chat, so nothing is lost
// and nothing repeats.
test('a user who was offline gets every missed message once, in order', async ({ browser }) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'));

  await startDirectChat(alice.page, bob.name);
  await send(alice.page, 'before the outage');
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, 'before the outage')).toBeVisible();

  // Bob's network goes away. The app notices and tells him.
  await bob.context.setOffline(true);
  await expect(bob.page.getByText(/offline|reconnecting/i).first()).toBeVisible();

  await send(alice.page, 'missed 1');
  await send(alice.page, 'missed 2');
  await send(alice.page, 'missed 3');
  await expect(bubble(alice.page, 'missed 3')).toBeVisible();
  // Nothing has reached Bob yet.
  await expect(bubble(bob.page, 'missed 1')).toHaveCount(0);

  // The network returns.
  await bob.context.setOffline(false);

  // `toHaveText` with a list checks the exact number of bubbles and their order.
  const bobsBubbles = bob.page.getByRole('article');
  await expect(bobsBubbles).toHaveText([/before the outage/, /missed 1/, /missed 2/, /missed 3/]);
});
