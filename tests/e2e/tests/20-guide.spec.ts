import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';
import {
  goTo,
  isPhone,
  openChat,
  openSettingsSection,
  send,
  signIn,
  startDirectChat,
  uniqueName,
} from './support';

// Journeys 20: the in-app guide. The other journeys switch the guide off (see switchGuideOff in
// support.ts); these turn it on and check what a new person, and a person who has been around, see.

test.describe.configure({ timeout: 150_000 });

const card = (page: Page): Locator => page.getByTestId('guide-card');
const offer = (page: Page): Locator => page.getByRole('region', { name: 'Tour of Flick' });
const spotlight = (page: Page): Locator => page.getByTestId('guide-spotlight');
const guideSaved = (page: Page) =>
  page.waitForResponse(
    (r) => r.url().includes('/users/me/guide') && r.request().method() === 'PATCH',
  );

/** Press Next / Got it / Done until the tour or tip on screen is over (another tip may follow). */
async function closeCurrent(page: Page): Promise<void> {
  for (let i = 0; i < 12; i++) {
    const text = (await card(page).textContent()) ?? '';
    const counter = /(\d+) of (\d+)/.exec(text);
    await card(page)
      .getByRole('button', { name: /^(Next|Got it|Done)$/ })
      .click();
    if (!counter || Number(counter[1]) >= Number(counter[2])) return;
    await page.waitForTimeout(100);
  }
}

/** The same, then check the card is gone (for a tour: no tip follows a tour at once). */
async function finish(page: Page): Promise<void> {
  await closeCurrent(page);
  await expect(card(page)).toBeHidden();
}

/**
 * Let every tip that is waiting have its turn (each is closed with "Got it"). Returns their titles.
 * The install tip depends on the browser announcing that Flick can be installed, which is not
 * something a journey controls, so it is left out of the list.
 */
async function clearTips(page: Page, firstWaitMs = 8000): Promise<string[]> {
  const titles: string[] = [];
  for (let i = 0; i < 40; i++) {
    const shown = await card(page)
      .waitFor({ state: 'visible', timeout: i === 0 ? firstWaitMs : 2500 })
      .then(() => true)
      .catch(() => false);
    if (!shown) break;
    const title = (await card(page).getByRole('heading').textContent()) ?? '';
    if (title !== 'Keep Flick on your device') titles.push(title);
    await closeCurrent(page);
  }
  return titles;
}

/** Set the wait between tips in the browser; 0 lets them follow each other at once. */
const tipPause = (page: Page, ms: number): Promise<unknown> =>
  page.addInitScript((value) => {
    try {
      localStorage.setItem('flick.guide.cooldown_ms', String(value));
    } catch {
      // no storage
    }
  }, ms);

/** Make the signed-in account look months old, so only the chats decide who is "new". */
const looksOld = (page: Page): Promise<unknown> =>
  page.route('**/users/me', async (route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const response = await route.fetch();
    const body = (await response.json()) as Record<string, unknown>;
    return route.fulfill({
      response,
      json: { ...body, created_at: '2025-01-01T00:00:00.000Z' },
    });
  });

/**
 * A person who has been around: they have a chat with a message in it, and no guide progress.
 * `pause` is the wait between tips in the browser (a long one keeps them to one at a time).
 */
async function existingUser(browser: Browser, pause = 600_000) {
  const name = uniqueName('vera');
  const friend = await signIn(browser, uniqueName('finn'));
  const setup = await signIn(browser, name);
  await startDirectChat(friend.page, name);
  await send(friend.page, 'welcome aboard');
  await expect(setup.page.getByRole('option', { name: /welcome aboard/ })).toBeVisible();
  await setup.context.close();
  // Back again with the guide on: this is the visit we look at.
  const vera = await signIn(browser, name, {
    guide: true,
    beforeLoad: async (page) => {
      await looksOld(page);
      await tipPause(page, pause);
    },
  });
  await clearTips(vera.page);
  await expect(offer(vera.page)).toBeVisible();
  return { vera, friend };
}

