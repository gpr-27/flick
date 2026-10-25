// Small helpers shared by the journeys. A "person" is one browser context (its own storage, cookies
// and network state) signed in as one fake user, so two people are really two separate browsers.
//
// The same journeys run on two Playwright projects, `laptop` and `phone` (see playwright.config.ts).
// Helpers that differ between the two (a right-click or a hold, a header button or the "⋮" menu)
// look at the project name, so a spec reads the same on both.
import { randomUUID } from 'node:crypto';
import { deflateSync, crc32 } from 'node:zlib';
import {
  expect,
  test,
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
  /** Options for the browser context, e.g. a different user agent. They win over the project's. */
  context?: Parameters<Browser['newContext']>[0];
  /** Runs before the page loads, e.g. to install a network trick. */
  beforeLoad?: (page: Page) => Promise<unknown>;
}

/** True on the `phone` project. Outside a test (the README screenshot script) it is false. */
export function isPhone(): boolean {
  try {
    return test.info().project.name === 'phone';
  } catch {
    return false;
  }
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
  // `browser.newContext()` inherits the project's `use` (size, touch, user agent, permissions).
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

/** Leave the open chat and show the chat list again (the back arrow on a phone, the X on a laptop). */
export async function closeChat(page: Page): Promise<void> {
  await page
    .getByRole('button', { name: isPhone() ? 'Back to chats' : 'Close conversation' })
    .click();
  await expect(page.getByRole('listbox', { name: 'Chats' })).toBeVisible();
}

/** The message box of the open chat. */
export const composer = (page: Page): Locator => page.getByLabel(/^Message /);

/** Type a message and press the send button. */
export async function send(page: Page, text: string): Promise<void> {
  await composer(page).fill(text);
  await page.getByRole('button', { name: 'Send message' }).click();
}

/** Send a message and wait until the server has it (one tick), so its actions are available. */
export async function sendAndWait(page: Page, text: string): Promise<void> {
  await send(page, text);
  await expect(tick(page, text)).toHaveAccessibleName(/^(Sent|Delivered|Read)$/);
}

/**
 * Two people with an open direct chat: alice wrote `opening` and bob has opened the chat and seen
 * it. The usual starting point of a journey.
 */
export async function openPair(
  browser: Browser,
  opening = 'hi there',
): Promise<{ alice: Person; bob: Person }> {
  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'));
  await startDirectChat(alice.page, bob.name);
  await send(alice.page, opening);
  await openChat(bob.page, alice.name);
  await expect(bubble(bob.page, opening)).toBeVisible();
  return { alice, bob };
}

/** The message bubble containing `text`. */
export const bubble = (page: Page, text: string): Locator =>
  page.getByRole('article').filter({ hasText: text });

/** The coloured box of a message (inside the row that `bubble` finds). */
export const bubbleBox = (page: Page, text: string): Locator =>
  bubble(page, text).locator('.bubble-sent, .bubble-recv');

/** The delivery tick of a message I sent: "Sent", "Delivered" or "Read". */
export const tick = (page: Page, text: string): Locator =>
  bubble(page, text).getByRole('img', { name: /^(Sending|Sent|Delivered|Read)$/ });

/** Open the actions menu of a message with a right-click (the mouse way to do what a hold does on a phone). */
export async function openMessageMenu(page: Page, text: string): Promise<Locator> {
  await bubble(page, text).getByText(text).click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Message actions' });
  await menu.waitFor();
  return menu;
}

/**
 * Hold a message with a finger (Chromium touch events), like on a phone. The finger stays down
 * until the sheet is up, then the browser ends the touch.
 */
export async function holdMessage(page: Page, text: string): Promise<Locator> {
  const target = bubble(page, text).getByText(text).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  if (!box) throw new Error(`Message "${text}" is not on screen`);
  const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const cdp = await page.context().newCDPSession(page);
  const menu = page.getByRole('menu', { name: 'Message actions' });
  try {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
    await menu.waitFor();
  } finally {
    // A browser ends a long press by cancelling the touch (Android Chrome does, after its
    // `contextmenu`), so no click follows the lift. A plain lift would click the sheet's backdrop
    // and close it again whenever the finger comes up after the sheet's 350 ms guard.
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] });
    await cdp.detach();
  }
  return menu;
}

/** Open the actions of a message the way this device does it: a right-click, or a hold on a phone. */
export const openActions = (page: Page, text: string): Promise<Locator> =>
  isPhone() ? holdMessage(page, text) : openMessageMenu(page, text);

/** Open the actions of a message and choose one by name, e.g. "Pin" or "Reply". */
export async function doAction(page: Page, text: string, action: string): Promise<void> {
  const menu = await openActions(page, text);
  await menu.getByRole('menuitem', { name: action, exact: true }).click();
}

/** Open the "⋮" menu of the open chat and choose an entry. */
export async function chatOption(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole('button', { name: 'Chat options' }).click();
  await page.getByRole('menu', { name: 'Chat options' }).getByRole('menuitem', { name }).click();
}

/** The composer buttons by what they do. A laptop has one button each; a phone keeps them in "+". */
const COMPOSER_BUTTONS = {
  Emoji: 'Insert emoji',
  'Photo or video': 'Attach photo or video',
  File: 'Attach file',
  'GIFs and stickers': 'GIFs and stickers',
  Poll: 'Create poll',
} as const;
export type ComposerAction = keyof typeof COMPOSER_BUTTONS;

