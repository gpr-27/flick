// Fetch client. Every authenticated request carries the Clerk session token (fetched per request;
// Clerk renews it) and the per-browser X-Device-Id. A 401 means the session is gone: onUnauthorized
// signs out. Typed endpoints are layered on top (endpoints.ts).
import { ApiError, INVALID_RESPONSE, NETWORK_ERROR } from './errors';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export type QueryValue = string | number | boolean | null | undefined;
/** Turns an untrusted response body into a typed value (e.g. a zod schema's parse). */
export type Parser<T> = (data: unknown) => T;

export interface RequestOptions {
  method?: HttpMethod;
  /** JSON-serialised unless it is FormData / Blob / URLSearchParams. */
  body?: unknown;
  query?: Record<string, QueryValue>;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Attach the session token and device id; a 401 signs out. Default true. */
  auth?: boolean;
}

export interface ApiClientOptions {
  baseUrl: string;
  /** The current Clerk session token, or null when signed out. */
  getToken: () => Promise<string | null>;
  /** Sent as X-Device-Id on every request. */
  getDeviceId: () => string;
  fetch?: typeof fetch;
  headers?: Readonly<Record<string, string>>;
  credentials?: RequestCredentials;
  /** The server answered 401: the session is gone. */
  onUnauthorized?: (error: ApiError) => void;
  /** Observability hook for every failed request. */
  onError?: (error: ApiError, request: { method: HttpMethod; path: string }) => void;
}

export interface ApiClient {
  request<T>(path: string, parse: Parser<T>, options?: RequestOptions): Promise<T>;
  get<T>(
    path: string,
    parse: Parser<T>,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  post<T>(
    path: string,
    body: unknown,
    parse: Parser<T>,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  put<T>(
    path: string,
    body: unknown,
    parse: Parser<T>,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  patch<T>(
    path: string,
    body: unknown,
    parse: Parser<T>,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
  delete<T>(
    path: string,
    parse: Parser<T>,
    options?: Omit<RequestOptions, 'method' | 'body'>,
  ): Promise<T>;
}

/** For endpoints whose body the caller does not use. */
export const ignoreBody: Parser<undefined> = () => undefined;

const isRawBody = (body: unknown): body is BodyInit =>
  body instanceof FormData || body instanceof Blob || body instanceof URLSearchParams;

const joinUrl = (base: string, path: string, query?: Record<string, QueryValue>): string => {
  const url = `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) params.append(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
};

const readBody = async (res: Response): Promise<unknown> => {
  if (res.status === 204 || res.status === 205) return undefined;
  const text = await res.text();
  if (!text) return undefined;
  const type = res.headers.get('content-type') ?? '';
  if (type.includes('json')) {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return text;
    }
  }
  return text;
};

const isAbort = (e: unknown): boolean => e instanceof DOMException && e.name === 'AbortError';

export const createApiClient = (options: ApiClientOptions): ApiClient => {
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const send = async (
    path: string,
    init: RequestOptions,
    token: string | null,
  ): Promise<Response> => {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      ...options.headers,
      ...init.headers,
    };
    let body: BodyInit | undefined;
    if (init.body !== undefined) {
      if (isRawBody(init.body)) body = init.body;
      else {
        body = JSON.stringify(init.body);
        headers['Content-Type'] = 'application/json';
      }
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    if (init.auth ?? true) headers['X-Device-Id'] = options.getDeviceId();
    try {
      return await fetchImpl(joinUrl(options.baseUrl, path, init.query), {
        method: init.method ?? 'GET',
        headers,
        body,
        signal: init.signal,
        credentials: options.credentials ?? 'omit',
      });
    } catch (cause) {
      if (isAbort(cause)) throw cause;
      throw new ApiError({
        status: 0,
        code: NETWORK_ERROR,
        message: "Can't reach the server. Check your connection and try again.",
        cause,
      });
    }
  };

  const request = async <T>(
    path: string,
    parse: Parser<T>,
    init: RequestOptions = {},
  ): Promise<T> => {
    const method = init.method ?? 'GET';
    const useAuth = init.auth ?? true;
    try {
      const token = useAuth ? await options.getToken() : null;
      const res = await send(path, init, token);

      const data = await readBody(res);
      if (!res.ok) {
        const error = ApiError.fromResponse(res.status, data, `Request failed (${res.status})`);
        if (res.status === 401 && useAuth) options.onUnauthorized?.(error);
        throw error;
      }
      try {
        return parse(data);
      } catch (cause) {
        throw new ApiError({
          status: res.status,
          code: INVALID_RESPONSE,
          message: 'The server sent an unexpected response.',
          cause,
        });
      }
    } catch (error) {
      if (error instanceof ApiError) options.onError?.(error, { method, path });
      throw error;
    }
  };

  return {
    request,
    get: (path, parse, o) => request(path, parse, { ...o, method: 'GET' }),
    post: (path, body, parse, o) => request(path, parse, { ...o, method: 'POST', body }),
    put: (path, body, parse, o) => request(path, parse, { ...o, method: 'PUT', body }),
    patch: (path, body, parse, o) => request(path, parse, { ...o, method: 'PATCH', body }),
    delete: (path, parse, o) => request(path, parse, { ...o, method: 'DELETE' }),
  };
};
