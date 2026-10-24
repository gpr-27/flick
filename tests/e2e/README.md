# Browser tests (Playwright)

Real Chromium browsers talk to a throwaway copy of the whole app: Postgres 17, Redis 7 and MinIO in
docker, the API, the worker and the web app. Login is faked (`E2E_FAKE_AUTH` on the API,
`VITE_E2E_FAKE_AUTH` on the web build); see `apps/web/README.md`.

```bash
npx playwright install chromium   # once
npm run e2e                       # start the stack, run tests/, tear everything down
npm run e2e -- --repeat-each 3    # extra arguments go to `playwright test`
npm run e2e:screenshots           # write docs/screenshots/*.png
node tests/e2e/run.mjs --serve          # keep the stack up; open <web url>/?as=alice by hand
```

- `stack.mjs` starts and stops the stack (containers are named `chat-e2e-*`, ports are random).
  If `DATABASE_URL` and `REDIS_URL` are set it uses those instead of docker (CI does this).
- Logs of the API, worker and web server are in `tests/e2e/.logs/`; failure traces in `tests/e2e/.results/`.
- `tests/` has one file per journey, each commented. They are not part of `npm test`.
- CI: `.github/workflows/e2e.yml`.
