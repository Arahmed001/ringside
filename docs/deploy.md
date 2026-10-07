# Deploying Ringside

> New to deploying? [go-live.md](go-live.md) is the same material as plain, numbered steps. Have not chosen a host? [host-guide.md](host-guide.md) compares Fly.io, Render, Railway and a plain server against the requirements below.

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

`GET /api/health` returns `200 {"status":"ok","fighters":N,"bouts":N,"data":{"updatedAt":…,"ageHours":N,"stale":…}}` when the database is open and the world is built, and `503` otherwise. It reports counts and the age of the data only. `data.stale` is `true` when a licensed feed (`BOXING_PROVIDER=licensed`) has not been updated for more than two days, meaning the daily `vendor:backfill --update` has probably stopped and the site is serving old results; it is `null` for the demo league and a file feed. A stale feed never makes the answer a `503`: it is a reason to look at the cron, not to restart the container, so point an alert at `data.stale`, not at the status code. `npm run doctor` gives the same warning (`stale-data`). The image's `HEALTHCHECK` uses it; point a load balancer at it too.

## Settings

All optional; see `.env.example` for the full list.

- `SITE_URL`: the public origin, used for canonical URLs, sitemaps and share images. **Set it.**
- `SITE_CONTACT`: where someone who is not signed in can report a mistake, an email address or an `https://` page, published as written on the Data and Report pages (a role address like `corrections@…`, never a personal one). No default; the doctor warns when `BOXING_PROVIDER=licensed` and it is unset.
- `VENDOR_TERMS_URL`: the `https://` link to the data vendor's licence terms (or the page that states the written agreement). The Data page credits the vendor whenever `BOXING_PROVIDER=licensed` and links the terms once this is set; every page's footer carries the credit too ("Fight, fighter and event data: Boxing Data API"), because the vendor was told it would be credited wherever its data appears (where it is and how to remove it: `docs/vendor-credit.md`).
- `BOXING_PROVIDER`: while it is `demo` the site is `noindex`, so a demo deployment never competes with real sites in search. Set `INDEXABLE=1` only to override that on purpose. Either way the site is indexable only when `SITE_URL` is also a public address (not localhost): without it everything stays `noindex` and no sitemap is served. What was checked before launch: `docs/seo-audit.md`.
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

A league made of awkward values (markup and SQL in names, a 300-letter name, absurd heights, contradictory results, impossible dates, a fighter with no name; `lib/hostile-feed.ts`) is read through the real adapter by `tests/hostile-feed.test.ts` (nothing throws, every fight is kept or counted) and rendered page by page in both languages by `npm run smoke -- --feed hostile --crawl 60` (326 pages), which also fails if the markup from a name is ever on a page unescaped. CI runs it on every change, after the sparse, empty, unknown-facts and partial runs; run it by hand after changing the adapter, the validator or a page that shows a name.

## When a page breaks

A visitor gets the site's own error page (in their language, with the navigation still there, a Try again button and a short reference number) and never a stack trace, a message or a path; if the root layout itself fails, a plain bilingual page with the same reference. The server writes **one line of JSON** to stderr per error:

```json
{"at":"2026-10-03T15:33:42.396Z","level":"error","event":"request_error","digest":"1624447259","method":"GET","path":"/boxers/ramil-abad","route":"/[locale]/boxers/[slug]","type":"render","source":"react-server-components","error":"Error","message":"...","stack":["at ...","..."]}
```

