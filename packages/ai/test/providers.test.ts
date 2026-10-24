import { describe, expect, it } from 'vitest';
import { loadAiConfig } from '../src/config.js';
import { GROQ_MODELS } from '../src/providers.js';
import { buildChain, Script } from './helpers.js';

describe('provider request shapes', () => {
  it('Anthropic: no temperature/top_p, no assistant prefill, system separate', async () => {
    const script = new Script();
    const { chain } = buildChain(script);
    await chain.complete({
      system: 'be brief',
      maxTokens: 321,
      messages: [
        { role: 'assistant', content: 'leading assistant turn is dropped' },
        { role: 'user', content: 'q' },
        { role: 'assistant', content: 'trailing prefill is dropped' },
      ],
    });
    const p = script.calls[0]!.params;
    expect(p['model']).toBe('claude-haiku-5-5');
    expect(p['max_tokens']).toBe(321);
    expect(p['system']).toBe('be brief');
    expect(p['messages']).toEqual([{ role: 'user', content: 'q' }]);
    expect(p).not.toHaveProperty('temperature');
    expect(p).not.toHaveProperty('top_p');
    expect(p).not.toHaveProperty('top_k');
  });

  it('Groq: max_completion_tokens, light reasoning on GPT-OSS only, json mode', async () => {
    const script = new Script();
    const { chain } = buildChain(script, { anthropicApiKey: undefined });
    await chain.complete({
      system: 's',
      messages: [{ role: 'user', content: 'q' }],
      maxTokens: 50,
      responseFormat: 'json',
    });
    const p = script.calls[0]!.params;
    expect(p['model']).toBe(GROQ_MODELS[0]);
    expect(p['max_completion_tokens']).toBe(50);
    expect(p['reasoning_effort']).toBe('low');
    expect(p['response_format']).toEqual({ type: 'json_object' });
    expect(p['messages']).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'q' },
    ]);
    expect(p).not.toHaveProperty('temperature');
  });
});

describe('loadAiConfig', () => {
  it('reads only the documented env names and treats blanks as missing', () => {
    const cfg = loadAiConfig({
      ANTHROPIC_API_KEY: '  ',
      GROQ_API_KEY_1: 'g1',
      GEMINI_API_KEY_2: 'm2',
      AI_ATTEMPT_TIMEOUT_MS: '5000',
    });
    expect(cfg.anthropicApiKey).toBeUndefined();
    expect(cfg.groqApiKeys).toEqual(['g1', undefined]);
    expect(cfg.geminiApiKeys).toEqual([undefined, 'm2']);
    expect(cfg.attemptTimeoutMs).toBe(5000);
    expect(cfg.totalTimeoutMs).toBe(90_000);
  });
});
