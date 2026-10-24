import { createServer } from 'node:http';
import { runChecks, type DependencyCheck } from '@chat/shared';
import { registry } from './metrics.js';

/** Serves GET /metrics, /health/live and /health/ready on the worker's metrics port. */
export function createOpsServer(checks: DependencyCheck[], isShuttingDown: () => boolean) {
  return createServer((req, res) => {
    const reply = (status: number, body: string, type = 'application/json') => {
      res.writeHead(status, { 'content-type': type });
      res.end(body);
    };

    const handle = async () => {
      if (req.url === '/metrics') return reply(200, await registry.metrics(), registry.contentType);
      if (req.url === '/health/live') return reply(200, JSON.stringify({ status: 'ok' }));
      if (req.url === '/health/ready') {
        const report = await runChecks(checks);
        const ready = report.status === 'ready' && !isShuttingDown();
        return reply(
          ready ? 200 : 503,
          JSON.stringify({ ...report, shuttingDown: isShuttingDown() }),
        );
      }
      reply(404, JSON.stringify({ error: { message: 'Not found' } }));
    };
    handle().catch(() => reply(500, JSON.stringify({ error: { message: 'Internal error' } })));
  });
}
