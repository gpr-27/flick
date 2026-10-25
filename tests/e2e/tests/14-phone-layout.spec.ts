import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  apiSendText,
  bubble,
  closeChat,
  composer,
  conversationId,
  goTo,
  holdMessage,
  openPair,
  scrollsSideways,
  sendAndWait,
  openSettingsSection,
} from './support';

// Journeys 14: the phone layout (390 x 844). This file runs only on the `phone` project.

/** Every box must lie inside the window and every control must be thumb-sized (44 px). */
async function expectBigButtons(controls: Locator): Promise<void> {
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await controls.nth(i).boundingBox();
    const label = await controls
      .nth(i)
      .evaluate((el) => el.getAttribute('aria-label') ?? el.textContent ?? '?');
    expect(box, `${label} has a box`).not.toBeNull();
    // Half a pixel of rounding is allowed: 44 px made of fractions of a grid cell.
    expect(box?.height ?? 0, `${label} is tall enough`).toBeGreaterThanOrEqual(43.5);
  }
}

const inside = (
  box: { x: number; y: number; width: number; height: number } | null,
  page: Page,
) => {
  const viewport = page.viewportSize();
  return Boolean(
    box &&
    viewport &&
    box.x >= -0.5 &&
    box.y >= -0.5 &&
    box.x + box.width <= viewport.width + 0.5 &&
    box.y + box.height <= viewport.height + 0.5,
  );
};

test('an open chat has one top bar, its own; the back button returns to the list', async ({
  browser,
}) => {
  const { alice, bob } = await openPair(browser);
  const page = alice.page;
  const globalBar = page.getByRole('banner');

  // The chat is open: the app-wide bar (logo, Calls, menu) steps aside; the chat header remains.
  await expect(page.getByRole('heading', { name: bob.name })).toBeVisible();
  await expect(globalBar).toBeHidden();
  await expect(page.getByRole('link', { name: 'Flick home' })).toBeHidden();
  const back = await page.getByRole('button', { name: 'Back to chats' }).boundingBox();
  // The chat header sits at the very top of the screen, where the bar used to be.
  expect(back?.y ?? 999).toBeLessThan(24);

  // Back to the list: the app bar is back and the chat is gone from the screen.
  await closeChat(page);
  await expect(globalBar).toBeVisible();
  await expect(page.getByRole('link', { name: 'Flick home' })).toBeVisible();
  await expect(page.getByRole('region', { name: `Chat with ${bob.name}` })).toHaveCount(0);

  // Other pages keep the bar.
  await goTo(page, 'Calls');
  await expect(globalBar).toBeVisible();
});

