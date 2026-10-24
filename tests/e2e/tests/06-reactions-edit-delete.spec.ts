import { test, expect } from '@playwright/test';
import {
  bubble,
  openChat,
  openMessageMenu,
  send,
  signIn,
  startDirectChat,
  uniqueName,
} from './support';

// Journey (f): changes to an existing message reach the other person live.
test('a reaction, an edit and a delete-for-everyone show up live', async ({ browser }) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'));

  await startDirectChat(alice.page, bob.name);
  await send(alice.page, 'original text');
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, 'original text')).toBeVisible();

  // Bob reacts with a thumbs up; Alice sees the reaction on her message.
  await openMessageMenu(bob.page, 'original text');
  await bob.page.getByRole('button', { name: 'React 👍' }).click();
  await expect(
    bubble(alice.page, 'original text').getByRole('button', { name: /^👍 1 reaction/ }),
  ).toBeVisible();

  // Alice edits her message; Bob sees the new text and the "edited" label, without a reload.
  await openMessageMenu(alice.page, 'original text');
  await alice.page.getByRole('menuitem', { name: 'Edit' }).click();
  await alice.page.getByLabel('Edit your message').fill('edited text');
  await alice.page.getByRole('button', { name: 'Save edit' }).click();
  await expect(bubble(bob.page, 'edited text')).toContainText('edited');
  await expect(bubble(bob.page, 'original text')).toHaveCount(0);

  // Alice deletes it for everyone; Bob's bubble turns into a notice.
  await openMessageMenu(alice.page, 'edited text');
  await alice.page.getByRole('menuitem', { name: 'Delete' }).click();
  await alice.page.getByRole('menuitem', { name: 'Delete for everyone' }).click();
  await expect(bob.page.getByRole('article').getByText('This message was deleted')).toBeVisible();
  await expect(bob.page.getByText('edited text')).toHaveCount(0);
});
