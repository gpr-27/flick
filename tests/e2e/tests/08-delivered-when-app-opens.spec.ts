import { test, expect } from '@playwright/test';
import { chatInList, openChat, send, signIn, startDirectChat, tick, uniqueName } from './support';

// Journey (h): the app was closed when the message arrived. Opening it must turn the sender's
// single tick into two ticks (delivered) even before the chat itself is opened; opening the chat
// then makes it blue. Before the fix the tick stayed single and jumped straight to blue.
test('a message that arrived while the app was closed shows delivered as soon as it opens', async ({
  browser,
}) => {
  const bobName = uniqueName('bob');
  const bob = await signIn(browser, bobName);
  const alice = await signIn(browser, uniqueName('alice'));

  // Introduce the two, then Bob closes the app completely.
  await startDirectChat(alice.page, bob.name);
  await send(alice.page, 'hi bob');
  await bob.context.close();

  await send(alice.page, 'sent while you were away');
  await expect(tick(alice.page, 'sent while you were away')).toHaveAccessibleName('Sent');

  // Bob opens the app again and stays on the chat list.
  const bobAgain = await signIn(browser, bobName);
  await expect(chatInList(bobAgain.page, alice.name)).toBeVisible();
  await expect(tick(alice.page, 'sent while you were away')).toHaveAccessibleName('Delivered');

  // Only when he opens the chat is it read.
  await openChat(bobAgain.page, alice.name);
  await expect(tick(alice.page, 'sent while you were away')).toHaveAccessibleName('Read');
});
