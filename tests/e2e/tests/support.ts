// Small helpers shared by the journeys. A "person" is one browser context (its own storage, cookies
// and network state) signed in as one fake user, so two people are really two separate browsers.
import {
  expect,
  type Browser,
  type BrowserContext,
  type Locator,
  type Page,
} from '@playwright/test';

export interface Person {
  name: string;
  context: BrowserContext;
  page: Page;
}

export interface SignInOptions {
  /** Options for the browser context, e.g. a phone-sized viewport. */
  context?: Parameters<Browser['newContext']>[0];
  /** Runs before the page loads, e.g. to install a network trick. */
  beforeLoad?: (page: Page) => Promise<void>;
}

/** A user name that is unique per run: the database is shared by all tests, so names must not repeat. */
export const uniqueName = (base: string): string =>
  `${base}_${Math.random().toString(36).slice(2, 8)}`;

/** Open the app in a fresh browser context, signed in as `name` (created on first sign-in). */
export async function signIn(
  browser: Browser,
  name: string,
  options: SignInOptions = {},
): Promise<Person> {
  const context = await browser.newContext(options.context);
  const page = await context.newPage();
  await options.beforeLoad?.(page);
  await page.goto(`/?as=${name}`);
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  return { name, context, page };
}

/** The chat list entry with this title. */
export const chatInList = (page: Page, title: string): Locator =>
  page.getByRole('option', { name: new RegExp(title) });

/** Start a direct chat with `username` from the "New chat" dialog. */
export async function startDirectChat(page: Page, username: string): Promise<void> {
  await page.getByRole('button', { name: 'New chat' }).click();
  await page.getByLabel('Search people').fill(username);
  await page.getByRole('button', { name: `Chat with ${username}` }).click();
  await expect(page.getByRole('region', { name: `Chat with ${username}` })).toBeVisible();
}

/** Create a group from the "New group" dialog. The new group opens by itself. */
export async function createGroup(page: Page, title: string, members: string[]): Promise<void> {
  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill(title);
  for (const member of members) {
    await page.getByLabel('Search people').fill(member);
    await page.getByRole('button', { name: `Add ${member}` }).click();
    await expect(page.getByRole('button', { name: `Remove ${member}` })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('region', { name: `Chat with ${title}` })).toBeVisible();
}

/** Open an existing chat from the list. */
export async function openChat(page: Page, title: string): Promise<void> {
  await chatInList(page, title).click();
  await expect(page.getByRole('region', { name: `Chat with ${title}` })).toBeVisible();
}

/** Type a message and press the send button. */
export async function send(page: Page, text: string): Promise<void> {
  await page.getByLabel(/^Message /).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

/** The message bubble containing `text`. */
export const bubble = (page: Page, text: string): Locator =>
  page.getByRole('article').filter({ hasText: text });

/** The delivery tick of a message I sent: "Sent", "Delivered" or "Read". */
export const tick = (page: Page, text: string): Locator =>
  bubble(page, text).getByRole('img', { name: /^(Sending|Sent|Delivered|Read)$/ });

/** Hover a bubble so its action buttons (react, edit, delete...) are showing, then return it. */
export async function hoverBubble(page: Page, text: string): Promise<Locator> {
  const target = bubble(page, text);
  await target.hover();
  return target;
}
