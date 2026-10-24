import { runChecks } from '@chat/shared';
import type { FastifyInstance } from 'fastify';
import type { AppDeps } from '../../../app.js';
import { readinessStatusCode } from '../domain/readiness.js';

export function healthRoutes(app: FastifyInstance, deps: AppDeps): void {
  // Liveness never checks dependencies: restarting the API would not fix a database outage.
  app.get('/health/live', () => ({ status: 'ok' }));

  app.get('/health/ready', async (_req, reply) => {
    const report = await runChecks(deps.checks);
    const shuttingDown = deps.isShuttingDown();
    return reply
      .code(readinessStatusCode(report, shuttingDown))
      .send({ ...report, status: shuttingDown ? 'not_ready' : report.status, shuttingDown });
  });
}
