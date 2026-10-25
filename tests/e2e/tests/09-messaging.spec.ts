import { test, expect } from '@playwright/test';
import {
  apiSendText,
  bubble,
  bubbleBox,
  closeChat,
  composer,
  conversationId,
  doAction,
  openActions,
  openChat,
  openPair,
  scrollsSideways,
  send,
  sendAndWait,
  signIn,
  startDirectChat,
  uniqueName,
} from './support';

// Journeys 09: the everyday life of a chat. Each runs on the laptop and on the phone project.

test('messages go both ways: emoji, a very long text and a very long word', async ({ browser }) => {
  const { alice, bob } = await openPair(browser, 'hello from alice');

  // Bob answers; Alice sees it live.
  await send(bob.page, 'hello from bob');
  await expect(bubble(alice.page, 'hello from bob')).toBeVisible();

  // Emoji survive the trip, including a multi-part one (a heart with a variation selector).
  await send(alice.page, 'party 🎉🚀 ❤️👍🏽');
  await expect(bubble(bob.page, 'party 🎉🚀 ❤️👍🏽')).toBeVisible();

  // A very long text (3 000 characters of words) arrives whole and stays inside the screen.
  const words = Array.from({ length: 500 }, (_, i) => `word${i}`).join(' ');
  await send(alice.page, words);
  const long = bubble(bob.page, 'word0 word1').last();
  await expect(long).toContainText('word499');
  await expect(long).toBeVisible();
  // One long word with no spaces must wrap instead of widening the page.
  const unbroken = `x${'0123456789'.repeat(40)}`;
  await send(alice.page, unbroken);
  await expect(bubble(bob.page, unbroken.slice(0, 40))).toBeVisible();
  expect(await scrollsSideways(bob.page)).toBe(false);
  expect(await scrollsSideways(alice.page)).toBe(false);
  const box = await bubbleBox(bob.page, unbroken.slice(0, 40)).boundingBox();
  const viewport = bob.page.viewportSize();
  expect(box && viewport && box.x + box.width <= viewport.width).toBe(true);
});

test('Enter sends, and the one-line box has no way to type a line break', async ({ browser }) => {
  const { alice, bob } = await openPair(browser);
  const box = composer(alice.page);

  await box.fill('sent with enter');
  await box.press('Enter');
  await expect(bubble(bob.page, 'sent with enter')).toBeVisible();
  await expect(box).toHaveValue('');

  // The message box is a one-line <input>, so Shift+Enter submits like Enter: no stray line break
  // is typed and no half-written message is left behind.
  await box.fill('sent with shift enter');
  await box.press('Shift+Enter');
  await expect(bubble(bob.page, 'sent with shift enter')).toBeVisible();
  await expect(box).toHaveValue('');
  await expect(bubble(alice.page, 'sent with shift enter')).toHaveCount(1);
});

test('a message with line breaks keeps them when it is shown', async ({ browser }) => {
  const { alice, bob } = await openPair(browser, 'one line');
  // The app cannot type a line break (see above), but other clients can send one. Put one into
  // the chat through the API and look at how both people see it.
  const id = await conversationId(bob.page, alice.name);
  await apiSendText(alice.name, id, 'first line\nsecond line\nthird line');
  const lines = bubble(bob.page, 'first line');
  await expect(lines).toBeVisible();
  const text = lines.getByText('first line');
  await expect(text).toHaveCSS('white-space', 'pre-wrap');
  const single = await bubbleBox(bob.page, 'one line').boundingBox();
  const triple = await bubbleBox(bob.page, 'first line').boundingBox();
  // Three lines are clearly taller than one.
  expect((triple?.height ?? 0) > (single?.height ?? 0) * 1.8).toBe(true);
  await expect(bubble(alice.page, 'first line')).toBeVisible();
});

test('reply quotes the message and the quote jumps back to the original', async ({ browser }) => {
  const { alice, bob } = await openPair(browser, 'THE ORIGINAL');
  const id = await conversationId(bob.page, alice.name);
  // Push the original far out of sight.
  for (let i = 1; i <= 30; i++) await apiSendText(alice.name, id, `filler ${i}`);
  await expect(bubble(bob.page, 'filler 30')).toBeVisible();

  // Bob scrolls back up to the original and replies to it.
  const scroller = bob.page.getByTestId('message-scroller');
  const original = bob.page
    .getByRole('article')
    .filter({ hasText: 'THE ORIGINAL' })
    .filter({ hasNot: bob.page.getByRole('button', { name: 'Go to the original message' }) });
  await expect(async () => {
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    await expect(original).toBeVisible({ timeout: 1000 });
  }).toPass();
  await doAction(bob.page, 'THE ORIGINAL', 'Reply');
  await expect(bob.page.getByText('Replying to ' + alice.name)).toBeVisible();
  await send(bob.page, 'this is my reply');

  // Alice sees the reply with the quote on it.
  const reply = bubble(alice.page, 'this is my reply');
  await expect(reply).toBeVisible();
  await expect(reply.getByRole('button', { name: 'Go to the original message' })).toContainText(
    'THE ORIGINAL',
  );
  // The original is far above and not on screen; the quote takes her back to it.
  const aliceOriginal = alice.page
    .getByRole('article')
    .filter({ hasText: 'THE ORIGINAL' })
    .filter({ hasNot: alice.page.getByRole('button', { name: 'Go to the original message' }) });
  await expect(aliceOriginal).toHaveCount(0);
  await reply.getByRole('button', { name: 'Go to the original message' }).click();
  await expect(aliceOriginal).toBeInViewport();
});

