import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import autoprefixer from 'autoprefixer';
import tailwindcss from 'tailwindcss';
import { defaultClientConditions, loadEnv } from 'vite';
import { VitePWA, type VitePWAOptions } from 'vite-plugin-pwa';
import { defineConfig } from 'vitest/config';

const here = dirname(fileURLToPath(import.meta.url));
// The app version shown in Settings > About comes from this package.json (see __APP_VERSION__).
const { version } = JSON.parse(readFileSync(resolve(here, 'package.json'), 'utf8')) as {
  version: string;
};
// The single shared .env lives at the repo root (two levels up). Only VITE_*
// variables reach the client bundle; FRONTEND_PORT is read here, in Node only.
const rootEnvDir = resolve(here, '..', '..');

// Placeholder client config so tests never need a real .env.
const testEnv = {
  VITE_APP_ENV: 'test',
  VITE_API_URL: 'http://api.test/api',
  VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder',
  // Blank on purpose: a developer's own relay login in .env must not change what a test sees.
  VITE_STUN_URLS: '',
  VITE_TURN_URL: '',
  VITE_TURN_USERNAME: '',
  VITE_TURN_CREDENTIAL: '',
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
    id: '/',
    name: 'Flick',
    short_name: 'Flick',
    description: 'Real-time messaging',
    lang: 'en',
    categories: ['social', 'communication'],
    start_url: '/',
    scope: '/',
    display: 'standalone',
    display_override: ['standalone', 'minimal-ui'],
    prefer_related_applications: false,
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
    define: { __APP_VERSION__: JSON.stringify(version) },
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
      // `npx vitest run --coverage`: every source file is counted, even one no test imports.
      coverage: {
        provider: 'v8',
        include: ['src/**/*.{ts,tsx}'],
        exclude: ['src/**/*.test.{ts,tsx}', 'src/**/*.d.ts'],
        reporter: ['text-summary', 'json-summary', 'html'],
      },
    },
  };
});
