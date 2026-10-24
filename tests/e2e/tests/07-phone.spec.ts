import { test, expect } from '@playwright/test';
import {
  bubble,
  chatInList,
  holdMessage,
  send,
  signIn,
  startDirectChat,
  uniqueName,
} from './support';

// Journey (g): smoke test on a phone-sized screen. The list and the chat take turns on the screen,
// the composer is reachable, and the page never scrolls sideways.
test('the app works on a phone-sized viewport', async ({ browser }) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'), {
    context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  });
  const phone = alice.page;

  const sidewaysScroll = () =>
    phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);

  await expect(phone.getByRole('button', { name: 'New chat' })).toBeVisible();
  expect(await sidewaysScroll()).toBe(false);

  await startDirectChat(phone, bob.name);
  await send(phone, 'hello from my phone');
  await expect(bubble(phone, 'hello from my phone')).toBeVisible();
  expect(await sidewaysScroll()).toBe(false);

  // Wait until the message has really been sent: one that is still sending has no actions.
  await expect(
    bubble(phone, 'hello from my phone').getByRole('img', { name: /^(Sent|Delivered|Read)$/ }),
  ).toBeVisible();

  // Holding a message opens the actions as a sheet with big buttons; pin and unpin both work.
  await holdMessage(phone, 'hello from my phone');
  await phone.getByRole('menuitem', { name: 'Pin' }).click();
  await expect(phone.getByRole('img', { name: 'Pinned' })).toBeVisible();
  await holdMessage(phone, 'hello from my phone');
  await phone.getByRole('menuitem', { name: 'Unpin' }).click();
  await expect(phone.getByRole('img', { name: 'Pinned' })).toHaveCount(0);
  expect(await sidewaysScroll()).toBe(false);

  // Bob answers from his desktop; the phone shows it live.
  await chatInList(bob.page, alice.name).click();
  await send(bob.page, 'got it');
  await expect(bubble(phone, 'got it')).toBeVisible();

  // Going back shows the list again.
  await phone.getByRole('button', { name: 'Back to chats' }).click();
  await expect(chatInList(phone, bob.name)).toBeVisible();
});
