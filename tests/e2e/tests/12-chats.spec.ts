import { test, expect, type Page } from '@playwright/test';
import {
  attachFile,
  bubble,
  chatInList,
  chatOption,
  closeChat,
  composer,
  composerAction,
  createGroup,
  isPhone,
  makePng,
  openChat,
  openGroupInfo,
  openPair,
  send,
  sendAndWait,
  signIn,
  uniqueName,
} from './support';

// Journeys 12: groups, the settings of one chat, polls and view-once photos.

const groupDialog = (page: Page) => page.getByRole('dialog', { name: 'Group info' });

test('a group: add a member, promote an admin, remove a member, rename, and leave', async ({
  browser,
}) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const carol = await signIn(browser, uniqueName('carol'));
  const alice = await signIn(browser, uniqueName('alice'));
  const title = uniqueName('club');

  await createGroup(alice.page, title, [bob.name]);
  await sendAndWait(alice.page, 'welcome to the club');
  await openChat(bob.page, title);
  await expect(bubble(bob.page, 'welcome to the club')).toBeVisible();

  // Alice adds Carol from the group info; Carol gets the group in her list.
  await openGroupInfo(alice.page);
  await expect(groupDialog(alice.page).getByText('2 members')).toBeVisible();
  await groupDialog(alice.page).getByRole('button', { name: 'Add members' }).click();
  await groupDialog(alice.page).getByLabel('Search people').fill(carol.name);
  await groupDialog(alice.page)
    .getByRole('button', { name: `Add ${carol.name} to the group` })
    .click();
  await expect(groupDialog(alice.page).getByText('3 members')).toBeVisible();
  await expect(chatInList(carol.page, title)).toBeVisible();

  // A plain member cannot manage the group; Alice makes Bob an admin and then he can.
  await openGroupInfo(bob.page);
  await expect(bob.page.getByRole('button', { name: 'Add members' })).toHaveCount(0);
  await bob.page.getByRole('button', { name: 'Close', exact: true }).click();
  await groupDialog(alice.page)
    .getByRole('button', { name: `Make ${bob.name} admin` })
    .click();
  // The button turns into the opposite one: Demote.
  await expect(
    groupDialog(alice.page).getByRole('button', { name: `Remove admin from ${bob.name}` }),
  ).toHaveText('Demote');
  await openGroupInfo(bob.page);
  await expect(bob.page.getByRole('button', { name: 'Add members' })).toBeVisible();
  await bob.page.getByRole('button', { name: 'Close', exact: true }).click();

  // Alice renames the group: the new name shows in her header and in Bob's list.
  const renamed = uniqueName('renamed');
  await groupDialog(alice.page).getByLabel('Group name').fill(renamed);
  await groupDialog(alice.page).getByRole('button', { name: 'Save', exact: true }).click();
  await alice.page.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(alice.page.getByRole('region', { name: `Chat with ${renamed}` })).toBeVisible();
  await expect(bob.page.getByRole('region', { name: `Chat with ${renamed}` })).toBeVisible();

  // Alice removes Carol; the group goes from Carol's list after a reload.
  await openGroupInfo(alice.page);
  await groupDialog(alice.page)
    .getByRole('button', { name: `Remove ${carol.name}` })
    .click();
  await expect(groupDialog(alice.page).getByText('2 members')).toBeVisible();
  await alice.page.getByRole('button', { name: 'Close', exact: true }).click();
  await carol.page.reload();
  await expect(carol.page.getByRole('button', { name: 'New chat' })).toBeVisible();
  // Carol is left with only the chat with Flick that every account starts with.
  await expect(chatInList(carol.page, renamed)).toHaveCount(0);
  await expect(chatInList(carol.page, 'Flick')).toHaveCount(1);

  // Bob leaves: the group disappears for him and the others are told.
  await openGroupInfo(bob.page);
  await groupDialog(bob.page).getByRole('button', { name: 'Leave group' }).click();
  // Leaving asks first; "Stay" would keep the group, "Leave" confirms.
  await bob.page
    .getByRole('alertdialog', { name: 'Leave this group?' })
    .getByRole('button', { name: 'Leave', exact: true })
    .click();
  await expect(chatInList(bob.page, renamed)).toHaveCount(0);
  await expect(chatInList(bob.page, 'Flick')).toHaveCount(1);
  await expect(alice.page.getByText(new RegExp(`${bob.name} left`))).toBeVisible();
});

