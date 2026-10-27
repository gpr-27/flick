# Deploying Flick

This page is the full recipe for the hosted setup: the web app on Vercel (`flick-app`), the API and worker jobs in one
Render web service (`flick-server`, auto-deployed from `main`), Postgres on Supabase, Redis on Render, files in a private
S3 bucket, and login on Clerk. It has the step-by-step setup, every environment variable for the API, the worker and the
web app, the Vercel headers, the Clerk dashboard settings, how migrations run on every deploy and how to roll back, and a
troubleshooting table. In the blueprint file (`render.yaml`) the service is named `flick-api`; the live service in the
owner's account is `flick-server`. They are the same thing, only the name differs.

**Which service is live.** Render service `flick-server` is built from the GitHub repo `gpr-27/flick`, branch `main`,
with auto deploy on. Its start command runs `npm run migrate:prod` before the server starts, and its health check is
`/health/ready`. Vercel project `flick-app` deploys `apps/web` from `main`. A separate, older Render service also named
`flick-api` exists on the repo `gpr-27/chat_app`; it is suspended. Do not use it, do not resume it and do not point
anything at it.

Related: [`runbook.md`](runbook.md), [`../platform-setup.md`](../platform-setup.md), [`../security/auth.md`](../security/auth.md),
[`../decisions/0020-clerk-own-sign-in-paths-and-flick-only-profile.md`](../decisions/0020-clerk-own-sign-in-paths-and-flick-only-profile.md),
[`../ai/privacy-and-limits.md`](../ai/privacy-and-limits.md).

The demo setup uses only free plans and no domain name:

| Part                | Where                                             | Notes                                                                                 |
| ------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Web app             | **Vercel** (`flick-app`)                          | Builds `apps/web`; settings in `apps/web/vercel.json`                                 |
| API and worker jobs | **Render**, one free web service (`flick-server`) | Auto-deploys `main`; started by `scripts/start-render.mjs`; settings in `render.yaml` |
| Postgres            | **Supabase** (free project)                       | `DATABASE_URL` is the **session pooler** connection string                            |
| Redis               | **Render Key Value** (free)                       | Data is disposable by design                                                          |
| Files               | **AWS S3**, private bucket                        | The browser uploads with signed URLs                                                  |
| Login               | **Clerk**, development keys                       | Works on the `*.vercel.app` address                                                   |

```
 Browser --HTTPS--> Vercel (the React app)
    |
    |--HTTPS (REST) -----> Render: flick-api  --> Supabase Postgres  (data, outbox, pg-boss jobs)
    |--WebSocket --------> Fastify + Socket.IO --> Render Key Value   (rooms, presence, rate limits)
    |                      outbox dispatcher
    |                      worker jobs (child process of the same service)
    |--HTTPS ------------> Clerk (login; the API checks the session token)
    '--HTTPS ------------> S3 (uploads and downloads with signed URLs)
```

Order of work: storage, database, Render, Vercel, then tell the API and the bucket the Vercel address.

**Secrets** (database password, `CLERK_SECRET_KEY`, AWS keys, provider keys) are typed only into the Render and Vercel
dashboards. They are never committed, and `render.yaml` holds no secret value.

## Why the API is not on Vercel

Vercel runs code as short serverless functions. A function cannot keep a WebSocket open, and Socket.IO needs one
process that holds every connected user for hours. The API also runs a dispatcher loop that reads the outbox all the
time. Render runs a normal always-on server, so it fits. Vercel stays ideal for the static React app.

## Why one service runs the API and the worker

Render's free plan has no background workers. So the one `flick-api` web service starts
`node scripts/start-render.mjs`, which runs the API and the worker (pg-boss jobs: notifications, expiring messages,
cleanup) as two child processes. If either stops, the script stops both and Render restarts the service, so neither
dies quietly. The worker's own port (9465) is internal; Render exposes only the API's `PORT`. On a paid plan you would
run the worker as its own service.

## Steps

You need accounts on Render, Vercel, Supabase, AWS and Clerk.

### 1. File storage (AWS S3)

1. S3 > Create bucket (any region, for example `ap-south-1`). Keep **Block all public access ON**. The bucket stays
   private.
2. Bucket > Permissions > **CORS**: allow the origin `https://<your-vercel-name>.vercel.app` (add it after step 4 if you
   do not know it yet), methods `GET, POST, PUT, HEAD`, headers `*`, expose header `ETag`.
