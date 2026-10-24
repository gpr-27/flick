import type { OutgoingHttpHeaders } from 'node:http';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AiStream } from './chain.js';
import {
  AiAbortedError,
  AiError,
  AiRequestError,
  AiStreamInterruptedError,
  AiTimeoutError,
  AiUnavailableError,
} from './errors.js';
import { MemoryRateLimitStore, type RateLimitStore } from './rate-limit.js';
import { TARGET_LANG_RE, type AiTasks } from './tasks.js';
import type { AiResult, AnswerInfo, CallOptions } from './types.js';

/** Hard caps on what a client may send. */
export const AI_INPUT_LIMITS = {
  bodyBytes: 128 * 1024,
  summarize: { messages: 300, senderChars: 100, textChars: 4_000, totalChars: 60_000 },
  suggestReplies: { messages: 30, senderChars: 100, textChars: 2_000, totalChars: 12_000 },
  translate: { textChars: 5_000 },
  chat: { messages: 40, contentChars: 8_000, totalChars: 32_000 },
} as const;

const L = AI_INPUT_LIMITS;

const totalChars = (items: Array<{ text?: string; content?: string }>): number =>
  items.reduce((n, m) => n + (m.text ?? m.content ?? '').length, 0);

export const summarizeBodySchema = z.object({
  messages: z
    .array(
      z.object({
        sender: z.string().trim().min(1).max(L.summarize.senderChars),
        text: z.string().max(L.summarize.textChars),
        sentAt: z.string().max(40).optional(),
      }),
    )
    .min(1)
    .max(L.summarize.messages)
    .refine((m) => totalChars(m) <= L.summarize.totalChars, {
      message: `total text exceeds ${L.summarize.totalChars} characters`,
    })
    .refine((m) => m.some((x) => x.text.trim().length > 0), { message: 'messages are empty' }),
});

export const suggestRepliesBodySchema = z.object({
  context: z
    .array(
      z.object({
        sender: z.string().trim().min(1).max(L.suggestReplies.senderChars),
        text: z.string().trim().min(1).max(L.suggestReplies.textChars),
        fromMe: z.boolean().optional(),
      }),
    )
    .min(1)
    .max(L.suggestReplies.messages)
    .refine((m) => totalChars(m) <= L.suggestReplies.totalChars, {
      message: `total text exceeds ${L.suggestReplies.totalChars} characters`,
    }),
});

export const translateBodySchema = z.object({
  text: z.string().trim().min(1).max(L.translate.textChars),
  targetLang: z.string().trim().regex(TARGET_LANG_RE, 'targetLang must be a language name or code'),
});

export const chatBodySchema = z.object({
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().trim().min(1).max(L.chat.contentChars),
      }),
    )
    .min(1)
    .max(L.chat.messages)
    .refine((h) => h[h.length - 1]?.role === 'user', {
      message: 'last message must be from the user',
    })
    .refine((h) => totalChars(h) <= L.chat.totalChars, {
      message: `total content exceeds ${L.chat.totalChars} characters`,
    }),
});

export interface AiRoutesOptions {
  tasks: AiTasks;
  /**
   * Auth guard run before everything else (e.g. verifies the session and sets `request.user`).
   * It should send 401/403 itself when the caller is not allowed.
   */
  authGuard?: (request: FastifyRequest, reply: FastifyReply) => Promise<unknown>;
  /** Must be set explicitly to run without an auth guard (dev/tests). */
  allowUnauthenticated?: boolean;
  /** Rate-limit identity. Defaults to `request.user.id`, then `request.user.sub`, then the client IP. */
  getUserId?: (request: FastifyRequest) => string | undefined;
  /** Per-user fixed window. Default 20 requests / 60s in memory; pass a RedisRateLimitStore when running replicas. */
  rateLimit?: { max: number; windowMs: number; store?: RateLimitStore } | false;
  /** Forwarded to the chain per request. */
  timeoutMs?: number;
  totalTimeoutMs?: number;
}

function defaultUserId(request: FastifyRequest): string | undefined {
  const user = (request as unknown as { user?: { id?: unknown; sub?: unknown } }).user;
  const id = user?.id ?? user?.sub;
  return typeof id === 'string' || typeof id === 'number' ? String(id) : undefined;
}

function wantsJson(request: FastifyRequest): boolean {
  const accept = request.headers.accept ?? '';
  return accept.includes('application/json') && !accept.includes('text/event-stream');
}

