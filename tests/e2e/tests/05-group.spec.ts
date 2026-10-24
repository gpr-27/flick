import { test, expect } from '@playwright/test';
import { bubble, createGroup, openChat, send, signIn, uniqueName } from './support';

// Journey (e): a group of three. A message reaches every member. After one member is removed,
// that person no longer receives anything, while the others carry on.
test('group messages reach all members, and a removed member stops receiving', async ({
  browser,
}) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const carol = await signIn(browser, uniqueName('carol'));
  const alice = await signIn(browser, uniqueName('alice'));
  const title = uniqueName('team');

  await createGroup(alice.page, title, [bob.name, carol.name]);
  await send(alice.page, 'welcome, everyone');

  for (const member of [bob, carol]) {
    await openChat(member.page, title);
    await expect(bubble(member.page, 'welcome, everyone')).toBeVisible();
  }

  // Alice (the owner) removes Bob in the group info dialog.
  await alice.page.getByRole('button', { name: 'Group info' }).click();
  await alice.page.getByRole('button', { name: `Remove ${bob.name}` }).click();
  await expect(alice.page.getByRole('button', { name: `Remove ${bob.name}` })).toHaveCount(0);
  await alice.page.getByRole('button', { name: 'Close', exact: true }).click();

  await send(alice.page, 'only for the remaining two');
  await expect(bubble(carol.page, 'only for the remaining two')).toBeVisible();

  // Carol has it, so by now it would have reached Bob too if he were still a member.
  // A reload makes Bob ask the server again from scratch: he must not get the message.
  await bob.page.reload();
  await expect(bob.page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await expect(bob.page.getByText('only for the remaining two')).toHaveCount(0);
  await expect(bob.page.getByRole('option', { name: new RegExp(title) })).toHaveCount(0);
});
