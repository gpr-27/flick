import { test, expect } from '@playwright/test';
import { bubble, chatInList, signIn, startDirectChat, uniqueName } from './support';

// Journey (i): take a photo with the live camera and send it. Chromium gets a fake camera (a test
// picture) and allows it without a prompt, so no real device is needed.
test.use({
  permissions: ['camera'],
  launchOptions: {
    args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
  },
});

test('a photo taken with the camera is sent to the other person', async ({ browser }) => {
  const bob = await signIn(browser, uniqueName('bob'));
  const alice = await signIn(browser, uniqueName('alice'), {
    context: { permissions: ['camera'] },
  });
  await startDirectChat(alice.page, bob.name);

  await alice.page.getByRole('button', { name: 'Open camera' }).click();
  const shutter = alice.page.getByRole('button', { name: 'Take photo' });
  await expect(shutter).toBeEnabled();
  await shutter.click();
  await expect(alice.page.getByAltText('Your photo')).toBeVisible();
  await alice.page.getByRole('button', { name: /Use photo/ }).click();

  // The shot is now a normal attachment: preview, caption, send.
  await expect(alice.page.getByAltText('Selected image preview')).toBeVisible();
  await alice.page.getByLabel(/^Message /).fill('fresh from the camera');
  await alice.page.getByRole('button', { name: 'Send message' }).click();
  await expect(
    bubble(alice.page, 'fresh from the camera').getByRole('button', { name: 'Open image' }),
  ).toBeVisible();

  await chatInList(bob.page, alice.name).click();
  await expect(
    bubble(bob.page, 'fresh from the camera').getByRole('button', { name: 'Open image' }),
  ).toBeVisible();
});
