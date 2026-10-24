import { describe, expect, it } from 'vitest';
import { cooldownKey, MemoryCooldownStore } from '../src/cooldown.js';
import {
  AiRequestError,
  AiTimeoutError,
  AiUnavailableError,
  AUTH_COOLDOWN_MS,
  RATE_LIMIT_COOLDOWN_MS,
} from '../src/errors.js';
import { GEMINI_MODELS, GROQ_MODELS } from '../src/providers.js';
import type { AiRequest } from '../src/types.js';
import { buildChain, err, fail, hang, KEYS, recordingMetrics, Script, text } from './helpers.js';

const REQ: AiRequest = { messages: [{ role: 'user', content: 'SECRET-PROMPT-CONTENT hello' }] };
const SONNET = 'claude-sonnet-5-5';
const G1 = GROQ_MODELS[0];

const FULL_ORDER = [
  `${KEYS.anthropic}|${SONNET}`,
  ...GROQ_MODELS.map((m) => `${KEYS.groq1}|${m}`),
  ...GROQ_MODELS.map((m) => `${KEYS.groq2}|${m}`),
  ...GEMINI_MODELS.map((m) => `${KEYS.gemini1}|${m}`),
  ...GEMINI_MODELS.map((m) => `${KEYS.gemini2}|${m}`),
];

function allFail(script: Script, make: () => unknown): Script {
  script.on(KEYS.anthropic, SONNET, fail(make));
  script.onKey(KEYS.groq1, GROQ_MODELS, fail(make));
  script.onKey(KEYS.groq2, GROQ_MODELS, fail(make));
  script.onKey(KEYS.gemini1, GEMINI_MODELS, fail(make));
  script.onKey(KEYS.gemini2, GEMINI_MODELS, fail(make));
  return script;
}

describe('order and configuration', () => {
  it('tries every entry strictly in order and reports all failures', async () => {
    const script = allFail(new Script(), () => err.openai(500, 'boom'));
    const { chain, created } = buildChain(script);
    const e = await chain.complete(REQ).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiUnavailableError);
    expect(script.order).toEqual(FULL_ORDER);
    expect((e as AiUnavailableError).failures).toHaveLength(13);
    expect(created.openai.map((c) => c.baseURL)).toEqual([
      'https://api.groq.com/openai/v1',
      'https://api.groq.com/openai/v1',
      'https://generativelanguage.googleapis.com/v1beta/openai/',
      'https://generativelanguage.googleapis.com/v1beta/openai/',
    ]);
  });

  it('skips entries whose key is missing', async () => {
    const script = new Script();
    const { chain, created } = buildChain(script, {
      anthropicApiKey: undefined,
      groqApiKeys: [undefined, KEYS.groq2],
      geminiApiKeys: [KEYS.gemini1, undefined],
    });
    expect(chain.adapters.map((a) => `${a.provider}:${a.account}`)).toEqual(['groq:2', 'gemini:1']);
    expect(created.anthropic).toEqual([]);
    const r = await chain.complete(REQ);
    expect(r).toMatchObject({ provider: 'groq', account: '2', model: G1 });
    expect(script.order).toEqual([`${KEYS.groq2}|${G1}`]);
  });
});

describe('fall-through conditions', () => {
  const cases: Array<[string, () => unknown]> = [
    ['429 rate limit', () => err.anthropic(429, 'rate limited', {}, 'rate_limit_error')],
    ['500', () => err.anthropic(500, 'internal')],
    ['SDK timeout', err.timeout],
    ['401', () => err.anthropic(401, 'invalid x-api-key', {}, 'authentication_error')],
    [
      '400 credit exhausted',
      () => err.anthropic(400, 'Your credit balance is too low to access the Anthropic API.'),
    ],
  ];

  it.each(cases)('%s falls through to the next entry', async (_name, make) => {
    const script = new Script().on(KEYS.anthropic, SONNET, fail(make));
    const { chain } = buildChain(script);
    const r = await chain.complete(REQ);
    expect(r).toMatchObject({ provider: 'groq', account: '1', model: G1 });
    expect(script.order.slice(0, 2)).toEqual([
      `${KEYS.anthropic}|${SONNET}`,
      `${KEYS.groq1}|${G1}`,
    ]);
  });
});

describe('400 caused by our own request', () => {
  it('surfaces the error and does not try other entries', async () => {
    const script = new Script().on(
      KEYS.anthropic,
      SONNET,
      fail(() =>
        err.anthropic(
          400,
          'messages: text content blocks must be non-empty',
          {},
          'invalid_request_error',
        ),
      ),
    );
    const { chain } = buildChain(script);
    const e = await chain.complete(REQ).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiRequestError);
    expect(e).toMatchObject({ status: 400, provider: 'anthropic', model: SONNET });
    expect(script.calls).toHaveLength(1);
  });
});

