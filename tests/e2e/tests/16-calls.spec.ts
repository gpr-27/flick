import { test, expect, type Locator, type Page } from '@playwright/test';
import {
  openPair,
  signIn,
  startDirectChat,
  startVideoCall,
  uniqueName,
  type Person,
} from './support';

// Journeys 16: real one-to-one WebRTC calls between two browsers on this machine. Both have a fake
// camera (a moving test picture) and a fake microphone (a beep), so no hardware or prompt is needed
// (see playwright.config.ts). The media really travels from one browser to the other.

test.describe.configure({ timeout: 150_000 });

/**
 * Records every oscillator a page starts, with its pitch. The ringtone is made of oscillators
 * (440 and 480 Hz for the ring, 425 Hz for the waiting tone), so a page that rings leaves a trail.
 */
const recordTones = (page: Page): Promise<unknown> =>
  page.addInitScript(() => {
    const log: number[] = [];
    (window as unknown as { __tones: number[] }).__tones = log;
    const Native = window.AudioContext;
    function Spy(this: unknown, ...args: ConstructorParameters<typeof AudioContext>) {
      const ctx = new Native(...args);
      const create = ctx.createOscillator.bind(ctx);
      ctx.createOscillator = () => {
        const osc = create();
        const start = osc.start.bind(osc);
        osc.start = (when?: number) => {
          log.push(osc.frequency.value);
          start(when);
        };
        return osc;
      };
      return ctx;
    }
    Spy.prototype = Native.prototype;
    window.AudioContext = Spy as unknown as typeof AudioContext;
  });

const ringStarts = (page: Page, pitches: number[]): Promise<number> =>
  page.evaluate(
    (wanted) =>
      (window as unknown as { __tones: number[] }).__tones.filter((f) => wanted.includes(f)).length,
    pitches,
  );

/** Two people with an open chat, and the caller's and the callee's pages ready to record tones. */
async function twoPeople(
  browser: Parameters<typeof signIn>[0],
): Promise<{ caller: Person; callee: Person }> {
  const callee = await signIn(browser, uniqueName('bob'), { beforeLoad: recordTones });
  const caller = await signIn(browser, uniqueName('alice'), { beforeLoad: recordTones });
  await startDirectChat(caller.page, callee.name);
  return { caller, callee };
}

/**
 * The green Accept button bounces all the time (an attention animation), and Playwright waits for
 * a button to hold still before it clicks. Press it without that wait: the click still lands on it.
 */
const accept = (incoming: Locator): Promise<void> =>
  incoming.getByRole('button', { name: 'Accept call' }).click({ force: true });

/** Press on the middle of the self-view and drag it to (x, y), with a few moves in between. */
async function dragSelfView(page: Page, selfView: Locator, x: number, y: number): Promise<void> {
  const box = await selfView.boundingBox();
  if (!box) throw new Error('no self-view');
  const fromX = box.x + box.width / 2;
  const fromY = box.y + box.height / 2;
  await page.mouse.move(fromX, fromY);
  await page.mouse.down();
  await page.mouse.move((fromX + x) / 2, (fromY + y) / 2, { steps: 4 });
  await page.mouse.move(x, y, { steps: 6 });
  await page.mouse.up();
}

const callDialog = (page: Page, kind: 'Voice' | 'Video') =>
  page.getByRole('dialog', { name: new RegExp(`^${kind} call with`) });

const callStatus = (page: Page) =>
  page.getByRole('status').filter({ hasText: /Connected|Calling|Connecting|Reconnecting/ });

