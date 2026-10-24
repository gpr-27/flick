// Starts a throwaway copy of the whole app for browser tests and tears it down again.
//
//   Postgres 17, Redis 7, MinIO   docker run, random free ports, names start with "chat-e2e-"
//                                 (or your own, if DATABASE_URL and REDIS_URL are set: CI does that)
//   migrations                    npm run migrate
//   API (E2E_FAKE_AUTH=true)      tsx, from source
//   worker                        tsx, from source
//   web                           built with VITE_E2E_FAKE_AUTH=true, served by `vite preview`
//
// Everything listens on 127.0.0.1 only. Logs go to tests/e2e/.logs/ so a failing run can be read afterwards.
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createWriteStream, mkdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const logDir = join(root, 'tests', 'e2e', '.logs');
const webDist = join(root, 'tests', 'e2e', '.web-dist');
const bin = (name) => join(root, 'node_modules', '.bin', name);

const MINIO_USER = 'e2e-minio';
const MINIO_PASSWORD = 'e2e-minio-secret';
const BUCKET = 'chat-e2e';

/** Ask the OS for a free port. */
const freePort = () =>
  new Promise((ok, fail) => {
    const server = createServer();
    server.once('error', fail);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => {
        ok(port);
      });
    });
  });

const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** Poll `probe` until it returns true, or fail with a message that names the thing we waited for. */
async function waitFor(what, probe, seconds = 90) {
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    if (await Promise.resolve(probe()).catch(() => false)) return;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${what}`);
}

const httpOk = (url) => async () => (await fetch(url)).ok;

export async function startStack() {
  mkdirSync(logDir, { recursive: true });
  const containers = [];
  const children = [];
  let stopped = false;

  const stop = async () => {
    if (stopped) return;
    stopped = true;
    for (const child of children) child.kill('SIGTERM');
    await sleep(500);
    for (const child of children) child.kill('SIGKILL');
    if (containers.length) spawnSync('docker', ['rm', '-f', ...containers], { stdio: 'ignore' });
    rmSync(webDist, { recursive: true, force: true });
  };

  // A Ctrl-C or a crash must not leave containers behind.
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => {
      void stop().then(() => process.exit(1));
    });
  }

  /** Run a long-lived process with its output in tests/e2e/.logs/<name>.log. */
  const run = (name, command, args, { cwd = root, env = {} } = {}) => {
    const log = createWriteStream(join(logDir, `${name}.log`));
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.pipe(log);
    child.stderr.pipe(log);
    child.once('exit', (code) => {
      if (!stopped)
        console.error(`[e2e] ${name} exited early (code ${code}); see tests/e2e/.logs/${name}.log`);
    });
    children.push(child);
    return child;
  };

  /** Run a short command to completion; throw with its output when it fails. */
  const runToEnd = (command, args, options = {}) => {
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: 'utf8',
      ...options,
      env: { ...process.env, ...options.env },
    });
    if (result.status !== 0) {
      throw new Error(`${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
    }
  };

  const docker = (name, image, port, inside, args = [], extra = []) => {
    const full = `chat-e2e-${randomBytes(3).toString('hex')}-${name}`;
    runToEnd('docker', [
      'run',
      '-d',
      '--rm',
      '--name',
      full,
      '-p',
      `127.0.0.1:${port}:${inside}`,
      ...extra,
      image,
      ...args,
    ]);
    containers.push(full);
    return full;
  };

  try {
    let databaseUrl = process.env.DATABASE_URL;
    let redisUrl = process.env.REDIS_URL;
    let s3 = process.env.S3_ENDPOINT
      ? {
          S3_ENDPOINT: process.env.S3_ENDPOINT,
          S3_PUBLIC_ENDPOINT: process.env.S3_ENDPOINT,
          S3_BUCKET: process.env.S3_BUCKET ?? BUCKET,
          S3_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID ?? MINIO_USER,
          S3_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY ?? MINIO_PASSWORD,
        }
      : null;

    if (!databaseUrl || !redisUrl) {
      console.log('[e2e] starting Postgres, Redis and MinIO in docker...');
      const [pgPort, redisPort, minioPort] = await Promise.all([
        freePort(),
        freePort(),
        freePort(),
      ]);
      const pg = docker(
        'pg',
        'postgres:17-alpine',
        pgPort,
        5432,
        ['-c', 'fsync=off', '-c', 'max_connections=300'],
        [
          '-e',
          'POSTGRES_USER=chat',
          '-e',
          'POSTGRES_PASSWORD=chat',
          '-e',
          'POSTGRES_DB=chat_e2e',
          '--tmpfs',
          '/var/lib/postgresql/data',
        ],
      );
      const redis = docker('redis', 'redis:7-alpine', redisPort, 6379, [
        'redis-server',
        '--save',
        '',
        '--appendonly',
        'no',
      ]);
      docker(
        'minio',
        'pgsty/minio:RELEASE.2026-08-04T00-00-00Z',
        minioPort,
        9000,
        ['server', '/data'],
        [
          '-e',
          `MINIO_ROOT_USER=${MINIO_USER}`,
          '-e',
          `MINIO_ROOT_PASSWORD=${MINIO_PASSWORD}`,
          '--tmpfs',
          '/data',
        ],
      );
      // pg_isready can say yes during the first-boot restart; ask for a real answer instead.
      await waitFor(
        'Postgres',
        () =>
          spawnSync(
            'docker',
            ['exec', pg, 'psql', '-U', 'chat', '-d', 'chat_e2e', '-tAc', 'select 1'],
            { encoding: 'utf8' },
          ).stdout.trim() === '1',
      );
      await waitFor('Redis', () =>
        spawnSync('docker', ['exec', redis, 'redis-cli', 'ping'], {
          encoding: 'utf8',
        }).stdout.includes('PONG'),
      );
      databaseUrl = `postgres://chat:chat@127.0.0.1:${pgPort}/chat_e2e`;
      redisUrl = `redis://127.0.0.1:${redisPort}`;
      s3 = {
        S3_ENDPOINT: `http://127.0.0.1:${minioPort}`,
        S3_PUBLIC_ENDPOINT: `http://127.0.0.1:${minioPort}`,
        S3_BUCKET: BUCKET,
        S3_ACCESS_KEY_ID: MINIO_USER,
        S3_SECRET_ACCESS_KEY: MINIO_PASSWORD,
      };
    }

    if (s3) {
      await waitFor('MinIO', httpOk(`${s3.S3_ENDPOINT}/minio/health/live`));
      await createBucket(s3);
    }

    console.log('[e2e] migrating the database...');
    runToEnd('npm', ['--prefix', root, 'run', 'migrate'], { env: { DATABASE_URL: databaseUrl } });

    const [apiPort, webPort, workerPort] = await Promise.all([freePort(), freePort(), freePort()]);
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    const webUrl = `http://127.0.0.1:${webPort}`;

    console.log('[e2e] starting API and worker...');
    const shared = {
      DATABASE_URL: databaseUrl,
      REDIS_URL: redisUrl,
      LOG_LEVEL: 'warn',
      ...(s3 ?? {}),
      S3_FORCE_PATH_STYLE: 'true',
    };
    run('api', bin('tsx'), ['--conditions=@chat/source', 'src/main.ts'], {
      cwd: join(root, 'apps', 'api'),
      env: {
        ...shared,
        NODE_ENV: 'development',
        E2E_FAKE_AUTH: 'true',
        API_HOST: '127.0.0.1',
        API_PORT: String(apiPort),
        CORS_ORIGINS: webUrl,
        // Every test user shares one IP; the default limit would trip.
        RATE_LIMIT_MAX: '100000',
      },
    });
    run('worker', bin('tsx'), ['--conditions=@chat/source', 'src/main.ts'], {
      cwd: join(root, 'apps', 'worker'),
      env: { ...shared, NODE_ENV: 'development', WORKER_METRICS_PORT: String(workerPort) },
    });

    console.log('[e2e] building the web app with the fake login...');
    runToEnd(bin('vite'), ['build', '--outDir', webDist, '--emptyOutDir'], {
      cwd: join(root, 'apps', 'web'),
      env: {
        VITE_E2E_FAKE_AUTH: 'true',
        VITE_APP_ENV: 'test',
        VITE_API_URL: apiUrl,
        VITE_CLERK_PUBLISHABLE_KEY: 'pk_test_unused_by_the_fake_login',
      },
    });
    run(
      'web',
      bin('vite'),
      [
        'preview',
        '--outDir',
        webDist,
        '--host',
        '127.0.0.1',
        '--port',
        String(webPort),
        '--strictPort',
      ],
      {
        cwd: join(root, 'apps', 'web'),
      },
    );

    await waitFor('the API', httpOk(`${apiUrl}/health/ready`));
    await waitFor('the web server', httpOk(webUrl));
    console.log(`[e2e] ready: web ${webUrl}, api ${apiUrl}`);
    return { webUrl, apiUrl, stop };
  } catch (error) {
    await stop();
    throw error;
  }
}

/** The bucket must exist before uploads work; the app does not create it. */
async function createBucket(s3) {
  const { CreateBucketCommand, S3Client } = await import('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint: s3.S3_ENDPOINT,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: s3.S3_ACCESS_KEY_ID, secretAccessKey: s3.S3_SECRET_ACCESS_KEY },
  });
  await client.send(new CreateBucketCommand({ Bucket: s3.S3_BUCKET })).catch((error) => {
    if (error.name !== 'BucketAlreadyOwnedByYou') throw error;
  });
}
