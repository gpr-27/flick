export type ProviderName = 'anthropic' | 'groq' | 'gemini';

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

/** Provider-neutral request. Never logged. */
export interface AiRequest {
  system?: string;
  messages: ChatMessage[];
  /** Output token cap (includes reasoning tokens on reasoning models). */
  maxTokens?: number;
  /** 'json' asks OpenAI-compatible providers for a JSON object; prompts must also ask for JSON. */
  responseFormat?: 'text' | 'json';
}

export interface CallOptions {
  /** Cancels the whole call (all attempts). */
  signal?: AbortSignal;
  /** Per-attempt timeout (time to full answer for complete(), time to first / between deltas for stream()). */
  timeoutMs?: number;
  /** Budget for the whole chain walk. */
  totalTimeoutMs?: number;
  /** complete() only: reject an answer (e.g. unparsable JSON) and fall through to the next entry. */
  validate?: (text: string) => boolean;
  /** Correlation id copied into log lines. */
  requestId?: string;
}

export interface AnswerInfo {
  provider: ProviderName;
  account: string;
  model: string;
}

export interface AiResult extends AnswerInfo {
  text: string;
  /** Number of provider calls made, including the successful one. */
  attempts: number;
  latencyMs: number;
}

export type AttemptResult =
  | 'success'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'auth_error'
  | 'credit_exhausted'
  | 'model_unavailable'
  | 'server_error'
  | 'timeout'
  | 'network_error'
  | 'bad_request'
  | 'aborted'
  | 'invalid_output'
  | 'skipped_cooldown'
  | 'stream_interrupted';

export interface AttemptLabels {
  provider: ProviderName;
  account: string;
  model: string;
  result: AttemptResult;
}

type LogFn = (obj: Record<string, unknown>, msg?: string) => void;

/** pino-compatible subset; Fastify's `request.log` / `app.log` fit directly. */
export interface AiLogger {
  debug?: LogFn;
  info?: LogFn;
  warn?: LogFn;
  error?: LogFn;
}

export interface AiMetrics {
  /** Suggested Prometheus mapping: counter `ai_attempts_total{provider,account,model,result}`. */
  attempt?(labels: AttemptLabels): void;
  /** Suggested Prometheus mapping: histogram `ai_attempt_duration_seconds{provider,account,model,result}`. */
  latency?(labels: AttemptLabels, ms: number): void;
}

export interface ProviderCallParams {
  model: string;
  request: AiRequest;
  signal: AbortSignal;
}

export interface ProviderAdapter {
  readonly provider: ProviderName;
  readonly account: string;
  readonly models: readonly string[];
  complete(params: ProviderCallParams): Promise<string>;
  stream(params: ProviderCallParams): AsyncIterable<string>;
}