/** The "Take the tour" entry of the user menu (a button in the bar, a menu item on a phone). */
async function takeTourFromMenu(page: Page): Promise<void> {
  if (isPhone()) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Take the tour' }).click();
  } else {
    await page
      .getByRole('navigation', { name: 'Account' })
      .getByRole('button', { name: 'Take the tour' })
      .click();
  }
}

test('a new person is taken on the tour, step by step, and can finish it', async ({ browser }) => {
  const { page } = await signIn(browser, uniqueName('nia'), { guide: true });
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('1 of 10');
  await expect(card(page).getByRole('heading')).toHaveText('Your chats live here');

  for (let step = 2; step <= 10; step++) {
    await card(page).getByRole('button', { name: 'Next' }).click();
    await expect(card(page)).toContainText(`${String(step)} of 10`);
    await expect(card(page)).toBeInViewport();
    // The card never sits on top of a small highlighted element (once the screen has settled).
    await expect
      .poll(
        async () => {
          if (!(await spotlight(page).isVisible())) return true;
          const hole = await spotlight(page).boundingBox();
          const box = await card(page).boundingBox();
          const view = page.viewportSize();
          if (!hole || !box || !view || hole.height >= view.height / 2) return true;
          return (
            box.y + box.height <= hole.y ||
            hole.y + hole.height <= box.y ||
            box.x + box.width <= hole.x ||
            hole.x + hole.width <= box.x
          );
        },
        { message: `step ${String(step)}: the card covers the highlighted element` },
      )
      .toBe(true);
  }
  await card(page).getByRole('button', { name: 'Done' }).click();
  await expect(card(page)).toBeHidden();

  // It was only for the first time: after a reload nothing starts by itself.
  const answer = page.waitForResponse((r) => r.url().includes('/users/me/guide'));
  await page.reload();
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await answer;
  await page.waitForTimeout(1500);
  await expect(offer(page)).toHaveCount(0);
  // Tips for other features may come, but never the tour again.
  if (await card(page).isVisible()) await expect(card(page)).not.toContainText('of 10');
  await expect(card(page).getByRole('heading')).not.toHaveText('Your chats live here');
});

test('skipping the tour can be undone with "Resume tour"; Esc skips too', async ({ browser }) => {
  const { page } = await signIn(browser, uniqueName('sam'), { guide: true });
  await expect(card(page)).toBeVisible();
  await card(page).getByRole('button', { name: 'Skip' }).click();
  await expect(card(page)).toBeHidden();

  await expect(offer(page)).toContainText('Pick up the tour');
  await offer(page).getByRole('button', { name: 'Resume tour' }).click();
  await expect(card(page)).toContainText('1 of 10');
  await card(page).getByRole('button', { name: 'Next' }).click();
  await expect(card(page)).toContainText('2 of 10');

  await page.keyboard.press('Escape');
  await expect(card(page)).toBeHidden();
  await expect(offer(page).getByRole('button', { name: 'Resume tour' })).toBeVisible();
  await offer(page).getByRole('button', { name: 'Resume tour' }).click();
  await expect(card(page)).toContainText('2 of 10');
  await finish(page);
  await expect(offer(page)).toHaveCount(0);
});

test('a person who has been around is offered the tour, never forced', async ({ browser }) => {
  const { vera } = await existingUser(browser);
  const { page } = vera;
  await expect(offer(page)).toContainText('New here?');
  await page.waitForTimeout(1500);
  await expect(card(page)).toHaveCount(0);

  await offer(page).getByRole('button', { name: 'Take the tour' }).click();
  await expect(card(page)).toContainText('1 of 10');
  await finish(page);
  await expect(offer(page)).toHaveCount(0);

  // The menu entry starts it again whenever they like.
  await takeTourFromMenu(page);
  await expect(card(page)).toContainText('1 of 10');
  await card(page).getByRole('button', { name: 'Skip' }).click();
});

