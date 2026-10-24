// Generates the three Grafana dashboards in ./dashboards.
//
//   node infra/grafana/build-dashboards.mjs
//
// One generator instead of hand-written JSON keeps every panel consistent
// (datasource, units, layout) and makes the PromQL easy to review in one place.
// App metric names come from the implementation plan; exporter metric names
// (pg_*, redis_*) match the exporter versions pinned in compose.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const datasource = { type: 'prometheus', uid: 'prometheus' };

// A graph panel. `queries` is a list of [promql, legend] pairs.
function graph(title, queries, unit = 'short') {
  return {
    type: 'timeseries',
    title,
    datasource,
    targets: queries.map(([expr, legendFormat], i) => ({
      refId: String.fromCharCode(65 + i),
      datasource,
      expr,
      legendFormat,
    })),
    fieldConfig: { defaults: { unit }, overrides: [] },
    options: { legend: { displayMode: 'list', placement: 'bottom' }, tooltip: { mode: 'multi' } },
    size: [12, 8],
  };
}

// A single big number.
function stat(title, expr, unit = 'short') {
  return {
    type: 'stat',
    title,
    datasource,
    targets: [{ refId: 'A', datasource, expr, instant: true }],
    fieldConfig: { defaults: { unit }, overrides: [] },
    options: { reduceOptions: { calcs: ['lastNotNull'] }, graphMode: 'none' },
    size: [6, 4],
  };
}

// p50 / p95 / p99 of a Prometheus histogram.
function percentiles(metric) {
  return [0.5, 0.95, 0.99].map((q) => [
    `histogram_quantile(${q}, sum by (le) (rate(${metric}_bucket[$__rate_interval])))`,
    `p${q * 100}`,
  ]);
}

// Place panels left to right, wrapping at Grafana's 24-column grid.
function layout(panels) {
  let x = 0;
  let y = 0;
  let rowHeight = 0;
  return panels.map(({ size: [w, h], ...panel }, i) => {
    if (x + w > 24) {
      x = 0;
      y += rowHeight;
      rowHeight = 0;
    }
    const placed = { id: i + 1, gridPos: { x, y, w, h }, ...panel };
    x += w;
    rowHeight = Math.max(rowHeight, h);
    return placed;
  });
}

function dashboard(uid, title, panels) {
  return {
    uid,
    title,
    tags: ['chat'],
    editable: false,
    schemaVersion: 39,
    refresh: '30s',
    time: { from: 'now-1h', to: 'now' },
    panels: layout(panels),
  };
}

const rate = (metric) => `sum(rate(${metric}[$__rate_interval]))`;

const dashboards = {
  'messaging-delivery.json': dashboard('chat-messaging-delivery', 'Flick / Messaging delivery', [
    stat('Accepted/s (5m)', 'sum(rate(messages_accepted_total[5m]))', 'ops'),
    stat('Delivered/s (5m)', 'sum(rate(messages_delivered_total[5m]))', 'ops'),
    stat('Outbox pending', 'max(outbox_pending)'),
    stat('Outbox oldest age', 'max(outbox_oldest_age_seconds)', 's'),
    // Accept = submit until the transaction commits.
    graph('Accept latency', percentiles('message_accept_latency_seconds'), 's'),
    // Dispatch = the message committed until the dispatcher emitted it to Socket.IO.
    graph('Dispatch latency', percentiles('message_dispatch_latency_seconds'), 's'),
    // Delivered counts recipients with a connected socket when the message was emitted.
    graph(
      'Messages accepted vs delivered',
      [
        [rate('messages_accepted_total'), 'accepted'],
        [rate('messages_delivered_total'), 'delivered'],
        [rate('messages_duplicate_total'), 'duplicate submissions'],
      ],
      'ops',
    ),
    graph('Outbox pending rows', [['max(outbox_pending)', 'pending']]),
    graph('Outbox oldest undispatched event', [['max(outbox_oldest_age_seconds)', 'oldest']], 's'),
  ]),

  'api-database.json': dashboard('chat-api-database', 'Flick / API and database health', [
    stat('API instances up', 'count(up{job="api"} == 1) or vector(0)'),
    stat(
      'HTTP 5xx ratio (5m)',
      'sum(rate(http_request_duration_seconds_count{status=~"5.."}[5m])) / sum(rate(http_request_duration_seconds_count[5m]))',
      'percentunit',
    ),
    stat('Pool in use (max)', 'max(db_pool_in_use)'),
    stat(
      'Query p99 (5m)',
      'histogram_quantile(0.99, sum by (le) (rate(db_query_duration_seconds_bucket[5m])))',
      's',
    ),
    graph(
      'HTTP requests by status',
      [
        [
          'sum by (status) (rate(http_request_duration_seconds_count[$__rate_interval]))',
          '{{status}}',
        ],
      ],
      'reqps',
    ),
    graph('HTTP latency', percentiles('http_request_duration_seconds'), 's'),
    graph(
      'Event-loop lag',
      [['max by (job, instance) (eventloop_lag_seconds)', '{{job}} {{instance}}']],
      's',
    ),
    graph('Dependencies up (1 = up)', [['up{job=~"postgres|redis|minio"}', '{{job}}']]),
    graph('Query latency (all queries)', percentiles('db_query_duration_seconds'), 's'),
    graph('Pool connections in use', [['db_pool_in_use', '{{job}} {{instance}}']]),
    // Rollbacks include the intentional rollback on a duplicate submission.
    graph(
      'Transactions',
      [
        ['sum(rate(pg_stat_database_xact_commit{datname="chat"}[$__rate_interval]))', 'commits'],
        [
          'sum(rate(pg_stat_database_xact_rollback{datname="chat"}[$__rate_interval]))',
          'rollbacks',
        ],
      ],
      'ops',
    ),
  ]),

  'connections-presence.json': dashboard(
    'chat-connections-presence',
    'Flick / Connections and presence',
    [
      stat('Active WebSockets', 'sum(ws_connections_active)'),
      stat('Redis memory used', 'max(redis_memory_used_bytes)', 'bytes'),
      // An even split across api replicas shows the load balancer is working.
      graph('Active connections by instance', [
        ['sum by (instance) (ws_connections_active)', '{{instance}}'],
      ]),
      graph(
        'Connect attempts by result',
        [['sum by (result) (rate(ws_connect_attempts_total[$__rate_interval]))', '{{result}}']],
        'ops',
      ),
      graph('Redis connected clients', [['sum(redis_connected_clients)', 'clients']]),
    ],
  ),
};

const outDir = join(dirname(fileURLToPath(import.meta.url)), 'dashboards');
mkdirSync(outDir, { recursive: true });
for (const [file, dash] of Object.entries(dashboards)) {
  writeFileSync(join(outDir, file), `${JSON.stringify(dash, null, 2)}\n`);
  console.log(`wrote ${file}`);
}
