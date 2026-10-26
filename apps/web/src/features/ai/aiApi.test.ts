import { afterEach, describe, expect, it, vi } from 'vitest';
import { askFlick, getAiEnabled, isNotConfigured, suggestReplies, summarizeUnread } from './aiApi';

const sse = (...blocks: string[]): Response =>
  new Response(
    new ReadableStream({
      start(controller) {
        const enc = new TextEncoder();
        // Split mid-event to prove partial chunks are buffered.
        const all = blocks.join('');
        controller.enqueue(enc.encode(all.slice(0, 20)));
        controller.enqueue(enc.encode(all.slice(20)));
        controller.close();
      },
    }),
    { headers: { 'content-type': 'text/event-stream' } },
  );

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const event = (name: string, data: unknown) => `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('aiApi', () => {
  it('collects streamed text and reports progress', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        sse(
          event('meta', { provider: 'groq', model: 'm' }),
          event('delta', { text: 'Hel' }),
          event('delta', { text: 'lo' }),
          event('done', { provider: 'groq', model: 'm' }),
        ),
      ),
    );
    vi.stubGlobal('fetch', fetchMock);
    const seen: string[] = [];
    const models: string[] = [];

    const text = await askFlick([{ role: 'user', content: 'hi' }], 'conv-1', {
      onText: (t) => seen.push(t),
      onModel: (label) => models.push(label),
    });

    expect(text).toBe('Hello');
    expect(seen).toEqual(['Hel', 'Hello']);
    expect(models).toEqual(['Groq · m']); // told once, before the first words
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/ai/chat');
    expect(JSON.parse(init.body as string)).toMatchObject({
      stream: true,
      conversation_id: 'conv-1',
    });
  });

  it('turns an SSE error event into an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          sse(
            event('delta', { text: 'part' }),
            event('error', {
              error: 'ai_stream_interrupted',
              message: 'The answer was interrupted.',
            }),
          ),
        ),
      ),
    );
    await expect(summarizeUnread('c')).rejects.toThrow('The answer was interrupted.');
  });

  it('recognises the "AI not configured" 503', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        Promise.resolve(
          json(
            {
              error: {
                code: 'AI_UNAVAILABLE',
                message: 'AI is not configured. Set ANTHROPIC_API_KEY.',
                retryable: true,
              },
            },
            503,
          ),
        ),
      ),
    );
    const error = await summarizeUnread('c').catch((e: unknown) => e);
    expect(isNotConfigured(error)).toBe(true);
  });

  it('reads the AI package error shape too', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.resolve(json({ error: 'ai_timeout', message: 'Took too long.' }, 504))),
    );
    const error = await summarizeUnread('c').catch((e: unknown) => e);
    expect(error).toMatchObject({ status: 504, code: 'AI_TIMEOUT', message: 'Took too long.' });
    expect(isNotConfigured(error)).toBe(false);
  });

  it('fetches status and suggested replies as JSON', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json({ enabled: true }))
      .mockResolvedValueOnce(json({ replies: ['a', 'b', 'c'], provider: 'groq', model: 'm' }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await getAiEnabled()).toBe(true);
    expect(await suggestReplies('c')).toEqual({
      replies: ['a', 'b', 'c'],
      model: 'Groq · m',
    });
  });
});

describe('composeText', () => {
  it('POSTs the request as JSON and returns the text with the model label', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(json({ text: 'Hello Ravi', provider: 'groq', model: 'm' })),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { composeText } = await import('./aiApi');
    expect(await composeText({ mode: 'rewrite', text: 'hi', tone: 'casual' })).toEqual({
      text: 'Hello Ravi',
      model: 'Groq · m',
    });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api.test/api/ai/compose');
    expect(JSON.parse(init.body as string)).toEqual({
      mode: 'rewrite',
      text: 'hi',
      tone: 'casual',
    });
  });
});
