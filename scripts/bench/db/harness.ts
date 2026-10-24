// The measuring tools: run one scenario at a fixed concurrency and report latency and throughput.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type pg from 'pg';

const run = promisify(execFile);

export interface Result {
  scenario: string;
  concurrency: number;
  rep: number;
  iterations: number;
  seconds: number;
  qps: number;
  avg_ms: number;
  p50_ms: number;
  p95_ms: number;
  p99_ms: number;
  max_ms: number;
  errors: number;
  first_error: string | null;
  pool_busy_avg: number;
  pool_busy_max: number;
  pool_waiting_max: number;
  pg_cpu_avg_pct: number | null;
  pg_cpu_max_pct: number | null;
  pg_mem_max_mib: number | null;
}

export interface Options {
  scenario: string;
  concurrency: number;
  rep: number;
  pool: pg.Pool;
  sampler: DockerSampler;
  // One operation. `i` counts up across all workers, so an op can rotate through its fixtures.
  op: (i: number) => Promise<void>;
  warmup: number;
  minIterations: number;
  minSeconds: number;
  maxSeconds: number;
}

function percentile(sorted: Float64Array, p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
}

// Runs `concurrency` workers that call `op` back to back. The measured phase ends when both
// minIterations and minSeconds are reached, or at maxSeconds, whichever happens first.
export async function measure(o: Options): Promise<Result> {
  let counter = 0;
  let errors = 0;
  let firstError: string | null = null;
  const worker = async (done: () => boolean, record?: (ms: number) => void) => {
    while (!done()) {
      const i = counter++;
      const t0 = process.hrtime.bigint();
      try {
        await o.op(i);
      } catch (err) {
        errors++;
        firstError ??= err instanceof Error ? err.message : String(err);
      }
      record?.(Number(process.hrtime.bigint() - t0) / 1e6);
    }
  };

  // Warm-up: plans, connections and caches settle. Not recorded.
  const warmEnd = o.warmup;
  await Promise.all(Array.from({ length: o.concurrency }, () => worker(() => counter >= warmEnd)));
  errors = 0;
  firstError = null;

  const latencies: number[] = [];
  const poolBusy: number[] = [];
  let poolWaitingMax = 0;
  const timer = setInterval(() => {
    poolBusy.push(o.pool.totalCount - o.pool.idleCount);
    poolWaitingMax = Math.max(poolWaitingMax, o.pool.waitingCount);
  }, 20);

  const startedWall = Date.now();
  const start = process.hrtime.bigint();
  const elapsed = () => Number(process.hrtime.bigint() - start) / 1e9;
  const done = () =>
    elapsed() >= o.maxSeconds || (latencies.length >= o.minIterations && elapsed() >= o.minSeconds);
  await Promise.all(
    Array.from({ length: o.concurrency }, () => worker(done, (ms) => latencies.push(ms))),
  );
  const seconds = elapsed();
  clearInterval(timer);

  const sorted = Float64Array.from(latencies).sort();
  const sum = latencies.reduce((a, b) => a + b, 0);
  const cpu = o.sampler.between(startedWall, Date.now());
  return {
    scenario: o.scenario,
    concurrency: o.concurrency,
    rep: o.rep,
    iterations: latencies.length,
    seconds,
    qps: latencies.length / seconds,
    avg_ms: sum / latencies.length,
    p50_ms: percentile(sorted, 50),
    p95_ms: percentile(sorted, 95),
    p99_ms: percentile(sorted, 99),
    max_ms: sorted[sorted.length - 1] ?? 0,
    errors,
    first_error: firstError,
    pool_busy_avg: poolBusy.reduce((a, b) => a + b, 0) / Math.max(1, poolBusy.length),
    pool_busy_max: poolBusy.reduce((a, b) => Math.max(a, b), 0),
    pool_waiting_max: poolWaitingMax,
    pg_cpu_avg_pct: cpu.length ? cpu.reduce((a, s) => a + s.cpu, 0) / cpu.length : null,
    pg_cpu_max_pct: cpu.length ? Math.max(...cpu.map((s) => s.cpu)) : null,
    pg_mem_max_mib: cpu.length ? Math.max(...cpu.map((s) => s.memMiB)) : null,
  };
}

// Polls `docker stats` for the Postgres container in the background. CPU is a percentage of ONE
// core of the Colima VM (so 300 means three cores busy).
export class DockerSampler {
  private samples: { t: number; cpu: number; memMiB: number }[] = [];
  private running = false;
  private loop: Promise<void> = Promise.resolve();

  constructor(private container: string) {}

  start(): void {
    this.running = true;
    this.loop = this.poll();
  }

  async stop(): Promise<void> {
    this.running = false;
    await this.loop;
  }

  between(from: number, to: number) {
    return this.samples.filter((s) => s.t >= from && s.t <= to);
  }

  private async poll(): Promise<void> {
    while (this.running) {
      try {
        const { stdout } = await run('docker', [
          'stats',
          '--no-stream',
          '--format',
          '{{.CPUPerc}}|{{.MemUsage}}',
          this.container,
        ]);
        const [cpu, mem] = stdout.trim().split('|');
        const memMatch = /([\d.]+)(MiB|GiB)/.exec(mem ?? '');
        if (cpu && memMatch) {
          const value = Number(memMatch[1]) * (memMatch[2] === 'GiB' ? 1024 : 1);
          this.samples.push({ t: Date.now(), cpu: parseFloat(cpu), memMiB: value });
        }
      } catch {
        // A failed sample is just a missing sample.
      }
    }
  }
}

export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
