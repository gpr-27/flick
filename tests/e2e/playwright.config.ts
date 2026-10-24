import { defineConfig, devices } from '@playwright/test';

// Run through `npm run e2e`: tests/e2e/run.mjs starts the stack and sets E2E_WEB_URL.
export default defineConfig({
  testDir: './tests',
  outputDir: './.results',
  reporter: [['list'], ['html', { outputFolder: './.report', open: 'never' }]],
  // Every test makes its own users, so tests do not share state and may run side by side.
  fullyParallel: true,
  workers: process.env.CI ? 2 : 3,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_WEB_URL,
    ...devices['Desktop Chrome'],
    // The service worker would only add caching between the page and the stack under test.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
