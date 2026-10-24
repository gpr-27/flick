// Render's free plan has no background workers, so the API service also runs the worker's jobs.
// This starts both as child processes and exits as soon as either stops: Render then restarts
// the whole service, so neither one can die quietly.
import { spawn } from 'node:child_process';

const children = [
  spawn('node', ['apps/api/dist/main.js'], { stdio: 'inherit' }),
  // The worker's own HTTP port is internal. Render only exposes the API's PORT.
  spawn('node', ['apps/worker/dist/main.js'], {
    stdio: 'inherit',
    env: { ...process.env, WORKER_METRICS_PORT: '9465' },
  }),
];

let exiting = false;
function stopAll(code) {
  if (exiting) return;
  exiting = true;
  for (const child of children) child.kill('SIGTERM');
  setTimeout(() => process.exit(code), 25_000).unref(); // a running job may need time to finish
}
for (const child of children) child.on('exit', (code) => stopAll(code ?? 1));
process.on('SIGTERM', () => stopAll(0));
process.on('SIGINT', () => stopAll(0));
