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
- Security headers need nothing from the proxy except what is above: the app sets a content security policy (a fresh nonce per page), `X-Frame-Options`, `nosniff`, a referrer and permissions policy itself, and `Strict-Transport-Security` once it knows it is behind https. Do not add a second, different `Content-Security-Policy` in the proxy: browsers apply both, and the nonce-based one here would be defeated or broken. See `docs/security.md`.
- English is at `/`, Arabic at `/ar`; there is no redirect on `Accept-Language`, by design.

## First start, and the gap between seasons

The site renders with no data at all and with data but nothing upcoming: the home page says no fights are scheduled and drops the poster and calendar, the style map is empty until someone has eight bouts, rankings and analytics read zero rather than NaN. Both states are exercised in CI (`npm run smoke -- --feed empty` and `-- --feed sparse`, 68 and 95 pages in both languages) and by tests that call every aggregate and every Ask-the-data tool on those leagues. Before this was checked the home page and the style map returned a 500 in both states, which a real feed would have hit between seasons.

## When a page breaks

A visitor gets the site's own error page (in their language, with the navigation still there, a Try again button and a short reference number) and never a stack trace, a message or a path; if the root layout itself fails, a plain bilingual page with the same reference. The server writes **one line of JSON** to stderr per error:

```json
{"at":"2026-10-03T15:33:42.396Z","level":"error","event":"request_error","digest":"1624447259","method":"GET","path":"/boxers/ramil-abad","route":"/[locale]/boxers/[slug]","type":"render","source":"react-server-components","error":"Error","message":"...","stack":["at ...","..."]}
```

The reference on the error page is that `digest`, so a report of "reference 1624447259" finds its line with `docker logs ringside 2>&1 | grep '"digest":"1624447259"'` (add `| jq .` for layout). The line has the path without its query string (a search is somebody's question), no headers, cookies or bodies, a message cut at 500 characters and the first six stack lines. It does contain the real error message, so treat the logs as internal. Anything that reads container logs (a log shipper, a platform alert on `"level":"error"`) can use it as is.

## Sizing

Measured on a production build with the demo league (968 fighters, 7,466 bouts; one Node process, one core, Apple laptop, a browser on the same machine, so network time is not in these numbers):

| | |
|---|---|
| a page, one visitor at a time | 5-17 ms on the server; first paint 70-140 ms; no layout shift; no long tasks |
| throughput | about 105 pages a second on one core, flat from 10 to 50 at a time (it queues rather than degrading); at 50 at a time p50 460 ms, p95 520 ms, no failures in 12,000 requests |
| memory | 200 MB when it starts, **about 600 MB resident under sustained load** (it settles there; no leak over 12,000 requests). The same demo ran at 350 MB with the heap capped at 160 MB (`NODE_OPTIONS=--max-old-space-size=160`) with no change in speed, so most of the 600 is garbage not yet collected |
| client JavaScript | about 220 KB gzipped for the whole site (React and Next are most of it); a page is 12-47 KB of gzipped HTML |

What to do with it: give the container **at least 768 MB**, or cap the heap (`NODE_OPTIONS=--max-old-space-size=...`) and leave 200 MB for everything else. The heap needed grows with the data: the 20x test world (159,000 bouts) needed about 460 MB of heap, so a real feed's size matters more than traffic does. It is one core's worth of work per instance, and PLAN.md explains why there should be one instance; if you need more than about 100 pages a second, put a CDN or page cache in front rather than a second instance.

`npm run loadtest -- --base https://your-host --conc 50 --total 1000 --each` repeats this against any server you own (`--each` times every page alone to find a slow one). It is one Node process: past a few hundred requests a second it is measuring itself.

## Routine work inside the container

The maintenance scripts ship in the image (`tsx` is installed):

```bash
docker exec ringside npm run model:fit
docker exec -e WIKIMEDIA_CONTACT=you@example.com ringside npm run wikidata:import
docker exec -e WIKIMEDIA_CONTACT=you@example.com ringside npm run wikidata:import -- --enrich
```

A refit (`model:fit`) is picked up on the next request, with no restart. Run the long imports against a copy of the volume if you would rather not write to the live database while they run; SQLite takes a write lock per batch, so reads keep working either way.

## Backups

Two files cannot be re-derived: the live **ledger** inside `ringside.db` and everything in `accounts.db` (people, picks, edits). One command takes a consistent snapshot of both while the app keeps running (`VACUUM INTO`, not a file copy, which can tear):

```bash
docker exec ringside npm run backup
docker exec ringside npm run backup -- --keep 30
docker exec ringside npm run backup -- verify /data/backups/2026-10-03T12-00-00Z
```

Snapshots land in `/data/backups/<timestamp>/` (`ringside.db`, `accounts.db`, `model-fit.json`); `--keep` sets how many are kept (default 14; only folders with that timestamp name are ever removed). Every copy is opened and checked with `integrity_check` as it is written, and `verify` repeats that later and checks the important tables are there (the ledger table included); the command exits non-zero if anything is wrong, so a scheduler can alert on it. The accounts copy is personal data and is written readable by its owner only. **A backup on the volume that dies is not a backup:** copy the newest folder off the machine (an object store, another host) on a schedule, for example a daily `docker exec ringside npm run backup` followed by an upload of the newest `/data/backups/*` folder.

**Restoring:** stop the container, replace `ringside.db` and/or `accounts.db` in `/data` with the files from a snapshot (delete the old `-wal` and `-shm` files beside them), start it again. Run `verify` on the snapshot first. Restoring `ringside.db` rolls the ledger back to that day, so predictions locked since then are gone; restoring `accounts.db` rolls back sign-ups and picks the same way. A restore has not been rehearsed on a real host: do it once, on a copy, before you need it.

## Updating

Build a new image and replace the container with the same volume. The schema migrates forward on start (`ADDED_COLUMNS` in `lib/db.ts`). Downgrading to an older image against a newer database is not supported.

## Real data

A licensed feed is loaded and kept current by `npm run vendor:backfill` (first load, then a daily `--update`), not by the app: an empty database with `BOXING_PROVIDER=licensed` makes the app refuse to start a paid fetch on a page view. In a container pass `--cache-dir /data/vendor-cache` so the cache lives on the volume. See `docs/real-data-runbook.md`.

## Not covered yet

- **Scaling beyond one instance.** That needs the ledger, picks and cost-guard counters in a shared store, and is a design change rather than a setting.
- **Email.** Accounts have no email (nothing to verify, nothing to leak), so a forgotten password is reset by the operator with `npm run accounts -- reset NAME`. Add email and a mailer if that becomes a burden. See `docs/accounts.md`.
- **Monitoring and alerting.** The health endpoint is the hook; wire it to whatever your host offers.
- **The container has been built and run only in CI**, not on a particular host. Check the first deploy end to end.
