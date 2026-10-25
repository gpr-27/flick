// Shared ESLint config. Packages run `eslint .`, which finds this file by walking up.
// apps/web can add its own eslint.config.js (React rules) that imports this one.
import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import prettier from 'eslint-config-prettier';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'tests/e2e/.web-dist/**',
      'tests/e2e/.report/**',
      'tests/e2e/.results/**',
    ],
  },
  js.configs.recommended,
  { languageOptions: { globals: globals.node } },
  {
    files: ['**/*.ts', '**/*.tsx'],
    // Type-aware rules catch real bugs such as un-awaited promises.
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  prettier, // formatting is Prettier's job; turn off rules that conflict with it
);
