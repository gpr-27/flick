import { test, expect } from '@playwright/test';
import {
  apiSendText,
  bubble,
  closeChat,
  composer,
  conversationId,
  createGroup,
  doAction,
  openChat,
  openPair,
  sendAndWait,
  signIn,
  uniqueName,
} from './support';

// Journeys 10: finding things again: stars, pins, search and @mentions.

test('star and unstar a message, and find it in the starred list', async ({ browser }) => {
  const { alice } = await openPair(browser);
  await sendAndWait(alice.page, 'remember this one');

  await doAction(alice.page, 'remember this one', 'Star');
  await expect(
    bubble(alice.page, 'remember this one').getByRole('img', { name: 'Starred' }),
  ).toBeVisible();

  // The starred list is on the chat list screen (a phone goes back to it first).
  await closeChat(alice.page);
  await alice.page.getByRole('button', { name: 'Starred messages' }).click();
  const dialog = alice.page.getByRole('dialog', { name: 'Starred messages' });
  await expect(dialog.getByText('remember this one')).toBeVisible();

  // Choosing it opens the chat at that message.
  await dialog
    .getByRole('button', { name: /remember this one/ })
    .first()
    .click();
  await expect(bubble(alice.page, 'remember this one')).toBeInViewport();

  // Unstar from the action sheet: the star goes and the list is empty.
  await doAction(alice.page, 'remember this one', 'Unstar');
  await expect(
    bubble(alice.page, 'remember this one').getByRole('img', { name: 'Starred' }),
  ).toHaveCount(0);
  await closeChat(alice.page);
  await alice.page.getByRole('button', { name: 'Starred messages' }).click();
  await expect(alice.page.getByText('No starred messages')).toBeVisible();
  await alice.page.getByRole('button', { name: 'Close', exact: true }).click();
});

test('pin two messages, use the pinned bar to jump between them, then unpin', async ({
  browser,
}) => {
  const { alice, bob } = await openPair(browser, 'pin A');
  await sendAndWait(alice.page, 'pin B');
  await expect(bubble(bob.page, 'pin B')).toBeVisible();

  await doAction(alice.page, 'pin A', 'Pin');
  await expect(bubble(alice.page, 'pin A').getByRole('img', { name: 'Pinned' })).toBeVisible();
  await doAction(alice.page, 'pin B', 'Pin');
  await expect(bubble(alice.page, 'pin B').getByRole('img', { name: 'Pinned' })).toBeVisible();

  // Pins are shared by the whole chat, but there is no live event for them: the other person
  // gets the bar when the chat is opened again.
  const bar = (page: typeof alice.page) =>
    page.getByRole('button', { name: /^Pinned message \d of 2/ });
  await expect(bar(alice.page)).toBeVisible();
  await closeChat(bob.page);
  await openChat(bob.page, alice.name);
  await expect(bar(bob.page)).toBeVisible();

  // Bury both pins under newer messages so that the bar has somewhere to take us.
  const id = await conversationId(alice.page, bob.name);
  for (let i = 1; i <= 30; i++) await apiSendText(bob.name, id, `filler ${i}`);
  await expect(bubble(alice.page, 'filler 30')).toBeVisible();
  await expect(bubble(alice.page, 'pin A')).toHaveCount(0);
  await expect(bubble(alice.page, 'pin B')).toHaveCount(0);

  // Each press of the bar goes to the next pin and shows it on screen.
  const first = await bar(alice.page).getAttribute('aria-label');
  const firstName = /pin [AB]/.exec(first ?? '')?.[0] ?? '';
  const secondName = firstName === 'pin A' ? 'pin B' : 'pin A';
  expect([firstName, secondName].sort()).toEqual(['pin A', 'pin B']);
  await bar(alice.page).click();
  await expect(bubble(alice.page, firstName)).toBeInViewport();
  await bar(alice.page).click();
  await expect(bubble(alice.page, secondName)).toBeInViewport();

  // Unpin through the action sheet; the bar counts down and then goes away.
  await doAction(alice.page, secondName, 'Unpin');
  await expect(bubble(alice.page, secondName).getByRole('img', { name: 'Pinned' })).toHaveCount(0);
  await expect(alice.page.getByRole('button', { name: /^Pinned message 1 of 1/ })).toBeVisible();
  await alice.page.getByRole('button', { name: /^Pinned message 1 of 1/ }).click();
  await expect(bubble(alice.page, firstName)).toBeInViewport();
  await doAction(alice.page, firstName, 'Unpin');
  await expect(alice.page.getByRole('button', { name: /^Pinned message/ })).toHaveCount(0);
  await closeChat(bob.page);
  await openChat(bob.page, alice.name);
  await expect(bob.page.getByRole('region', { name: `Chat with ${alice.name}` })).toBeVisible();
  await expect(bob.page.getByRole('button', { name: /^Pinned message/ })).toHaveCount(0);
});

