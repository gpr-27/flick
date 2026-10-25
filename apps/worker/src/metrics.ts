import { monitorEventLoopDelay } from 'node:perf_hooks';
import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

// Small fixed label sets only.

export const registry = new Registry();
registry.setDefaultLabels({ service: 'worker' });
collectDefaultMetrics({ register: registry });

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

export const notificationsTotal = new Counter({
  name: 'notifications_total',
  help: 'Notify jobs by outcome: sent, skipped_online, skipped_muted, skipped_gone.',
  labelNames: ['result'],
  registers: [registry],
});
export const callPushTotal = new Counter({
  name: 'call_push_total',
  help: 'Call push jobs by kind (ring, cancel) and outcome.',
  labelNames: ['kind', 'result'],
  registers: [registry],
});
export const reminderPushTotal = new Counter({
  name: 'reminder_push_total',
  help: 'Reminder push jobs by outcome: sent, simulated, skipped.',
  labelNames: ['result'],
  registers: [registry],
});
export const messagesExpiredTotal = new Counter({
  name: 'messages_expired_total',
  help: 'Messages turned into tombstones by the expire-messages job.',
  registers: [registry],
});
export const uploadsSweptTotal = new Counter({
  name: 'uploads_swept_total',
  help: 'Abandoned uploads removed by the sweep job.',
  registers: [registry],
});
