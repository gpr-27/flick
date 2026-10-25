import { defineConfig } from 'vitest/config';

// Resolve workspace packages (@chat/shared, ...) to their TypeScript sources so tests do not
// need a prior build. 'module' is deliberately not listed: it would select bundler-only ESM
// builds (e.g. @aws-sdk's dist-es) that Node cannot execute.
const conditions = ['@chat/source', 'node', 'development|production'];

export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['test/**/*.test.ts'],
    exclude: ['test/**/*.int.test.ts'],
    environment: 'node',
    // `npx vitest run --coverage`: which lines of src/ the tests run (numbers in docs/testing.md).
    coverage: { provider: 'v8', include: ['src/**/*.ts'], reporter: ['text', 'text-summary'] },
  },
});
