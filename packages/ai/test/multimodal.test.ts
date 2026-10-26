import { describe, expect, it } from 'vitest';
import { AiUnavailableError } from '../src/errors.js';
import { anthropicContent, openAiContent, requiredCaps } from '../src/providers.js';
import type { AiRequest, ContentPart } from '../src/types.js';
import { buildChain, Script } from './helpers.js';

const png: ContentPart = { type: 'image', mime: 'image/png', data: 'QUJD' };
const pdf: ContentPart = { type: 'document', mime: 'application/pdf', data: 'REVG' };
const withParts = (...parts: ContentPart[]): AiRequest => ({
  messages: [{ role: 'user', content: [{ type: 'text', text: 'what is this?' }, ...parts] }],
});

describe('content parts', () => {
  it('detects what a request needs', () => {
    expect(requiredCaps({ messages: [{ role: 'user', content: 'hi' }] })).toEqual({
      vision: false,
      pdf: false,
    });
    expect(requiredCaps(withParts(png))).toEqual({ vision: true, pdf: false });
    expect(requiredCaps(withParts(png, pdf))).toEqual({ vision: true, pdf: true });
  });

  it('maps parts to Anthropic blocks and OpenAI data URIs', () => {
    expect(anthropicContent([{ type: 'text', text: 'q' }, png, pdf])).toEqual([
      { type: 'text', text: 'q' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
      { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'REVG' } },
    ]);
    expect(openAiContent([{ type: 'text', text: 'q' }, png])).toEqual([
      { type: 'text', text: 'q' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
    ]);
    expect(anthropicContent('plain')).toBe('plain');
    expect(openAiContent('plain')).toBe('plain');
  });
});

describe('capability routing', () => {
  it('sends an image request to Anthropic as image blocks', async () => {
    const script = new Script();
    const { chain } = buildChain(script);
    await chain.complete(withParts(png));
    const content = (script.calls[0]!.params['messages'] as Array<{ content: unknown[] }>)[0]!
      .content;
    expect(script.calls[0]!.model).toBe('claude-sonnet-5-5');
    expect(content[1]).toMatchObject({ type: 'image' });
  });

  it('skips text-only Groq models and goes to Gemini', async () => {
    const script = new Script();
    const { chain } = buildChain(script, { anthropicApiKey: undefined });
    await chain.complete(withParts(png));
    expect(script.calls.length).toBe(1);
    expect(script.calls[0]!.model).toMatch(/^gemini/);
  });

  it('fails clearly when no model can read the parts', async () => {
    const script = new Script();
    const { chain } = buildChain(script, {
      anthropicApiKey: undefined,
      geminiApiKeys: [undefined, undefined],
    });
    const err = await chain.complete(withParts(pdf)).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect((err as Error).message).toMatch(/images or PDFs/);
    expect(script.calls.length).toBe(0);
  });

  it('keeps text-only requests on the first provider', async () => {
    const script = new Script();
    const { chain } = buildChain(script);
    await chain.complete({ messages: [{ role: 'user', content: 'hi' }] });
    expect(script.calls[0]!.model).toBe('claude-sonnet-5-5');
  });
});
