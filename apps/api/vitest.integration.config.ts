import { defineConfig } from 'vitest/config';

// See vitest.config.ts for why these conditions.
const conditions = ['@chat/source', 'node', 'development|production'];

/**
 * Integration tests against real Postgres, Redis and MinIO. Connection settings come
 * from the variables the app itself reads (DATABASE_URL, REDIS_URL, S3_*); CI
 * starts the services, locally use infra/docker/compose.test.yml.
 */
export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    // The files run one after another: they share one Redis, and Socket.IO servers that share a Redis
    // form one cluster, so a server of one file would answer cluster-wide calls of another.
    fileParallelism: false,
    // Generous, because the suites also run on busy machines; a test that hangs still fails, just later.
    testTimeout: 60_000,
    hookTimeout: 120_000,
    // `npx vitest run --coverage`: which lines of src/ the tests run (numbers in docs/testing.md).
    coverage: { provider: 'v8', include: ['src/**/*.ts'], reporter: ['text', 'text-summary'] },
  },
});
