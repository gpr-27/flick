import { test, expect, type Page } from '@playwright/test';
import { goTo, signIn, uniqueName } from './support';

// Journeys 15: "install the app" on a phone. This file runs only on the `phone` project, whose
// default user agent is an iPhone's. The service worker is blocked in these tests, so what is
// tested is the card, the steps and the call to the browser's own install dialog.

const KEY = 'flick.install_card_dismissed_at';
const DAY = 24 * 60 * 60 * 1000;

const ANDROID_CHROME =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const INSTAGRAM_IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 320.0.0.0';

const card = (page: Page) => page.getByText('Install Flick for a faster, full-screen app.');

test('iPhone: the card offers install and the button shows the Add to Home Screen steps', async ({
  browser,
}) => {
  const { page } = await signIn(browser, uniqueName('ivy'));

  // The card sits on top of the chat list.
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  const steps = page.getByRole('dialog', { name: 'Install Flick' });
  await expect(steps).toBeVisible();
  await expect(steps.getByText('Add to Home Screen')).toBeVisible();
  await expect(steps.getByRole('img', { name: 'Share' })).toBeVisible();
  // It is a sheet from the bottom edge, inside the screen.
  const viewport = page.viewportSize();
  await expect
    .poll(async () => {
      const box = await steps.boundingBox();
      return (box?.y ?? 0) + (box?.height ?? 0);
    })
    .toBeGreaterThan((viewport?.height ?? 0) - 2);
  await steps.getByRole('button', { name: 'Got it' }).click();
  await expect(steps).toBeHidden();
  // Opening the steps does not dismiss the card.
  await expect(card(page)).toBeVisible();
});

test('closing the card hides it for two weeks, not longer', async ({ browser }) => {
  const { page } = await signIn(browser, uniqueName('ivy'));
  await expect(card(page)).toBeVisible();

  await page.getByRole('button', { name: 'Hide the install suggestion' }).click();
  await expect(card(page)).toBeHidden();
  // The moment is remembered, and a reload does not bring the card back.
  const stored = await page.evaluate((key) => Number(localStorage.getItem(key)), KEY);
  expect(Math.abs(Date.now() - stored)).toBeLessThan(60_000);
  await page.reload();
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await expect(card(page)).toBeHidden();

  // 13 days later it is still quiet; after 15 days it is offered again.
  await page.evaluate(
    ([key, at]) => localStorage.setItem(String(key), String(at)),
    [KEY, Date.now() - 13 * DAY],
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await expect(card(page)).toBeHidden();
  await page.evaluate(
    ([key, at]) => localStorage.setItem(String(key), String(at)),
    [KEY, Date.now() - 15 * DAY],
  );
  await page.reload();
  await expect(card(page)).toBeVisible();

  // Even while the card is hidden, the menu keeps an "Install app" entry.
  await page.getByRole('button', { name: 'Hide the install suggestion' }).click();
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Install app' }).click();
  await expect(page.getByRole('dialog', { name: 'Install Flick' })).toBeVisible();
});

test("Android Chrome: the install button calls the browser's own prompt()", async ({ browser }) => {
  const { page } = await signIn(browser, uniqueName('andy'), {
    context: { userAgent: ANDROID_CHROME },
  });
  // Without the browser's event, Android gets the written steps.
  await expect(card(page)).toBeVisible();

  // The browser says "installable": a synthetic beforeinstallprompt, like Chrome's, with prompt().
  const prevented = await page.evaluate(() => {
    const w = window as unknown as { __prompted: number };
    w.__prompted = 0;
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, {
      prompt: () => {
        w.__prompted += 1;
        return Promise.resolve();
      },
      userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  });
  // The app took over from the browser's own mini-bar.
  expect(prevented).toBe(true);

  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __prompted: number }).__prompted))
    .toBe(1);
  // The browser's dialog was used, not our written steps.
  await expect(page.getByRole('dialog', { name: 'Install Flick' })).toHaveCount(0);

  // Without the event, the same button shows the Android steps.
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  const steps = page.getByRole('dialog', { name: 'Install Flick' });
  await expect(steps.getByText('Add to Home screen')).toBeVisible();
});

test("inside another app's browser the steps say to open it in the real browser", async ({
  browser,
}) => {
  const { page } = await signIn(browser, uniqueName('ivy'), {
    context: { userAgent: INSTAGRAM_IPHONE },
  });
  await page.getByRole('button', { name: 'Install', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Install Flick' }).getByText(/Open in Safari/),
  ).toBeVisible();
});

test('an app that is already installed is not asked to install', async ({ browser }) => {
  const { page } = await signIn(browser, uniqueName('ivy'), {
    beforeLoad: (p) =>
      p.addInitScript(() => {
        const original = window.matchMedia.bind(window);
        window.matchMedia = (query: string) =>
          query.includes('display-mode: standalone')
            ? ({
                matches: true,
                media: query,
                onchange: null,
                addEventListener: () => undefined,
                removeEventListener: () => undefined,
                addListener: () => undefined,
                removeListener: () => undefined,
                dispatchEvent: () => false,
              } as MediaQueryList)
            : original(query);
      }),
  });
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await expect(card(page)).toHaveCount(0);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: 'Settings' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Install app' })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await goTo(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
});
