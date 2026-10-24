import { readFile } from 'node:fs/promises';
import { test, expect, type Page } from '@playwright/test';
import { signIn, uniqueName } from './support';

// Journey (j): profile and settings, on a laptop and on a phone. Edit the profile, change the look
// and see it survive a reload, sign a second browser out from Settings, and download your data.
const SCREENS = [
  { label: 'laptop', context: { viewport: { width: 1280, height: 800 } } },
  {
    label: 'phone',
    context: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  },
] as const;

/** Open a section: a list on the left on laptops, an accordion heading on phones. */
async function openSection(page: Page, name: string): Promise<void> {
  const list = page.getByRole('navigation', { name: 'Settings sections' });
  if (await list.count()) await list.getByRole('button', { name }).click();
  else await page.getByRole('button', { name, exact: true }).click();
}

for (const screen of SCREENS) {
  test.describe(`on a ${screen.label}`, () => {
    test('edit the profile and keep it after a reload', async ({ browser }) => {
      const me = await signIn(browser, uniqueName('pat'), { context: screen.context });
      const page = me.page;
      await page.goto('/profile');

      await page.getByLabel('Display name').fill('Pat Example');
      await page.getByRole('button', { name: 'Busy' }).click();
      await expect(page.getByText('4/139')).toBeVisible();

      // Live checks: a bad username is refused, a free one is accepted.
      const newName = uniqueName('patty');
      await page.getByLabel('Username').fill('no spaces');
      await expect(page.getByText(/Only letters, numbers/)).toBeVisible();
      await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled();
      await page.getByLabel('Username').fill(newName);
      await expect(page.getByRole('status').filter({ hasText: 'Available' })).toBeVisible();

      await page.getByRole('button', { name: 'Save' }).click();
      await expect(page.getByText('Profile saved.')).toBeVisible();

      await page.reload();
      await expect(page.getByRole('heading', { level: 1, name: 'Pat Example' })).toBeVisible();
      await expect(page.getByText(`@${newName}`).first()).toBeVisible();
      await expect(page.getByLabel('About')).toHaveValue('Busy');

      // The shared link opens the public profile for another signed-in person.
      const other = await signIn(browser, uniqueName('visitor'), { context: screen.context });
      await other.page.goto(`/u/${newName}`);
      await expect(other.page.getByRole('heading', { name: 'Pat Example' })).toBeVisible();
      await expect(other.page.getByRole('button', { name: 'Message' })).toBeVisible();
    });

    test('theme and text size apply at once and survive a reload', async ({ browser }) => {
      const me = await signIn(browser, uniqueName('sky'), { context: screen.context });
      const page = me.page;
      await page.goto('/settings');
      await openSection(page, 'Appearance');

      const theme = page.getByRole('radiogroup', { name: 'Theme' });
      await theme.getByRole('radio', { name: 'Dark' }).click();
      await page.getByRole('radio', { name: 'Large', exact: true }).click();
      const html = page.locator('html');
      await expect(html).toHaveAttribute('data-theme', 'pastel-night');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.style.fontSize))
        .toBe('18px');

      await page.reload();
      // Applied before the app starts (by the script in index.html), and still chosen in Settings.
      await expect(html).toHaveAttribute('data-theme', 'pastel-night');
      expect(await page.evaluate(() => document.documentElement.style.fontSize)).toBe('18px');
      await openSection(page, 'Appearance');
      await expect(
        page.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }),
      ).toBeChecked();
      await expect(page.getByRole('radio', { name: 'Large', exact: true })).toBeChecked();
    });

    test('signing out another device signs that browser out', async ({ browser }) => {
      const name = uniqueName('duo');
      const first = await signIn(browser, name, { context: screen.context });
      const second = await signIn(browser, name);
      await first.page.goto('/settings');
      await openSection(first.page, 'Account');

      await expect(first.page.getByText('This device')).toBeVisible();
      await first.page.getByRole('button', { name: /^Sign out (?!of other)/ }).click();
      await expect(first.page.getByText(/^Signed out /).first()).toBeVisible();

      // The other browser is cut off: its socket closes and its next request gets 401.
      await expect(second.page.getByRole('status')).toContainText('Test login', {
        timeout: 20_000,
      });
    });

    test('"Download my data" saves a JSON file with my profile', async ({ browser }) => {
      const name = uniqueName('data');
      const me = await signIn(browser, name, { context: screen.context });
      const page = me.page;
      await page.goto('/settings');
      await openSection(page, 'Account');

      const download = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download', exact: true }).click();
      const file = await download;
      expect(file.suggestedFilename()).toMatch(/^flick-export-\d{4}-\d{2}-\d{2}\.json$/);
      const path = await file.path();
      const data = JSON.parse(await readFile(path, 'utf8')) as {
        profile: { username: string };
        chats: unknown[];
      };
      expect(data.profile.username).toBe(name.toLowerCase());
      expect(Array.isArray(data.chats)).toBe(true);
    });
  });
}
