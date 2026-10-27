# Flick runbook

This page is for running Flick day to day: starting the Docker stack, checking health, reading logs and dashboards,
fixing the common problems (including the hosted ones: sign-in loops, 401 after login, uploads, AI not configured, AI
quota, free-plan sleep), rolling back a bad deploy or migration, and backing up Postgres and files. Commands run from the
repo root. For the hosted demo (Vercel, Render, Supabase, S3) see [`deployment.md`](deployment.md); on Render, logs and
the shell are in the Render dashboard.

Related: [`deployment.md`](deployment.md), [`../platform-setup.md`](../platform-setup.md), [`../testing.md`](../testing.md),
[`../architecture/database-schema.md`](../architecture/database-schema.md), [`../security/auth.md`](../security/auth.md).

## Hosted service (Render `flick-server`, Vercel `flick-app`)

The live API is the Render service **`flick-server`** (repo `gpr-27/flick`, branch `main`, auto deploy on, health check
`/health/ready`, runs `npm run migrate:prod` before the server starts). `render.yaml` calls the same service `flick-api`.
An older, suspended service named `flick-api` exists on the repo `gpr-27/chat_app`: leave it alone. The web app is the
Vercel project **`flick-app`**, deployed from `apps/web` on `main`.

| Task                      | How                                                                                                                       |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| See logs                  | Render > service > Logs (JSON from pino; api and worker lines are interleaved). Filter by `level`.                        |
| Is it up?                 | `curl https://<service>.onrender.com/health/ready` must return ready. The first call after sleep can take about a minute. |
| Deploy                    | Push to `main`: Render and Vercel deploy by themselves. Render runs `migrate:prod` before the server starts.              |
| Roll back code            | Render > Deploys > pick the last good deploy > Rollback. Vercel > Deployments > Promote an older deployment.              |
| Roll back a bad migration | Back up first. Shell with `DATABASE_URL`: `npm run migrate:down -w @chat/db`, then roll back the code. See deployment.md. |
| Change a variable         | Render: Environment > edit (redeploys). Vercel: Settings > Environment Variables, then redeploy (build-time values).      |
| Check migration state     | `npm run migrate:status -w @chat/db` with `DATABASE_URL` set.                                                             |

**Hosted problems at a glance**

| Symptom                       | First check                                                                                                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in loop                  | Clerk paths `/sign-in`, `/sign-up`; both Clerk keys from the same app; `CORS_ORIGINS` is the exact page origin.                                          |
| 401 on every call after login | `CORS_ORIGINS` (Clerk `authorizedParties`) and `CLERK_SECRET_KEY`. Look for "unauthorized" in the API log.                                               |
| Uploads fail                  | `S3_*` set? Bucket CORS lists the Vercel origin? File over 1 GB (413)? Pending uploads older than 24 h are cleaned up.                                   |
| AI "not configured" (503)     | No AI key set. Add one of `ANTHROPIC_API_KEY`, `GROQ_API_KEY_1/2`, `GEMINI_API_KEY_1/2`.                                                                 |
| AI "Daily AI limit reached"   | `AI_DAILY_LIMIT` (default 200) used for the UTC day. Raise it or wait for 00:00 UTC. Redis down = no limit.                                              |
| AI answers slow or fall back  | A provider is cooling down after 429/5xx; the chain moves on. See `ai_attempts_total` in metrics or the API log.                                         |
| Free plan sleep               | Service sleeps after 15 min idle; sockets drop and reconnect; worker jobs pause. Starter plan fixes it.                                                  |
| Push notifications missing    | `VAPID_*` set on the service? Settings > Notifications shows the last push status per device.                                                            |
| Email-to-chat does nothing    | `INBOUND_EMAIL_SECRET` set (else 404) and the provider sends `x-inbound-secret`. Settings shows the address only when `INBOUND_EMAIL_DOMAIN` is set too. |
| CORS error or 401 after login | `CORS_ORIGINS` must equal the Vercel origin exactly: `https`, no trailing slash, no path, not a preview address.                                         |
| Camera or microphone blocked  | `Permissions-Policy` in `apps/web/vercel.json` must allow `camera`, `microphone` and `geolocation` for `self`.                                           |
| AI "turned off for this chat" | Not a fault: the person switched off "Allow Flick to read this chat". It also stops translation and transcription there.                                 |

