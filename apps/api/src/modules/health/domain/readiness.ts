import type { ReadinessReport } from '@chat/shared';

/**
 * HTTP status for a readiness report. "degraded" stays 200 so the load balancer keeps sending
 * traffic (the core chat still works); only a critical failure or shutdown returns 503.
 */
export function readinessStatusCode(report: ReadinessReport, shuttingDown: boolean): 200 | 503 {
  return shuttingDown || report.status === 'not_ready' ? 503 : 200;
}
