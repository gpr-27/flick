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
  const row = (name: string) => dialog.getByRole('listitem').filter({ hasText: name });

  // Both are listed under the "A" header, in alphabetical order, and I am not in my own list.
  await expect(dialog.locator('[data-letter-header="A"]')).toBeVisible();
  // The list is virtual (only the rows in view exist), so scroll down until a row appears and note
  // where it is in the whole list. Other people's tests add names to the same directory.
  const scroller = dialog.getByRole('list', { name: 'People' }).locator('..');
  const positionOf = async (name: string): Promise<number> => {
    await scroller.evaluate((el) => {
      el.scrollTop = 0;
    });
    for (let i = 0; i < 40 && (await row(name).count()) === 0; i++) {
      await scroller.evaluate((el) => {
        el.scrollBy(0, 80);
      });
      await row(name)
        .waitFor({ timeout: 250 })
        .catch(() => undefined);
    }
    const [box, top] = await Promise.all([
      row(name).boundingBox(),
      scroller.evaluate((el) => el.scrollTop),
    ]);
    return (box?.y ?? Number.NaN) + top;
  };
  expect(await positionOf(one.name)).toBeLessThan(await positionOf(two.name));
  await expect(row(me.name)).toHaveCount(0);

  // Searching narrows the list (to a number of results, or to no one); clearing brings the directory back.
  const search = dialog.getByRole('searchbox', { name: 'Search people' });
  await search.fill('zzzqqqxx');
  await expect(dialog.getByText('No one found')).toBeVisible();
  await expect(row(one.name)).toHaveCount(0);
  await search.fill(two.name);
  await expect(dialog.getByText(/\d+ results?/)).toBeVisible();
  await expect(row(two.name)).toBeVisible();
  await search.fill('');
  expect(await positionOf(one.name)).not.toBeNaN();

  // Arrow keys move through the results (the server may rank similar names too) and Enter opens the chat.
  await search.fill(two.name);
  await expect(dialog.getByText(/\d+ results?/)).toBeVisible();
  for (let i = 0; i < 5 && (await row(two.name).getAttribute('aria-current')) !== 'true'; i++) {
    await search.press('ArrowDown');
  }
  await expect(row(two.name)).toHaveAttribute('aria-current', 'true');
  await search.press('Enter');
  await expect(me.page.getByRole('region', { name: `Chat with ${two.name}` })).toBeVisible();
});

test('the directory works on a phone: letter strip, tap to chat, no sideways scroll', async ({
  browser,
}) => {
  // The letter strip needs more than one letter among the people loaded so far. Other tests have
  // made many "a..." people (the directory loads 50 at a time), so a "zzz" person guarantees a
  // second letter once the last page is loaded.
  await signIn(browser, uniqueName('zzz'));
  const { one, me, dialog } = await openDirectory(browser, {
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const strip = dialog.getByRole('group', { name: 'Jump to letter' });
  for (let i = 0; i < 20 && (await strip.count()) === 0; i++) {
    const more = dialog.getByRole('button', { name: 'Load more' });
    await more.scrollIntoViewIfNeeded();
    await more.click();
  }
  await expect(strip.getByRole('button', { name: 'Jump to A' })).toBeVisible();
  expect(
    await me.page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth),
  ).toBe(false);

  // Back to the top (the first people are the "aaa" ones), and tap one.
  await dialog.getByRole('button', { name: 'Jump to A' }).tap();
  await dialog.getByRole('button', { name: `Chat with ${one.name}` }).tap();
  await expect(me.page.getByRole('region', { name: `Chat with ${one.name}` })).toBeVisible();
});
