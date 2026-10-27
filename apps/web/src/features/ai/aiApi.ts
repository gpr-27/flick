// Calls to /ai/*. These use fetch directly (not api.call) because the answer can be a stream of
// server-sent events. The error body is either the app's { error: { code, message } } or the
// AI package's { error: 'ai_unavailable', message }; both become an ApiError.
import { ENDPOINTS, type AiComposeRequest } from '@chat/contracts';
import { config } from '@/config/env';
import { ApiError, NETWORK_ERROR } from '@/lib/api';
import { getDeviceId, getSessionToken } from '@/features/auth/authBridge';

const E = ENDPOINTS.ai;

import { modelLabel } from './modelLabel';

export interface AiChatTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface StreamOptions {
  signal?: AbortSignal;
  /** Called with the full text so far each time more arrives. */
  onText?: (text: string) => void;
  /** Called once, before the first words, with which model is answering. */
  onModel?: (label: string) => void;
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null;

const toApiError = (status: number, body: unknown): ApiError => {
  const fallback = `Request failed (${status})`;
  if (isRecord(body) && typeof body.error === 'string') {
    const message = typeof body.message === 'string' ? body.message : fallback;
    return new ApiError({ status, code: body.error.toUpperCase(), message });
  }
  return ApiError.fromResponse(status, body, fallback);
};

/** True for the 503 the server sends when no provider key is set. */
export const isNotConfigured = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 503 && /not configured/i.test(error.message);

async function send(
  path: string,
  init: { method: 'GET' | 'POST'; body?: unknown; stream?: boolean; signal?: AbortSignal },
): Promise<Response> {
  const token = await getSessionToken();
  const headers: Record<string, string> = {
    Accept: init.stream ? 'text/event-stream' : 'application/json',
    'X-Device-Id': getDeviceId(),
    ...config.http.tunnelHeaders,
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (init.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`${config.apiUrl.replace(/\/+$/, '')}${path}`, {
      method: init.method,
      headers,
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: init.signal,
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError({
      status: 0,
      code: NETWORK_ERROR,
      message: "Can't reach the server. Check your connection and try again.",
      cause,
    });
  }
  if (!res.ok) throw toApiError(res.status, await res.json().catch(() => undefined));
  return res;
}

/** Reads `event:` / `data:` blocks from a server-sent event stream. */
async function readEvents(
  res: Response,
  onEvent: (event: string, data: Record<string, unknown>) => void,
): Promise<void> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const flush = (block: string): void => {
    let event = 'message';
    let data = '';
    for (const line of block.split('\n')) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    const parsed: unknown = JSON.parse(data);
    onEvent(event, isRecord(parsed) ? parsed : {});
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const blocks = buffer.split('\n\n');
    buffer = blocks.pop() ?? '';
    blocks.forEach(flush);
  }
  if (buffer.trim()) flush(buffer);
}

/** POSTs and collects the streamed answer; resolves with the full text. */
async function streamText(path: string, body: unknown, options: StreamOptions): Promise<string> {
  const res = await send(path, { method: 'POST', body, stream: true, signal: options.signal });
  let text = '';
  await readEvents(res, (event, data) => {
    if (event === 'meta' && typeof data.provider === 'string' && typeof data.model === 'string') {
      options.onModel?.(modelLabel(data.provider, data.model));
    } else if (event === 'delta' && typeof data.text === 'string') {
      text += data.text;
      options.onText?.(text);
    } else if (event === 'error') {
      const message = typeof data.message === 'string' ? data.message : 'The assistant failed.';
      throw new ApiError({ status: 502, code: 'AI_STREAM_FAILED', message, retryable: true });
    }
  });
  if (!text.trim()) {
    throw new ApiError({ status: 502, code: 'AI_EMPTY', message: 'Flick had no answer.' });
  }
  return text;
}

async function jsonOf(path: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  return (await send(path, { method: 'POST', body, signal })).json();
}

export async function getAiEnabled(signal?: AbortSignal): Promise<boolean> {
  const res = await send(E.status.path, { method: 'GET', signal });
  return E.status.response.parse(await res.json()).enabled;
}

export const summarizeUnread = (conversationId: string, options: StreamOptions = {}) =>
  streamText(E.summarize.path, { conversation_id: conversationId }, options);

export const askFlick = (
  messages: AiChatTurn[],
  conversationId: string | undefined,
  options: StreamOptions = {},
) =>
  streamText(
    E.ask.path,
    { messages, stream: true, ...(conversationId ? { conversation_id: conversationId } : {}) },
    options,
  );

export async function suggestReplies(conversationId: string, signal?: AbortSignal) {
  const data = E.suggestReplies.response.parse(
    await jsonOf(E.suggestReplies.path, { conversation_id: conversationId }, signal),
  );
  return { replies: data.replies, model: modelLabel(data.provider, data.model) };
}

/** `conversationId` is the chat the text comes from, so that chat's "AI off" switch applies. */
export async function translateText(
  text: string,
  targetLang: string,
  signal?: AbortSignal,
  conversationId?: string,
) {
  const data = E.translate.response.parse(
    await jsonOf(
      E.translate.path,
      { text, targetLang, ...(conversationId ? { conversation_id: conversationId } : {}) },
      signal,
    ),
  );
  return { text: data.text, model: modelLabel(data.provider, data.model) };
}

/** "Explain with Flick": Flick reads an image, PDF, text file or voice note and answers about it. */
export async function analyzeAttachment(
  attachmentId: string,
  question?: string,
  signal?: AbortSignal,
) {
  const q = question?.trim();
  const data = E.analyze.response.parse(
    await jsonOf(
      E.analyze.path,
      { attachment_id: attachmentId, ...(q ? { question: q } : {}) },
      signal,
    ),
  );
  return data.text;
}

export type AnalyzeMode = 'explain' | 'table' | 'translate' | 'highlight' | 'compare' | 'receipt';

/** Flick works on one or several files: a mode (table, translate, receipt...) or a question. */
export async function analyzeFiles(
  attachmentIds: string[],
  options: { question?: string; mode?: AnalyzeMode; language?: string },
  signal?: AbortSignal,
) {
  const q = options.question?.trim();
  const data = E.analyze.response.parse(
    await jsonOf(
      E.analyze.path,
      {
        attachment_ids: attachmentIds,
        ...(q ? { question: q } : {}),
        ...(options.mode ? { mode: options.mode } : {}),
        ...(options.language ? { language: options.language } : {}),
      },
      signal,
    ),
  );
  return data.text;
}

export type ComposeRequest = AiComposeRequest;

/** "Write with Flick": polish, rewrite or write text for the composer. Never sends anything. */
export async function composeText(request: ComposeRequest, signal?: AbortSignal) {
  const data = E.compose.response.parse(await jsonOf(E.compose.path, request, signal));
  return { text: data.text, model: modelLabel(data.provider, data.model) };
}
