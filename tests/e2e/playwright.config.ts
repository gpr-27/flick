import { defineConfig, devices } from '@playwright/test';

// Run through `npm run e2e`: tests/e2e/run.mjs starts the stack and sets E2E_WEB_URL.
//
// Two projects run the same journeys:
//   laptop   1440x900 Chromium with a mouse
//   phone    390x844 Chromium with touch, a mobile user agent (an iPhone's) and `isMobile`
// `--project=laptop` / `--project=phone` pick one. The specs read the project name through
// `isPhone()` (tests/support.ts) where the two layouts differ, e.g. a hold instead of a right-click.

// Fake camera and microphone (a moving test picture and a beep) so voice notes and calls work
// without hardware or a permission prompt. Local WebRTC candidates are not hidden behind mDNS
// names, which two browsers on one machine would have to resolve, and the loopback interface is
// offered as a candidate: two browsers on one machine reach each other there even when the LAN
// address of the machine is not reachable from itself (a VPN, a firewall, a CI container).
const mediaArgs = [
  '--use-fake-device-for-media-stream',
  '--use-fake-ui-for-media-stream',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
  '--allow-loopback-in-peer-connection',
];

const iPhone = devices['iPhone 14'];

export default defineConfig({
  testDir: './tests',
  outputDir: './.results',
  reporter: [['list'], ['html', { outputFolder: './.report', open: 'never' }]],
  // Every test makes its own users, so tests do not share state and may run side by side.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      // A small tolerance: anti-aliasing differs by a pixel here and there, a real change does not.
      threshold: 0.2,
      maxDiffPixelRatio: 0.01,
      animations: 'disabled',
      caret: 'hide',
      scale: 'css',
    },
  },
  // Baselines live in tests/e2e/screenshots-baseline/<platform>/<project>/. Fonts differ between
  // macOS and Linux, so each platform has its own set (see README, "Visual baselines").
  snapshotPathTemplate: '{testDir}/../screenshots-baseline/{platform}/{projectName}/{arg}{ext}',
  use: {
    baseURL: process.env.E2E_WEB_URL,
    // The service worker would only add caching between the page and the stack under test.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    permissions: ['microphone', 'camera', 'clipboard-read', 'clipboard-write'],
    launchOptions: { args: mediaArgs },
  },
  projects: [
    {
      name: 'laptop',
      use: {
        ...devices['Desktop Chrome'],
        viewport: { width: 1440, height: 900 },
        launchOptions: { args: mediaArgs },
      },
      // These are about the phone layout and the phone-only install card.
      testIgnore: /(14-phone-layout|15-install)\.spec\.ts$/,
    },
    {
      name: 'phone',
      use: {
        // Chromium, not WebKit: the iPhone's user agent and size, but the same engine as the laptop.
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        userAgent: iPhone.userAgent,
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        launchOptions: { args: mediaArgs },
      },
      // Spec 07 builds its own phone next to a laptop user; on this project it would repeat itself.
      testIgnore: /07-phone\.spec\.ts$/,
    },
  ],
});