3. IAM > create a user with an inline policy that allows only `s3:GetObject`, `s3:PutObject` and `s3:DeleteObject` on
   `arn:aws:s3:::<bucket>/*`. Create an access key for it. These become `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`.
4. Values for Render: `S3_REGION=<bucket region>`, `S3_BUCKET=<bucket name>`, `S3_ENDPOINT` **empty** (empty means
   real AWS S3), `S3_PUBLIC_URL` empty.

Because the bucket is private, an uploaded avatar has no public address, so the app shows the Clerk profile picture
instead. Chat images and files are unaffected: they are downloaded with 5-minute signed links.

The API makes uploads with a signed **POST** form. Cloudflare R2 is not known to support that, so use S3 unless you
test R2 uploads first.

### 2. Database (Supabase)

1. Create a Supabase project (free).
2. In the dashboard open **Connect** and copy the **Session pooler** connection string. Use it as `DATABASE_URL` and add `?sslmode=no-verify` at the end (the connection is encrypted; Supabase's certificate is not checked). Use
   the session pooler, not the transaction pooler: the job queue (pg-boss) needs a normal session.
3. Do not run migrations by hand. Render applies them on every start (see "Migrations on deploy").

`render.yaml` has no database block: `DATABASE_URL` is a `sync: false` secret, so you paste the Supabase string in the Render dashboard.

### 3. Render (API, worker jobs, Redis)

1. Push the repo to GitHub. Render > New > **Blueprint** > pick the repo. It reads `render.yaml`.
2. Render asks for every value marked `sync: false`. Fill in the table below and leave optional ones empty. For
   `CORS_ORIGINS` put anything valid for now (for example `https://example.vercel.app`); you fix it in step 5.
3. Apply. The build compiles the `@chat/*` packages in order. The start command is
   `npm run migrate:prod -w @chat/db && node scripts/start-render.mjs`, so **pending migrations run first, on every
   start**; if a migration fails the service does not start and Render keeps the previous version serving. (The free plan
   has no separate pre-deploy step, so this is done in the start command.) Pushing to `main` redeploys automatically
   (`autoDeploy: true`, limited to the paths in `buildFilter`).
4. Open `https://<service>.onrender.com/health/ready`. It must say `ready` (Postgres and Redis answer). This address
   is `VITE_API_URL`.

The Key Value instance (`flick-redis`, free) is created by the blueprint and `REDIS_URL` is filled in automatically. It
only holds socket rooms, presence and rate-limit counters, so losing its data is fine. All Render services use
Singapore, the closest Render region to Mumbai. They must stay in one region because the private connection strings
only work inside a region.

### 4. Vercel (the web app)

1. Vercel > Add New > Project > import the repo. Set **Root Directory** to `apps/web` and keep "Include source files
   outside of the Root Directory" ON. Everything else comes from `apps/web/vercel.json` (install from the repo root,
   `npm run build`, output `dist`, all paths rewritten to `index.html`, security headers, see below).
2. Environment variables (they are baked in at **build** time, so changing one needs a redeploy):
   `VITE_APP_ENV=production`, `VITE_API_URL=<Render API address, no trailing slash, no /api>`,
   `VITE_CLERK_PUBLISHABLE_KEY=<pk_test_...>`.
3. Deploy. Pushes to `main` redeploy automatically. Copy the address (`https://<name>.vercel.app`; use the production alias, not a per-deploy preview address).

### 5. Connect the parts

1. Render > the API service (`flick-server` in the live account) > Environment > `CORS_ORIGINS` = the Vercel address exactly as the browser shows it:
   `https://<name>.vercel.app`, no trailing slash. The API also hands this to Clerk as the allowed token origin. Save;
   Render redeploys.
2. Add the same address to the S3 bucket CORS (step 1.2).
3. Clerk dashboard (see "Clerk dashboard settings" below): set the sign-in and sign-up paths, make username optional,
   optionally enable passkeys. Development keys accept the `*.vercel.app` address. If sign-in complains about the origin,
   add the Vercel address under the application's domains/allowed origins.
4. Clerk > Users > **Create user** (email and password) for the demo account, and make sure password sign-in is
   enabled.

### 6. Check it works

- [ ] `/health/live` and `/health/ready` on the API both return 200.
- [ ] The Vercel address loads; reloading an inner page also works (no 404).
- [ ] Sign in with the demo user (a "Development mode" banner is expected).
- [ ] Browser dev tools > Network: the `socket.io` request is a `101` WebSocket and stays open.
- [ ] Two browsers (or one normal, one private window) with two users: a message sent in one appears in the other,
      ticks update.
