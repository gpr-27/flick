/**
 * Starts a throwaway PostgreSQL 17 container on a random free host port for the test run, or
 * uses an existing server when TEST_DATABASE_URL is set (CI service containers). Each test file
 * then creates its own database on that server (see ./helpers.ts), so files run in parallel
 * without sharing state.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import pg from 'pg';
import type { TestProject } from 'vitest/node';

const exec = promisify(execFile);
const IMAGE = 'postgres:17-alpine';

declare module 'vitest' {
  export interface ProvidedContext {
    pgAdminUrl: string;
  }
}

async function waitForPostgres(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    const client = new pg.Client({ connectionString: url });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return;
    } catch (err) {
      lastError = err;
      await client.end().catch(() => undefined);
      await new Promise((r) => setTimeout(r, 250));
    }
  }
  throw new Error(`Postgres did not become ready: ${String(lastError)}`);
}

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const external = process.env.TEST_DATABASE_URL;
  if (external) {
    await waitForPostgres(external, 30_000);
    project.provide('pgAdminUrl', external);
    return () => Promise.resolve();
  }

  const name = `chat-db-test-${process.pid}-${Date.now()}`;
  const { stdout } = await exec('docker', [
    'run',
    '-d',
    '--rm',
    '--name',
    name,
    '-e',
    'POSTGRES_USER=test',
    '-e',
    'POSTGRES_PASSWORD=test',
    '-e',
    'POSTGRES_DB=postgres',
    // Random free host port bound to loopback only: never clashes with parallel agents/CI jobs.
    '-p',
    '127.0.0.1::5432',
    '--tmpfs',
    '/var/lib/postgresql/data',
    IMAGE,
    '-c',
    'fsync=off',
    '-c',
    'synchronous_commit=off',
    '-c',
    'full_page_writes=off',
    '-c',
    'max_connections=300',
  ]);
  const containerId = stdout.trim();
  const teardown = async () => {
    await exec('docker', ['rm', '-f', containerId]).catch(() => undefined);
  };
  try {
    const port = await (async () => {
      for (let i = 0; i < 40; i++) {
        const { stdout: out } = await exec('docker', ['port', containerId, '5432/tcp']).catch(
          () => ({ stdout: '' }),
        );
        const match = /:(\d+)\s*$/m.exec(out.trim());
        if (match?.[1]) return match[1];
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error('could not determine mapped Postgres port');
    })();
    const url = `postgres://test:test@127.0.0.1:${port}/postgres`;
    await waitForPostgres(url, 60_000);
    project.provide('pgAdminUrl', url);
    return teardown;
  } catch (err) {
    await teardown();
    throw err;
  }
}
