import { existsSync } from 'node:fs';
import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  bubble,
  chatInList,
  closeChat,
  goTo,
  openActions,
  openChat,
  openGroupInfo,
  openSettingsSection,
  send,
  sendAndWait,
  setDisplayName,
  signIn,
  tick,
  uniqueName,
} from './support';

// Journeys 19: visual regression. Six key screens on each of the two profiles are compared with
// pictures stored in tests/e2e/screenshots-baseline/<platform>/<profile>/ (see the README).
// The people have made-up display names, so the pictures do not depend on the random user names,
// and the few things that change by the minute (times) are covered by a mask.

const SCREENS = [
  'chat-list.png',
  'conversation.png',
  'message-actions.png',
  'group-info.png',
  'settings.png',
  'incoming-call.png',
] as const;

/**
 * A flat page background instead of the drifting gradient blobs, and no soft shadows:
 * smooth gradients are what makes a picture big (the baselines must stay under 150 KB) and they
 * move with animations. Layout, colours, text and shapes are still the real thing.
 */
const plainBackground = (page: Page): Promise<unknown> =>
  page.addInitScript(() => {
    addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent =
        '.blobs { display: none !important } .app-bg { background: #f2f1fa !important } ' +
        '* { box-shadow: none !important; }';
      document.head.append(style);
    });
  });

/** The things that change from run to run: clock times and "5m" style ages. */
const masks = (page: Page) => [
  page.locator('time'),
  page.locator('[role="option"] span.shrink-0.text-\\[11px\\]'),
];

/** Wait until a moving box has stopped: two looks, 100 ms apart, find it in the same place. */
async function atRest(box: Locator): Promise<void> {
  let before = '';
  await expect
    .poll(
      async () => {
        const now = JSON.stringify(await box.boundingBox());
        const still = now === before;
        before = now;
        return still;
      },
      { intervals: [100] },
    )
    .toBe(true);
}

