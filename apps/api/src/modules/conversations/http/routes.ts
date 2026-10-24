import { ENDPOINTS, type Endpoint } from '@chat/contracts';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { z } from 'zod';
import type { AppDeps } from '../../../app.js';
import { conversationChanges, inviteJoins } from '../../../metrics.js';
import * as groups from '../repo/groups.js';
import * as invites from '../repo/invites.js';
import { updatePrefs } from '../repo/prefs.js';
import { requireActiveMember } from '../repo/core.js';
import {
  getConversation,
  getMember,
  listConversations,
  listMembers,
  mentionCandidates,
} from '../repo/summaries.js';
import { ApiError, registerErrorHandler } from './errors.js';

const E = ENDPOINTS.conversations;

type Parsed<S> = S extends z.ZodType ? z.output<S> : undefined;
interface Ctx<T extends Endpoint> {
  userId: string;
  params: Parsed<T['params']>;
  query: Parsed<T['query']>;
  body: Parsed<T['body']>;
  reply: FastifyReply;
}

function parse(schema: z.ZodType | undefined, data: unknown): unknown {
  if (!schema) return undefined;
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

export function conversationRoutes(app: FastifyInstance, deps: AppDeps): void {
  const { db, config } = deps;

  // Registered as a child plugin so the contract-style error handler covers only these routes.
  void app.register((scope) => {
    registerErrorHandler(scope);

    // Paths, methods and request/response shapes come from @chat/contracts; each route is
    // behind app.authenticate and validates params, query and body with the contract's schemas.
    function route<T extends Endpoint>(endpoint: T, handler: (ctx: Ctx<T>) => Promise<unknown>) {
      scope.route({
        method: endpoint.method,
        url: endpoint.path,
        preHandler: scope.authenticate,
        handler: async (req, reply) => {
          const result = await handler({
            userId: req.auth!.userId,
            params: parse(endpoint.params, req.params) as Ctx<T>['params'],
            query: parse(endpoint.query, req.query) as Ctx<T>['query'],
            body: parse(endpoint.body, req.body) as Ctx<T>['body'],
            reply,
          });
          return endpoint.response === null ? reply.code(204).send() : result;
        },
      });
    }

    const summary = (userId: string, id: string) => getConversation(db, config, userId, id);

    route(E.list, ({ userId, query }) => listConversations(db, config, userId, query));
    route(E.get, ({ userId, params }) => summary(userId, params.conversation_id));

    route(E.createDirect, async ({ userId, body }) => {
      const id = await groups.openDirect(db, userId, body.user_id);
      return summary(userId, id);
    });

    route(E.openSaved, async ({ userId }) => {
      const id = await groups.openSaved(db, userId);
      return summary(userId, id);
    });

    route(E.createGroup, async ({ userId, body, reply }) => {
      const id = await groups.createGroup(db, userId, {
        title: body.title,
        memberIds: body.member_ids,
        avatarAttachmentId: body.avatar_attachment_id,
      });
      conversationChanges.inc({ action: 'group_created' });
      void reply.code(201);
      return summary(userId, id);
    });

    route(E.update, async ({ userId, params, body }) => {
      await groups.updateConversation(db, userId, params.conversation_id, {
        title: body.title,
        avatarAttachmentId: body.avatar_attachment_id,
        settings: body.settings,
      });
      conversationChanges.inc({ action: 'updated' });
      return summary(userId, params.conversation_id);
    });

    route(E.updatePrefs, ({ userId, params, body }) =>
      updatePrefs(db, userId, params.conversation_id, body),
    );

    route(E.leave, async ({ userId, params }) => {
      await groups.leaveGroup(db, userId, params.conversation_id);
      conversationChanges.inc({ action: 'left' });
    });

    // ------------------------------------------------------------- members
    route(E.members, async ({ userId, params, query }) => {
      await requireActiveMember(db, params.conversation_id, userId);
      return listMembers(db, config, params.conversation_id, query);
    });

    route(E.addMembers, async ({ userId, params, body }) => {
      const result = await groups.addMembers(db, userId, params.conversation_id, body.user_ids);
      conversationChanges.inc({ action: 'members_added' }, result.added.length);
      return result;
    });

    route(E.removeMember, async ({ userId, params }) => {
      await groups.removeMember(db, userId, params.conversation_id, params.user_id);
      conversationChanges.inc({ action: 'member_removed' });
    });

    route(E.setRole, async ({ userId, params, body }) => {
      await groups.setRole(db, userId, params.conversation_id, params.user_id, body.role);
      conversationChanges.inc({ action: 'role_changed' });
      return getMember(db, config, params.conversation_id, params.user_id);
    });

    route(E.mentionCandidates, async ({ userId, params, query }) => {
      await requireActiveMember(db, params.conversation_id, userId);
      return {
        items: await mentionCandidates(db, config, params.conversation_id, userId, query),
      };
    });

    // ------------------------------------------------------------- invites
    route(E.createInvite, async ({ userId, params, body, reply }) => {
      void reply.code(201);
      return invites.createInvite(db, userId, params.conversation_id, {
        expiresInS: body.expires_in_s,
        maxUses: body.max_uses,
      });
    });
    route(E.previewInvite, ({ params }) => invites.previewInvite(db, config, params.code));
    route(E.joinInvite, async ({ userId, params }) => {
      const result = await invites.joinByInvite(db, userId, params.code);
      inviteJoins.inc({ result: result.status });
      return result;
    });
    route(E.revokeInvite, ({ userId, params }) => invites.revokeInvite(db, userId, params.code));

    route(E.joinRequests, ({ userId, params, query }) =>
      invites.listJoinRequests(db, config, userId, params.conversation_id, query),
    );
    route(E.decideJoinRequest, ({ userId, params, body }) =>
      invites.decideJoinRequest(
        db,
        userId,
        params.conversation_id,
        params.request_id,
        body.approve,
      ),
    );
  });
}
