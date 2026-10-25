import { test, expect, type Page } from '@playwright/test';
import {
  attachFile,
  bubble,
  bubbleBox,
  composerAction,
  makePng,
  openPair,
  uniqueName,
} from './support';

// Journeys 11: photos, files, voice notes and GIFs. The stack has a real MinIO for uploads, and
// the browsers have a fake microphone (see playwright.config.ts).

/** Wait until the <img> has really loaded (a picture that failed has a natural width of 0). */
const loadedWidth = (page: Page, alt: string) =>
  expect
    .poll(() =>
      page
        .getByRole('article')
        .getByRole('img', { name: alt })
        .first()
        .evaluate((img: HTMLImageElement) => (img.complete ? img.naturalWidth : 0)),
    )
    .toBeGreaterThan(0);

test('a photo goes through the message box, shows for both people and opens large', async ({
  browser,
}) => {
  const { alice, bob } = await openPair(browser);
  await attachFile(alice.page, 'Photo or video', {
    name: 'red.png',
    mimeType: 'image/png',
    buffer: makePng(240, 160, [200, 60, 60]),
  });
  // The chosen picture shows as a small preview with a button to take it back out.
  await expect(alice.page.getByRole('img', { name: 'Selected image preview' })).toBeVisible();
  await expect(alice.page.getByRole('button', { name: 'Remove attachment' })).toBeVisible();
  await alice.page.getByLabel(/^Message /).fill('a red photo');
  await alice.page.getByRole('button', { name: 'Send message' }).click();

  // Alice's bubble and Bob's bubble both show the picture, with the caption under it.
  for (const page of [alice.page, bob.page]) {
    await expect(bubble(page, 'a red photo')).toBeVisible();
    await loadedWidth(page, 'a red photo');
  }
  // The preview in the box is gone once it has been sent.
  await expect(alice.page.getByRole('img', { name: 'Selected image preview' })).toHaveCount(0);

  // Tapping the picture opens it large; the close button brings back the chat.
  await bubble(bob.page, 'a red photo').getByRole('button', { name: 'Open image' }).click();
  const lightbox = bob.page.getByRole('dialog', { name: 'Image preview' });
  await expect(lightbox.getByRole('img', { name: 'Attachment preview' })).toBeVisible();
  await bob.page.getByRole('button', { name: 'Close image preview' }).click();
  await expect(lightbox).toHaveCount(0);
});

test('a file is uploaded, shows its name and size, and its link serves the same bytes', async ({
  browser,
}) => {
  const { alice, bob } = await openPair(browser);
  const name = `${uniqueName('report')}.pdf`;
  const content = '%PDF-1.4 the contents of the file, as the server stored them';
  await attachFile(alice.page, 'File', {
    name,
    mimeType: 'application/pdf',
    buffer: Buffer.from(content),
  });
  await expect(alice.page.getByText(name)).toBeVisible();
  await alice.page.getByRole('button', { name: 'Send message' }).click();

  for (const page of [alice.page, bob.page]) {
    const download = page.getByRole('button', { name: `Download ${name}` });
    await expect(download).toBeVisible();
    await expect(download).toContainText(`${content.length} B`);
  }

  // The download button opens a time-limited link. Catch the link instead of following it, and
  // fetch it ourselves: it must be the stored file, byte for byte.
  await bob.page.evaluate(() => {
    (window as unknown as { __opened: string[] }).__opened = [];
    window.open = (url) => {
      (window as unknown as { __opened: string[] }).__opened.push(String(url));
      return null;
    };
  });
  await bob.page.getByRole('button', { name: `Download ${name}` }).click();
  await expect
    .poll(() =>
      bob.page.evaluate(() => (window as unknown as { __opened: string[] }).__opened.length),
    )
    .toBe(1);
  const [link] = await bob.page.evaluate(
    () => (window as unknown as { __opened: string[] }).__opened,
  );
  const response = await bob.page.request.get(link ?? '');
  expect(response.status()).toBe(200);
  expect(await response.text()).toBe(content);
});

test('a file type the server does not accept is refused with a message, and can be removed', async ({
  browser,
}) => {
  const { alice } = await openPair(browser);
  await attachFile(alice.page, 'File', {
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('plain text is not on the allow list'),
  });
  await alice.page.getByRole('button', { name: 'Send message' }).click();
  await expect(alice.page.getByRole('alert')).toBeVisible();
  await expect(alice.page.getByRole('button', { name: 'Retry' })).toBeVisible();
  // Nothing was sent, and taking the file out clears the message.
  await expect(alice.page.getByRole('button', { name: 'Download notes.txt' })).toHaveCount(0);
  await alice.page.getByRole('button', { name: 'Remove attachment' }).click();
  await expect(alice.page.getByRole('alert')).toHaveCount(0);
});

