import type { AiConfig } from './config.js';
import { cooldownKey, MemoryCooldownStore, type CooldownStore } from './cooldown.js';
import {
  AiAbortedError,
  AiRequestError,
  AiStreamInterruptedError,
  AiTimeoutError,
  AiUnavailableError,
  classifyError,
  SAME_ENTRY_RETRY_MAX_MS,
  type AttemptFailure,
  type Classification,
} from './errors.js';
import {
  AnthropicAdapter,
  defaultClientFactories,
  GEMINI_MODELS,
  GEMINI_OPENAI_BASE_URL,
  GROQ_BASE_URL,
  GROQ_MODELS,
  OpenAICompatAdapter,
  requiredCaps,
  supportsCaps,
  type ClientFactories,
} from './providers.js';
import type {
  AiLogger,
  AiMetrics,
  AiRequest,
  AiResult,
  AnswerInfo,
  AttemptResult,
  CallOptions,
  ModelCaps,
  ProviderAdapter,
} from './types.js';
import { raceAbort, sleep } from './util.js';

export const DEFAULT_ATTEMPT_TIMEOUT_MS = 25_000;
export const DEFAULT_TOTAL_TIMEOUT_MS = 90_000;

type AbortKind = 'user' | 'deadline' | 'timeout';

class AbortReason extends Error {
  constructor(readonly kind: AbortKind) {
    super(`aborted: ${kind}`);
    this.name = 'AbortReason';
  }
}

/** Raised internally when an answer is empty or fails `validate`. */
class InvalidOutputError extends Error {
  constructor() {
    super('invalid output');
    this.name = 'InvalidOutputError';
  }
}

/** One call to complete()/stream(): user signal + total deadline. */
class CallContext {
  private readonly controller = new AbortController();
  private kind: 'user' | 'deadline' | null = null;
  private readonly deadline: ReturnType<typeof setTimeout>;
  private readonly onUserAbort = (): void => this.abort('user');

  constructor(
    private readonly userSignal: AbortSignal | undefined,
    totalTimeoutMs: number,
  ) {
    if (userSignal?.aborted) this.abort('user');
    else userSignal?.addEventListener('abort', this.onUserAbort, { once: true });
    this.deadline = setTimeout(() => this.abort('deadline'), totalTimeoutMs);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get doneKind(): 'user' | 'deadline' | null {
    return this.kind;
  }

  private abort(kind: 'user' | 'deadline'): void {
    if (this.kind) return;
    this.kind = kind;
    this.controller.abort(new AbortReason(kind));
  }

  throwIfDone(): void {
    if (this.kind === 'user') throw new AiAbortedError();
    if (this.kind === 'deadline') throw new AiTimeoutError();
  }

  async sleep(ms: number): Promise<void> {
    try {
      await sleep(ms, this.signal);
    } catch {
      this.throwIfDone();
    }
  }

  dispose(): void {
    clearTimeout(this.deadline);
    this.userSignal?.removeEventListener('abort', this.onUserAbort);
  }
}

/** One provider call: the call context plus a per-attempt (re-armable) timer. */
class AttemptScope {
  private readonly controller = new AbortController();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private timedOut = false;
  private readonly onParentAbort = (): void => this.controller.abort(this.ctx.signal.reason);

  constructor(
    private readonly ctx: CallContext,
    private readonly timeoutMs: number,
  ) {
    if (ctx.signal.aborted) this.controller.abort(ctx.signal.reason);
    else ctx.signal.addEventListener('abort', this.onParentAbort, { once: true });
    this.arm();
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  arm(): void {
    this.disarm();
    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.controller.abort(new AbortReason('timeout'));
    }, this.timeoutMs);
  }

  disarm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  reason(): AbortKind | null {
    return this.ctx.doneKind ?? (this.timedOut ? 'timeout' : null);
  }

  dispose(): void {
    this.disarm();
    this.ctx.signal.removeEventListener('abort', this.onParentAbort);
  }
}

interface WalkWin<T> {
  value: T;
  info: AnswerInfo;
  attempts: number;
  scope: AttemptScope;
}

