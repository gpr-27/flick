import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type {
  ChatCompletionContentPart,
  ChatCompletionCreateParamsBase,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type {
  AiRequest,
  ChatMessage,
  ContentPart,
  ModelCaps,
  ProviderAdapter,
  ProviderCallParams,
  ProviderName,
} from './types.js';

/** Model IDs, all from free-llm-api-guide.md. Order matters: first is tried first. */
export const ANTHROPIC_MODELS = ['claude-sonnet-5-5'] as const;
export const GROQ_MODELS = [
  'openai/gpt-oss-120b',
  'openai/gpt-oss-20b',
  'qwen/qwen3.8-27b',
] as const;
export const GEMINI_MODELS = [
  'gemini-3.8-flash',
  'gemini-3.6-flash',
  'gemini-3.1-flash-lite',
] as const;

export const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
export const GEMINI_OPENAI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/';

const DEFAULT_MAX_TOKENS = 1024;

/** Which models can read images / PDFs. Groq's chat models here are text only. */
export function modelCaps(provider: ProviderName): ModelCaps {
  return provider === 'groq' ? { vision: false, pdf: false } : { vision: true, pdf: true };
}

/** What a request needs from a model. */
export function requiredCaps(request: AiRequest): ModelCaps {
  const need: ModelCaps = { vision: false, pdf: false };
  for (const m of request.messages) {
    if (typeof m.content === 'string') continue;
    for (const p of m.content) {
      if (p.type === 'image') need.vision = true;
      else if (p.type === 'document') need.pdf = true;
    }
  }
  return need;
}

export function supportsCaps(have: ModelCaps | undefined, need: ModelCaps): boolean {
  return (!need.vision || !!have?.vision) && (!need.pdf || !!have?.pdf);
}

export function anthropicContent(
  content: string | ContentPart[],
): string | Anthropic.ContentBlockParam[] {
  if (typeof content === 'string') return content;
  return content.map((p): Anthropic.ContentBlockParam => {
    if (p.type === 'text') return { type: 'text', text: p.text };
    if (p.type === 'image') {
      return {
        type: 'image',
        source: {
          type: 'base64',
          media_type: p.mime as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: p.data,
        },
      };
    }
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: p.data },
    };
  });
}

export function openAiContent(
  content: string | ContentPart[],
): string | ChatCompletionContentPart[] {
  if (typeof content === 'string') return content;
  return content.map((p): ChatCompletionContentPart => {
    if (p.type === 'text') return { type: 'text', text: p.text };
    // Gemini's OpenAI-compatible endpoint reads PDFs given as data URIs the same way as images.
    return { type: 'image_url', image_url: { url: `data:${p.mime};base64,${p.data}` } };
  });
}

/** Anthropic requires the first turn to be `user` and forbids a trailing assistant prefill. */
export function normalizeTurns(messages: ChatMessage[]): ChatMessage[] {
  const out = [...messages];
  while (out.length > 0 && out[0]?.role !== 'user') out.shift();
  while (out.length > 0 && out[out.length - 1]?.role !== 'user') out.pop();
  return out;
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider: ProviderName = 'anthropic';

  constructor(
    private readonly client: Anthropic,
    readonly account = 'default',
    readonly models: readonly string[] = ANTHROPIC_MODELS,
  ) {}

  capabilities(): ModelCaps {
    return modelCaps('anthropic');
  }

  private params(model: string, request: AiRequest): Anthropic.MessageCreateParamsNonStreaming {
    // No temperature/top_p (rejected by current models) and no assistant prefill.
    return {
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(request.system ? { system: request.system } : {}),
      messages: normalizeTurns(request.messages).map((m) => ({
        role: m.role,
        content: anthropicContent(m.content),
      })),
      output_config: { effort: 'low' },
    };
  }

  async complete({ model, request, signal }: ProviderCallParams): Promise<string> {
    const msg = await this.client.messages.create(this.params(model, request), { signal });
    return msg.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
  }

  async *stream({ model, request, signal }: ProviderCallParams): AsyncIterable<string> {
    const stream = await this.client.messages.create(
      { ...this.params(model, request), stream: true },
      { signal },
    );
    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta' &&
        event.delta.text
      ) {
        yield event.delta.text;
      }
    }
  }
}

/** Groq and Gemini through their OpenAI-compatible Chat Completions endpoints. */
export class OpenAICompatAdapter implements ProviderAdapter {
  constructor(
    readonly provider: 'groq' | 'gemini',
    private readonly client: OpenAI,
    readonly account: string,
    readonly models: readonly string[],
  ) {}

  capabilities(): ModelCaps {
    return modelCaps(this.provider);
  }

  private params(model: string, request: AiRequest): ChatCompletionCreateParamsBase {
    const messages: ChatCompletionMessageParam[] = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    for (const m of request.messages) {
      if (m.role === 'assistant') {
        const text =
          typeof m.content === 'string'
            ? m.content
            : m.content.map((p) => (p.type === 'text' ? p.text : '')).join('');
        messages.push({ role: 'assistant', content: text });
      } else {
        messages.push({ role: 'user', content: openAiContent(m.content) });
      }
    }
    const maxTokens = request.maxTokens ?? DEFAULT_MAX_TOKENS;
    const params: ChatCompletionCreateParamsBase = { model, messages };
    if (this.provider === 'groq') {
      params.max_completion_tokens = maxTokens;
      // GPT-OSS reasons by default and reasoning counts toward the cap; keep it light.
      // Qwen 3.8 defaults to `none` (instruct mode), so leave it alone.
      if (model.startsWith('openai/gpt-oss')) params.reasoning_effort = 'low';
    } else {
      params.max_tokens = maxTokens;
      params.reasoning_effort = 'low'; // valid on 3.8 Flash, 3.6 Flash and 3.5 Flash-Lite
    }
    if (request.responseFormat === 'json') params.response_format = { type: 'json_object' };
    return params;
  }

  async complete({ model, request, signal }: ProviderCallParams): Promise<string> {
    const res = await this.client.chat.completions.create(
      { ...this.params(model, request), stream: false },
      { signal },
    );
    return res.choices[0]?.message?.content ?? '';
  }

  async *stream({ model, request, signal }: ProviderCallParams): AsyncIterable<string> {
    const stream = await this.client.chat.completions.create(
      { ...this.params(model, request), stream: true },
      { signal },
    );
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content;
      if (delta) yield delta;
    }
  }
}

export interface ClientFactories {
  anthropic(apiKey: string): Anthropic;
  openai(apiKey: string, baseURL: string): OpenAI;
}

/** SDK retries are disabled: the chain owns retry / fall-through policy. */
export function defaultClientFactories(sdkTimeoutMs: number): ClientFactories {
  return {
    anthropic: (apiKey) => new Anthropic({ apiKey, maxRetries: 0, timeout: sdkTimeoutMs }),
    openai: (apiKey, baseURL) =>
      new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: sdkTimeoutMs }),
  };
}