The reference on the error page is that `digest`, so a report of "reference 1624447259" finds its line with `docker logs ringside 2>&1 | grep '"digest":"1624447259"'` (add `| jq .` for layout). The line has the path without its query string (a search is somebody's question), no headers, cookies or bodies, a message cut at 500 characters and the first six stack lines. It does contain the real error message, so treat the logs as internal. Anything that reads container logs (a log shipper, a platform alert on `"level":"error"`) can use it as is.

## Sizing

**At the real size (35,000 fighters, 160,000 fights), see [capacity.md](capacity.md):** what one instance serves (about 15 requests a second on one core, 21 on two, of a mixed workload), the memory it needs (after the memory diet: 0.7 GB at start, 1.1 to 1.2 GB under load, 1.4 GB while a data update or a new day rebuilds the world, so **2 GB is enough with no heap cap**; before it was 1.5, 1.7 and 2.2 GB, a 4 GB host or a capped heap), the 10 to 16 second stall a data update used to cause, and the 15 second one at midnight (both fixed: the old data keeps being served while the new is built; under a 1 GB heap cap it is shortened, not gone), and what to put in front. The older measurements below are of smaller leagues.

Measured on a production build with the demo league (968 fighters, 7,466 bouts; one Node process, one core, Apple laptop, a browser on the same machine, so network time is not in these numbers):

| | |
|---|---|
| a page, one visitor at a time | 5-17 ms on the server; first paint 70-140 ms; no layout shift; no long tasks |
| throughput | about 105 pages a second on one core, flat from 10 to 50 at a time (it queues rather than degrading); at 50 at a time p50 460 ms, p95 520 ms, no failures in 12,000 requests |
| memory | 200 MB when it starts, **about 600 MB resident under sustained load** (it settles there; no leak over 12,000 requests). The same demo ran at 350 MB with the heap capped at 160 MB (`NODE_OPTIONS=--max-old-space-size=160`) with no change in speed, so most of the 600 is garbage not yet collected |
| client JavaScript | about 220 KB gzipped for the whole site (React and Next are most of it); a page is 12-47 KB of gzipped HTML |

Re-measured 2026-10-06 on the 20x test world (`npm run bench -- --scale 20`: 19,360 fighters, 159,296 bouts, 1.1 million punch rows): the world builds cold in 18 s and holds about **541 MB of heap** (2.4 GB resident while the benchmark also holds its own data). That is above the 460 MB noted below from the earlier run, because the site now computes more per fighter; the real feed, with far fewer bouts and no punch rows, is the smaller case measured further down. Re-run it before sizing a host for a league much bigger than the real one.

What to do with it: give the container **at least 768 MB**, or cap the heap (`NODE_OPTIONS=--max-old-space-size=...`) and leave 200 MB for everything else. The heap needed grows with the data: the 20x test world (159,000 bouts) needed about 460 MB of heap, so a real feed's size matters more than traffic does. It is one core's worth of work per instance, and PLAN.md explains why there should be one instance; if you need more than about 100 pages a second, put a CDN or page cache in front rather than a second instance.

**At the size of the real feed (measured 2026-10-05):** a league of 32,152 fighters and 43,889 bouts, loaded by `vendor:backfill` from the stand-in vendor with the first real fetch's faults (half the careers held in part, `--drop-conflicts --allow-partial`), a 21 MB database, the same production build and machine.

| | |
|---|---|
| start-up | the world is built and the pages warmed in 1.2 s; 515 MB resident right after start (no heap cap) |
| pages | 11-100 ms one at a time (home 100 ms the first time, the rest 11-35 ms) |
| throughput | 117-135 pages a second at 30 or 50 at a time; p50 270-440 ms, p95 310-520 ms, no failures in 4,500 requests |
| memory, no cap | **761 MB resident** after 2,000 requests |
| memory, `--max-old-space-size=400` | works, **565 MB resident**, same speed |
| memory, `--max-old-space-size=250` | **does not start**: out of memory while building the world |

So at this size give the container **1 GB**, or cap the heap at 400 MB and give it 768 MB. The heap the world needs is between 250 and 400 MB here; it grows with fighters and fights, so re-measure when the feed grows by a lot. (The 760 MB is mostly garbage not yet collected, as with the demo.)

Around the site at that size (same league, same machine, 2026-10-05): `npm run model:fit` 1.2 s and 400 MB; `npm run backup` 0.4 s; `npm run data:check` 0.25 s and 87 MB; `npm run doctor` seconds. **A data change under a running site** (the daily `--update`, an approved edit): the next request rebuilds the in-memory world in 0.7-0.9 s (the following ones are 30-50 ms again), and with the heap capped at 400 MB the process stayed at 510-520 MB over four changes in a row, with no heap error: the old world is released before the new one is kept, so the cap does not have to cover two.

`npm run loadtest -- --base https://your-host --conc 50 --total 1000 --each` repeats this against any server you own (`--each` times every page alone to find a slow one). It is one Node process: past a few hundred requests a second it is measuring itself.

### The first visitor, and what start-up now does about it

Measured with `npm run coldcheck` on the 20x test world (159,000 bouts), restarting the server before each of 36 pages and timing the first request against the next three (`npm run bench -- --scale 20 --keep` makes the database; `npm run build` first). A first request always costs about 50-60 ms more than later ones (the page's code loading); this is about what costs more than that.

| | before round 31 | after |
|---|---|---|
| pages whose first visit was 300 ms or more slower than usual | 14 of 36 | 0 of 36 |
| slowest first visit | 948 ms (upset watch); trainers 810, all-time 808, track record 704, a fighter page 655 | 151 ms |
| the 36 first-visit penalties added up | 9.0 s | 2.2 s |
| server ready after start | 6.2 s | 9.1 s (3 s longer: the pages' aggregates are computed before it accepts requests) |
| memory, 20x world | 1,625 MB idle, 1,750 MB after 14 pages | 1,655 MB idle, 1,700 MB after 14 pages |

Two causes. The start-up warm-up only covered four aggregates, and what it did cover was never seen by the pages: Next builds the start-up hook and the pages as separate bundles, each with its own copy of `lib/memo.ts`, so the cache the warm-up filled was not the one the pages read (the world itself is shared through `globalThis`, its aggregates were not). The cache now lives on `globalThis`, and `WARM_STEPS` in `lib/warm.ts` lists everything the slow pages compute, with the arguments they use. If you add a page with an expensive whole-league aggregate, give it a line there.

To see what a page computes on its first visit: run the server with `RINGSIDE_MEMO_LOG=1` and visit it; every aggregate that takes 5 ms or more is logged once as a JSON line (`"event":"memo"`, its own time and its total). A production server also logs one `"event":"world_built"` line each time it builds the world (how long, the cache key and the key it replaced), which is how to tell a rebuild at midnight from one caused by the data changing.

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

**Every backup folder also holds `checksums.sha256`** (a SHA-256 for each file, in `sha256sum` format); `verify` checks it, so a copy that was cut short or altered in transit is caught even if SQLite can still open it. Backups made before this have no list: `verify` still checks them, and `restore` accepts one only with `--allow-unchecked`.

**Restoring:** stop the container, then in a throwaway container on the same volume run

```bash
docker stop ringside
docker run --rm -v ringside-data:/data ringside npm run backup -- restore /data/backups/2026-10-03T12-00-00Z --dry-run   # changes nothing
docker run --rm -v ringside-data:/data ringside npm run backup -- restore /data/backups/2026-10-03T12-00-00Z
docker start ringside
```

`restore` (in `lib/restore.ts`) does these in order and stops, changing nothing, at the first that fails: (1) the backup must verify, integrity and checksums; (2) it refuses if the site might be running (a process has the database open where `/proc` can be read, or something answers on port 3000 (`--port N` if the site uses another), or on a platform without `/proc` a leftover `-wal`/`-shm`; `--even-if-running` overrides, for a copy or when you are sure); (3) it saves the current data, checked, to `<data dir>/backups/before-restore/<timestamp>/` (folded WAL included); (4) it writes the new files beside the old ones (`*.restore-tmp`), flushes them and checks them again; (5) it renames them into place, removes the old `-wal`/`-shm`, and puts the files already swapped back if anything fails. Both files are restored together; a backup without `accounts.db` leaves the current accounts as they are, and `accounts.db` stays mode 0600. A `*.restore-old` file means an earlier restore was killed mid-swap: the next run refuses and tells you to look at it, since it holds the old data. **Undo** is the same command on the `before-restore` folder it printed. It prints paths, sizes and counts only, never rows. Restoring `ringside.db` rolls the ledger back to that day, so predictions locked since then are gone; restoring `accounts.db` rolls back sign-ups and picks the same way. Rehearsed on a copy of the demo league (PLAN.md section 209); not yet on a real host: do the `--dry-run` once before you need it.

## Before the first visitor: `npm run doctor`

```
npm run doctor -- --production        # --strict makes warnings fail too; --json for a machine to read
```

Checks the settings and the files they point to, and prints what it found with the fix beside each problem: Node version, the data folder is writable, both databases open and pass `quick_check` and have their tables (and the sports one has fights in it), `accounts.db` is not readable by other users, the newest backup is under two days old, free disk, `SITE_URL` is a real https origin, the licensed key looks like a key (a pasted `…` does not) and storing is confirmed, `INDEXABLE` is not inviting search engines to index fictional data, numbers are numbers, and **misspelt setting names** (`SITE_URLL`, `INDEXABEL`, `anthropic_api_key`), which are otherwise ignored without any error. It never prints a secret. Exit code 1 means something failed; run it from the same environment as the server (it reads `.env.local` like the other scripts).

The server also logs one JSON line when it starts (`"event":"config"`: provider, public origin, whether it is indexable, whether the model is on, and the ids of any problems) and one `config_problem` line per setting problem, with the fix. It does not look at the disk, so it adds nothing to start-up; `doctor` is the full check.

## Updating

Build a new image and replace the container with the same volume. The schema migrates forward on start (`ADDED_COLUMNS` in `lib/db.ts`). Downgrading to an older image against a newer database is not supported.

## Real data

A licensed feed is loaded and kept current by `npm run vendor:backfill` (first load, then a daily `--update`), not by the app: an empty database with `BOXING_PROVIDER=licensed` makes the app refuse to start a paid fetch on a page view. In a container pass `--cache-dir /data/vendor-cache` so the cache lives on the volume. See `docs/real-data-runbook.md`.

## Not covered yet

- **Scaling beyond one instance.** That needs the ledger, picks and cost-guard counters in a shared store, and is a design change rather than a setting.
- **Email.** Accounts have no email (nothing to verify, nothing to leak), so a forgotten password is reset by the operator with `npm run accounts -- reset NAME`. Add email and a mailer if that becomes a burden. See `docs/accounts.md`.
- **Monitoring and alerting.** The health endpoint is the hook; wire it to whatever your host offers.
- **The container has been built and run only in CI**, not on a particular host. Check the first deploy end to end.

### Behind a proxy: the client address

The public API limits each address to 60 requests a minute (`docs/public-api.md`). The address is read from `X-Forwarded-For` (first entry) or `X-Real-IP`, which the proxy in front of the site must set; the app never trusts a socket it cannot see. With neither header every visitor falls into one shared bucket (600 a minute), so the limit protects the server but a busy site would be throttled as a whole: configure the proxy to pass the client's address.
