import { test, expect } from '@playwright/test';
import {
  bubble,
  closeChat,
  openChat,
  send,
  signIn,
  startDirectChat,
  tick,
  uniqueName,
} from './support';

// Journey (b): the tick on my message follows what the other person has done.
//   one tick  = the server has it
//   two ticks = it reached the other person's device
//   blue      = they opened the chat and saw it
test('ticks go from sent, to delivered, to read', async ({ browser }) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'));

  // Introduce the two so the chat exists on both screens.
  await startDirectChat(alice.page, bob.name);
  await send(alice.page, 'hi bob');
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, 'hi bob')).toBeVisible();

  // Bob loses his connection, so a new message can only be stored, not delivered.
  await bob.context.setOffline(true);
  await expect(bob.page.getByText(/offline|reconnecting/i).first()).toBeVisible();
  await send(alice.page, 'are you there?');
  await expect(tick(alice.page, 'are you there?')).toHaveAccessibleName('Sent');

  // Bob reconnects: his device catches up, so the message is delivered. He is looking at the
  // chat, so it is read at once; to see "Delivered" on its own he must be somewhere else.
  await closeChat(bob.page);
  await bob.context.setOffline(false);
  await expect(tick(alice.page, 'are you there?')).toHaveAccessibleName('Delivered');

  // Bob opens the chat: now it is read.
  await openChat(bob.page, alice.name);
  await expect(tick(alice.page, 'are you there?')).toHaveAccessibleName('Read');

  // A message that arrives while Bob is looking at the chat is read straight away.
  await send(alice.page, 'and now?');
  await expect(tick(alice.page, 'and now?')).toHaveAccessibleName('Read');
});
