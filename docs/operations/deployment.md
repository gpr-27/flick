# Deploying Flick

The demo setup uses only free plans and no domain name:

| Part                | Where                            | Notes                                                            |
| ------------------- | -------------------------------- | ---------------------------------------------------------------- |
| Web app             | **Vercel**                       | Static files from `apps/web`, settings in `apps/web/vercel.json` |
| API and worker jobs | **Render**, one free web service | Started by `scripts/start-render.mjs`; settings in `render.yaml` |
| Postgres            | **Supabase** (free project)      | `DATABASE_URL` is the **session pooler** connection string       |
| Redis               | **Render Key Value** (free)      | Data is disposable by design                                     |
| Files               | **AWS S3**, private bucket       | The browser uploads with signed URLs                             |
| Login               | **Clerk**, development keys      | Works on the `*.vercel.app` address                              |

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
3. Do not run migrations by hand. The Render pre-deploy command applies them.

`render.yaml` has no database block: `DATABASE_URL` is a `sync: false` secret, so you paste the Supabase string in the Render dashboard.

### 3. Render (API, worker jobs, Redis)

1. Push the repo to GitHub. Render > New > **Blueprint** > pick the repo. It reads `render.yaml`.
2. Render asks for every value marked `sync: false`. Fill in the table below and leave optional ones empty. For
   `CORS_ORIGINS` put anything valid for now (for example `https://example.vercel.app`); you fix it in step 5.
3. Apply. The build compiles the `@chat/*` packages. Before the new version takes traffic, `preDeployCommand` runs the
   migrations (`npm run migrate:prod -w @chat/db`); a failed migration cancels the deploy and the old version keeps
   running. If you ever need to run them by hand: Render > flick-api > Shell > the same command.
4. Open `https://<flick-api>.onrender.com/health/ready`. It must say `ready` (Postgres and Redis answer). This address
   is `VITE_API_URL`.

The Key Value instance (`flick-redis`, free) is created by the blueprint and `REDIS_URL` is filled in automatically. It
only holds socket rooms, presence and rate-limit counters, so losing its data is fine. All Render services use
Singapore, the closest Render region to Mumbai. They must stay in one region because the private connection strings
only work inside a region.

### 4. Vercel (the web app)

1. Vercel > Add New > Project > import the repo. Set **Root Directory** to `apps/web` and keep "Include source files
   outside of the Root Directory" ON. Everything else comes from `apps/web/vercel.json` (install from the repo root,
   `npm run build`, output `dist`, all paths rewritten to `index.html`, security headers).
2. Environment variables (they are baked in at **build** time, so changing one needs a redeploy):
   `VITE_APP_ENV=production`, `VITE_API_URL=<Render API address, no trailing slash, no /api>`,
   `VITE_CLERK_PUBLISHABLE_KEY=<pk_test_...>`.
3. Deploy. Copy the address (`https://<name>.vercel.app`; use the production alias, not a per-deploy preview address).

### 5. Connect the parts

1. Render > flick-api > Environment > `CORS_ORIGINS` = the Vercel address exactly as the browser shows it:
   `https://<name>.vercel.app`, no trailing slash. The API also hands this to Clerk as the allowed token origin. Save;
   Render redeploys.
2. Add the same address to the S3 bucket CORS (step 1.2).
3. Clerk (development instance): development keys accept the `*.vercel.app` address. If sign-in complains about the
   origin, add the Vercel address under the application's domains/allowed origins.
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

## Environment variables

Names only. "auto" means the blueprint fills it in.