test('the six key screens look the way they did', async ({ browser }, testInfo) => {
  // Fonts are drawn differently on each operating system, so every platform has its own pictures.
  // Without any, CI (which runs on Linux) skips this journey instead of failing it; locally the
  // first run writes them (see README, "Visual baselines").
  const missing = SCREENS.filter((name) => !existsSync(testInfo.snapshotPath(name)));
  testInfo.skip(
    Boolean(process.env.CI) && missing.length > 0 && testInfo.config.updateSnapshots === 'missing',
    `no visual baselines for ${process.platform} yet; create them with --update-snapshots=all`,
  );
  test.setTimeout(150_000);

  // The people. Their user names are random; the names people see are fixed, set before anything
  // else happens (the app has no screen for it yet), then every page loads again to show them.
  const names = {
    alice: uniqueName('alice'),
    bob: uniqueName('bob'),
    carol: uniqueName('carol'),
  };
  const bob = await signIn(browser, names.bob);
  const carol = await signIn(browser, names.carol);
  const alice = await signIn(browser, names.alice, { beforeLoad: plainBackground });
  const page = alice.page;
  await setDisplayName(alice.page, names.alice, 'Alice Johnson');
  await setDisplayName(bob.page, names.bob, 'Bob Martin');
  await setDisplayName(carol.page, names.carol, 'Carol Diaz');
  for (const person of [alice, bob, carol]) {
    await person.page.reload();
    await expect(person.page.getByRole('button', { name: 'New chat' })).toBeVisible();
  }

  /** Like startDirectChat, but the person is found by user name and shown by display name. */
  const startChat = async (who: Page, username: string, shownAs: string): Promise<void> => {
    await who.getByRole('button', { name: 'New chat' }).click();
    await who.getByLabel('Search people').fill(username);
    await who.getByRole('button', { name: `Chat with ${shownAs}` }).click();
    await expect(who.getByRole('region', { name: `Chat with ${shownAs}` })).toBeVisible();
  };

  // A small, made-up conversation with each of them, and a group.
  await startChat(page, names.bob, 'Bob Martin');
  await sendAndWait(page, 'Are we still on for Saturday?');
  await openChat(bob.page, 'Alice Johnson');
  await send(bob.page, 'Yes! I will bring the map.');
  await expect(bubble(page, 'I will bring the map')).toBeVisible();
  await sendAndWait(page, 'Perfect, see you at ten.');
  await openActions(bob.page, 'Are we still on for Saturday?');
  await bob.page.getByRole('button', { name: 'React 👍' }).click();
  await expect(
    bubble(page, 'Are we still on for Saturday?').getByRole('button', { name: /^👍/ }),
  ).toBeVisible();
  // Bob has the chat open in front of him, so Alice's messages are read: blue ticks.
  await expect(tick(page, 'Perfect, see you at ten.')).toHaveAccessibleName('Read');

  await closeChat(page);
  await startChat(carol.page, names.alice, 'Alice Johnson');
  await send(carol.page, 'Lunch tomorrow?');
  await expect(chatInList(page, 'Carol Diaz')).toContainText('Lunch tomorrow?');

  await page.getByRole('button', { name: 'New group' }).click();
  await page.getByLabel('Group name').fill('Team Orbit');
  for (const [username, shownAs] of [
    [names.bob, 'Bob Martin'],
    [names.carol, 'Carol Diaz'],
  ] as const) {
    await page.getByLabel('Search people').fill(username);
    await page.getByRole('button', { name: `Add ${shownAs}` }).click();
    await expect(page.getByRole('button', { name: `Remove ${shownAs}` })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Create group' }).click();
  await expect(page.getByRole('region', { name: 'Chat with Team Orbit' })).toBeVisible();
  await sendAndWait(page, 'Welcome to the team, everyone.');
  await closeChat(page);

  const shot = async (name: (typeof SCREENS)[number]): Promise<void> => {
    // Let every entrance animation (a page sliding up by a pixel or two) run to its end first.
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getComputedTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      ),
    );
    await expect.soft(page).toHaveScreenshot(name, { mask: masks(page) });
  };

  // 1. The chat list.
  await expect(chatInList(page, 'Team Orbit')).toBeVisible();
  await expect(chatInList(page, 'Bob Martin')).toContainText('Perfect, see you at ten.');
  await expect(chatInList(page, 'Carol Diaz')).toContainText('Lunch tomorrow?');
  await shot('chat-list.png');

  // 2. An open conversation: bubbles, a reaction, a date chip and blue ticks.
  await openChat(page, 'Bob Martin');
  await expect(tick(page, 'Perfect, see you at ten.')).toHaveAccessibleName('Read');
  await expect(page.getByText('Online', { exact: true })).toBeVisible();
  await shot('conversation.png');

  // 3. The actions of a message: a popover on a laptop, a sheet from the bottom on a phone.
  await openActions(page, 'Perfect, see you at ten.');
  await expect(page.getByRole('menu', { name: 'Message actions' })).toBeVisible();
  // It slides in; take the picture when it has stopped.
  await atRest(page.getByRole('dialog', { name: 'Message actions' }));
  await shot('message-actions.png');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Message actions' })).toHaveCount(0);

  // 4. Group info.
  await closeChat(page);
  await openChat(page, 'Team Orbit');
  await openGroupInfo(page);
  const info = page.getByRole('dialog', { name: 'Group info' });
  await expect(info.getByText('Bob Martin')).toBeVisible();
  await expect(info.getByText('Carol Diaz')).toBeVisible();
  await atRest(info);
  await shot('group-info.png');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // 5. Settings.
  await closeChat(page);
  await goTo(page, 'Settings');
  await openSettingsSection(page, 'Privacy');
  await expect(page.getByRole('combobox', { name: 'Last seen and online' })).toBeVisible();
  await shot('settings.png');

  // 6. An incoming call: Carol rings Alice, who sees the full-screen answer or decline card.
  await page.getByRole('link', { name: 'Flick home' }).click();
  await expect(carol.page.getByRole('region', { name: 'Chat with Alice Johnson' })).toBeVisible();
  await carol.page.getByRole('button', { name: 'Start voice call with Alice Johnson' }).click();
  const incoming = page.getByRole('alertdialog');
  await expect(incoming.getByRole('heading', { name: 'Carol Diaz' })).toBeVisible();
  await expect(incoming).toContainText('Incoming voice call');
  await atRest(incoming);
  await shot('incoming-call.png');
  await carol.page.getByRole('button', { name: 'End call' }).click();
  await expect(incoming).toBeHidden();
});