function errorReply(reply: FastifyReply, err: unknown): FastifyReply {
  if (err instanceof AiUnavailableError) {
    return reply.code(503).send({
      error: 'ai_unavailable',
      message: 'The assistant is temporarily unavailable. Try again shortly.',
    });
  }
  if (err instanceof AiTimeoutError)
    return reply
      .code(504)
      .send({ error: 'ai_timeout', message: 'The assistant took too long to answer.' });
  if (err instanceof AiRequestError) {
    return reply.code(422).send({
      error: 'ai_request_rejected',
      message: 'The assistant could not process this input.',
    });
  }
  if (err instanceof RangeError)
    return reply.code(400).send({ error: 'invalid_request', message: err.message });
  if (err instanceof AiError)
    return reply.code(502).send({ error: err.code, message: 'The assistant failed to answer.' });
  throw err;
}

/** The client went away and the call was aborted; nobody will read this. */
function clientClosed(reply: FastifyReply): FastifyReply {
  return reply.code(499).send({ error: 'client_closed_request' });
}

function sseEventFor(err: unknown): { error: string; message: string } {
  if (err instanceof AiStreamInterruptedError)
    return { error: 'ai_stream_interrupted', message: 'The answer was interrupted.' };
  if (err instanceof AiTimeoutError)
    return { error: 'ai_timeout', message: 'The assistant took too long to answer.' };
  if (err instanceof AiError)
    return { error: err.code, message: 'The assistant failed to answer.' };
  return { error: 'internal_error', message: 'Unexpected error.' };
}

class SseWriter {
  constructor(private readonly reply: FastifyReply) {}