| Where  | Variable                                                                        | Where the value comes from                                                                       |
| ------ | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Render | `NODE_ENV`, `TRUST_PROXY`, `LOG_LEVEL`, `NODE_VERSION`                          | auto (`production`, `true`, `info`, `22`)                                                        |
| Render | `PORT`                                                                          | Render sets it; the API listens on it (`API_PORT` wins if set)                                   |
| Render | `DATABASE_URL`                                                                  | Supabase session pooler string (step 2)                                                          |
| Render | `REDIS_URL`                                                                     | auto from `flick-redis`                                                                          |
| Render | `CORS_ORIGINS`                                                                  | The Vercel address; also Clerk's allowed origin. Several origins: comma-separated                |
| Render | `CLERK_SECRET_KEY`                                                              | Clerk > API keys > Secret key (`sk_test_`)                                                       |
| Render | `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`            | Step 1                                                                                           |
| Render | `S3_ENDPOINT`, `S3_PUBLIC_URL`                                                  | Leave empty                                                                                      |
| Render | `GIPHY_API_KEY`                                                                 | developers.giphy.com (optional; GIF search is off without it)                                    |
| Render | `LIVEKIT_URL`, `LIVEKIT_API_KEY`, `LIVEKIT_API_SECRET`                          | LiveKit Cloud project (optional; group calls off without them)                                   |
| Render | `TURN_SECRET`, `TURN_URLS`                                                      | Your coturn server (optional; see below)                                                         |
| Render | `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`                        | `npx web-push generate-vapid-keys`; subject like `mailto:you@example.com`. Set all three or none |
| Render | `ANTHROPIC_API_KEY`, `GROQ_API_KEY_1/2`, `GEMINI_API_KEY_1/2`                   | Each provider's console (all optional)                                                           |
| Render | `RATE_LIMIT_MAX`, `DATABASE_POOL_MAX`                                           | Optional tuning, defaults are fine                                                               |
| Vercel | `VITE_APP_ENV`                                                                  | `production`                                                                                     |
| Vercel | `VITE_API_URL`                                                                  | The Render API address                                                                           |
| Vercel | `VITE_CLERK_PUBLISHABLE_KEY`                                                    | Clerk > API keys > Publishable key (`pk_test_`)                                                  |
| Vercel | `VITE_STUN_URLS`, `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL` | Optional call settings                                                                           |

Never set `E2E_FAKE_AUTH` on Render. It is a test-only login and the API refuses to start with it in production.

Calls between people on different networks need a TURN relay. Either run coturn on a small server and set
`TURN_SECRET` and `TURN_URLS` on the API, or set the `VITE_TURN_*` values on Vercel to a hosted relay. Render cannot
run coturn (it needs UDP ports).

## Troubleshooting

| Symptom                                              | Cause and fix                                                                                                                                                     |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Browser console: "blocked by CORS policy"            | `CORS_ORIGINS` is not exactly the page address (check `https`, no trailing slash, no preview address). Fix it on Render; it redeploys.                            |
| Every API call is 401 right after sign-in            | Same cause: the Clerk token origin check uses `CORS_ORIGINS`. Also check that the `sk_test_` and `pk_test_` keys belong to the same Clerk app.                    |
| Socket.IO `connect_error: unauthorized`              | The session token was rejected: wrong `CLERK_SECRET_KEY`, wrong `CORS_ORIGINS`, or keys from different Clerk apps. The app signs you out on this error by design. |
| Socket.IO cannot connect at all                      | `VITE_API_URL` is wrong (it was baked in at build; fix it and redeploy Vercel), or the API is asleep and still starting. The client uses WebSocket only.          |
| "Development mode" banner in the sign-in box         | Expected with `pk_test_` keys.                                                                                                                                    |
| First load is slow or connections drop after idle    | The free Render service was asleep. See the caveats above.                                                                                                        |
| API cannot reach the database                        | The Supabase project is paused (restore it), or `DATABASE_URL` is not the session pooler string.                                                                  |
| Render deploy fails at "pre-deploy"                  | A migration failed; open the deploy log. The previous version keeps serving.                                                                                      |
| Upload fails in the browser                          | The bucket CORS does not list the Vercel address, or `S3_*` is wrong (the API answers 503 when storage is not configured).                                        |
| Avatars show the Clerk picture, not the uploaded one | Expected with a private bucket and an empty `S3_PUBLIC_URL`.                                                                                                      |
| Changed a `VITE_` value but nothing changed          | Vite reads these at build time. Redeploy the Vercel project.                                                                                                      |