- [ ] Send an image: it uploads and shows.

## Free-plan caveats

- **The API sleeps after 15 minutes without traffic.** Every Socket.IO connection drops, and the next request waits
  about a minute while the service starts. The worker jobs sleep with it. The client reconnects and syncs, so no
  message is lost. For a service that never sleeps use Render's `starter` plan, and then run the worker as its own
  service.
- **Supabase free projects pause after a week of inactivity.** Restore the project from the Supabase dashboard before
  the API can reach the database again.
- **Render's free Postgres expires after 30 days. It is not used here.**
- Render Key Value (free) loses its data on restart; that only resets presence and rate-limit counters.
- Development Clerk keys show a "Development mode" banner and are meant for a demo. Production keys need your own
  domain.

## Vercel headers

`apps/web/vercel.json` sets these on every response:

| Header                   | Value                                                  | Why                                                                                                                |
| ------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| `X-Content-Type-Options` | `nosniff`                                              | The browser must not guess types.                                                                                  |
| `X-Frame-Options`        | `DENY`                                                 | The app cannot be framed (clickjacking).                                                                           |
| `Referrer-Policy`        | `strict-origin-when-cross-origin`                      | Do not leak full URLs.                                                                                             |
| `Permissions-Policy`     | `camera=(self), microphone=(self), geolocation=(self)` | Calls, voice notes, photos and sharing a location work **only for Flick itself**; no embedded third party may ask. |

Hashed files under `/assets/` are cached for a year (`immutable`); `sw.js`, `manifest.webmanifest` and `index.html` are
`no-cache` so a new version is picked up at once, and `sw.js` has `Service-Worker-Allowed: /`. All other paths are
rewritten to `index.html` (single page app). If you change `Permissions-Policy` to remove `camera` or `microphone`, calls
and voice notes will fail with a permission error.

## Clerk dashboard settings

1. **Paths.** Configure > Paths: sign-in `/sign-in`, sign-up `/sign-up`, home URL `/` and after sign-out `/` (all set). The app also sets them in code
   (`signInUrl`, `signUpUrl`, `afterSignOutUrl="/"`), but the dashboard must agree or Clerk may send people to its hosted
   Account Portal and ask them to create a second account.
2. **Username optional.** User and authentication > Username: enabled but **not required**. Flick fills in a username
   itself from the Clerk username or the email.
3. **Passkeys.** User and authentication > Passkeys: enabled for this app. If they are turned off, the Passkeys card
   in Settings, Account stays hidden.
4. **API keys.** Publishable key (`pk_test_` or `pk_live_`) goes to Vercel as `VITE_CLERK_PUBLISHABLE_KEY`; secret key
   (`sk_...`) goes to Render as `CLERK_SECRET_KEY`. They must come from the **same** Clerk application.
