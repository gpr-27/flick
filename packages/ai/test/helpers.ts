import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { vi } from 'vitest';
import { AiChain, type AiChainDeps } from '../src/chain.js';
import type { AiConfig } from '../src/config.js';
import type { ClientFactories } from '../src/providers.js';
import type { AiLogger, AiMetrics, AttemptLabels } from '../src/types.js';

/** What a fake SDK does for one call. */
export type Behavior =
  | { kind: 'text'; text: string }
  | { kind: 'error'; error: () => unknown }
  | { kind: 'stream'; chunks: string[]; failAfter?: number; delayMs?: number }
  | { kind: 'hang' };

export const text = (t: string): Behavior => ({ kind: 'text', text: t });
export const fail = (error: () => unknown): Behavior => ({ kind: 'error', error });
export const chunks = (
  c: string[],
  extra: { failAfter?: number; delayMs?: number } = {},
): Behavior => ({
  kind: 'stream',
  chunks: c,
  ...extra,
});
export const hang = (): Behavior => ({ kind: 'hang' });

export interface Call {
  key: string;
  model: string;
  stream: boolean;
  params: Record<string, unknown>;
}

/**
 * Behaviours keyed by `${apiKey}|${model}`; each call shifts the next behaviour
 * (the last one repeats). Unscripted calls answer `ok:<key>:<model>`.
 */
export class Script {
  readonly calls: Call[] = [];
  private readonly plan = new Map<string, Behavior[]>();

  on(key: string, model: string, ...behaviors: Behavior[]): this {
    this.plan.set(`${key}|${model}`, behaviors);
    return this;
  }

  /** Make every model of a key behave the same. */
  onKey(key: string, models: readonly string[], ...behaviors: Behavior[]): this {
    for (const m of models) this.on(key, m, ...behaviors);
    return this;
  }

  next(key: string, model: string): Behavior {
    const list = this.plan.get(`${key}|${model}`);
    if (!list || list.length === 0) return text(`ok:${key}:${model}`);
    return list.length > 1 ? list.shift()! : list[0]!;
  }

  get order(): string[] {
    return this.calls.map((c) => `${c.key}|${c.model}`);
  }
}

function abortError(): Error {
  return new Anthropic.APIUserAbortError();
}

function waitAbort(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(abortError());
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

async function* streamOf(
  b: Extract<Behavior, { kind: 'stream' }>,
  wrap: (t: string) => unknown,
  signal: AbortSignal | undefined,
): AsyncGenerator<unknown> {
  for (let i = 0; i < b.chunks.length; i++) {
    if (b.failAfter !== undefined && i === b.failAfter) {
      throw new OpenAI.APIConnectionError({ message: 'socket hang up' });
    }
    if (b.delayMs) {
      await Promise.race([new Promise((r) => setTimeout(r, b.delayMs)), waitAbort(signal)]);
    }
    if (signal?.aborted) throw abortError();
    yield wrap(b.chunks[i]!);
  }
  if (b.failAfter !== undefined && b.failAfter >= b.chunks.length) {
    throw new OpenAI.APIConnectionError({ message: 'socket hang up' });
  }
}

async function run(
  script: Script,
  key: string,
  params: Record<string, unknown>,
  opts: { signal?: AbortSignal } | undefined,
  shape: 'anthropic' | 'openai',
): Promise<unknown> {
  const model = String(params['model']);
  const isStream = params['stream'] === true;
  script.calls.push({ key, model, stream: isStream, params });
  const b = script.next(key, model);
  await Promise.resolve();
  if (opts?.signal?.aborted) throw abortError();
  switch (b.kind) {
    case 'error':
      throw b.error();
    case 'hang':
      return waitAbort(opts?.signal);
    case 'text':
      if (isStream) {
        return streamOf({ kind: 'stream', chunks: [b.text] }, wrapper(shape), opts?.signal);
      }
      return shape === 'anthropic'
        ? { content: [{ type: 'text', text: b.text }] }
        : { choices: [{ message: { role: 'assistant', content: b.text } }] };
    case 'stream':
      if (!isStream) throw new Error('fake: stream behaviour on non-stream call');
      return streamOf(b, wrapper(shape), opts?.signal);
  }
}

function wrapper(shape: 'anthropic' | 'openai'): (t: string) => unknown {
  return shape === 'anthropic'
    ? (t) => ({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } })
    : (t) => ({ choices: [{ index: 0, delta: { content: t } }] });
}

