// Takes the README screenshots into docs/screenshots/. Run with `npm run e2e:screenshots`, which
// starts a fresh stack first, so the pictures always show the same small, made-up conversation.
import { chromium, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bubble,
  createGroup,
  openChat,
  send,
  signIn,
  startDirectChat,
  tick,
} from './tests/support';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
mkdirSync(out, { recursive: true });

const baseURL = process.env.E2E_WEB_URL;
if (!baseURL) throw new Error('E2E_WEB_URL is not set; run this with `npm run e2e:screenshots`.');

/** Screenshot without half-finished animations (bubbles fade in). */
const shot = (page: Page, name: string) =>
  page.screenshot({ path: join(out, `${name}.png`), animations: 'disabled' });

const browser = await chromium.launch();
// Same size for every picture, light theme, no service worker.
const context = { baseURL, viewport: { width: 1280, height: 800 }, colorScheme: 'light' } as const;
const options = { context: { ...context, serviceWorkers: 'block' } } as const;

try {
  const bob = await signIn(browser, 'bob', options);
  const carol = await signIn(browser, 'carol', options);
  const alice = await signIn(browser, 'alice', options);

  // A direct chat where Bob has read everything: two blue ticks.
  await startDirectChat(alice.page, 'bob');
  await send(alice.page, 'Hey Bob, are we still on for Saturday?');
  await openChat(bob.page, 'alice');
  await send(bob.page, 'Yes! I booked the table for 7.');
  await send(alice.page, 'Perfect, see you there.');
  await expect(tick(alice.page, 'Perfect, see you there.')).toHaveAccessibleName('Read');
  await expect(bubble(alice.page, 'I booked the table')).toBeVisible();

  // A group of three, with a reply from Carol.
  await createGroup(alice.page, 'Weekend plans', ['bob', 'carol']);
  await send(alice.page, 'Who is bringing what?');
  await openChat(carol.page, 'Weekend plans');
  await send(carol.page, 'I will bring dessert.');
  await expect(bubble(alice.page, 'I will bring dessert.')).toBeVisible();

  // 1. The chat list, with the group open.
  await shot(alice.page, 'chat-list');

  // 2. A conversation with delivery ticks.
  await openChat(alice.page, 'bob');
  await expect(bubble(alice.page, 'Perfect, see you there.')).toBeVisible();
  await shot(alice.page, 'conversation-ticks');

  // 3. Group info.
  await openChat(alice.page, 'Weekend plans');
  await alice.page.getByRole('button', { name: 'Group info' }).click();
  await expect(alice.page.getByRole('button', { name: 'Remove carol' })).toBeVisible();
  await shot(alice.page, 'group-info');
  await alice.page.getByRole('button', { name: 'Close', exact: true }).click();

  // 4. Settings.
  await alice.page.getByRole('link', { name: 'Settings' }).click();
  await expect(alice.page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  await shot(alice.page, 'settings');

  console.log(`Screenshots written to ${out}`);
} finally {
  await browser.close();
}
