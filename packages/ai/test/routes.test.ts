import Fastify, { type FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { MemoryRateLimitStore } from '../src/rate-limit.js';
import { aiRoutes, type AiRoutesOptions } from '../src/routes.js';
import { AiTasks } from '../src/tasks.js';
import type { AiConfig } from '../src/config.js';
import { buildChain, chunks, KEYS, Script } from './helpers.js';

const SONNET = 'claude-sonnet-5-5';
let app: FastifyInstance | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function makeApp(
  script: Script,
  opts: Partial<AiRoutesOptions> = {},
  cfg: Partial<AiConfig> = {},
): Promise<FastifyInstance> {
  const { chain } = buildChain(script, cfg);
  app = Fastify();
  await app.register(aiRoutes, {
    prefix: '/api/ai',
    tasks: new AiTasks(chain),
    allowUnauthenticated: true,
    ...opts,
  });
  await app.ready();
  return app;
}

function parseSse(body: string): Array<{ event: string; data: unknown }> {
  return body
    .split('\n\n')
    .filter((b) => b.trim())
    .map((block) => {
      const event = /^event: (.+)$/m.exec(block)?.[1] ?? '';
      const data = /^data: (.+)$/m.exec(block)?.[1] ?? 'null';
      return { event, data: JSON.parse(data) as unknown };
    });
}

describe('aiRoutes', () => {
  it('requires an auth guard unless explicitly disabled', async () => {
    const { chain } = buildChain(new Script());
    app = Fastify();
    await expect(
      app.register(aiRoutes, { prefix: '/api/ai', tasks: new AiTasks(chain) }).ready(),
    ).rejects.toThrow(/authGuard/);
  });

  it('streams SSE with provider and model', async () => {
    const script = new Script().on(KEYS.anthropic, SONNET, chunks(['Hel', 'lo']));
    const a = await makeApp(script);
    const res = await a.inject({
      method: 'POST',
      url: '/api/ai/chat',
      payload: { history: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');
    expect(res.headers['x-ratelimit-limit']).toBe('20');
    expect(parseSse(res.body)).toEqual([
      { event: 'meta', data: { provider: 'anthropic', model: SONNET } },
      { event: 'delta', data: { text: 'Hel' } },
      { event: 'delta', data: { text: 'lo' } },
      { event: 'done', data: { provider: 'anthropic', model: SONNET } },
    ]);
  });

  it.each([
    ['/api/ai/chat', { history: [{ role: 'assistant', content: 'hi' }] }],
    ['/api/ai/translate', { text: 'x'.repeat(5_001), targetLang: 'English' }],
    ['/api/ai/suggest-replies', { context: [{ sender: 'a', text: '' }] }],
  ])('rejects invalid or oversized input on %s', async (url, payload) => {
    const script = new Script();
    const a = await makeApp(script);
    const res = await a.inject({ method: 'POST', url, payload });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'invalid_request' });
    expect(script.calls).toHaveLength(0);
  });

  it('rate limits per user', async () => {
    const script = new Script();
    const a = await makeApp(script, {
      rateLimit: { max: 2, windowMs: 60_000, store: new MemoryRateLimitStore() },
      getUserId: (req) => String(req.headers['x-user'] ?? ''),
    });
    const call = (user: string) =>
      a.inject({
        method: 'POST',
        url: '/api/ai/chat',
        headers: { 'x-user': user, accept: 'application/json' },
        payload: { history: [{ role: 'user', content: 'hi' }] },
      });
    expect((await call('u1')).statusCode).toBe(200);
    expect((await call('u1')).statusCode).toBe(200);
    const limited = await call('u1');
    expect(limited.statusCode).toBe(429);
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect((await call('u2')).statusCode).toBe(200);
  });

  it('maps all-providers-down to 503 before any SSE bytes', async () => {
    const a = await makeApp(
      new Script(),
      {},
      {
        anthropicApiKey: undefined,
        groqApiKeys: [undefined, undefined],
        geminiApiKeys: [undefined, undefined],
      },
    );
    const res = await a.inject({
      method: 'POST',
      url: '/api/ai/chat',
      payload: { history: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ error: 'ai_unavailable' });
  });
});