/** Async iterator of text deltas that also reports who answered. */
export interface AiStream extends AsyncIterable<string> {
  /** Resolves when an entry produced its first delta; rejects if the chain fails first. */
  readonly info: Promise<AnswerInfo>;
  /** Set once `info` resolves. */
  readonly answer: AnswerInfo | undefined;
}

export interface AiChainOptions {
  /** Tried strictly in order; each adapter's models are tried in order. */
  adapters: ProviderAdapter[];
  cooldowns?: CooldownStore;
  logger?: AiLogger;
  metrics?: AiMetrics;
  attemptTimeoutMs?: number;
  totalTimeoutMs?: number;
  now?: () => number;
}

export interface AiChainDeps {
  cooldowns?: CooldownStore;
  logger?: AiLogger;
  metrics?: AiMetrics;
  /** Override SDK construction (tests). */
  clients?: ClientFactories;
}

export class AiChain {
  readonly adapters: readonly ProviderAdapter[];
  private readonly cooldowns: CooldownStore;
  private readonly logger: AiLogger | undefined;
  private readonly metrics: AiMetrics | undefined;
  private readonly attemptTimeoutMs: number;
  private readonly totalTimeoutMs: number;
  private readonly now: () => number;

  constructor(options: AiChainOptions) {
    this.adapters = [...options.adapters];
    this.cooldowns = options.cooldowns ?? new MemoryCooldownStore(options.now);
    this.logger = options.logger;
    this.metrics = options.metrics;
    this.attemptTimeoutMs = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
    this.totalTimeoutMs = options.totalTimeoutMs ?? DEFAULT_TOTAL_TIMEOUT_MS;
    this.now = options.now ?? Date.now;
  }

  /**
   * Builds the fixed chain: Anthropic -> Groq #1 -> Groq #2 -> Gemini #1 -> Gemini #2,
   * skipping entries whose key is missing.
   */
  static fromConfig(config: AiConfig, deps: AiChainDeps = {}): AiChain {
    const f = deps.clients ?? defaultClientFactories(config.attemptTimeoutMs + 5_000);
    const adapters: ProviderAdapter[] = [];
    if (config.anthropicApiKey)
      adapters.push(new AnthropicAdapter(f.anthropic(config.anthropicApiKey), 'default'));
    config.groqApiKeys.forEach((key, i) => {
      if (key)
        adapters.push(
          new OpenAICompatAdapter('groq', f.openai(key, GROQ_BASE_URL), String(i + 1), GROQ_MODELS),
        );
    });
    config.geminiApiKeys.forEach((key, i) => {
      if (key) {
        adapters.push(
          new OpenAICompatAdapter(
            'gemini',
            f.openai(key, GEMINI_OPENAI_BASE_URL),
            String(i + 1),
            GEMINI_MODELS,
          ),
        );
      }
    });
    deps.logger?.info?.(
      { entries: adapters.map((a) => `${a.provider}:${a.account}`) },
      adapters.length ? 'ai chain configured' : 'ai chain has no providers configured',
    );
    return new AiChain({
      adapters,
      ...(deps.cooldowns ? { cooldowns: deps.cooldowns } : {}),
      ...(deps.logger ? { logger: deps.logger } : {}),
      ...(deps.metrics ? { metrics: deps.metrics } : {}),
      attemptTimeoutMs: config.attemptTimeoutMs,
      totalTimeoutMs: config.totalTimeoutMs,
    });
  }

  get configured(): boolean {
    return this.adapters.length > 0;
  }

  async complete(request: AiRequest, options: CallOptions = {}): Promise<AiResult> {
    const started = this.now();
    const ctx = new CallContext(options.signal, options.totalTimeoutMs ?? this.totalTimeoutMs);
    try {
      const win = await this.walk(
        ctx,
        options,
        requiredCaps(request),
        async (adapter, model, scope) => {
          const text = await raceAbort(
            adapter.complete({ model, request, signal: scope.signal }),
            scope.signal,
          );
          if (!text.trim() || (options.validate && !options.validate(text)))
            throw new InvalidOutputError();
          return text;
        },
        request.preference,
      );
      win.scope.dispose();
      return {
        ...win.info,
        text: win.value,
        attempts: win.attempts,
        latencyMs: this.now() - started,
      };
    } finally {
      ctx.dispose();
    }
  }

