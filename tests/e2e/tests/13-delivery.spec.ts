import { test, expect } from '@playwright/test';
import {
  bubble,
  chatInList,
  createGroup,
  openChat,
  openPair,
  send,
  signIn,
  tick,
  uniqueName,
} from './support';

// Journeys 13: what the sender sees while the other side is away. The direct-chat cases are in
// 02, 03, 04 and 08; these add a group of three and a queue of messages written while offline.

test('in a group the ticks wait for every member: sent, delivered to all, then read by all', async ({
  browser,
}) => {
  const bobName = uniqueName('bob');
  const carolName = uniqueName('carol');
  const title = uniqueName('trio');
  const bob = await signIn(browser, bobName);
  const carol = await signIn(browser, carolName);
  const alice = await signIn(browser, uniqueName('alice'));

  await createGroup(alice.page, title, [bobName, carolName]);
  await send(alice.page, 'welcome, both');
  await openChat(bob.page, title);
  await openChat(carol.page, title);
  await expect(bubble(bob.page, 'welcome, both')).toBeVisible();
  await expect(bubble(carol.page, 'welcome, both')).toBeVisible();
  // Both have seen it: read by everybody.
  await expect(tick(alice.page, 'welcome, both')).toHaveAccessibleName('Read');

  // Both close the app completely; a message now can only be stored.
  await bob.context.close();
  await carol.context.close();
  await send(alice.page, 'while you were both away');
  await expect(tick(alice.page, 'while you were both away')).toHaveAccessibleName('Sent');

  // Bob opens the app (staying on his chat list). One of two is not enough: still a single tick.
  const bobAgain = await signIn(browser, bobName);
  await expect(chatInList(bobAgain.page, title)).toBeVisible();
  await expect(chatInList(bobAgain.page, title)).toContainText('while you were both away');
  await expect(tick(alice.page, 'while you were both away')).toHaveAccessibleName('Sent');

  // Carol opens the app too: now it reached everybody, and it is delivered, not yet read.
  const carolAgain = await signIn(browser, carolName);
  await expect(chatInList(carolAgain.page, title)).toBeVisible();
  await expect(tick(alice.page, 'while you were both away')).toHaveAccessibleName('Delivered');

  // Bob reads it; Carol has not, so it is still only delivered.
  await openChat(bobAgain.page, title);
  await expect(bubble(bobAgain.page, 'while you were both away')).toBeVisible();
  await expect(tick(alice.page, 'while you were both away')).toHaveAccessibleName('Delivered');

  // Carol reads it too: read by everybody.
  await openChat(carolAgain.page, title);
  await expect(bubble(carolAgain.page, 'while you were both away')).toBeVisible();
  await expect(tick(alice.page, 'while you were both away')).toHaveAccessibleName('Read');
});

test('messages written offline wait in the outbox, then arrive once and in order', async ({
  browser,
}) => {
  const { alice, bob } = await openPair(browser, 'before the signal went');

  await alice.context.setOffline(true);
  await expect(alice.page.getByText(/offline|reconnecting/i).first()).toBeVisible();
  await send(alice.page, 'queued 1');
  await send(alice.page, 'queued 2');
  await send(alice.page, 'queued 3');

  // They are on Alice's screen with a clock ("Sending"), and nothing has reached Bob.
  for (const text of ['queued 1', 'queued 2', 'queued 3']) {
    await expect(tick(alice.page, text)).toHaveAccessibleName('Sending');
  }
  await expect(bubble(bob.page, 'queued 1')).toHaveCount(0);

  // The signal comes back: the outbox sends them, oldest first.
  await alice.context.setOffline(false);
  for (const text of ['queued 1', 'queued 2', 'queued 3']) {
    await expect(tick(alice.page, text)).toHaveAccessibleName(/^(Sent|Delivered|Read)$/);
  }
  await expect(bob.page.getByRole('article')).toHaveText([
    /before the signal went/,
    /queued 1/,
    /queued 2/,
    /queued 3/,
  ]);
  // And Alice's own list has each exactly once as well.
  await expect(alice.page.getByRole('article')).toHaveText([
    /before the signal went/,
    /queued 1/,
    /queued 2/,
    /queued 3/,
  ]);
  await expect(alice.page.getByRole('img', { name: 'Sending' })).toHaveCount(0);
});
