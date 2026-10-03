# Deploying Ringside

Ringside is one Node process with one SQLite file. That shapes the deployment: **run exactly one instance, with a persistent volume.** Two instances would each hold their own copy of the database, the live ledger and visitors' cached AI answers.

This was written without a hosting provider chosen. Nothing here is specific to one; the container is the unit.

## What needs to persist

| What | Where | Why it matters |
|---|---|---|
| `ringside.db` (+ `-wal`, `-shm`) | `/data` (set by `DATABASE_PATH`) | All data, and the **live ledger**: its predictions are append-only and cannot be rebuilt after the fact. Back this up. |
| `accounts.db` (+ `-wal`, `-shm`) | `/data`, next to the database (`ACCOUNTS_DB_PATH` to move it) | **People's accounts, picks and edits.** Not rebuildable from anything else, and personal data: back it up, keep it on the volume only, never in the image. Created on first sign-up; permissions 0600. |
| `model-fit.json` | `/data` (symlinked from `data/model-fit.json`) | The fitted model, written by `npm run model:fit`. Without it the hand-set weights are used. |

Everything else (the in-memory world, caches, rate-limit counters) is rebuilt on start. The AI cost guard's counters reset on restart, so a restart refills the day's budget; keep that in mind if the budget matters to you.

## Build and run

```bash
docker build -t ringside .
docker run -d --name ringside -p 3000:3000 -v ringside-data:/data \
  -e SITE_URL=https://ringside.example \
  -e ANTHROPIC_API_KEY=... \
  ringside
```

The first start seeds the demo league into an empty database (about 2 seconds) and builds the in-memory world before the server accepts traffic (about 1 second at demo size, about 4 seconds at 160,000 bouts), so nobody waits for it.

`GET /api/health` returns `200 {"status":"ok","fighters":N,"bouts":N}` when the database is open and the world is built, and `503` otherwise. It reports counts only. The image's `HEALTHCHECK` uses it; point a load balancer at it too.

## Settings

All optional; see `.env.example` for the full list.

- `SITE_URL`: the public origin, used for canonical URLs, sitemaps and share images. **Set it.**
- `BOXING_PROVIDER`: while it is `demo` the site is `noindex`, so a demo deployment never competes with real sites in search. Set `INDEXABLE=1` only to override that on purpose.
- `ANTHROPIC_API_KEY`, `AI_DAILY_BUDGET`, `AI_CLIENT_LIMIT`, `AI_CLIENT_WINDOW_MS`: the AI features and what visitors can spend. Without a key everything falls back to rules.
- `DATABASE_PATH`: defaults to `/data/ringside.db` in the image.

Put the key in your host's secret store, not in the image or the repository.

## Putting it on the internet

- Terminate TLS in front of the container (the host's proxy, Caddy, a load balancer). The app speaks plain HTTP on `PORT` (3000).
- Pass the real client address in `X-Forwarded-For`: the per-visitor AI limit and the sign-in and sign-up limits are keyed on it. Without a proxy in front, every visitor looks alike. A client that can reach the container directly can fake the header, so do not publish the container's own port; the per-name and site-wide limits do not depend on it.
- Pass `X-Forwarded-Proto: https` (or set `SITE_URL=https://…`) so the session cookie is marked `Secure`, and keep `Host` or `X-Forwarded-Host` as the public name: state-changing requests are refused unless their `Origin` matches it (CSRF protection).
- English is at `/`, Arabic at `/ar`; there is no redirect on `Accept-Language`, by design.

## Routine work inside the container

The maintenance scripts ship in the image (`tsx` is installed):

```bash
docker exec ringside npm run model:fit                      # refit; picked up on the next request, no restart
docker exec -e WIKIMEDIA_CONTACT=you@example.com ringside npm run wikidata:import
docker exec -e WIKIMEDIA_CONTACT=you@example.com ringside npm run wikidata:import -- --enrich
```

Run the long imports against a copy of the volume if you would rather not write to the live database while they run; SQLite takes a write lock per batch, so reads keep working either way.

## Backups

The ledger is the one thing that cannot be re-derived. Take a consistent copy while the app runs:

```bash
docker exec ringside node -e "const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.env.DATABASE_PATH);d.exec(\"VACUUM INTO '/data/backup.db'\")"
```

and the same for the accounts file (`ACCOUNTS_DB_PATH`, default `/data/accounts.db`, saved as `/data/accounts-backup.db`), then copy both off the volume (and delete them from the volume). Copying `ringside.db` alone while the app is writing can give you a torn file; the `-wal` file holds recent writes.

## Updating

Build a new image and replace the container with the same volume. The schema migrates forward on start (`ADDED_COLUMNS` in `lib/db.ts`). Downgrading to an older image against a newer database is not supported.

## Not covered yet

- **Scaling beyond one instance.** That needs the ledger, picks and cost-guard counters in a shared store, and is a design change rather than a setting.
- **Email.** Accounts have no email (nothing to verify, nothing to leak), so a forgotten password is reset by the operator with `npm run accounts -- reset NAME`. Add email and a mailer if that becomes a burden. See `docs/accounts.md`.
- **Monitoring and alerting.** The health endpoint is the hook; wire it to whatever your host offers.
- **The container has been built and run only in CI**, not on a particular host. Check the first deploy end to end.
