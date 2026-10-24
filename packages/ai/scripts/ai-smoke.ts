/**
 * Live smoke test: one real complete() through the fallback chain.
 * NOT part of CI (vitest only picks up test/**). Run manually: `npm run smoke -w @chat/ai`.
 *
 * Loads keys from the repo-root .env (nearest .env walking up from this file, or AI_SMOKE_ENV_FILE)
 * into a private object — never into process.env, and never printed.
 * Prints only: which entries failed (status code / result), who answered, and the first 80 chars.
 */
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenv } from 'dotenv';
import { AiChain, AiUnavailableError, loadAiConfig, type AiLogger } from '../src/index.js';

function findEnvFile(): string | undefined {
  const override = process.env['AI_SMOKE_ENV_FILE'];
  if (override) return resolve(override);
  let dir = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const candidate = join(dir, '.env');
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

const envFile = findEnvFile();
const env: Record<string, string> = {};
if (envFile) dotenv({ path: envFile, processEnv: env, quiet: true });
const loaded = loadAiConfig(env);
// Optional: AI_SMOKE_ONLY=anthropic|groq|gemini exercises a single provider's entries.
const only = process.env['AI_SMOKE_ONLY'];
const cfg = only
  ? {
      ...loaded,
      anthropicApiKey: only === 'anthropic' ? loaded.anthropicApiKey : undefined,
      groqApiKeys:
        only === 'groq' ? loaded.groqApiKeys : ([undefined, undefined] as [undefined, undefined]),
      geminiApiKeys:
        only === 'gemini'
          ? loaded.geminiApiKeys
          : ([undefined, undefined] as [undefined, undefined]),
    }
  : loaded;

const configured = [
  cfg.anthropicApiKey ? 'anthropic:default' : null,
  ...cfg.groqApiKeys.map((k, i) => (k ? `groq:${i + 1}` : null)),
  ...cfg.geminiApiKeys.map((k, i) => (k ? `gemini:${i + 1}` : null)),
].filter(Boolean);
console.log(
  `env file: ${envFile ? 'found' : 'not found'}; configured entries: ${configured.join(', ') || 'none'}`,
);

const logger: AiLogger = {
  warn: (obj, msg) => {
    if (msg !== 'ai attempt failed') return;
    const o = obj as {
      provider: string;
      account: string;
      model: string;
      result: string;
      status?: number;
    };
    console.log(
      `  failed  ${o.provider}:${o.account} ${o.model} -> ${o.result}${o.status ? ` (HTTP ${o.status})` : ''}`,
    );
  },
};

const chain = AiChain.fromConfig(cfg, { logger });

try {
  const r = await chain.complete({
    system: 'You are a terse assistant.',
    messages: [
      { role: 'user', content: 'In one short sentence, what is a fallback chain in software?' },
    ],
    maxTokens: 512,
  });
  console.log(
    `answered by ${r.provider}:${r.account} model=${r.model} attempts=${r.attempts} latencyMs=${r.latencyMs}`,
  );
  console.log(`text[0..80]: ${JSON.stringify(r.text.slice(0, 80))}`);
} catch (e) {
  if (e instanceof AiUnavailableError) {
    console.log(`no provider answered: ${e.message}`);
    for (const f of e.failures)
      console.log(
        `  ${f.provider}:${f.account} ${f.model} -> ${f.result}${f.status ? ` (HTTP ${f.status})` : ''}`,
      );
  } else {
    console.log(
      `smoke failed: ${e instanceof Error ? `${e.name} ${(e as { status?: number }).status ?? ''}` : 'unknown'}`,
    );
  }
  process.exitCode = 1;
}
