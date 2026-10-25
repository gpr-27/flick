import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    globalSetup: ['test/global-setup.ts'],
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // `npx vitest run --coverage`: which lines of src/ the tests run (numbers in docs/testing.md).
    coverage: { provider: 'v8', include: ['src/**/*.ts'], reporter: ['text', 'text-summary'] },
  },
});
