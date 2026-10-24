import { ENDPOINTS } from '@chat/contracts';
import type { FastifyInstance } from 'fastify';
import type { z } from 'zod';
import type { AppDeps } from '../../../app.js';
import { ApiError, registerErrorHandler } from '../../conversations/http/errors.js';
import { turnCredentials } from '../domain/turn.js';
import { listCalls } from '../repo/call-log.js';
import { joinByCallLink, joinGroupCall } from '../repo/group-call.js';
import { createCallLink, getCallLink, revokeCallLink } from '../repo/links.js';

const E = ENDPOINTS.calls;

function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new ApiError(
      'VALIDATION_FAILED',
      `${issue?.path.join('.') || 'request'}: ${issue?.message}`,
    );
  }
  return result.data;
}

// Trying link codes is a guessing attack, so redeeming and looking up are limited per IP.
// (The codes are 192 random bits, so this limit is cheap insurance, not the main defence.)
const linkLimit = { rateLimit: { max: 20, timeWindow: 60_000 } };

export function callRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;

  void app.register((scope) => {
    registerErrorHandler(scope);
    const auth = { preHandler: scope.authenticate };

    scope.get(E.turn.path, auth, (req) => turnCredentials(config, req.auth!.userId));

    scope.get(E.log.path, auth, (req) =>
      listCalls(db, req.auth!.userId, parse(E.log.query, req.query)),
    );

    // Either a conversation_id (members) or a call_link code (anyone with the link).
    scope.post(E.livekitToken.path, { ...auth, config: linkLimit }, (req) => {
      const body = parse(E.livekitToken.body, req.body);
      const userId = req.auth!.userId;
      return body.call_link
        ? joinByCallLink(db, config, userId, body.call_link)
        : joinGroupCall(db, config, userId, body.conversation_id!, body.media);
    });

    scope.post(E.createLink.path, auth, async (req, reply) => {
      const body = parse(E.createLink.body, req.body);
      const link = await createCallLink(db, req.auth!.userId, {
        conversationId: body.conversation_id,
        media: body.media,
        expiresInS: body.expires_in_s,
        maxUses: body.max_uses,
      });
      return reply.code(201).send(link);
    });

    scope.get(E.getLink.path, { ...auth, config: linkLimit }, (req) =>
      getCallLink(db, parse(E.getLink.params, req.params).code),
    );

    scope.delete(E.revokeLink.path, auth, async (req, reply) => {
      await revokeCallLink(db, req.auth!.userId, parse(E.revokeLink.params, req.params).code);
      return reply.code(204).send();
    });
  });
}
