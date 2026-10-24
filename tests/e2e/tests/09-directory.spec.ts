import { test, expect, type Browser } from '@playwright/test';
import { signIn, uniqueName, type SignInOptions } from './support';

// Journey (i): the people directory. "New chat" shows everyone on Flick A to Z under letter headers,
// the search box narrows it, and a person on the list opens a chat. Once with the keyboard on a
// desktop, once with a finger on a phone (where a letter strip on the right jumps through the list).
// Names start with "aaa" so they sit at the top of the first page, however many users other tests made.

async function openDirectory(browser: Browser, context?: SignInOptions['context']) {
  const one = await signIn(browser, uniqueName('aaa1'));
  const two = await signIn(browser, uniqueName('aaa2'));
  const me = await signIn(browser, uniqueName('mia'), { context });
  await me.page.getByRole('button', { name: 'New chat' }).click();
  const dialog = me.page.getByRole('dialog', { name: 'New chat' });
  await expect(dialog.getByText(/people? on Flick/)).toBeVisible();
  return { one, two, me, dialog };
}

test('the directory lists people A to Z, searches, and starts a chat from the keyboard', async ({
  browser,
}) => {
  const { one, two, me, dialog } = await openDirectory(browser);
  const row = (name: string) => dialog.getByRole('option', { name: new RegExp(name) });

  // Both are listed under the "A" header, in alphabetical order, and I am not in my own list.
  await expect(dialog.locator('[data-letter-header="A"]')).toBeVisible();
  await expect(row(one.name)).toBeVisible();
  await expect(row(two.name)).toBeVisible();
  const [boxOne, boxTwo] = await Promise.all([
    row(one.name).boundingBox(),
    row(two.name).boundingBox(),
  ]);
  expect(boxOne!.y).toBeLessThan(boxTwo!.y);
  await expect(row(me.name)).toHaveCount(0);

  // Searching narrows the list (to a number of results, or to no one); clearing brings the directory back.
  const search = dialog.getByLabel('Search people');
  await search.fill('zzzqqqxx');
  await expect(dialog.getByText('No one found')).toBeVisible();
  await expect(row(one.name)).toHaveCount(0);
  await search.fill(two.name);
  await expect(dialog.getByText(/\d+ results?/)).toBeVisible();
  await expect(row(two.name)).toBeVisible();
  await search.fill('');
  await expect(row(one.name)).toBeVisible();

  // Arrow keys move through the results (the server may rank similar names too) and Enter opens the chat.
  await search.fill(two.name);
  await expect(dialog.getByText(/\d+ results?/)).toBeVisible();
  for (let i = 0; i < 5 && (await row(two.name).getAttribute('aria-selected')) !== 'true'; i++) {
    await search.press('ArrowDown');
  }
  await expect(row(two.name)).toHaveAttribute('aria-selected', 'true');
  await search.press('Enter');
  await expect(me.page.getByRole('region', { name: `Chat with ${two.name}` })).toBeVisible();
});

test('the directory works on a phone: letter strip, tap to chat, no sideways scroll', async ({
  browser,
}) => {
  const { one, me, dialog } = await openDirectory(browser, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  await expect(dialog.getByRole('button', { name: 'Jump to A' })).toBeVisible();
  expect(
    await me.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
  ).toBe(false);

  await dialog.getByRole('button', { name: `Chat with ${one.name}` }).tap();
  await expect(me.page.getByRole('region', { name: `Chat with ${one.name}` })).toBeVisible();
});