5. **Allowed origin.** The Vercel address must be in `CORS_ORIGINS` on Render (Clerk's `authorizedParties`).
6. **Closed demo.** To keep the app invite-only, turn sign-ups off and create users by hand (Users > Create user).

## Migrations on deploy, and rolling back

- **Forward.** Every start of the Render service runs `npm run migrate:prod -w @chat/db` (compiled
  `node dist/src/migrate.js up`). It applies only migrations not yet recorded, so running it twice is safe. A failure
  stops the start.
- **Backward compatible rule.** Write migrations so the previous app version still works with the new schema (add
  columns and tables, do not rename or drop in the same release). Then a rollback of the code needs no database change.
- **Roll back code.** Render > the service > Events/Deploys > roll back to a previous deploy. The old version starts and
  runs `migrate:prod`, which does nothing new.
- **Roll back a migration.** Only if the migration itself is wrong: take a database backup (Supabase dashboard, or
  `pg_dump`), then from a shell with `DATABASE_URL` set run `npm run migrate:down -w @chat/db` (reverts the latest one)
  and redeploy the previous commit. Some `down` steps cannot restore everything: the `message_type` enum values added
  in 0027 and 0032 stay, and the 0007 trim deleted messages of removed types. Never edit or rename a migration that has
  been applied anywhere.
- **Numbering.** 0014, 0021, 0026 and 0030 do not exist; do not add files under those numbers
  (see [`../architecture/database-schema.md`](../architecture/database-schema.md)).

## Environment variables, in full

Names only; never commit values. "auto" means the blueprint fills it in. Anything optional switches its feature off when
empty; the app keeps working.

### API (Render service)

| Variable                                                                    | Needed      | Meaning                                                                                                                                                                                 |
| --------------------------------------------------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`, `NODE_VERSION`, `LOG_LEVEL`, `TRUST_PROXY`                      | auto        | `production`, `22`, `info`, `true` (so rate limits use the real client address)                                                                                                         |
| `PORT` / `API_HOST` / `API_PORT`                                            | auto        | Render sets `PORT`; the API uses it unless `API_PORT` is set                                                                                                                            |
| `DATABASE_URL`                                                              | yes         | Supabase session-pooler string ending `?sslmode=no-verify`                                                                                                                              |
| `DATABASE_POOL_MAX`                                                         | no          | Pool size, default 20                                                                                                                                                                   |
| `REDIS_URL`                                                                 | auto        | From `flick-redis`                                                                                                                                                                      |
| `CORS_ORIGINS`                                                              | yes         | Must equal the Vercel origin exactly (`https://<name>.vercel.app`, no trailing slash, no path); CORS allow-list and Clerk `authorizedParties`                                           |
| `CLERK_SECRET_KEY`                                                          | yes         | The API refuses to start without it                                                                                                                                                     |
| `RATE_LIMIT_MAX`                                                            | no          | Requests per minute per IP, default 300                                                                                                                                                 |
| `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`        | for uploads | Private bucket. Without them uploads answer 503                                                                                                                                         |
| `S3_ENDPOINT`, `S3_PUBLIC_ENDPOINT`, `S3_PUBLIC_URL`, `S3_FORCE_PATH_STYLE` | no          | Leave empty for AWS S3; used for MinIO/R2 or a public avatar bucket                                                                                                                     |
| `ANTHROPIC_API_KEY`                                                         | no          | AI provider 1 (Anthropic)                                                                                                                                                               |
| `GROQ_API_KEY_1`, `GROQ_API_KEY_2`                                          | no          | AI providers 2 and 3 (Groq); also needed for voice transcription                                                                                                                        |
| `GEMINI_API_KEY_1`, `GEMINI_API_KEY_2`                                      | no          | AI providers 4 and 5 (Gemini)                                                                                                                                                           |
| `AI_DAILY_LIMIT`                                                            | no          | AI requests per user per UTC day, default 200 (counts analyze, transcribe, translate-batch and bot replies too)                                                                         |
| `AI_ATTEMPT_TIMEOUT_MS`, `AI_TOTAL_TIMEOUT_MS`                              | no          | Per provider attempt (25 s) and per chain walk (90 s)                                                                                                                                   |
| `GIPHY_API_KEY`                                                             | no          | GIF search; without it the GIF endpoints answer `FEATURE_DISABLED`                                                                                                                      |
| `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`                      | no          | Group calls and call links; without them `FEATURE_DISABLED`                                                                                                                             |
| `TURN_SECRET`, `TURN_URLS` or `TURN_USERNAME`, `TURN_CREDENTIAL`            | no          | TURN relay for 1:1 calls across networks (coturn secret, or a hosted service's fixed login)                                                                                             |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                    | no          | Web Push. Set all three or none                                                                                                                                                         |
| `INBOUND_EMAIL_SECRET`                                                      | no          | Email-to-chat: the secret the mail provider sends in `x-inbound-secret`. Unset: `/inbound/email` answers 404                                                                            |
| `INBOUND_EMAIL_DOMAIN`                                                      | no          | The domain of the forwarding address. Used only to show each person `<username>@domain` in Settings (`GET /platform/email-alias`); the address is shown only when the secret is set too |
| `E2E_FAKE_AUTH`                                                             | never       | Test-only login; the API refuses to start with it in production                                                                                                                         |

### Worker (runs inside the same Render service)

The worker child process reads the same environment. It uses `DATABASE_URL`, `DATABASE_POOL_MAX` (default 10),
`REDIS_URL`, the `S3_*` values (for the upload sweep), the `VAPID_*` values (without them pushes are only logged),
`WORKER_METRICS_PORT` (default 9465, internal) and `LOG_LEVEL`. It needs no AI keys.

### Web (Vercel, baked in at build time)

| Variable                                                                        | Meaning                                              |
| ------------------------------------------------------------------------------- | ---------------------------------------------------- |
| `VITE_APP_ENV`                                                                  | `production`                                         |
| `VITE_API_URL`                                                                  | The Render API address, no trailing slash, no `/api` |
| `VITE_CLERK_PUBLISHABLE_KEY`                                                    | Clerk publishable key                                |
| `VITE_STUN_URLS`, `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | Optional call settings                               |

Changing a `VITE_` value needs a redeploy.

## Health checks and monitoring

`/health/live` (process is up) and `/health/ready` (Postgres and Redis answer) are public. Render uses `/health/ready`.
`/metrics` exposes Prometheus metrics; do not publish it on a public host. On the free plan there is no Prometheus; use
the Render logs. See [`runbook.md`](runbook.md).

Never set `E2E_FAKE_AUTH` on Render. It is a test-only login and the API refuses to start with it in production.

Calls between people on different networks need a TURN relay. Either run coturn on a small server and set
`TURN_SECRET` and `TURN_URLS` on the API, or set the `VITE_TURN_*` values on Vercel to a hosted relay. Render cannot
run coturn (it needs UDP ports).

## Troubleshooting

| Symptom                                                    | Cause and fix                                                                                                                                                                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser console: "blocked by CORS policy"                  | `CORS_ORIGINS` is not exactly the page address (check `https`, no trailing slash, no preview address). Fix it on Render; it redeploys.                                                                                            |
| Every API call is 401 right after sign-in                  | Same cause: the Clerk token origin check uses `CORS_ORIGINS`. Also check that the `sk_test_` and `pk_test_` keys belong to the same Clerk app.                                                                                    |
| Socket.IO `connect_error: unauthorized`                    | The session token was rejected: wrong `CLERK_SECRET_KEY`, wrong `CORS_ORIGINS`, or keys from different Clerk apps. The app signs you out on this error by design.                                                                 |
| Socket.IO cannot connect at all                            | `VITE_API_URL` is wrong (it was baked in at build; fix it and redeploy Vercel), or the API is asleep and still starting. The client uses WebSocket only.                                                                          |
| "Development mode" banner in the sign-in box               | Expected with `pk_test_` keys.                                                                                                                                                                                                    |
| First load is slow or connections drop after idle          | The free Render service was asleep. See the caveats above.                                                                                                                                                                        |
| API cannot reach the database                              | The Supabase project is paused (restore it), or `DATABASE_URL` is not the session pooler string.                                                                                                                                  |
| Render deploy fails at start                               | A migration failed (the start command runs `migrate:prod` first); open the deploy log. The previous version keeps serving.                                                                                                        |
| Upload fails in the browser                                | The bucket CORS does not list the Vercel address, or `S3_*` is wrong (the API answers 503 when storage is not configured).                                                                                                        |
| Avatars show the Clerk picture, not the uploaded one       | Expected with a private bucket and an empty `S3_PUBLIC_URL`.                                                                                                                                                                      |
| Changed a `VITE_` value but nothing changed                | Vite reads these at build time. Redeploy the Vercel project.                                                                                                                                                                      |
| Sign-in loop (back to /sign-in after signing in)           | Clerk paths do not match the app (`/sign-in`, `/sign-up`), keys come from different Clerk apps, or the browser blocks third-party cookies for a custom domain. Fix the Clerk dashboard paths and the key pair, then hard refresh. |
| 401 right after login                                      | `CORS_ORIGINS` is not the exact page origin (Clerk `authorizedParties` fails), or `CLERK_SECRET_KEY` belongs to another app. The API log says "unauthorized".                                                                     |
| Uploads fail (503, or the browser stops at the S3 request) | `S3_*` not set (503), or the bucket CORS lacks the Vercel origin and methods `GET, POST, PUT, HEAD`. Files over 1 GB are refused by design (413).                                                                                 |
| AI says "not configured" / 503                             | No AI key is set on Render (`ANTHROPIC_API_KEY`, `GROQ_API_KEY_1/2`, `GEMINI_API_KEY_1/2`). Add at least one and redeploy. Voice transcription needs a Groq key.                                                                  |
| AI says "Daily AI limit reached"                           | The user hit `AI_DAILY_LIMIT` (default 200 a day, resets at 00:00 UTC). Raise the variable, or wait. Usage is shown in Settings, AI.                                                                                              |
| AI says "AI is turned off for this chat"                   | The person switched off "Allow Flick to read this chat". Not a fault.                                                                                                                                                             |
| Free plan: first request takes about a minute              | The Render free service sleeps after 15 minutes without traffic. The client reconnects and syncs; use the `starter` plan to avoid sleeping.                                                                                       |
| Camera or microphone blocked in the app                    | `Permissions-Policy` was changed; keep `camera=(self), microphone=(self)`. Also check the browser's site permission.                                                                                                              |