test('search finds a message and opens the chat at it', async ({ browser }) => {
  const { alice, bob } = await openPair(browser);
  const word = `quokka${Math.random().toString(16).slice(2, 8)}`;
  await sendAndWait(alice.page, `my ${word} is hiding`);
  await sendAndWait(alice.page, 'nothing special here');
  await expect(bubble(bob.page, 'nothing special here')).toBeVisible();

  // Search from the chat list (a phone goes back to it).
  await closeChat(bob.page);
  await bob.page.getByRole('button', { name: 'Search messages' }).click();
  const dialog = bob.page.getByRole('dialog', { name: 'Search messages' });
  await dialog.getByRole('searchbox', { name: 'Search messages' }).fill(word);
  await dialog.getByRole('button', { name: 'Search' }).click();
  const hit = dialog.getByRole('list', { name: 'Search results' }).getByRole('button');
  await expect(hit).toHaveCount(1);
  await expect(hit).toContainText(word);
  await hit.click();
  await expect(bubble(bob.page, word)).toBeInViewport();

  // A word that nobody wrote gives a plain "nothing found".
  await closeChat(bob.page);
  await bob.page.getByRole('button', { name: 'Search messages' }).click();
  await bob.page
    .getByRole('dialog', { name: 'Search messages' })
    .getByRole('searchbox', { name: 'Search messages' })
    .fill('zzzznothingzzzz');
  await bob.page
    .getByRole('dialog', { name: 'Search messages' })
    .getByRole('button', { name: 'Search' })
    .click();
  await expect(bob.page.getByText('No messages found')).toBeVisible();
});

test('mentions in a group: autocomplete, highlight, and the other member sees it', async ({
  browser,
}) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const carol = await signIn(browser, uniqueName('carol'));
  const alice = await signIn(browser, uniqueName('alice'));
  const title = uniqueName('crew');
  await createGroup(alice.page, title, [bob.name, carol.name]);
  await sendAndWait(alice.page, 'welcome');
  await openChat(bob.page, title);
  await openChat(carol.page, title);

  // Type the start of Bob's name: the suggestions list offers him.
  await composer(alice.page).fill(`hello @${bob.name.slice(0, 6)}`);
  const list = alice.page.getByRole('listbox', { name: 'Mention suggestions' });
  await expect(list).toBeVisible();
  await expect(list.getByRole('option', { name: new RegExp(bob.name) })).toBeVisible();
  // Escape closes it without changing the text.
  await composer(alice.page).press('Escape');
  await expect(list).toHaveCount(0);
  await composer(alice.page).press('Backspace');
  await expect(list).toBeVisible();
  await list.getByRole('option', { name: new RegExp(bob.name) }).click();
  await expect(composer(alice.page)).toHaveValue(`hello @${bob.name} `);
  await composer(alice.page).press('End');
  await composer(alice.page).pressSequentially('see you');
  await alice.page.getByRole('button', { name: 'Send message' }).click();

  // The mention is drawn highlighted for everybody in the group.
  for (const member of [alice, bob, carol]) {
    const message = bubble(member.page, 'see you');
    await expect(message).toBeVisible();
    await expect(message.getByText(`@${bob.name}`, { exact: true })).toHaveClass(/underline/);
  }
});
