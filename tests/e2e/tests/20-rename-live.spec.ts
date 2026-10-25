import { test, expect } from '@playwright/test';
import {
  bubble,
  closeChat,
  createGroup,
  goTo,
  openChat,
  send,
  signIn,
  uniqueName,
} from './support';

// Journey 20: a person renames themselves on the Flick profile page. Everyone who shares a chat
// with them sees the new name on their messages without a reload.
test('a new display name reaches the people in a group without a reload', async ({ browser }) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'));
  const title = uniqueName('crew');

  await createGroup(alice.page, title, [bob.name]);
  await send(alice.page, 'hello from before the rename');
  await openChat(bob.page, title);
  await expect(bubble(bob.page, 'hello from before the rename')).toBeVisible();

  // Bob never reloads: this marker disappears if the page is loaded again.
  await bob.page.evaluate(() => {
    (window as unknown as { __noReload: boolean }).__noReload = true;
  });

  // Alice changes her name on the Flick profile page (a move inside the app, not a reload).
  const newName = `Alice ${Math.random().toString(36).slice(2, 7)}`;
  await closeChat(alice.page);
  await goTo(alice.page, 'Profile');
  await expect(
    alice.page.getByText('Changing your name here also updates your sign-in account.'),
  ).toBeVisible();
  await alice.page.getByLabel('Display name').fill(newName);
  await alice.page.getByRole('button', { name: 'Save' }).click();
  await expect(alice.page.getByText('Profile saved.')).toBeVisible();

  // Bob sees the new name on her earlier message, with no reload.
  await expect(bubble(bob.page, 'hello from before the rename')).toContainText(newName);
  expect(
    await bob.page.evaluate(() => (window as unknown as { __noReload?: boolean }).__noReload),
  ).toBe(true);
});
