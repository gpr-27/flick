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
    // "Share" from another app (text and links) opens /share to pick a chat.
    share_target: {
      action: '/share',
      method: 'GET',
      params: { title: 'title', text: 'text', url: 'url' },
    },
    // Long-press the app icon: jump straight to these.
    shortcuts: [
      {
        name: 'New chat',
        url: '/people',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      {
        name: 'Saved messages',
        url: '/?saved=1',
        icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }],
      },
      { name: 'Calls', url: '/calls', icons: [{ src: '/icons/icon-192.png', sizes: '192x192' }] },
    ],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  },
  injectManifest: { globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'] },
};

// daisyUI 4 ships a table-row hover rule whose selector comes out as `.hover:hovertr:hover`, which
// is not valid CSS and makes the CSS minifier warn on every build. The app uses no daisyUI tables,
// so the broken rule is removed.
const dropBrokenTableHover = {
  postcssPlugin: 'drop-broken-table-hover',
  Rule(rule: { selector: string; remove: () => void }) {
    if (rule.selector.includes('hovertr')) rule.remove();
  },
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
        plugins: [
          tailwindcss({ config: resolve(here, 'tailwind.config.ts') }),
          dropBrokenTableHover,
          autoprefixer(),
        ],
      },
    },
    server: { port },
    // The one big chunk is the LiveKit call SDK, which is only loaded when a call starts.
    build: {
      sourcemap: true,
      chunkSizeWarningLimit: 1000,
      rolldownOptions: {
        output: {
          // Big libraries get their own files so they cache between releases.
          manualChunks(id: string) {
            if (!id.includes('node_modules')) return undefined;
            if (id.includes('livekit')) return undefined; // already loaded on demand
            if (id.includes('@clerk')) return 'clerk';
            if (id.includes('socket.io') || id.includes('engine.io')) return 'socketio';
            if (
              /node_modules\/(react|react-dom|react-router|react-router-dom|scheduler)\//.test(id)
            )
              return 'react';
            return undefined;
          },
        },
      },
    },
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
