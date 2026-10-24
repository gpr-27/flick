import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

// Metric names match the dashboards in infra/grafana. Labels only take a small, fixed set of
// values (route templates, status codes, scopes), never user, conversation or message IDs,
// because every distinct label value creates a new time series in Prometheus.

export const registry = new Registry();
registry.setDefaultLabels({ service: 'api' });
collectDefaultMetrics({ register: registry });

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'HTTP request duration by route template and status code.',
  labelNames: ['route', 'status'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [registry],
});

// Database: a Kysely log hook times every query; the pool gauge is read at scrape time.
export const dbQueryDuration = new Histogram({
  name: 'db_query_duration_seconds',
  help: 'Duration of each SQL query.',
  buckets: [0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1],
  registers: [registry],
});

let poolInUse = () => 0;
/** db.ts tells us how to read the pool, so the gauge is up to date at every scrape. */
export function watchDbPool(read: () => number): void {
  poolInUse = read;
}
new Gauge({
  name: 'db_pool_in_use',
  help: 'Database connections checked out of the pool right now.',
  registers: [registry],
  collect() {
    this.set(poolInUse());
  },
});

export const rateLimitRejections = new Counter({
  name: 'rate_limit_rejections_total',
  help: 'Requests rejected by a rate limiter.',
  labelNames: ['scope'],
  registers: [registry],
});

// WebSocket gateway.
export const wsConnectionsActive = new Gauge({
  name: 'ws_connections_active',
  help: 'Open WebSocket connections on this API replica.',
  registers: [registry],
});

export const wsConnectAttempts = new Counter({
  name: 'ws_connect_attempts_total',
  help: 'WebSocket connections by auth outcome (ok, bad_auth).',
  labelNames: ['result'],
  registers: [registry],
});

export const messagesDelivered = new Counter({
  name: 'messages_delivered_total',
  help: 'Recipients with a connected socket that a new message was emitted to.',
  registers: [registry],
});

export const messageDispatchLatency = new Histogram({
  name: 'message_dispatch_latency_seconds',
  help: 'Time from the message commit until the dispatcher emitted it to Socket.IO.',
  buckets: [0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
  registers: [registry],
});

export const outboxPending = new Gauge({
  name: 'outbox_pending',
  help: 'Outbox rows not yet dispatched.',
  registers: [registry],
});

export const outboxOldestAge = new Gauge({
  name: 'outbox_oldest_age_seconds',
  help: 'Age of the oldest outbox row not yet dispatched.',
  registers: [registry],
});

export const messagesAccepted = new Counter({
  name: 'messages_accepted_total',
  help: 'New messages committed (a retried send is not counted here).',
  registers: [registry],
});

export const messagesDuplicate = new Counter({
  name: 'messages_duplicate_total',
  help: 'Sends recognised as retries of a message that was already accepted.',
  registers: [registry],
});

export const messageAcceptLatency = new Histogram({
  name: 'message_accept_latency_seconds',
  help: 'Time from receiving a send until its transaction committed.',
  buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5],
  registers: [registry],
});

// p99 event-loop delay since the last scrape: if this grows, the process is CPU-bound and
// every request and WebSocket frame on it is delayed.
const loopDelay = monitorEventLoopDelay();
loopDelay.enable();
new Gauge({
  name: 'eventloop_lag_seconds',
  help: 'p99 event-loop delay since the previous scrape.',
  registers: [registry],
  collect() {
    this.set(loopDelay.percentile(99) / 1e9);
    loopDelay.reset();
  },
});

// AI provider attempts (one per provider call, including skipped and failed ones).
export const aiAttempts = new Counter({
  name: 'ai_attempts_total',
  help: 'AI provider attempts by provider and result (success, rate_limited, timeout, ...).',
  labelNames: ['provider', 'result'],
  registers: [registry],
});

export const aiAttemptDuration = new Histogram({
  name: 'ai_attempt_duration_seconds',
  help: 'Time to the full answer (or the first token for streams) of one AI provider attempt.',
  labelNames: ['provider', 'result'],
  buckets: [0.25, 0.5, 1, 2, 5, 10, 25, 60],
  registers: [registry],
});

export const conversationChanges = new Counter({
  name: 'conversation_changes_total',
  help: 'Group and membership changes by action (group_created, members_added, member_removed, left, role_changed, updated).',
  labelNames: ['action'],
  registers: [registry],
});

export const inviteJoins = new Counter({
  name: 'invite_joins_total',
  help: 'Uses of invite links by result (joined, requested).',
  labelNames: ['result'],
  registers: [registry],
});
