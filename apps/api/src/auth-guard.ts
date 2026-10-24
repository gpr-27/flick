// The one thing every protected route needs from authentication: who is calling.
// The auth module builds the real `authenticate` (it checks the access token). Other modules just use it:
//   app.get('/me', { preHandler: app.authenticate }, (req) => req.auth!.userId)
// Tests pass a fake through `buildApp({ ..., authenticate })`.
import type { FastifyReply, FastifyRequest } from 'fastify';

export interface AuthContext {
  userId: string;
  deviceId: string;
}

/** A preHandler: on success it sets `req.auth`; on failure it sends a 401 and stops. */
export type Authenticate = (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

declare module 'fastify' {
  interface FastifyRequest {
    auth?: AuthContext;
  }
  interface FastifyInstance {
    authenticate: Authenticate;
  }
}

/** Default until a real authenticate is passed in: nobody is logged in. */
export const rejectAll: Authenticate = async (req, reply) => {
  await reply.code(401).send({ error: { message: 'Unauthorized', requestId: req.id } });
};
