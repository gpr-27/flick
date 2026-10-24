import { defineConfig } from 'vitest/config';

// See vitest.config.ts for why these conditions.
const conditions = ['@chat/source', 'node', 'development|production'];

/**
 * Integration tests against real Postgres and Redis. Connection settings come from DATABASE_URL
 * and REDIS_URL; CI starts the services, locally use scripts/dev/test-deps-up.sh.
 */
export default defineConfig({
  resolve: { conditions },
  ssr: { resolve: { conditions } },
  test: {
    include: ['test/**/*.int.test.ts'],
    environment: 'node',
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