test('a voice call: ring, accept, connected on both sides, mute, end', async ({ browser }) => {
  const { caller, callee } = await twoPeople(browser);

  await caller.page.getByRole('button', { name: `Start voice call with ${callee.name}` }).click();

  // The caller waits with a soft tone and a "Calling…" screen.
  await expect(callDialog(caller.page, 'Voice')).toBeVisible();
  await expect(callStatus(caller.page)).toContainText('Calling');
  await expect.poll(() => ringStarts(caller.page, [425])).toBeGreaterThan(0);

  // The callee sees the incoming-call screen with who is calling, and hears the ring, over and over.
  const incoming = callee.page.getByRole('alertdialog');
  await expect(incoming).toBeVisible();
  await expect(incoming.getByRole('heading', { name: caller.name })).toBeVisible();
  await expect(incoming).toContainText('Incoming voice call');
  await expect(incoming.getByRole('button', { name: 'Accept call' })).toBeVisible();
  await expect(incoming.getByRole('button', { name: 'Decline call' })).toBeVisible();
  await expect
    .poll(() => ringStarts(callee.page, [440, 480]), { timeout: 30_000 })
    .toBeGreaterThanOrEqual(4);
  // The caller's tone is not the callee's ring.
  expect(await ringStarts(callee.page, [425])).toBe(0);

  // Accepting stops the ring: no new ring tone starts after that, not even a full ring cycle later.
  await accept(incoming);
  const at = await callee.page.evaluate(() => performance.now());
  const rangBefore = await ringStarts(callee.page, [440, 480]);
  await expect(incoming).toBeHidden();
  for (const page of [caller.page, callee.page]) {
    await expect(callDialog(page, 'Voice')).toBeVisible();
    await expect(callStatus(page)).toContainText('Connected', { timeout: 30_000 });
  }
  await expect
    .poll(() => callee.page.evaluate((t0) => performance.now() - t0, at), { timeout: 15_000 })
    .toBeGreaterThan(4_000);
  expect(await ringStarts(callee.page, [440, 480])).toBe(rangBefore);
  // The caller's waiting tone stopped too.
  const callerTones = await ringStarts(caller.page, [425]);
  expect(await ringStarts(caller.page, [425])).toBe(callerTones);

  // Mute and unmute: the button and its state follow.
  const mute = caller.page.getByRole('button', { name: 'Mute', exact: true });
  await expect(mute).toHaveAttribute('aria-pressed', 'false');
  await mute.click();
  const unmute = caller.page.getByRole('button', { name: 'Unmute', exact: true });
  await expect(unmute).toHaveAttribute('aria-pressed', 'true');
  await unmute.click();
  await expect(caller.page.getByRole('button', { name: 'Mute', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false',
  );

  // A voice call has no camera or screen controls.
  await expect(caller.page.getByRole('button', { name: /camera|Share screen/i })).toHaveCount(0);

  // Ending from one side ends it for both.
  await caller.page.getByRole('button', { name: 'End call' }).click();
  await expect(callDialog(caller.page, 'Voice')).toBeHidden();
  await expect(callDialog(callee.page, 'Voice')).toBeHidden();
});

test('a declined call ends quietly on both sides and the ring stops', async ({ browser }) => {
  const { caller, callee } = await twoPeople(browser);
  await caller.page.getByRole('button', { name: `Start voice call with ${callee.name}` }).click();
  const incoming = callee.page.getByRole('alertdialog');
  await expect(incoming).toBeVisible();
  await expect.poll(() => ringStarts(callee.page, [440, 480])).toBeGreaterThan(0);

  await incoming.getByRole('button', { name: 'Decline call' }).click();
  await expect(incoming).toBeHidden();
  await expect(callDialog(caller.page, 'Voice')).toBeHidden();
  const rang = await ringStarts(callee.page, [440, 480]);
  await expect
    .poll(() => callee.page.evaluate(() => performance.now()), { timeout: 15_000 })
    .toBeGreaterThan(0);
  expect(await ringStarts(callee.page, [440, 480])).toBe(rang);
});

test('a video call: media flows, camera off and on, screen share, fit and fill, self-view', async ({
  browser,
}) => {
  const { caller, callee } = await twoPeople(browser);

  await startVideoCall(caller.page, callee.name);
  const incoming = callee.page.getByRole('alertdialog');
  await expect(incoming).toContainText('Incoming video call');
  await accept(incoming);
  for (const page of [caller.page, callee.page]) {
    await expect(callDialog(page, 'Video')).toBeVisible();
    await expect(callStatus(page)).toContainText('Connected', { timeout: 30_000 });
  }

  for (const { page } of [caller, callee]) {
    const dialog = callDialog(page, 'Video');
    // The big picture is the one video without a label (the small one is "Your camera").
    const remote = dialog.locator('video:not([aria-label])');

    // The other person's picture really arrives (a video with a size is a video that decoded).
    await expect
      .poll(() => remote.evaluate((v: HTMLVideoElement) => v.videoWidth), { timeout: 30_000 })
      .toBeGreaterThan(0);

    // Camera off shows the placeholder in the self-view; on brings the picture back.
    const cameraOff = dialog.getByRole('button', { name: 'Turn camera off' });
    await expect(cameraOff).toHaveAttribute('aria-pressed', 'false');
    await cameraOff.click();
    await expect(dialog.getByRole('img', { name: 'Your camera is off' })).toBeVisible();
    // The placeholder is announced once, and it can still be dragged by the finger or mouse.
    await expect(dialog.getByRole('img', { name: 'Your camera is off' })).toHaveCount(1);
    const placeholderBox = dialog.getByRole('group', { name: /^Your picture/ });
    const before = await placeholderBox.boundingBox();
    await dragSelfView(page, placeholderBox, 60, 200);
    const after = await placeholderBox.boundingBox();
    expect(
      Math.hypot((after?.x ?? 0) - (before?.x ?? 0), (after?.y ?? 0) - (before?.y ?? 0)),
    ).toBeGreaterThan(20);
    await dialog.getByRole('button', { name: 'Turn camera on' }).click();
    await expect(dialog.getByRole('img', { name: 'Your camera is off' })).toHaveCount(0);
    await expect(dialog.getByRole('button', { name: 'Turn camera off' })).toBeVisible();

    // The screen-share control is there once connected (starting one needs a screen to pick).
    await expect(dialog.getByRole('button', { name: 'Share screen' })).toBeVisible();

    // Fit shows the whole picture; Fill crops it to cover the window. Fit is the default.
    await expect(remote).toHaveCSS('object-fit', 'contain');
    await dialog.getByRole('button', { name: 'Fill the screen' }).click();
    await expect(remote).toHaveCSS('object-fit', 'cover');
    await expect(dialog.getByRole('button', { name: 'Show the whole picture' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await dialog.getByRole('button', { name: 'Show the whole picture' }).click();
    await expect(remote).toHaveCSS('object-fit', 'contain');
  }

  // The self-view (the caller's small picture) can be dragged anywhere in the window...
  const page = caller.page;
  const dialog = callDialog(page, 'Video');
  const viewport = page.viewportSize();
  if (!viewport) throw new Error('no viewport');
  const selfView = dialog.getByRole('group', { name: /^Your picture/ });
  const start = await selfView.boundingBox();
  if (!start) throw new Error('no self-view');
  const within = (box: { x: number; y: number; width: number; height: number } | null) =>
    Boolean(
      box &&
      box.x >= -0.5 &&
      box.y >= -0.5 &&
      box.x + box.width <= viewport.width + 0.5 &&
      box.y + box.height <= viewport.height + 0.5,
    );
  await dragSelfView(page, selfView, viewport.width * 0.3, viewport.height * 0.35);
  const moved = await selfView.boundingBox();
  expect(Math.hypot((moved?.x ?? 0) - start.x, (moved?.y ?? 0) - start.y)).toBeGreaterThan(40);
  expect(within(moved)).toBe(true);

  // ...but never out of it: dragging past the corner stops at the edge.
  await dragSelfView(page, selfView, viewport.width - 2, viewport.height - 2);
  const corner = await selfView.boundingBox();
  expect(within(corner)).toBe(true);
  expect((corner?.x ?? 0) + (corner?.width ?? 0)).toBeGreaterThan(viewport.width - 4);

  // The arrow keys move it too, in 16 px steps.
  await selfView.focus();
  await page.keyboard.press('ArrowLeft');
  await expect
    .poll(async () => (await selfView.boundingBox())?.x ?? 0)
    .toBeLessThan((corner?.x ?? 0) - 10);
  expect(within(await selfView.boundingBox())).toBe(true);

  // Its button makes it bigger, step by step, and then back to the smallest.
  const width = async (): Promise<number> => (await selfView.boundingBox())?.width ?? 0;
  const small = await width();
  await dialog.getByRole('button', { name: 'Make your picture bigger' }).click();
  await expect.poll(width).toBeGreaterThan(small + 10);
  const medium = await width();
  await dialog.getByRole('button', { name: 'Make your picture bigger' }).click();
  await expect.poll(width).toBeGreaterThan(medium + 10);
  expect(within(await selfView.boundingBox())).toBe(true);
  await dialog.getByRole('button', { name: 'Make your picture smaller' }).click();
  await expect.poll(width).toBeCloseTo(small, 0);

  // Ending the call closes both screens.
  await dialog.getByRole('button', { name: 'End call' }).click();
  await expect(callDialog(caller.page, 'Video')).toBeHidden();
  await expect(callDialog(callee.page, 'Video')).toBeHidden();
});

test('you cannot start a second call while one is going', async ({ browser }) => {
  const { alice, bob } = await openPair(browser);
  await alice.page.getByRole('button', { name: `Start voice call with ${bob.name}` }).click();
  await expect(callDialog(alice.page, 'Voice')).toBeVisible();
  await expect(bob.page.getByRole('alertdialog')).toBeVisible();
  await bob.page.getByRole('alertdialog').getByRole('button', { name: 'Decline call' }).click();
  await expect(callDialog(alice.page, 'Voice')).toBeHidden();
  // After a decline the call buttons work again.
  await expect(
    alice.page.getByRole('button', { name: `Start voice call with ${bob.name}` }),
  ).toBeEnabled();
});