test('the message box is wide, 16 px, and keeps clear of the keyboard', async ({ browser }) => {
  const { alice } = await openPair(browser);
  const page = alice.page;
  const field = composer(page);
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');

  // At least 60% of the screen width, so there is room to write: empty, and with text in it.
  expect((await field.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(viewport.width * 0.6);
  await field.fill('some words');
  expect((await field.boundingBox())?.width ?? 0).toBeGreaterThanOrEqual(viewport.width * 0.6);
  await field.fill('');
  // 16 px or more: a smaller font makes iOS Safari zoom the page when the box is focused.
  expect(
    await field.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
  ).toBeGreaterThanOrEqual(16);
  // The page asks phones to shrink the layout, not to cover it, when the keyboard opens.
  await expect(page.locator('meta[name="viewport"]')).toHaveAttribute(
    'content',
    /interactive-widget=resizes-content/,
  );

  // Simulate the on-screen keyboard: the visible area shrinks to about half. The message box
  // must still be on screen, below the messages, and the messages must still scroll.
  await sendAndWait(page, 'a message above the keyboard');
  await field.focus();
  await page.setViewportSize({ width: viewport.width, height: 430 });
  await expect(field).toBeInViewport({ ratio: 1 });
  expect(inside(await field.boundingBox(), page)).toBe(true);
  expect(
    inside(await page.getByRole('button', { name: 'Record voice message' }).boundingBox(), page),
  ).toBe(true);
  await expect(bubble(page, 'a message above the keyboard')).toBeInViewport();
  const header = await page.getByRole('button', { name: 'Back to chats' }).boundingBox();
  expect(header?.y ?? -1).toBeGreaterThanOrEqual(0);
  expect(await scrollsSideways(page)).toBe(false);
  // Typing and sending still work in the short window.
  await field.fill('typed with the keyboard open');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(bubble(page, 'typed with the keyboard open')).toBeInViewport();
});

test('the "+" menu holds the extra attach options, each a full-size button', async ({
  browser,
}) => {
  const { alice } = await openPair(browser);
  const page = alice.page;

  // On a phone the bar shows only "+", the box and one round button: the microphone while the
  // box is empty, Send once something is typed.
  for (const name of [
    'Attach photo or video',
    'Open camera',
    'Attach file',
    'Insert emoji',
    'Create poll',
  ]) {
    await expect(page.getByRole('button', { name, exact: true })).toBeHidden();
  }
  await expect(page.getByRole('button', { name: 'Record voice message' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Send message' })).toBeHidden();
  await expectBigButtons(page.getByRole('button', { name: 'Record voice message' }));
  await composer(page).fill('x');
  await expect(page.getByRole('button', { name: 'Send message' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Record voice message' })).toBeHidden();
  await expectBigButtons(page.getByRole('button', { name: 'Send message' }));
  await composer(page).fill('');

  const plus = page.getByRole('button', { name: 'More actions' });
  await expectBigButtons(plus);
  await plus.click();
  const menu = page.getByRole('menu', { name: 'More actions' });
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Emoji',
    'Photo or video',
    'Camera',
    'File',
    'GIFs and stickers',
    'Poll',
    'Schedule send',
    'Formatting',
  ]);
  await expectBigButtons(menu.getByRole('menuitem'));
  expect(inside(await menu.boundingBox(), page)).toBe(true);

  // An entry does its job: Emoji opens the picker, and picking one puts it in the box.
  await menu.getByRole('menuitem', { name: 'Emoji' }).click();
  const picker = page.getByRole('dialog', { name: 'Emoji picker' });
  await expect(picker).toBeVisible();
  expect(inside(await picker.boundingBox(), page)).toBe(true);
  await picker.getByRole('button', { name: 'Insert 🎉' }).click();
  await expect(composer(page)).toHaveValue('🎉');
});

test('the message action sheet fits the screen and every button is at least 44 px tall', async ({
  browser,
}) => {
  const { alice, bob } = await openPair(browser, 'hold this message');
  await sendAndWait(bob.page, 'and this one from the other side');
  await expect(bubble(alice.page, 'and this one from the other side')).toBeVisible();

  for (const [page, text] of [
    [alice.page, 'hold this message'],
    [alice.page, 'and this one from the other side'],
  ] as const) {
    await holdMessage(page, text);
    const sheet = page.getByRole('dialog', { name: 'Message actions' });
    await expect(sheet).toBeVisible();
    // The sheet rises from the bottom edge and comes to rest wholly inside the window (it slides
    // in from below, so wait for that: a sheet still sliding is partly outside).
    await expect.poll(async () => inside(await sheet.boundingBox(), page)).toBe(true);
    const viewport = page.viewportSize();
    const rest = await sheet.boundingBox();
    expect((rest?.y ?? 0) + (rest?.height ?? 0)).toBeGreaterThan((viewport?.height ?? 0) - 2);
    // Reactions, actions and the delete step: all thumb-sized.
    await expectBigButtons(sheet.getByRole('button'));
    await expectBigButtons(sheet.getByRole('menuitem'));
    await sheet.getByRole('menuitem', { name: 'Delete', exact: true }).click();
    await expectBigButtons(sheet.getByRole('menuitem'));
    await sheet.getByRole('menuitem', { name: 'Cancel' }).click();
    await expect(sheet).toBeHidden();
  }
});

test('no page scrolls sideways: list, chat, settings, profile, calls', async ({ browser }) => {
  const { alice, bob } = await openPair(browser, 'a short first message');
  const page = alice.page;
  const id = await conversationId(page, bob.name);

  // The chat: a very long unbroken word, a long sentence and a photo-width bubble.
  await apiSendText(bob.name, id, `x${'0123456789'.repeat(40)}`);
  await apiSendText(bob.name, id, 'a sentence that goes on and on '.repeat(30));
  await expect(bubble(page, 'a sentence that goes on')).toBeVisible();
  expect(await scrollsSideways(page), 'the chat').toBe(false);
  const scroller = page.getByTestId('message-scroller');
  expect(await scroller.evaluate((el) => el.scrollWidth > el.clientWidth), 'the message list').toBe(
    false,
  );

  await closeChat(page);
  expect(await scrollsSideways(page), 'the chat list').toBe(false);
  await goTo(page, 'Settings');
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();
  // The sections are accordion rows on a phone: open each one and look at the page.
  for (const section of [
    'Account',
    'Notifications',
    'Appearance',
    'Chats',
    'Calls',
    'Flick assistant',
    'Storage and data',
    'Shortcuts and about',
    'Privacy',
  ]) {
    await openSettingsSection(page, section);
    expect(await scrollsSideways(page), `settings: ${section}`).toBe(false);
  }
  await expect(page.getByRole('combobox', { name: 'Last seen and online' })).toBeVisible();
  await goTo(page, 'Profile');
  await expect(page.getByRole('heading', { name: alice.name })).toBeVisible();
  expect(await scrollsSideways(page), 'profile').toBe(false);
  await goTo(page, 'Calls');
  await expect(page.getByRole('heading', { name: /calls/i }).first()).toBeVisible();
  expect(await scrollsSideways(page), 'calls').toBe(false);
});