test('a voice note: record, send, waveform, a duration that fits, play and pause', async ({
  browser,
}) => {
  const { alice, bob } = await openPair(browser);
  await alice.page.getByRole('button', { name: 'Record voice message' }).click();
  const bar = alice.page.getByRole('group', { name: 'Voice message' });
  await expect(bar).toBeVisible();
  // The timer runs while the fake microphone records; wait until two seconds are on it.
  await expect(bar.getByRole('timer', { name: 'Recording time' })).toHaveText(/^0:0[2-9]$/);
  await bar.getByRole('button', { name: 'Send voice message' }).click();
  await expect(bar).toHaveCount(0);

  for (const page of [alice.page, bob.page]) {
    const voice = page.getByRole('article').filter({ has: page.getByTestId('waveform') });
    await expect(voice).toBeVisible();
    await expect(voice.getByTestId('waveform')).toBeVisible();
    const playButton = voice.getByRole('button', { name: 'Play voice message' });
    await expect(playButton).toBeVisible();

    // The duration is whole: its box lies inside the coloured bubble, on the screen, and the
    // text is not cut off by its own box.
    const duration = voice.locator('span.tabular-nums');
    await expect(duration).toHaveText(/^0:0[2-9]$/);
    const shell = await voice.locator('.bubble-sent, .bubble-recv').boundingBox();
    const text = await duration.boundingBox();
    const speed = await voice.getByRole('button', { name: /^Playback speed/ }).boundingBox();
    const viewport = page.viewportSize();
    if (!shell || !text || !speed || !viewport) throw new Error('voice note has no boxes');
    expect(text.x).toBeGreaterThanOrEqual(shell.x);
    expect(text.x + text.width).toBeLessThanOrEqual(shell.x + shell.width);
    expect(speed.x + speed.width).toBeLessThanOrEqual(shell.x + shell.width);
    expect(shell.x + shell.width).toBeLessThanOrEqual(viewport.width);
    const clipped = await duration.evaluate((el) => el.scrollWidth > el.clientWidth);
    expect(clipped).toBe(false);

    // Play and pause flip the button; the speed button cycles 1x, 1.5x, 2x.
    await playButton.click();
    await expect(voice.getByRole('button', { name: 'Pause voice message' })).toBeVisible();
    await voice.getByRole('button', { name: 'Pause voice message' }).click();
    await expect(voice.getByRole('button', { name: 'Play voice message' })).toBeVisible();
    await voice.getByRole('button', { name: /^Playback speed 1x/ }).click();
    await expect(voice.getByRole('button', { name: /^Playback speed 1.5x/ })).toBeVisible();
  }
});

test('a voice note can be thrown away before it is sent', async ({ browser }) => {
  const { alice } = await openPair(browser);
  await alice.page.getByRole('button', { name: 'Record voice message' }).click();
  const bar = alice.page.getByRole('group', { name: 'Voice message' });
  await expect(bar).toBeVisible();
  await bar.getByRole('button', { name: 'Cancel recording' }).click();
  await expect(bar).toHaveCount(0);
  await expect(alice.page.getByTestId('waveform')).toHaveCount(0);
});

test('GIFs and stickers: without a GIPHY key the picker says so instead of breaking', async ({
  browser,
}) => {
  const { alice } = await openPair(browser);
  await composerAction(alice.page, 'GIFs and stickers');
  const picker = alice.page.getByRole('dialog', { name: 'GIF and sticker picker' });
  await expect(picker).toBeVisible();

  // It fits on the screen (a phone is only 390 px wide).
  const box = await picker.boundingBox();
  const viewport = alice.page.viewportSize();
  expect(box && viewport && box.x >= 0 && box.x + box.width <= viewport.width).toBe(true);

  const message = picker.getByRole('alert');
  const results = picker.getByRole('list');
  await expect(message.or(results).first()).toBeVisible();
  if (await message.isVisible()) {
    await expect(message).toHaveText('GIFs are not set up on this server.');
    // The Stickers tab answers the same way.
    await picker.getByRole('button', { name: 'Stickers' }).click();
    await expect(picker.getByRole('button', { name: 'Stickers' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(picker.getByRole('alert')).toHaveText('GIFs are not set up on this server.');
  }
  // Escape closes the picker and the chat is usable again.
  await alice.page.keyboard.press('Escape');
  await expect(picker).toHaveCount(0);
  await expect(bubbleBox(alice.page, 'hi there')).toBeVisible();
});