## Stacks (local Docker)

| File                            | Use                                                                                                |
| ------------------------------- | -------------------------------------------------------------------------------------------------- |
| `infra/docker/compose.yml`      | Local development: everything, including api, worker and web.                                      |
| `infra/docker/compose.test.yml` | Throwaway Postgres, Redis and MinIO for integration tests. Data is in memory.                      |
| `infra/docker/compose.prod.yml` | One-host production setup: nginx in front of 2 api replicas, worker, web, data stores, monitoring. |

Docker runs through Colima on macOS: `colima start`.

## Start and stop

```bash
cp .env.example .env          # once
docker compose -f infra/docker/compose.yml --env-file .env up -d        # start
docker compose -f infra/docker/compose.yml --env-file .env ps           # status
docker compose -f infra/docker/compose.yml --env-file .env down         # stop, keep data
docker compose -f infra/docker/compose.yml --env-file .env down -v      # stop, DELETE all data
```

Always pass `--env-file .env`. Without it compose uses the default host ports,
and if you changed ports it recreates containers with the wrong ones.

To run api/worker on the host instead (`npm run dev`), start only the
dependencies: `... up -d postgres redis minio minio-init coturn`.
The connection strings in `.env.example` point at their host ports.

Start order is handled by `depends_on`: api and worker wait until Postgres,
Redis are healthy and the `minio-init` job has finished.

Integration tests:

```bash
eval "$(scripts/dev/test-deps-up.sh)"    # start, wait, export DATABASE_URL etc.
npm run test:integration
scripts/dev/test-deps-down.sh            # stop and delete
```

Production:

```bash
docker compose -f infra/docker/compose.prod.yml --env-file .env.prod up -d --build
```

`.env.prod` must set every secret listed at the end of part 1 of
`.env.example`; compose refuses to start otherwise. TLS is terminated by a load
balancer in front of nginx.

## Migrations

Run the database migrations after Postgres is up and before using the app:

```bash
npm run migrate
```

## Is everything healthy?

`docker compose ... ps` shows `(healthy)` for services with a health check.
Each one checks something real:

| Service             | Health check                                    |
| ------------------- | ----------------------------------------------- |
| postgres            | `pg_isready` over TCP                           |
| redis               | `redis-cli ping`                                |
| minio               | `/minio/health/live`                            |
| coturn              | answers a STUN request                          |
| prometheus, grafana | their own ready/health endpoints                |
| api, worker         | `GET /health/ready` (checks their dependencies) |

`minio-init` is a one-shot job. It should show `Exited (0)` and is safe to re-run.

By hand:

```bash
docker compose -f infra/docker/compose.yml exec postgres psql -U chat -c 'select 1'
docker compose -f infra/docker/compose.yml exec redis redis-cli ping
curl -s localhost:4000/health/ready    # the API_PORT from .env
```

Prometheus shows every scrape target and whether it is up at
<http://localhost:9090/targets>, and current alerts at <http://localhost:9090/alerts>.

## Dashboards and tools (dev ports)

| Tool                    | URL                                     |
| ----------------------- | --------------------------------------- |
| Grafana (admin / admin) | <http://localhost:3001>, folder "Flick" |
| Prometheus              | <http://localhost:9090>                 |
| MinIO console           | <http://localhost:9001>                 |

The three Grafana dashboards: Messaging delivery, API and database health,
Connections and presence. They are generated by
`node infra/grafana/build-dashboards.mjs`; edit that file, not the JSON.