export interface FactoryLog {
  anthropic: string[];
  openai: Array<{ key: string; baseURL: string }>;
}

export function fakeClients(script: Script): { factories: ClientFactories; created: FactoryLog } {
  const created: FactoryLog = { anthropic: [], openai: [] };
  const factories: ClientFactories = {
    anthropic: (apiKey) => {
      created.anthropic.push(apiKey);
      const client = {
        messages: {
          create: vi.fn((params: Record<string, unknown>, opts?: { signal?: AbortSignal }) =>
            run(script, apiKey, params, opts, 'anthropic'),
          ),
        },
      };
      return client as unknown as Anthropic;
    },
    openai: (apiKey, baseURL) => {
      created.openai.push({ key: apiKey, baseURL });
      const client = {
        chat: {
          completions: {
            create: vi.fn((params: Record<string, unknown>, opts?: { signal?: AbortSignal }) =>
              run(script, apiKey, params, opts, 'openai'),
            ),
          },
        },
      };
      return client as unknown as OpenAI;
    },
  };
  return { factories, created };
}

export const KEYS = {
  anthropic: 'sk-ant-test',
  groq1: 'gsk-test-1',
  groq2: 'gsk-test-2',
  gemini1: 'gem-test-1',
  gemini2: 'gem-test-2',
} as const;

export function config(overrides: Partial<AiConfig> = {}): AiConfig {
  return {
    anthropicApiKey: KEYS.anthropic,
    groqApiKeys: [KEYS.groq1, KEYS.groq2],
    geminiApiKeys: [KEYS.gemini1, KEYS.gemini2],
    attemptTimeoutMs: 2_000,
    totalTimeoutMs: 5_000,
    ...overrides,
  };
}

export function recordingMetrics(): AiMetrics & {
  attempts: AttemptLabels[];
  latencies: Array<[AttemptLabels, number]>;
} {
  const attempts: AttemptLabels[] = [];
  const latencies: Array<[AttemptLabels, number]> = [];
  return {
    attempts,
    latencies,
    attempt: (l) => attempts.push(l),
    latency: (l, ms) => latencies.push([l, ms]),
  };
}

export function recordingLogger(): AiLogger & { lines: string[] } {
  const lines: string[] = [];
  const log = (obj: Record<string, unknown>, msg?: string): void => {
    lines.push(JSON.stringify({ obj, msg }));
  };
  return { lines, debug: log, info: log, warn: log, error: log };
}

export function buildChain(
  script: Script,
  cfg: Partial<AiConfig> = {},
  deps: Omit<AiChainDeps, 'clients'> = {},
): { chain: AiChain; created: FactoryLog } {
  const { factories, created } = fakeClients(script);
  return { chain: AiChain.fromConfig(config(cfg), { ...deps, clients: factories }), created };
}

// ---- SDK error builders (real SDK classes) ----

export const h = (init: Record<string, string> = {}): Headers => new Headers(init);

export const err = {
  anthropic: (
    status: number,
    message: string,
    headers: Record<string, string> = {},
    type = 'api_error',
  ) =>
    Anthropic.APIError.generate(
      status,
      { type: 'error', error: { type, message } },
      message,
      h(headers),
    ),
  openai: (
    status: number,
    message: string,
    headers: Record<string, string> = {},
    extra: Record<string, unknown> = {},
  ) => OpenAI.APIError.generate(status, { error: { message, ...extra } }, message, h(headers)),
  timeout: () => new OpenAI.APIConnectionTimeoutError(),
  network: () => new OpenAI.APIConnectionError({ message: 'Connection error.' }),
};