/** Press a composer action: the button on a laptop, the menu entry under "+" on a phone. */
export async function composerAction(page: Page, action: ComposerAction): Promise<void> {
  if (isPhone()) {
    await page.getByRole('button', { name: 'More actions' }).click();
    await page
      .getByRole('menu', { name: 'More actions' })
      .getByRole('menuitem', { name: action })
      .click();
  } else {
    await page.getByRole('button', { name: COMPOSER_BUTTONS[action] }).click();
  }
}

/** Open the group info dialog (a header button on a laptop, a "⋮" entry on a phone). */
export async function openGroupInfo(page: Page): Promise<void> {
  if (isPhone()) await chatOption(page, 'Group info');
  else await page.getByRole('button', { name: 'Group info' }).click();
  await expect(page.getByRole('dialog', { name: 'Group info' })).toBeVisible();
}

/** Start a video call from the open direct chat (a header button, or the "⋮" menu on a phone). */
export async function startVideoCall(page: Page, peer: string): Promise<void> {
  if (isPhone()) await chatOption(page, 'Video call');
  else await page.getByRole('button', { name: `Start video call with ${peer}` }).click();
}

/** Go to a top-level page from the bar: links on a laptop, the "More" menu on a phone. */
export async function goTo(page: Page, where: 'Settings' | 'Profile' | 'Calls'): Promise<void> {
  if (where === 'Calls' || !isPhone()) {
    await page
      .getByRole('navigation', { name: 'Account' })
      .getByRole('link', { name: where })
      .click();
  } else {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: where }).click();
  }
}

/** Press the theme button in the bar (a menu entry on a phone). Returns nothing; read `data-theme`. */
export async function toggleTheme(page: Page): Promise<void> {
  if (isPhone()) {
    await page.getByRole('button', { name: 'More', exact: true }).click();
    await page.getByRole('menuitem', { name: /^Switch to (dark|light) mode$/ }).click();
  } else {
    await page.getByRole('button', { name: /^Switch to (dark|light) mode$/ }).click();
  }
}

/** The theme the page is wearing: "light" or "dark". */
export const currentTheme = (page: Page): Promise<string | null> =>
  page.evaluate(() => {
    const theme = document.documentElement.getAttribute('data-theme');
    return theme === 'pastel-night' ? 'dark' : theme === 'pastel-glass' ? 'light' : theme;
  });

// ── talking to the API directly, to set a scene fast ────────────────────────────────────

const devices = new Map<string, string>();

/** POST as a fake user (token `fake:<name>`). Used to put messages in a chat without clicking. */
export const apiPost = (
  as: string,
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> => apiCall(as, 'POST', path, body);

/** The id this browser sends as its device. A call made with it is the same device as the page, not a new one. */
export const deviceOf = (page: Page): Promise<string | null> =>
  page.evaluate(() => localStorage.getItem('flick.device_id'));

/**
 * Give a user a display name (the name other people see), which the app itself cannot edit yet.
 * Pass the person's page so that the call is made as the same device (a second, silent device
 * would keep their messages from ever counting as delivered).
 */
export async function setDisplayName(page: Page, as: string, displayName: string): Promise<void> {
  const device = await deviceOf(page);
  if (device) devices.set(as, device);
  const { status, json } = await apiCall(as, 'PATCH', '/users/me', { display_name: displayName });
  if (status !== 200)
    throw new Error(`Setting the name of ${as} failed: ${status} ${JSON.stringify(json)}`);
}

async function apiCall(
  as: string,
  method: 'POST' | 'PATCH',
  path: string,
  body: unknown,
): Promise<{ status: number; json: unknown }> {
  const base = process.env.E2E_API_URL;
  if (!base) throw new Error('E2E_API_URL is not set; run this with `npm run e2e`.');
  let device = devices.get(as);
  if (!device) {
    device = randomUUID();
    devices.set(as, device);
  }
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer fake:${as}`,
      'x-device-id': device,
    },
    body: JSON.stringify(body),
  });
  return { status: response.status, json: await response.json().catch(() => null) };
}

/** The id of the chat with this title, read from the chat list (which a phone hides while a chat is open). */
export async function conversationId(page: Page, title: string): Promise<string> {
  const id = await page
    .locator('[role="option"][data-conversation-id]')
    .filter({ hasText: title })
    .getAttribute('data-conversation-id');
  if (!id) throw new Error(`No chat called ${title} in the list`);
  return id;
}

/** Send a text message into a chat as `as`, through the REST fallback. */
export async function apiSendText(as: string, conversation: string, text: string): Promise<void> {
  const { status, json } = await apiPost(as, `/conversations/${conversation}/messages`, {
    client_message_id: randomUUID().replaceAll('-', ''),
    content: { type: 'text', text },
  });
  if (status !== 200 && status !== 201) {
    throw new Error(`Sending as ${as} failed: ${status} ${JSON.stringify(json)}`);
  }
}

// ── files to upload ────────────────────────────────────────────────────────────────────

/** A valid PNG of one flat colour, built by hand so no image library is needed. */
export function makePng(
  width: number,
  height: number,
  [r, g, b]: [number, number, number],
): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body) >>> 0, body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // colour type: RGB
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) row.set([r, g, b], 1 + x * 3);
  const raw = Buffer.concat(Array.from({ length: height }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Choose a file through the file dialog that a composer action opens. */
export async function attachFile(
  page: Page,
  action: 'Photo or video' | 'File',
  file: { name: string; mimeType: string; buffer: Buffer },
): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await composerAction(page, action);
  await (await chooser).setFiles(file);
}

/** True when the page scrolls sideways (anything wider than the window). */
export const scrollsSideways = (page: Page): Promise<boolean> =>
  page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