In production these UIs listen on 127.0.0.1 only. Use an SSH tunnel, e.g.
`ssh -L 3001:localhost:3001 host`.

## Logs

```bash
docker compose -f infra/docker/compose.yml logs -f api worker     # follow
docker compose -f infra/docker/compose.yml logs --since 10m postgres
```

api and worker log JSON (pino). In production, logs rotate at 20 MB × 5 files
per container.

## Common problems

**Port already in use.** Change the port in `.env` (for example
`POSTGRES_PORT=5433`) and start again with `--env-file .env`.

**API down / not healthy** (alert `ApiDown`). Check
`logs api`. The api prints which dependency is unhealthy at startup. Fix that
dependency; the container restarts on its own.

**Outbox backlog or age growing** (alerts `OutboxBacklog`,
`OutboxOldestAgeGrowing`). The dispatcher is not keeping up or is stuck. Check
the API logs and the Messaging delivery dashboard. No message is lost: the
outbox rows stay in Postgres until they are dispatched.

**High 5xx rate** (alert `High5xxRate`). Look at the API and database health
dashboard and `logs api`.

**DB pool saturation** (alert `DbPoolSaturation`). Requests are waiting for a
database connection. Find slow queries on the API and database health dashboard,
or check `pg_stat_activity` for long transactions, before raising `DATABASE_POOL_MAX`.

**Tracing.** There is none (no OpenTelemetry or Jaeger); use logs and metrics.

**Media upload fails in the browser with a CORS error.** The web origin must
match `MINIO_API_CORS_ALLOW_ORIGIN` on MinIO (in compose it is
`http://localhost:${WEB_PORT}`).

**Calls connect but have no audio/video across networks.** TURN is not
reachable. In dev, check that `coturn` is healthy and UDP ports 49160-49200 are
free. In production, `TURN_EXTERNAL_IP` must be the host's public IP and UDP
3478 plus 49152-65535 must be open.

**Grafana shows "No data".** Check <http://localhost:9090/targets>. App panels
stay empty until api and worker are running and receiving traffic.

## Backup and restore

### Postgres (source of truth)

```bash
# Backup (custom format, compressed)
docker compose -f infra/docker/compose.yml exec -T postgres \
  pg_dump -U chat -d chat -Fc > backup-$(date +%F).dump

# Restore into an empty database: stop api and worker first
docker compose -f infra/docker/compose.yml stop api worker
docker compose -f infra/docker/compose.yml exec -T postgres \
  pg_restore -U chat -d chat --clean --if-exists < backup-2026-10-24.dump
docker compose -f infra/docker/compose.yml start api worker
```

Test a restore regularly; a backup you have never restored is not a backup.
For real production use continuous WAL archiving (point-in-time recovery) or a
managed Postgres, not only nightly dumps.

### MinIO (media files)

```bash
# Backup: copy the bucket to a local folder
docker run --rm --network chat_default -e MINIO_ROOT_PASSWORD -v "$PWD/media-backup:/backup" \
  --entrypoint /bin/sh pgsty/mc:RELEASE.2026-09-16T00-00-00Z -c \
  'mc alias set src http://minio:9000 minioadmin "$MINIO_ROOT_PASSWORD" && mc mirror src/chat-media /backup'

# Restore: copy the folder back into the bucket
docker run --rm --network chat_default -e MINIO_ROOT_PASSWORD -v "$PWD/media-backup:/backup" \
  --entrypoint /bin/sh pgsty/mc:RELEASE.2026-09-16T00-00-00Z -c \
  'mc alias set dst http://minio:9000 minioadmin "$MINIO_ROOT_PASSWORD" && mc mirror /backup dst/chat-media'
```

`-e MINIO_ROOT_PASSWORD` passes the password from your shell. Back up Postgres
and MinIO together: the `attachments` table points at objects in the bucket.

### Not backed up on purpose

- **Redis** holds only short-lived state (presence, routing, rate limits). It
  rebuilds itself as clients reconnect.
