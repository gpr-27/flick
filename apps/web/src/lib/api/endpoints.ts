// A typed caller over ENDPOINTS from @chat/contracts: the path, params, query, body and response
// type all come from the endpoint definition, and the response is parsed with its schema.
//
//   const { items } = await api.call(ENDPOINTS.conversations.list, { query: { filter: 'all' } });
import type { z } from 'zod';
import { buildPath, type Endpoint } from '@chat/contracts';
import { ignoreBody, type ApiClient, type QueryValue } from './client';

type InOf<S> = S extends z.ZodType ? z.input<S> : never;
type OutOf<S> = S extends z.ZodType ? z.output<S> : undefined;

type CallArgs<E extends Endpoint> = (E['params'] extends z.ZodType
  ? { params: InOf<E['params']> }
  : { params?: undefined }) &
  (E['query'] extends z.ZodType ? { query?: InOf<E['query']> } : { query?: undefined }) &
  (E['body'] extends z.ZodType ? { body: InOf<E['body']> } : { body?: undefined }) & {
    signal?: AbortSignal;
    headers?: Record<string, string>;
  };

export interface Api {
  call<E extends Endpoint>(endpoint: E, args?: CallArgs<E>): Promise<OutOf<E['response']>>;
}

export const createApi = (client: ApiClient): Api => ({
  call: async <E extends Endpoint>(endpoint: E, args: CallArgs<E> = {} as CallArgs<E>) => {
    const params = endpoint.params
      ? (endpoint.params.parse(args.params) as Record<string, string>)
      : {};
    const body: unknown = endpoint.body ? endpoint.body.parse(args.body) : undefined;
    const schema = endpoint.response;
    const parse = schema ? (data: unknown) => schema.parse(data) : ignoreBody;
    return (await client.request(buildPath('', endpoint.path, params), parse, {
      method: endpoint.method,
      body,
      query: args.query as Record<string, QueryValue> | undefined,
      headers: args.headers,
      signal: args.signal,
      auth: endpoint.auth,
    })) as OutOf<E['response']>;
  },
});