test('chat settings: pin, favourite, mute, archive, wallpaper', async ({ browser }) => {
  const { alice, bob } = await openPair(browser);
  const page = alice.page;

  await chatOption(page, 'Pin chat');
  await chatOption(page, 'Add to favourites');
  await chatOption(page, 'Mute…');
  await page
    .getByRole('dialog', { name: 'Mute notifications' })
    .getByRole('button', { name: '1 hour' })
    .click();

  // The menu now offers the opposite of each.
  await page.getByRole('button', { name: 'Chat options' }).click();
  const menu = page.getByRole('menu', { name: 'Chat options' });
  await expect(menu.getByRole('menuitem', { name: 'Unpin chat' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Remove from favourites' })).toBeVisible();
  await expect(menu.getByRole('menuitem', { name: 'Unmute' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);

  // The list shows all three marks, they are kept after a reload, and the Favourites tab has it.
  await closeChat(page);
  const row = chatInList(page, bob.name);
  await expect(row.getByRole('img', { name: 'Pinned' })).toBeVisible();
  await expect(row.getByRole('img', { name: 'Favourite' })).toBeVisible();
  await expect(row.getByRole('img', { name: 'Muted' })).toBeVisible();
  await page.reload();
  await expect(row.getByRole('img', { name: 'Pinned' })).toBeVisible();
  await page.getByRole('tab', { name: 'Groups' }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('tab', { name: 'Favourites' }).click();
  await expect(row).toBeVisible();
  await page.getByRole('tab', { name: 'All' }).click();

  // Wallpaper: choosing Mint paints the chat background that colour (and it stays).
  await openChat(page, bob.name);
  await chatOption(page, 'Wallpaper…');
  await page
    .getByRole('dialog', { name: 'Chat wallpaper' })
    .getByRole('button', { name: 'Mint' })
    .click();
  const backdrop = page
    .getByRole('region', { name: `Chat with ${bob.name}` })
    .locator('div[style*="background-color"]')
    .first();
  await expect(backdrop).toHaveCSS('background-color', 'rgb(217, 239, 227)');

  // Archive: the chat leaves the list and waits in "Archived"; unarchiving brings it back.
  await chatOption(page, 'Archive chat');
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: /^Archived \(1\)/ }).click();
  await expect(row).toBeVisible();
  await row.click();
  await chatOption(page, 'Unarchive chat');
  // The list is still showing "Archived": go back to the normal list (a phone first closes the chat).
  if (isPhone()) await page.getByRole('button', { name: 'Back to chats' }).click();
  await page.getByRole('button', { name: 'Back to chats' }).click();
  await expect(row).toBeVisible();
});

test('a locked chat shows nothing until the passcode is typed', async ({ browser }) => {
  const { alice, bob } = await openPair(browser, 'before the lock');
  const page = alice.page;

  // Setting a passcode needs one that is long enough and typed twice the same.
  await chatOption(page, 'Lock chat…');
  const dialog = page.getByRole('dialog', { name: 'Lock this chat' });
  await dialog.getByLabel('New passcode').fill('abc');
  await dialog.getByLabel('Repeat passcode').fill('abc');
  await dialog.getByRole('button', { name: 'Lock chat' }).click();
  await expect(dialog.getByRole('alert')).toContainText('at least 4');
  await dialog.getByLabel('New passcode').fill('open sesame');
  await dialog.getByLabel('Repeat passcode').fill('open sesame!');
  await dialog.getByRole('button', { name: 'Lock chat' }).click();
  await expect(dialog.getByRole('alert')).toContainText('do not match');
  await dialog.getByLabel('Repeat passcode').fill('open sesame');
  await dialog.getByRole('button', { name: 'Lock chat' }).click();
  await expect(page.getByText('Chat lock is on.')).toBeVisible();

  // "Lock now" hides the chat; a message that arrives meanwhile stays hidden too.
  await chatOption(page, 'Lock now');
  await expect(page.getByRole('region', { name: `Locked chat with ${bob.name}` })).toBeVisible();
  await send(bob.page, 'secret words');
  await expect(bubble(bob.page, 'secret words')).toBeVisible();
  await expect(page.getByText('secret words')).toHaveCount(0);

  // The wrong passcode is refused, the right one opens the chat with everything in it.
  const unlock = page.getByRole('region', { name: `Locked chat with ${bob.name}` });
  await unlock.getByLabel('Passcode', { exact: true }).fill('nope nope');
  await unlock.getByRole('button', { name: 'Unlock' }).click();
  await expect(unlock.getByRole('alert')).toHaveText('Wrong passcode. Try again.');
  await unlock.getByLabel('Passcode', { exact: true }).fill('open sesame');
  await unlock.getByRole('button', { name: 'Unlock' }).click();
  await expect(bubble(page, 'secret words')).toBeVisible();

  // The unlock lives in this tab only: a new tab (same account) shows the chat locked again, and
  // the list there does not give the last message away.
  const tab = await alice.context.newPage();
  await tab.goto(`/?as=${alice.name}`);
  await expect(chatInList(tab, bob.name)).toContainText('Locked chat');
  await expect(tab.getByText('secret words')).toHaveCount(0);
  await chatInList(tab, bob.name).click();
  await expect(tab.getByRole('region', { name: `Locked chat with ${bob.name}` })).toBeVisible();
  await tab.getByLabel('Passcode', { exact: true }).fill('open sesame');
  await tab.getByRole('button', { name: 'Unlock' }).click();
  await expect(bubble(tab, 'secret words')).toBeVisible();
  await tab.close();

  // Removing the lock asks for the passcode once more.
  await chatOption(page, 'Remove chat lock…');
  const removal = page.getByRole('dialog', { name: 'Remove chat lock' });
  await removal.getByLabel('Current passcode').fill('open sesame');
  await removal.getByRole('button', { name: 'Remove lock' }).click();
  await expect(removal).toHaveCount(0);
  await page.getByRole('button', { name: 'Chat options' }).click();
  await expect(page.getByRole('menuitem', { name: 'Lock chat…' })).toBeVisible();
});

test('disappearing messages: the timer is shared and marks new messages', async ({ browser }) => {
  const { alice, bob } = await openPair(browser, 'a normal message');

  if (isPhone()) await chatOption(alice.page, /^Disappearing messages: Off/);
  else await alice.page.getByRole('button', { name: 'Disappearing messages: Off' }).click();
  const dialog = alice.page.getByRole('dialog', { name: 'Disappearing messages' });
  await dialog.getByRole('radio', { name: '24 hours' }).click();
  await expect(dialog).toHaveCount(0);

  // Both people are told about the change in the chat itself.
  const note = (page: Page) =>
    page.getByRole('log').getByText(/changed the disappearing-messages timer/);
  await expect(note(alice.page)).toHaveText('You changed the disappearing-messages timer');
  await expect(note(bob.page)).toHaveText(`${alice.name} changed the disappearing-messages timer`);
  // New messages carry the timer mark; the old one does not.
  await sendAndWait(alice.page, 'this one will vanish');
  for (const person of [alice, bob]) {
    await expect(
      bubble(person.page, 'this one will vanish').getByRole('img', {
        name: 'Disappearing message',
      }),
    ).toBeVisible();
  }
  await expect(
    bubble(alice.page, 'a normal message').getByRole('img', { name: 'Disappearing message' }),
  ).toHaveCount(0);

  // Back to Off: the next message has no mark.
  if (isPhone()) await chatOption(alice.page, /^Disappearing messages: 24 hours/);
  else await alice.page.getByRole('button', { name: 'Disappearing messages: 24 hours' }).click();
  await alice.page
    .getByRole('dialog', { name: 'Disappearing messages' })
    .getByRole('radio', { name: 'Off' })
    .click();
  await sendAndWait(alice.page, 'back to normal');
  await expect(
    bubble(alice.page, 'back to normal').getByRole('img', { name: 'Disappearing message' }),
  ).toHaveCount(0);
});

test('a poll: create it, vote, change the vote, and see the result', async ({ browser }) => {
  const { alice, bob } = await openPair(browser);

  await composerAction(alice.page, 'Poll');
  const dialog = alice.page.getByRole('dialog', { name: 'Create poll' });
  // An empty poll is refused with a hint.
  await dialog.getByRole('button', { name: 'Send poll' }).click();
  await expect(dialog.getByRole('alert')).toHaveText('Write a question and at least two options.');
  await dialog.getByLabel('Question').fill('Lunch?');
  await dialog.getByRole('textbox', { name: 'Option 1' }).fill('Pizza');
  await dialog.getByRole('textbox', { name: 'Option 2' }).fill('Soup');
  await dialog.getByRole('button', { name: 'Add option' }).click();
  await dialog.getByRole('textbox', { name: 'Option 3' }).fill('Salad');
  await dialog.getByRole('button', { name: 'Send poll' }).click();

  const poll = (p: Page) => bubble(p, 'Lunch?');
  const option = (p: Page, text: string, votes: string) =>
    poll(p).getByRole('button', { name: new RegExp(`^${text}, ${votes}`) });
  await expect(poll(alice.page)).toBeVisible();
  await expect(poll(bob.page)).toBeVisible();
  await expect(poll(bob.page).getByText('Select one', { exact: true })).toBeVisible();

  // Bob votes for Pizza, then changes to Soup: a single-choice poll moves his vote.
  await option(bob.page, 'Pizza', '0 votes').click();
  await expect(option(bob.page, 'Pizza', '1 vote, your choice')).toBeVisible();
  await expect(poll(bob.page).getByText('1 voter')).toBeVisible();
  await option(bob.page, 'Soup', '0 votes').click();
  await expect(option(bob.page, 'Soup', '1 vote, your choice')).toBeVisible();
  await expect(option(bob.page, 'Pizza', '0 votes')).toBeVisible();

  // Alice does not get a vote event, so a poll re-reads when the window regains focus.
  await alice.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(option(alice.page, 'Soup', '1 vote')).toBeVisible();
  await option(alice.page, 'Soup', '1 vote').click();
  await expect(option(alice.page, 'Soup', '2 votes, your choice')).toBeVisible();
  await expect(poll(alice.page).getByText('2 voters')).toBeVisible();
});

test('a view-once photo can be opened one time only', async ({ browser }) => {
  const { alice, bob } = await openPair(browser);
  await attachFile(alice.page, 'Photo or video', {
    name: 'once.png',
    mimeType: 'image/png',
    buffer: makePng(120, 90, [40, 90, 200]),
  });
  await alice.page.getByLabel('Send as view once').check();
  await composer(alice.page).fill('look quickly');
  await alice.page.getByRole('button', { name: 'Send message' }).click();

  // The sender sees her own photo with a "View once" label; the receiver sees only a button.
  await expect(bubble(alice.page, 'look quickly').getByText('View once')).toBeVisible();
  const tap = bob.page.getByRole('button', { name: 'Tap to view photo' });
  await expect(tap).toBeVisible();
  await expect(bob.page.getByRole('img', { name: 'look quickly' })).toHaveCount(0);
  await expect(bob.page.getByRole('log').getByText('look quickly')).toHaveCount(0);

  // One tap shows the photo; closing it turns the bubble into "Opened" for good.
  await tap.click();
  await expect(bob.page.getByRole('img', { name: 'look quickly' })).toBeVisible();
  await bob.page.getByRole('button', { name: /^Close, it can't be opened again/ }).click();
  await expect(bob.page.getByRole('article').getByText('Opened')).toBeVisible();
  await expect(bob.page.getByRole('button', { name: 'Tap to view photo' })).toHaveCount(0);

  // Even after a fresh start there is nothing left to open: the server stopped sending it.
  await bob.page.reload();
  await openChat(bob.page, alice.name);
  await expect(bob.page.getByRole('button', { name: 'Tap to view photo' })).toHaveCount(0);
  await expect(bob.page.getByRole('img', { name: 'look quickly' })).toHaveCount(0);
  await expect(bob.page.getByRole('article').getByText('Opened')).toBeVisible();
});
