import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type {
  ChatCompletionCreateParamsBase,
  ChatCompletionMessageParam,
} from 'openai/resources/chat/completions';
import type {
  AiRequest,
  ChatMessage,
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

  private params(model: string, request: AiRequest): Anthropic.MessageCreateParamsNonStreaming {
    // No temperature/top_p (rejected by current models) and no assistant prefill.
    return {
      model,
      max_tokens: request.maxTokens ?? DEFAULT_MAX_TOKENS,
      ...(request.system ? { system: request.system } : {}),
      messages: normalizeTurns(request.messages).map((m) => ({ role: m.role, content: m.content })),
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

  private params(model: string, request: AiRequest): ChatCompletionCreateParamsBase {
    const messages: ChatCompletionMessageParam[] = [];
    if (request.system) messages.push({ role: 'system', content: request.system });
    for (const m of request.messages) messages.push({ role: m.role, content: m.content });
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
