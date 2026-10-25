import { test, expect, type Page } from '@playwright/test';
import {
  bubble,
  chatInList,
  closeChat,
  currentTheme,
  goTo,
  openChat,
  openPair,
  send,
  signIn,
  startDirectChat,
  tick,
  toggleTheme,
  uniqueName,
} from './support';

/** Do something that saves a privacy choice, and wait until the server has answered the save. */
const saved = async (page: Page, change: () => Promise<void>): Promise<void> => {
  const answer = page.waitForResponse(
    (r) => r.request().method() === 'PATCH' && r.url().includes('/users/me/privacy'),
  );
  await change();
  expect((await answer).ok()).toBe(true);
};

// Journeys 17: the pages behind the account menu, and signing in as somebody else on the same browser.

test('the theme switch works and is still there after a reload', async ({ browser }) => {
  const { page } = await signIn(browser, uniqueName('tess'));
  const first = await currentTheme(page);
  expect(['light', 'dark']).toContain(first);

  await toggleTheme(page);
  const second = first === 'light' ? 'dark' : 'light';
  await expect.poll(() => currentTheme(page)).toBe(second);
  // The choice is stored, so a reload (and the flash-free script in the page head) keeps it.
  expect(await page.evaluate(() => localStorage.getItem('chat-theme'))).toBe(second);
  await page.reload();
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  expect(await currentTheme(page)).toBe(second);

  // It is the same on the settings page, and switching back is remembered too.
  await goTo(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(await currentTheme(page)).toBe(second);
  await toggleTheme(page);
  await expect.poll(() => currentTheme(page)).toBe(first);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  expect(await currentTheme(page)).toBe(first);
});

test('the profile page shows who you are', async ({ browser }) => {
  const name = uniqueName('pia');
  const { page } = await signIn(browser, name);
  await goTo(page, 'Profile');
  await expect(page.getByRole('heading', { name })).toBeVisible();
  await expect(page.getByText(`@${name}`)).toBeVisible();
  await expect(
    page.getByRole('region', { name }).getByRole('button', { name: 'Sign out' }),
  ).toBeVisible();
});

test('privacy choices are saved on the server and kept after a reload', async ({ browser }) => {
  const { page } = await signIn(browser, uniqueName('pat'));
  await goTo(page, 'Settings');

  const lastSeen = page.getByRole('combobox', { name: 'Last seen and online' });
  const photo = page.getByRole('combobox', { name: 'Profile photo' });
  const about = page.getByRole('combobox', { name: 'About' });
  const receipts = page.getByRole('switch', { name: 'Read receipts' });
  await expect(lastSeen).toHaveValue('everyone');
  await expect(receipts).toBeChecked();

  await saved(page, () => lastSeen.selectOption('nobody').then(() => undefined));
  await saved(page, () => photo.selectOption('nobody').then(() => undefined));
  await saved(page, () => about.selectOption('nobody').then(() => undefined));
  await saved(page, () => receipts.uncheck());
  await expect(receipts).not.toBeChecked();

  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Last seen and online' })).toHaveValue('nobody');
  await expect(page.getByRole('combobox', { name: 'Profile photo' })).toHaveValue('nobody');
  await expect(page.getByRole('combobox', { name: 'About' })).toHaveValue('nobody');
  await expect(page.getByRole('switch', { name: 'Read receipts' })).not.toBeChecked();

  // And back again.
  await saved(page, () =>
    page
      .getByRole('combobox', { name: 'Last seen and online' })
      .selectOption('everyone')
      .then(() => undefined),
  );
  await saved(page, () => page.getByRole('switch', { name: 'Read receipts' }).check());
  await page.reload();
  await expect(page.getByRole('combobox', { name: 'Last seen and online' })).toHaveValue(
    'everyone',
  );
  await expect(page.getByRole('switch', { name: 'Read receipts' })).toBeChecked();
});

test('with read receipts off you do not send them: the other side never turns blue', async ({
  browser,
}) => {
  const { alice, bob } = await openPair(browser, 'hello');
  // Bob turns his read receipts off, from the chat list.
  await closeChat(bob.page);
  await goTo(bob.page, 'Settings');
  await saved(bob.page, () => bob.page.getByRole('switch', { name: 'Read receipts' }).uncheck());
  await expect(bob.page.getByRole('switch', { name: 'Read receipts' })).not.toBeChecked();
  await bob.page.goBack();
  await expect(chatInList(bob.page, alice.name)).toBeVisible();

  await send(alice.page, 'did you see this?');
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, 'did you see this?')).toBeVisible();
  // It was delivered, but Bob's reading is not reported.
  await expect(tick(alice.page, 'did you see this?')).toHaveAccessibleName('Delivered');
  await send(bob.page, 'yes');
  await expect(bubble(alice.page, 'yes')).toBeVisible();
  await expect(tick(alice.page, 'did you see this?')).toHaveAccessibleName('Delivered');
});

test('sign out, then sign in as someone else in the same browser, and back again', async ({
  browser,
}) => {
  const firstName = uniqueName('first');
  const secondName = uniqueName('second');
  const bobName = uniqueName('bob');
  const bob = await signIn(browser, bobName);
  const { page } = await signIn(browser, firstName);
  await startDirectChat(page, bobName);
  await send(page, 'a message from the first account');
  await openChat(bob.page, firstName);
  await expect(bubble(bob.page, 'a message from the first account')).toBeVisible();
  await closeChat(page);
  const deviceOfFirst = await page.evaluate(() => localStorage.getItem('flick.device_id'));
  expect(deviceOfFirst).toBeTruthy();

  // Sign out: the login screen comes back.
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page.getByText(/Test login/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'New chat' })).toHaveCount(0);

  // A different account on the same browser works (the server ties a device id to one account,
  // so the app must take a new one instead of failing).
  await page.getByPlaceholder('alice').fill(secondName);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await expect(page.getByText('No chats yet')).toBeVisible();
  await expect(chatInList(page, bobName)).toHaveCount(0);
  await goTo(page, 'Profile');
  await expect(page.getByRole('heading', { name: secondName })).toBeVisible();
  const deviceOfSecond = await page.evaluate(() => localStorage.getItem('flick.device_id'));
  expect(deviceOfSecond).toBeTruthy();
  expect(deviceOfSecond).not.toBe(deviceOfFirst);

  // The second account can chat as usual, and the first account's chat is back when signing in again.
  await page.getByRole('link', { name: 'Flick home' }).click();
  await startDirectChat(page, bobName);
  await send(page, 'hello from the second account');
  await closeChat(bob.page);
  await openChat(bob.page, secondName);
  await expect(bubble(bob.page, 'hello from the second account')).toBeVisible();

  await page.goto('/');
  await page.getByRole('button', { name: 'Sign out' }).click();
  await page.getByPlaceholder('alice').fill(firstName);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(chatInList(page, bobName)).toBeVisible();
  await openChat(page, bobName);
  await expect(bubble(page, 'a message from the first account')).toBeVisible();
  await expect(bubble(page, 'hello from the second account')).toHaveCount(0);
});