  stream(request: AiRequest, options: CallOptions = {}): AiStream {
    let resolveInfo!: (i: AnswerInfo) => void;
    let rejectInfo!: (e: unknown) => void;
    const info = new Promise<AnswerInfo>((res, rej) => {
      resolveInfo = res;
      rejectInfo = rej;
    });
    info.catch(() => undefined);
    let answer: AnswerInfo | undefined;
    let used = false;
    const walk = this.walk.bind(this);
    const preference = request.preference;
    const record = this.record.bind(this);
    const logger = this.logger;
    const totalTimeoutMs = options.totalTimeoutMs ?? this.totalTimeoutMs;

    async function* run(): AsyncGenerator<string> {
      const ctx = new CallContext(options.signal, totalTimeoutMs);
      let scope: AttemptScope | undefined;
      let iterator: AsyncIterator<string> | undefined;
      let settled = false;
      try {
        const win = await walk(
          ctx,
          options,
          requiredCaps(request),
          async (adapter, model, s) => {
            const it = adapter.stream({ model, request, signal: s.signal })[Symbol.asyncIterator]();
            try {
              const first = await raceAbort(it.next(), s.signal);
              if (first.done || !first.value) throw new InvalidOutputError();
              return { it, first: first.value };
            } catch (err) {
              void Promise.resolve(it.return?.()).catch(() => undefined);
              throw err;
            }
          },
          preference,
        );
        scope = win.scope;
        iterator = win.value.it;
        answer = win.info;
        settled = true;
        resolveInfo(win.info);
        scope.disarm(); // the consumer's pace is not the provider's fault
        yield win.value.first;
        for (;;) {
          scope.arm();
          let next: IteratorResult<string>;
          try {
            next = await raceAbort(iterator.next(), scope.signal);
          } catch (err) {
            const why = scope.reason();
            if (why === 'user') {
              record(win.info, 'aborted');
              throw new AiAbortedError();
            }
            if (why === 'deadline') {
              record(win.info, 'timeout');
              throw new AiTimeoutError();
            }
            record(win.info, 'stream_interrupted');
            logger?.warn?.(
              { ...win.info, requestId: options.requestId, timeout: why === 'timeout' },
              'ai stream interrupted after first delta',
            );
            throw new AiStreamInterruptedError(win.info, err);
          }
          scope.disarm();
          if (next.done) break;
          if (next.value) yield next.value;
        }
      } catch (err) {
        if (!settled) rejectInfo(err);
        throw err;
      } finally {
        if (!settled) rejectInfo(new AiAbortedError());
        scope?.dispose();
        if (iterator?.return) void Promise.resolve(iterator.return()).catch(() => undefined);
        ctx.dispose();
      }
    }

    return {
      info,
      get answer() {
        return answer;
      },
      [Symbol.asyncIterator]() {
        if (used) throw new Error('AiStream can only be iterated once');
        used = true;
        return run();
      },
    };
  }

  private record(info: AnswerInfo, result: AttemptResult, latencyMs?: number): void {
    const labels = { ...info, result };
    try {
      this.metrics?.attempt?.(labels);
      if (latencyMs !== undefined) this.metrics?.latency?.(labels, latencyMs);
    } catch {
      // metrics must never break a request
    }
  }

  private async remainingCooldown(key: string): Promise<number> {
    try {
      return await this.cooldowns.remainingMs(key);
    } catch {
      return 0;
    }
  }

  private async setCooldown(keys: string[], ttlMs: number, reason: string): Promise<void> {
    await Promise.all(keys.map((k) => this.cooldowns.set(k, ttlMs, reason).catch(() => undefined)));
  }

