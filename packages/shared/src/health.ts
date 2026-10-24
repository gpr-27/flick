import { withTimeout } from './time.js';

/**
 * A readiness check for one dependency. `critical` means the process cannot do its job without
 * it (the API without Postgres). A non-critical dependency only breaks one feature (the API
 * without object storage cannot take uploads), so the process stays ready but "degraded".
 */
export interface DependencyCheck {
  name: string;
  critical: boolean;
  check: () => Promise<void>; // rejects with a message that says what to fix
}

export interface CheckResult {
  name: string;
  critical: boolean;
  ok: boolean;
  error?: string;
}

export type ReadinessStatus = 'ready' | 'degraded' | 'not_ready';

export interface ReadinessReport {
  status: ReadinessStatus;
  checks: CheckResult[];
}

/** Runs all checks in parallel; each one fails if it takes longer than timeoutMs. */
export async function runChecks(
  checks: DependencyCheck[],
  timeoutMs = 2_000,
): Promise<ReadinessReport> {
  const results = await Promise.all(
    checks.map(async ({ name, critical, check }): Promise<CheckResult> => {
      try {
        await withTimeout(check(), timeoutMs, `${name} did not answer within ${timeoutMs}ms`);
        return { name, critical, ok: true };
      } catch (error) {
        return { name, critical, ok: false, error: (error as Error).message };
      }
    }),
  );
  const failed = results.filter((r) => !r.ok);
  const status: ReadinessStatus = failed.some((r) => r.critical)
    ? 'not_ready'
    : failed.length > 0
      ? 'degraded'
      : 'ready';
  return { status, checks: results };
}