test('"Not now" hides the offer for good', async ({ browser }) => {
  const { vera } = await existingUser(browser);
  const saved = guideSaved(vera.page);
  await vera.page.getByRole('button', { name: 'Not now' }).click();
  await expect(offer(vera.page)).toHaveCount(0);
  await saved;
  await vera.page.reload();
  await expect(vera.page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await clearTips(vera.page);
  await expect(offer(vera.page)).toHaveCount(0);
});

test('a tip shows the first time a feature is opened, once, and not again after a reload', async ({
  browser,
}) => {
  // No wait between tips, so every tip of a screen shows one after the other.
  const { vera, friend } = await existingUser(browser, 0);
  const { page } = vera;
  const seen = [...(await clearTips(page))];
  await openChat(page, friend.name);
  seen.push(...(await clearTips(page)));
  expect(seen).toContain('Type here');
  expect(new Set(seen).size).toBe(seen.length);

  // The server has them too; a reload does not bring any of them back.
  await page.waitForTimeout(2000);
  await page.reload();
  expect(await clearTips(page)).toEqual([]);
  await openChat(page, friend.name);
  expect(await clearTips(page)).toEqual([]);
});

test('a feature that was used is never shown as a tip', async ({ browser }) => {
  // A long wait between tips, so nothing covers the screen while she writes.
  const { vera, friend } = await existingUser(browser, 600_000);
  const { page } = vera;
  await openChat(page, friend.name);
  await send(page, 'thank you!');
  await expect(page.getByRole('article').filter({ hasText: 'thank you!' })).toBeVisible();

  // Now let the tips through: the box she just used is not among them.
  await page.evaluate(() => {
    localStorage.setItem('flick.guide.cooldown_ms', '0');
  });
  const seen = await clearTips(page);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).not.toContain('Type here');
});

test('the guide can be replayed and reset from Settings', async ({ browser }) => {
  const { vera } = await existingUser(browser);
  const { page } = vera;
  await goTo(page, 'Settings');
  await openSettingsSection(page, 'Guide and tips');
  await expect(page.getByRole('heading', { name: 'Writing messages' })).toBeVisible();

  const voice = page.getByRole('listitem').filter({ hasText: 'Voice notes' });
  await expect(voice).toContainText('New');
  await page.getByRole('button', { name: 'Show me Voice notes' }).click();
  await expect(card(page).getByRole('heading')).toHaveText('Say it instead of typing');
  await card(page).getByRole('button', { name: 'Got it' }).click();
  await expect(card(page)).toBeHidden();

  await goTo(page, 'Settings');
  await openSettingsSection(page, 'Guide and tips');
  await expect(page.getByRole('listitem').filter({ hasText: 'Voice notes' })).toContainText('Seen');

  // Reset forgets it all, here and on the server.
  const resetSaved = guideSaved(page);
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByText('The guide was reset.')).toBeVisible();
  await expect(page.getByRole('listitem').filter({ hasText: 'Voice notes' })).toContainText('New');
  await resetSaved;
  await page.reload();
  await page.evaluate(() => {
    localStorage.setItem('flick.guide.cooldown_ms', '0');
  });
  // Everything is new again, so the Settings tip comes back; close it to reach the list.
  expect(await clearTips(page, 6000)).toContain('Make it look right');
  await openSettingsSection(page, 'Guide and tips');
  await expect(page.getByRole('listitem').filter({ hasText: 'Voice notes' })).toContainText('New');
  await expect(page.getByRole('listitem').filter({ hasText: 'Welcome tour' })).toContainText('New');

  // The tips switch is there too.
  await expect(page.getByRole('switch', { name: 'Show tips as I use new features' })).toBeChecked();
});

test('the guide stays out of the way during a call', async ({ browser }) => {
  const alice = await signIn(browser, uniqueName('alice'), { guide: true });
  const bob = await signIn(browser, uniqueName('bob'));
  await expect(card(alice.page)).toBeVisible();

  await startDirectChat(bob.page, alice.name);
  await bob.page.getByRole('button', { name: `Start voice call with ${alice.name}` }).click();

  const incoming = alice.page.getByRole('alertdialog');
  await expect(incoming).toBeVisible();
  // The tour is hidden while the call rings, and the incoming-call screen is on top of everything.
  await expect(card(alice.page)).toBeHidden();
  await incoming.getByRole('button', { name: 'Decline call' }).click();
  await expect(incoming).toBeHidden();
  await expect(card(alice.page)).toBeVisible();
});
