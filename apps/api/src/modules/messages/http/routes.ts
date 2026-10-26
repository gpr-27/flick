import { ENDPOINTS, LIMITS, type Endpoint } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AuthContext } from '../../../auth-guard.js';
import type { MessageDeps } from '../deps.js';
import { deleteMessage, editMessage, reactToMessage, removeReaction } from '../domain/changes.js';
import {
  getPollTally,
  listPins,
  listStarred,
  openViewOnce,
  pinMessage,
  starMessage,
  unpinMessage,
  unstarMessage,
  votePoll,
} from '../domain/extras.js';
import { getHistory } from '../domain/history.js';
import { acknowledgeDelivered, acknowledgeRead, getMessageInfo } from '../domain/receipts.js';
import { search } from '../domain/search.js';
import { sendMessage } from '../domain/send.js';
import { syncConversation, syncMany } from '../domain/sync.js';
import { toApiError } from '../errors.js';

const E = ENDPOINTS.messages;

// What a handler receives: the caller plus params, query and body already parsed by the
// endpoint's own zod schemas (the same ones the web client uses).
type Parsed<D, K extends string> =
  D extends Record<K, infer S> ? (S extends z.ZodType ? z.output<S> : never) : undefined;
interface Call<D> {
  auth: AuthContext;
  params: Parsed<D, 'params'>;
  query: Parsed<D, 'query'>;
  body: Parsed<D, 'body'>;
}

const SyncQuery = z.object({
  after_seq: z.coerce.number().int().min(0).default(0),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.MAX_SYNC_PAGE_SIZE)
    .default(LIMITS.DEFAULT_SYNC_PAGE_SIZE),
});

export function messageRoutes(app: FastifyInstance, deps: { db: MessageDeps['db'] }): void {
  // Registered in its own scope so the error handler below covers only these routes.
  void app.register((scope, _opts, done) => {
    scope.setErrorHandler((error, req, reply) => {
      const apiError = toApiError(error);
      if (apiError.code === 'INTERNAL') req.log.error(error);
      return reply.code(apiError.httpStatus).send({ error: apiError.toBody() });
    });

    function route<D extends Endpoint>(def: D, handler: (call: Call<D>) => Promise<unknown>) {
      scope.route({
        method: def.method,
        url: def.path,
        preHandler: scope.authenticate,
        handler: async (req, reply) => {
          const call = {
            auth: req.auth!,
            params: def.params?.parse(req.params),
            query: def.query?.parse(req.query),
            body: def.body?.parse(req.body),
          } as Call<D>;
          const result = await handler(call);
          return def.response === null ? reply.code(204).send() : reply.send(result);
        },
      });
    }

    route(E.send, ({ auth, params, body }) =>
      sendMessage(deps, auth, { conversation_id: params.conversation_id, ...body }),
    );

    route(E.history, ({ auth, params, query }) =>
      getHistory(deps, auth, {
        conversationId: params.conversation_id,
        beforeSeq: query.before_seq,
        limit: query.limit,
      }),
    );

    route(E.sync, ({ auth, body }) => syncMany(deps, auth, body));

    route(E.edit, ({ auth, params, body }) =>
      editMessage(deps, auth, {
        conversationId: params.conversation_id,
        messageId: params.message_id,
        content: body.content,
      }),
    );

    route(E.delete, ({ auth, params, query }) =>
      deleteMessage(deps, auth, {
        conversationId: params.conversation_id,
        messageId: params.message_id,
        scope: query.for,
      }),
    );

    route(E.react, ({ auth, params, body }) =>
      reactToMessage(deps, auth, {
        conversationId: params.conversation_id,
        messageId: params.message_id,
        emoji: body.emoji,
      }),
    );

    route(E.unreact, ({ auth, params }) =>
      removeReaction(deps, auth, {
        conversationId: params.conversation_id,
        messageId: params.message_id,
      }),
    );

    const target = (params: { conversation_id: string; message_id: string }) => ({
      conversationId: params.conversation_id,
      messageId: params.message_id,
    });
    route(E.star, ({ auth, params }) => starMessage(deps, auth, target(params)));
    route(E.unstar, ({ auth, params }) => unstarMessage(deps, auth, target(params)));
    route(E.starred, ({ auth, query }) => listStarred(deps, auth, query));

    route(E.pin, ({ auth, params, body }) =>
      pinMessage(deps, auth, {
        conversationId: params.conversation_id,
        messageId: body.message_id,
      }),
    );
    route(E.unpin, ({ auth, params }) => unpinMessage(deps, auth, target(params)));
    route(E.pins, ({ auth, params }) => listPins(deps, auth, params.conversation_id));

    route(E.openViewOnce, ({ auth, params }) => openViewOnce(deps, auth, target(params)));
    route(E.info, ({ auth, params }) => getMessageInfo(deps, auth, target(params)));

    route(E.search, ({ auth, query }) =>
      search(deps, auth, {
        q: query.q,
        conversationId: query.conversation_id,
        senderId: query.sender_id,
        from: query.from,
        to: query.to,
        media: query.media,
        starred: query.starred === 'true',
        pinned: query.pinned === 'true',
        cursor: query.cursor,
        limit: query.limit,
      }),
    );

    route(E.delivered, ({ auth, body }) =>
      acknowledgeDelivered(
        deps,
        auth,
        body.acks.map((a) => ({ conversationId: a.conversation_id, seq: a.seq })),
      ),
    );
    route(E.read, ({ auth, params, body }) =>
      acknowledgeRead(deps, auth, { conversationId: params.conversation_id, seq: body.seq }),
    );

    // Not in the shared endpoint list: sync for a single conversation, easy to call by hand.
    scope.get(
      '/conversations/:conversation_id/sync',
      { preHandler: scope.authenticate },
      async (req) => {
        const { conversation_id } = ENDPOINTS.messages.history.params.parse(req.params);
        const query = SyncQuery.parse(req.query);
        const page = await syncConversation(deps, req.auth!, {
          conversationId: conversation_id,
          afterSeq: query.after_seq,
          limit: query.limit,
        });
        return { events: page.events, has_more: page.hasMore, last_seq: page.lastSeq };
      },
    );

    scope.post(
      '/conversations/:conversation_id/polls/:message_id/vote',
      { preHandler: scope.authenticate },
      async (req) => {
        const params = ENDPOINTS.messages.getPoll.params.parse(req.params);
        const body = ENDPOINTS.messages.votePoll.body.parse(req.body);
        return votePoll(deps, req.auth!, { ...target(params), optionIndexes: body.option_indexes });
      },
    );

    scope.get(
      '/conversations/:conversation_id/polls/:message_id',
      { preHandler: scope.authenticate },
      async (req) =>
        getPollTally(deps, req.auth!, target(ENDPOINTS.messages.getPoll.params.parse(req.params))),
    );

    done();
  });
}