  private async walk<T>(
    ctx: CallContext,
    options: CallOptions,
    need: ModelCaps,
    run: (adapter: ProviderAdapter, model: string, scope: AttemptScope) => Promise<T>,
    preference?: 'fast' | 'quality',
  ): Promise<WalkWin<T>> {
    const failures: AttemptFailure[] = [];
    let attempts = 0;
    const timeoutMs = options.timeoutMs ?? this.attemptTimeoutMs;
    let incapable = 0;

    // 'fast': the Anthropic entries go last (the sort is stable, so the rest keeps its order).
    const adapters =
      preference === 'fast'
        ? [...this.adapters].sort(
            (a, b) => Number(a.provider === 'anthropic') - Number(b.provider === 'anthropic'),
          )
        : this.adapters;
    for (const adapter of adapters) {
      let accountDown = false;
      for (const model of adapter.models) {
        if (accountDown) break;
        if (!supportsCaps(adapter.capabilities?.(model), need)) {
          incapable += 1; // this model cannot read the images / PDFs in the request
          continue;
        }
        ctx.throwIfDone();
        const info: AnswerInfo = { provider: adapter.provider, account: adapter.account, model };
        const remaining = await this.remainingCooldown(
          cooldownKey(adapter.provider, adapter.account, model),
        );
        if (remaining > 0) {
          this.record(info, 'skipped_cooldown');
          failures.push({ ...info, result: 'skipped_cooldown' });
          this.logger?.debug?.(
            { ...info, remainingMs: remaining, requestId: options.requestId },
            'ai entry cooling down',
          );
          continue;
        }

        let retriedSameEntry = false;
        for (;;) {
          ctx.throwIfDone();
          const scope = new AttemptScope(ctx, timeoutMs);
          const startedAt = this.now();
          attempts += 1;
          try {
            const value = await run(adapter, model, scope);
            const latencyMs = this.now() - startedAt;
            this.record(info, 'success', latencyMs);
            this.logger?.info?.(
              { ...info, latencyMs, attempts, requestId: options.requestId },
              'ai attempt succeeded',
            );
            return { value, info, attempts, scope };
          } catch (err) {
            const why = scope.reason();
            scope.dispose();
            const latencyMs = this.now() - startedAt;
            if (why === 'user') {
              this.record(info, 'aborted', latencyMs);
              throw new AiAbortedError();
            }
            if (why === 'deadline') {
              this.record(info, 'timeout', latencyMs);
              throw new AiTimeoutError();
            }
            const c: Classification =
              why === 'timeout'
                ? { result: 'timeout', fallthrough: true, scope: 'model' }
                : err instanceof InvalidOutputError
                  ? { result: 'invalid_output', fallthrough: true, scope: 'model' }
                  : classifyError(err, this.now());
            this.record(info, c.result, latencyMs);
            this.logger?.warn?.(
              {
                ...info,
                result: c.result,
                status: c.status,
                errorType: c.errorType,
                retryAfterMs: c.retryAfterMs,
                latencyMs,
                requestId: options.requestId,
              },
              'ai attempt failed',
            );
            if (!c.fallthrough)
              throw new AiRequestError({ provider: info.provider, model, status: c.status }, err);

            if (
              c.result === 'rate_limited' &&
              !retriedSameEntry &&
              c.retryAfterMs !== undefined &&
              c.retryAfterMs <= SAME_ENTRY_RETRY_MAX_MS
            ) {
              retriedSameEntry = true;
              await ctx.sleep(c.retryAfterMs);
              continue;
            }
            if (c.cooldownMs !== undefined && c.cooldownMs > 0) {
              const models = c.scope === 'account' ? adapter.models : [model];
              await this.setCooldown(
                models.map((m) => cooldownKey(adapter.provider, adapter.account, m)),
                c.cooldownMs,
                c.result,
              );
              this.logger?.info?.(
                {
                  provider: info.provider,
                  account: info.account,
                  models,
                  cooldownMs: c.cooldownMs,
                  result: c.result,
                },
                'ai cooldown set',
              );
            }
            failures.push({
              ...info,
              result: c.result,
              ...(c.status !== undefined ? { status: c.status } : {}),
            });
            if (c.scope === 'account') accountDown = true;
            break;
          }
        }
      }
    }
    throw new AiUnavailableError(
      failures,
      this.adapters.length === 0
        ? 'No AI providers are configured'
        : failures.length === 0 && incapable > 0
          ? 'No configured AI model can read images or PDFs. Add an Anthropic or Gemini key.'
          : 'All AI providers are unavailable',
    );
  }
}
