import { test, expect } from '@playwright/test';
import { bubble, openChat, send, signIn, startDirectChat, uniqueName } from './support';

// Journey (a): one user sends, the other sees it appear live, with no reload.
test('a message reaches the other user live, without a reload', async ({ browser }) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'));

  await startDirectChat(alice.page, bob.name);
  await send(alice.page, 'hello bob');
  await expect(bubble(alice.page, 'hello bob')).toBeVisible();

  // Bob never reloads: the new chat appears in his list through the live connection.
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, 'hello bob')).toBeVisible();

  // And with the chat open, the next message just shows up.
  await send(alice.page, 'second message');
  await expect(bubble(bob.page, 'second message')).toBeVisible();
});