  open(): void {
    // Keep headers set by earlier hooks (CORS, rate limit) that a hijacked reply would otherwise drop.
    const inherited: OutgoingHttpHeaders = {};
    for (const [k, v] of Object.entries(this.reply.getHeaders())) {
      if (v !== undefined) inherited[k] = typeof v === 'number' ? String(v) : v;
    }
    this.reply.hijack();
    this.reply.raw.writeHead(200, {
      ...inherited,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
  }

  send(event: string, data: unknown): void {
    if (this.reply.raw.writableEnded || this.reply.raw.destroyed) return;
    this.reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  end(): void {
    if (!this.reply.raw.writableEnded) this.reply.raw.end();
  }
}

const info = (i: AnswerInfo): { provider: string; model: string } => ({
  provider: i.provider,
  model: i.model,
});

/**
 * Fastify plugin. Register under a prefix:
 *   app.register(aiRoutes, { prefix: '/api/ai', tasks, authGuard })
 *
 * POST /summarize, /translate, /chat stream SSE events: `meta` {provider, model}, `delta` {text}*,
 * `done` {provider, model} or `error` {error, message}. POST /suggest-replies sends `meta`, `result` {replies}, `done`.
 * With `Accept: application/json` each route returns one JSON body including provider and model.
 */
export const aiRoutes: FastifyPluginAsync<AiRoutesOptions> = (fastify, opts) => {
  const { tasks } = opts;
  if (!opts.authGuard && !opts.allowUnauthenticated) {
    return Promise.reject(
      new Error('aiRoutes: pass authGuard, or allowUnauthenticated: true to run without auth'),
    );
  }
  const getUserId = opts.getUserId ?? defaultUserId;
  const rl = opts.rateLimit === false ? null : (opts.rateLimit ?? { max: 20, windowMs: 60_000 });
  const rlStore = rl ? (rl.store ?? new MemoryRateLimitStore()) : null;

  if (opts.authGuard) {
    const guard = opts.authGuard;
    fastify.addHook('preHandler', async (request, reply) => {
      await guard(request, reply);
      if (reply.sent) return reply;
      return undefined;
    });
  }

  if (rl && rlStore) {
    fastify.addHook('preHandler', async (request, reply) => {
      const id = getUserId(request) ?? `ip:${request.ip}`;
      const hit = await rlStore.hit(`ai:ratelimit:${id}`, rl.windowMs);
      const resetSec = Math.max(1, Math.ceil(hit.resetMs / 1000));
      reply.header('x-ratelimit-limit', rl.max);
      reply.header('x-ratelimit-remaining', Math.max(0, rl.max - hit.count));
      reply.header('x-ratelimit-reset', resetSec);
      if (hit.count > rl.max) {
        reply.header('retry-after', resetSec);
        return reply
          .code(429)
          .send({ error: 'rate_limited', message: 'Too many AI requests. Try again later.' });
      }
      return undefined;
    });
  }

  function callOptions(request: FastifyRequest, reply: FastifyReply): CallOptions {
    const controller = new AbortController();
    reply.raw.on('close', () => {
      if (!reply.raw.writableFinished) controller.abort();
    });
    return {
      signal: controller.signal,
      requestId: String(request.id),
      ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
      ...(opts.totalTimeoutMs !== undefined ? { totalTimeoutMs: opts.totalTimeoutMs } : {}),
    };
  }

  function invalid(reply: FastifyReply, error: z.ZodError): FastifyReply {
    return reply.code(400).send({
      error: 'invalid_request',
      issues: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }

  async function respondText(
    request: FastifyRequest,
    reply: FastifyReply,
    complete: (o: CallOptions) => Promise<AiResult>,
    stream: (o: CallOptions) => AiStream,
  ): Promise<FastifyReply | undefined> {
    const o = callOptions(request, reply);
    if (wantsJson(request)) {
      try {
        const r = await complete(o);
        return await reply.send({ ...info(r), text: r.text });
      } catch (err) {
        if (err instanceof AiAbortedError) return clientClosed(reply);
        return errorReply(reply, err);
      }
    }

    let s: AiStream;
    let it: AsyncIterator<string>;
    let first: IteratorResult<string>;
    try {
      s = stream(o);
      it = s[Symbol.asyncIterator]();
      first = await it.next(); // nothing is written until an entry answers, so failures stay plain HTTP errors
    } catch (err) {
      if (err instanceof AiAbortedError) return clientClosed(reply);
      return errorReply(reply, err);
    }

    const sse = new SseWriter(reply);
    sse.open();
    const answered = s.answer;
    if (answered) sse.send('meta', info(answered));
    try {
      if (!first.done) sse.send('delta', { text: first.value });
      for (;;) {
        const n = await it.next();
        if (n.done) break;
        sse.send('delta', { text: n.value });
      }
      if (answered) sse.send('done', info(answered));
    } catch (err) {
      if (!(err instanceof AiAbortedError)) {
        request.log.warn(
          { err: err instanceof Error ? err.name : 'unknown' },
          'ai sse stream failed',
        );
        sse.send('error', sseEventFor(err));
      }
    } finally {
      sse.end();
    }
    return undefined;
  }

  const routeOpts = { bodyLimit: L.bodyBytes };

  fastify.post('/summarize', routeOpts, async (request, reply) => {
    const body = summarizeBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    const messages = body.data.messages.map((m) => ({
      sender: m.sender,
      text: m.text,
      ...(m.sentAt ? { sentAt: m.sentAt } : {}),
    }));
    return respondText(
      request,
      reply,
      (o) => tasks.summarizeUnread(messages, o),
      (o) => tasks.summarizeUnreadStream(messages, o),
    );
  });

  fastify.post('/translate', routeOpts, async (request, reply) => {
    const body = translateBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    const { text, targetLang } = body.data;
    return respondText(
      request,
      reply,
      (o) => tasks.translate(text, targetLang, o),
      (o) => tasks.translateStream(text, targetLang, o),
    );
  });

  fastify.post('/chat', routeOpts, async (request, reply) => {
    const body = chatBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    const history = body.data.history;
    return respondText(
      request,
      reply,
      (o) => tasks.chat(history, o),
      (o) => tasks.chatStream(history, o),
    );
  });

  fastify.post('/suggest-replies', routeOpts, async (request, reply) => {
    const body = suggestRepliesBodySchema.safeParse(request.body);
    if (!body.success) return invalid(reply, body.error);
    const context = body.data.context.map((m) => ({
      sender: m.sender,
      text: m.text,
      ...(m.fromMe !== undefined ? { fromMe: m.fromMe } : {}),
    }));
    let result;
    try {
      result = await tasks.suggestReplies(context, callOptions(request, reply));
    } catch (err) {
      if (err instanceof AiAbortedError) return clientClosed(reply);
      return errorReply(reply, err);
    }
    if (wantsJson(request)) return reply.send({ ...info(result), replies: result.replies });
    const sse = new SseWriter(reply);
    sse.open();
    sse.send('meta', info(result));
    sse.send('result', { replies: result.replies });
    sse.send('done', info(result));
    sse.end();
    return undefined;
  });

  return Promise.resolve();
};