test('a message can be forwarded to another chat', async ({ browser }) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const carol = await signIn(browser, uniqueName('carol'));
  const alice = await signIn(browser, uniqueName('alice'));

  await startDirectChat(alice.page, carol.name);
  await sendAndWait(alice.page, 'hi carol');
  await closeChat(alice.page);
  await startDirectChat(alice.page, bob.name);
  await sendAndWait(alice.page, 'please forward me');

  await doAction(alice.page, 'please forward me', 'Forward');
  const dialog = alice.page.getByRole('dialog', { name: 'Forward message' });
  await expect(dialog).toBeVisible();
  await dialog.locator('label').filter({ hasText: carol.name }).getByRole('checkbox').check();
  await dialog.getByRole('button', { name: /^Send \(1\)$/ }).click();
  await expect(alice.page.getByText('Message forwarded.')).toBeVisible();

  // Carol receives it, marked as forwarded; Bob did not get a second copy.
  await openChat(carol.page, alice.name);
  const copy = bubble(carol.page, 'please forward me');
  await expect(copy).toBeVisible();
  await expect(copy).toContainText('Forwarded');
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, 'please forward me')).toHaveCount(1);
});

test('edit with the keyboard, delete for me keeps it for them, delete for everyone removes it', async ({
  browser,
}) => {
  const { alice, bob } = await openPair(browser);

  // ArrowUp in the empty message box edits the last message; Escape backs out.
  await sendAndWait(alice.page, 'typo here');
  await composer(alice.page).press('ArrowUp');
  await expect(alice.page.getByText('Editing message')).toBeVisible();
  const editBox = alice.page.getByLabel('Edit your message');
  await expect(editBox).toHaveValue('typo here');
  await editBox.press('Escape');
  await expect(alice.page.getByText('Editing message')).toHaveCount(0);

  // Delete for me: gone for Alice, still there for Bob.
  await sendAndWait(alice.page, 'for my eyes only');
  await expect(bubble(bob.page, 'for my eyes only')).toBeVisible();
  await doAction(alice.page, 'for my eyes only', 'Delete');
  await alice.page.getByRole('menuitem', { name: 'Delete for me' }).click();
  await expect(bubble(alice.page, 'for my eyes only')).toHaveCount(0);
  await expect(bubble(bob.page, 'for my eyes only')).toBeVisible();

  // Bob did not write it, so he is only offered "Delete for me".
  await openActions(bob.page, 'for my eyes only');
  await bob.page.getByRole('menuitem', { name: 'Delete', exact: true }).click();
  await expect(bob.page.getByRole('menuitem', { name: 'Delete for me' })).toBeVisible();
  await expect(bob.page.getByRole('menuitem', { name: 'Delete for everyone' })).toHaveCount(0);
  await bob.page.getByRole('menuitem', { name: 'Cancel' }).click();
  await expect(bubble(bob.page, 'for my eyes only')).toBeVisible();

  // Delete for everyone: both see a notice instead of the text.
  await sendAndWait(alice.page, 'gone for everyone');
  await expect(bubble(bob.page, 'gone for everyone')).toBeVisible();
  await doAction(alice.page, 'gone for everyone', 'Delete');
  await alice.page.getByRole('menuitem', { name: 'Delete for everyone' }).click();
  await expect(bob.page.getByRole('article').getByText('gone for everyone')).toHaveCount(0);
  await expect(bob.page.getByRole('article').getByText('This message was deleted')).toBeVisible();
  await expect(alice.page.getByRole('article').getByText('This message was deleted')).toBeVisible();
});

test('a reaction can be added, replaced and taken back', async ({ browser }) => {
  const { alice, bob } = await openPair(browser, 'react to me');
  const chip = (page: typeof alice.page, emoji: string) =>
    bubble(page, 'react to me').getByRole('button', { name: new RegExp(`^${emoji} 1 reaction`) });

  // The emoji buttons sit in a toolbar above the action list, so they are buttons, not menu items.
  await openActions(bob.page, 'react to me');
  await bob.page.getByRole('button', { name: 'React 👍' }).click();
  await expect(chip(alice.page, '👍')).toBeVisible();
  await expect(chip(bob.page, '👍')).toHaveAttribute('aria-pressed', 'true');

  // A second emoji replaces the first (one reaction per person).
  await openActions(bob.page, 'react to me');
  await bob.page.getByRole('button', { name: 'React ❤️' }).click();
  await expect(chip(alice.page, '❤️')).toBeVisible();
  await expect(chip(alice.page, '👍')).toHaveCount(0);

  // Alice adds her own to the same emoji: the count goes to 2.
  await openActions(alice.page, 'react to me');
  await alice.page.getByRole('button', { name: 'React ❤️' }).click();
  await expect(
    bubble(bob.page, 'react to me').getByRole('button', { name: /^❤️ 2 reactions/ }),
  ).toBeVisible();

  // Both take theirs back by pressing the chip.
  await bubble(bob.page, 'react to me')
    .getByRole('button', { name: /^❤️ 2 reactions/ })
    .click();
  await expect(chip(alice.page, '❤️')).toBeVisible();
  await chip(alice.page, '❤️').click();
  await expect(
    bubble(alice.page, 'react to me').getByRole('button', { name: /reaction/ }),
  ).toHaveCount(0);
});

test('Copy puts the text on the clipboard and shows a toast', async ({ browser }) => {
  const { alice, bob } = await openPair(browser, 'copy this text');
  await doAction(bob.page, 'copy this text', 'Copy');
  await expect(bob.page.getByText('Copied', { exact: true })).toBeVisible();
  expect(await bob.page.evaluate(() => navigator.clipboard.readText())).toBe('copy this text');
  await expect(bubble(alice.page, 'copy this text')).toBeVisible();
});
