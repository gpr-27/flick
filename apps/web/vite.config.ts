import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import { defaultClientConditions, loadEnv } from 'vite';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));
// The single shared .env lives at the repo root (two levels up). Only VITE_*
// variables reach the client bundle; FRONTEND_PORT is read here, in Node only.
const rootEnvDir = resolve(here, '..', '..');

// Placeholder client config so tests never need a real .env.
const testEnv = {
  VITE_APP_ENV: 'test',
  VITE_API_URL: 'http://api.test/api',
  VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder',
};

// Installable app + offline shell. src/pwa/sw.ts is our own worker (push + precache);
// the plugin builds it and fills in the list of files to precache.
const pwaOptions: Partial<VitePWAOptions> = {
  strategies: 'injectManifest',
  srcDir: 'src/pwa',
  filename: 'sw.ts',
  registerType: 'prompt',
  injectRegister: false,
  manifest: {
    name: 'Flick',
    short_name: 'Flick',
    description: 'Real-time messaging',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    theme_color: '#F4F3FA',
    background_color: '#F4F3FA',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
};

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, rootEnvDir, '');
  const port = env.FRONTEND_PORT ? Number(env.FRONTEND_PORT) : undefined;

  return {
    plugins: [
      react(),
      // The service worker plugin is skipped under Vitest (tests never register a worker).
      ...(mode === 'test' ? [] : [VitePWA(pwaOptions)]),
    ],
    envDir: rootEnvDir,
    // Workspace packages resolve to their TypeScript sources, so no prior build is needed.
    resolve: {
      alias: {
        '@': resolve(here, 'src'),
        // TEST ONLY: browser tests swap Clerk for a fake login (see features/auth/fakeClerk.tsx).
        // Without the flag nothing is aliased and the fake file is never bundled.
        ...(env.VITE_E2E_FAKE_AUTH === 'true'
          ? { '@clerk/clerk-react': resolve(here, 'src/features/auth/fakeClerk.tsx') }
          : {}),
      },
      conditions: ['@chat/source', ...defaultClientConditions],
    },
    css: {
      postcss: {
        plugins: [tailwindcss({ config: resolve(here, 'tailwind.config.ts') }), autoprefixer()],
      },
    },
    server: { port },
    build: { sourcemap: true },
    test: {
      environment: 'jsdom',
      include: ['src/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
      setupFiles: ['test/setup.ts'],
      env: testEnv,
      restoreMocks: true,
      css: false,
    },
  };
});