describe('429 handling', () => {
  it('retries the same entry once when retry-after <= 2s', async () => {
    const script = new Script().on(
      KEYS.anthropic,
      SONNET,
      fail(() => err.anthropic(429, 'slow down', { 'retry-after': '0' }, 'rate_limit_error')),
      text('second try worked'),
    );
    const { chain } = buildChain(script);
    const r = await chain.complete(REQ);
    expect(r).toMatchObject({ provider: 'anthropic', text: 'second try worked', attempts: 2 });
  });

  it('moves on immediately on a daily quota error even with a short retry-after', async () => {
    const script = new Script().on(
      KEYS.groq1,
      G1,
      fail(() =>
        err.openai(
          429,
          'Rate limit reached for model `openai/gpt-oss-120b` on tokens per day (TPD): Limit 200000',
          {
            'retry-after': '1',
          },
        ),
      ),
    );
    const { chain } = buildChain(script, { anthropicApiKey: undefined });
    const r = await chain.complete(REQ);
    expect(r).toMatchObject({ provider: 'groq', account: '1', model: GROQ_MODELS[1] });
    expect(script.order.filter((o) => o === `${KEYS.groq1}|${G1}`)).toHaveLength(1);
  });
});

describe('cooldowns', () => {
  it('skips a cooling entry, then uses it again after expiry', async () => {
    let now = 0;
    const cooldowns = new MemoryCooldownStore(() => now);
    const script = new Script().on(
      KEYS.anthropic,
      SONNET,
      fail(() => err.anthropic(429, 'busy')),
      text('claude back'),
    );
    const metrics = recordingMetrics();
    const { chain } = buildChain(script, {}, { cooldowns, metrics });

    expect((await chain.complete(REQ)).provider).toBe('groq');
    const callsAfterFirst = script.calls.length;

    // Still cooling: anthropic is not called at all.
    expect((await chain.complete(REQ)).provider).toBe('groq');
    expect(script.calls.slice(callsAfterFirst).map((c) => c.key)).toEqual([KEYS.groq1]);
    expect(metrics.attempts).toContainEqual({
      provider: 'anthropic',
      account: 'default',
      model: SONNET,
      result: 'skipped_cooldown',
    });

    now += RATE_LIMIT_COOLDOWN_MS + 1;
    const r = await chain.complete(REQ);
    expect(r).toMatchObject({ provider: 'anthropic', text: 'claude back' });
  });

  it('auth errors cool the whole account for 1h and skip its other models', async () => {
    const cooldowns = new MemoryCooldownStore(() => 0);
    const script = new Script().on(
      KEYS.groq1,
      G1,
      fail(() => err.openai(401, 'Invalid API Key', {}, { code: 'invalid_api_key' })),
    );
    const { chain } = buildChain(script, { anthropicApiKey: undefined }, { cooldowns });
    const r = await chain.complete(REQ);
    expect(r).toMatchObject({ provider: 'groq', account: '2', model: G1 });
    expect(script.order).toEqual([`${KEYS.groq1}|${G1}`, `${KEYS.groq2}|${G1}`]);
    for (const m of GROQ_MODELS) {
      expect(await cooldowns.remainingMs(cooldownKey('groq', '1', m))).toBe(AUTH_COOLDOWN_MS);
    }
  });

  it('every entry cooling down -> unavailable without any provider call', async () => {
    const cooldowns = new MemoryCooldownStore(() => 0);
    const script = new Script();
    const { chain } = buildChain(script, {}, { cooldowns });
    for (const a of chain.adapters)
      for (const m of a.models)
        await cooldowns.set(cooldownKey(a.provider, a.account, m), 5_000, 't');
    const e = await chain.complete(REQ).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(AiUnavailableError);
    expect(script.calls).toHaveLength(0);
  });
});

describe('timeouts and abort', () => {
  it('total timeout ends the walk with AiTimeoutError', async () => {
    const script = new Script()
      .on(KEYS.anthropic, SONNET, hang())
      .onKey(KEYS.groq1, GROQ_MODELS, hang())
      .onKey(KEYS.groq2, GROQ_MODELS, hang());
    const { chain } = buildChain(script, { attemptTimeoutMs: 1_000, totalTimeoutMs: 80 });
    await expect(chain.complete(REQ)).rejects.toBeInstanceOf(AiTimeoutError);
    expect(script.calls).toHaveLength(1);
  });
});
