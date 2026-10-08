# Capacity: how many visitors can one instance serve

Ringside must run as exactly one copy (one Node process, one SQLite file; `docs/deploy.md` says why). This is the measurement of what one copy can serve at the size of the real league, and what to ask of a host. **Every figure below was measured here, in the sandbox described under "What this is and is not"; nothing is quoted from elsewhere or estimated, except where a line says "assumption" or "calculation".** The numbers will differ on a real host: use them for the shape and the order of magnitude, then re-run the driver on the host (last section).

## Summary

- **One instance is limited by one thread.** The site renders every page on request in one Node thread. On one core it served about **15 requests a second** of a realistic mix (a request is a page, an API call, an image); on two cores about **21**. A second core helps by 35 to 40% (garbage collection and compression run beside the main thread); a third or fourth core does nothing for one instance. Ask for **2 vCPUs**.
- **In visitors** (calculation, with an assumption: 85% of requests in the mix are pages, and a reader looks at a new page every 30 seconds): one core carries about 380 people reading at once, two cores about 530. Look at a page every 60 seconds and the numbers double. These are the ceiling, not a comfortable load: at the ceiling a request waits behind the others (about 1 second at 20 requests in flight on two cores, 3.3 seconds at 50 on one).
- **Memory: 2 GB is enough; set `MALLOC_ARENA_MAX=2` (after the memory diet and "The leftovers" below; the figures before them are kept in the tables further down, marked as before).** On the 35,000-fighter league the process is **0.61 to 0.65 GB right after start, about 0.94 to 1.06 GB under load, and 1.30 to 1.39 GB at the moment a data update makes it rebuild its in-memory world** (old and new world both alive), where the build before the leftovers measured 0.70 GB, 1.05 GB and 1.40 to 1.42 GB on the same machine, and before the diet 1.5, 1.6 to 1.9 and 2.2 GB. With `MALLOC_ARENA_MAX=2` (glibc's allocator keeps fewer arenas: no change in speed, measured) it is **0.60 to 0.62 GB, 0.82 to 0.90 GB and 1.12 to 1.23 GB**; with that and a 1 GB heap cap, 0.51 to 0.53 GB, 0.73 to 0.85 GB and 1.06 to 1.10 GB, at 4 to 7% less throughput (inside the noise) and a heap with no room below it (a cap of 896 MB already slowed the site, 768 MB did not finish the update). For a 2 GB host: `MALLOC_ARENA_MAX=2`, no heap cap (`docs/deploy.md`). A 4 GB host is no longer needed; a 1 GB host is not enough.
- **Disk is not a constraint:** the database for 35,000 fighters and 160,000 fights is 62 MB.
- **A data update under traffic used to stall the site for 10 to 16 seconds; it no longer does (fixed, "Fixes after the first measurement" below).** The update commits three times, each moved `dbVersion`, and each move rebuilt the in-memory world (4.7 s each) on the one thread that serves visitors. Now one rebuild runs, in slices, behind the old world, which keeps answering; the new one is warmed and swapped in whole. Measured on the same machine, alternating runs: nothing answered for 6 to 13 s (before) against 1.3 to 1.7 s (after), the slowest answer 11 to 14 s against 1.9 to 2.2 s. The process still peaks at about 2.1 GB (two worlds alive together), and a start takes 11 to 16 seconds before it answers.
- **Little sits in front of the server today that can take load off it:** pages are sent `Cache-Control: private, no-cache, no-store` (a decision, below), so a CDN with default rules caches none of them. Share images (`public, max-age=600, stale-while-revalidate=3600`) and sitemap files (`public, max-age=3600`, gzip) now can be cached, and the origin keeps a copy of both in memory. What a CDN can and cannot safely be told is in "What to put in front".
- The measurement found two hot spots that were not about traffic, and fixed them: a fighter page worked out the style of every fighter in the league and scored every possible opponent, and a country page scanned every event and bout, on each view. Throughput of the mix went from **9-10 to 15-16 requests a second on one core, and from 11-13 to 20-22 on two** (alternating runs, same machine); the fighter page went from 168 to 69 ms and the country page from 319 to 34 ms. The behaviour is unchanged (tests below).

## What this is and is not

- **The league.** 34,992 fighters, 160,012 fights, 74,510 events, a 62 MB database, built by the real load path against the stand-in vendor (`lib/vendor-mock.ts`, no network, no real API): `npm run vendor:rehearse -- --fighters 35000 --fights 160000 --keep`, which runs `vendor:backfill` as a plan (64 s, 288 MB), a check that fetches and validates (3.1 min, 610 MB, 36,627 requests to the stand-in, 122 MB of cache), the load into a new database (17 s, 762 MB peak) and a daily `--update` (7.5 s, 390 requests), and passed all its own checks (every fight loaded, every fighter's record adds up). The copy used for the tests was made in a temporary folder; no real database was touched and no real vendor was called.
- **It is synthetic.** Fighters are "Fighter 123", fights are random pairings inside a division, there are only 10 countries (so a country page here has about 3,500 fighters, more than a real one would), and the league has no punch statistics, no money, no people, no organisations, no pictures and no official lists. A real league is smaller in fights per fighter (about 1.4 against 4.6 here) and richer in the other tables. The real size of fighters and fights is what drives the memory and the world build; the mix of pages is an assumption.
- **The machine.** A 4-core virtual machine with 16 GB (`nproc` = 4), Linux 6.18, Node 22.22.0, Next.js 16.3.8, production build, shared with other work (the machine's 1-minute load average was 1.5 to 2.7 during the runs reported, and up to 13 during one run that was thrown away and repeated; each table row's `load1` was recorded by the driver). "One core" and "two cores" mean the server was pinned with `taskset -c 0` or `taskset -c 0,1` and the load driver with `taskset -c 2,3`. A rented vCPU is usually slower than a core of this machine, and shares more; expect lower numbers, not higher.
- **The test.** Closed loop on localhost: each of N virtual visitors asks again the moment it is answered (no think time), so it finds the ceiling. No TLS, no network, no proxy, no CDN, no browser. Each virtual visitor sends its own `X-Forwarded-For` so the per-address limits behave as behind a proxy. Each row is one 30-second run (the "before" one-core runs 20 s); repeating a configuration moved the throughput by up to 10%, so treat differences under 10% as noise.
- **The mix** (`scripts/capacity.ts`, an assumption, not measured traffic; shares of requests): 8 home, 3 rankings index, 8 a division's rankings (some with the women's list, a page, a sort or an official list), 14 the fighters list (plain, sorted and paged to any of 200 pages, filtered by division and status, and a text search), 22 a fighter page, 3 events list, 5 an event, 3 a fight, 5 country pages and the countries index, 2 all-time lists, 3 other whole-league pages (analytics, map, upset watch, money, trainers, titles, matchmaking, on this day), 5 the ⌘K search API, 3 the type-ahead API, 3 share images, 1 the fighter card API, about 1 the sitemap. A quarter of page requests are in Arabic. Paths come from the server's own sitemap, so they exist. The public API (`/api/v1`) is off for licensed data until the owner switches it on, so it is not in the mix (`--v1` adds it); it was not measured.

## Method

1. `npm run build`; `npm start` on a free port with `BOXING_PROVIDER=licensed`, `SITE_URL=https://capacity-test.example.org` (a non-localhost name, so the site is indexable and serves sitemaps), the copy as `DATABASE_PATH`.
2. `scripts/capacity.ts` (`npm run capacity`): replays the mix at 1, 5, 20, 50 and 100 at a time for a fixed time each, recording requests a second, p50/p95/p99/max latency, failures (anything not 2xx, or no answer in 30 s), and the server's CPU and resident memory from `/proc/<pid>` every 250 ms. `--cold` times the first request of each kind straight after a start. `--event-cmd` runs a command part-way through a step (the real `vendor:backfill --update` against the stand-in, or `scripts/capacity-update.ts`, which makes the same three commits without a vendor, writing into the database the server was reading) and prints a second-by-second table and, since the fixes below, "nothing answered for N s at the longest, slowest answer, answers over 2 s".
3. The slow routes were found from per-kind latencies, then from V8 CPU profiles of the production server (`--cpu-prof`) resolved through the source maps to the repository's own lines.
4. Before and after a change, the old and new builds were run alternately on the same machine, same seed, same sequence of requests.

## Results

### Start-up

| | measured |
|---|---|
| time from launch to the first answered `/api/health` | 10.9 to 16.5 s (about a dozen starts) |
| of which building the in-memory world | 4.4 to 5.3 s (logged as `world_built`) |
| of which computing what the pages share (`WARM_STEPS`) | 7.3 to 9.8 s ("pages warmed") |
| resident memory when ready, no heap cap | 1.285 to 1.302 GB |

The server does not accept requests until both are done, so no visitor waits for them (`docs/deploy.md`: "about 4 seconds"; the 4 s is the world, the aggregates are 7 to 9 s more at this size). The Dockerfile's health check allows 120 s to start.

### Throughput and latency, final build

One core (server on core 0), mix above, 30 s per row:

| at a time | requests | req/s | p50 ms | p95 ms | p99 ms | failures | server CPU | peak RSS MB |
|---|---|---|---|---|---|---|---|---|
| 1 | 440 | 14.7 | 57 | 171 | 378 | 0 | 97% | 1,510 |
| 5 | 457 | 14.9 | 279 | 790 | 1,428 | 0 | 100% | 1,605 |
| 20 | 453 | 14.9 | 1,305 | 2,587 | 2,961 | 0 | 100% | 1,649 |
| 50 | 483 | 15.8 | 3,338 | 5,272 | 8,874 | 0 | 100% | 1,649 |
| 100 | 455 | 14.2 | 6,072 | 19,920 | 28,996 | 2 (30 s time-outs) | 100% | 1,667 |

Two cores (server on cores 0 and 1):

| at a time | requests | req/s | p50 ms | p95 ms | p99 ms | failures | server CPU (of one core) | peak RSS MB |
|---|---|---|---|---|---|---|---|---|
| 1 | 529 | 17.6 | 52 | 115 | 245 | 0 | 112% | 1,529 |
| 5 | 605 | 20.1 | 237 | 488 | 848 | 0 | 133% | 1,619 |
| 20 | 632 | 21.0 | 998 | 1,574 | 1,759 | 0 | 145% | 1,635 |
| 50 | 639 | 21.1 | 2,524 | 3,690 | 6,692 | 0 | 140% | 1,674 |
| 100 | 664 | 20.9 | 4,672 | 11,109 | 18,769 | 0 | 138% | 1,702 |

Reading them: the server is saturated by **one** visitor asking back to back (one core: 97% busy at 1 at a time, 14.7 req/s; 100 at a time gives no more). Adding visitors only lengthens the queue: the median is about the number in flight divided by the throughput (20 in flight on one core: 1.3 s). At 100 in flight on one core the tail is long and unfair (p95 20 s, two requests gave up after 30 s), so **a proxy should limit the requests in flight to the origin to about 10 to 20 and queue or shed the rest**. These steps measure the ceiling; a site working normally is far below it.

### Before and after the fixes

Same machine, old and new build alternately, 30 s a step, requests a second (p50 ms in brackets):

| | at 1 | at 5 | at 20 | at 50 |
|---|---|---|---|---|
| one core, before | 8.7 (67) | 10.3 (464) | 9.1 (2,310) | 10.7 (4,805) |
| one core, after | 13.4 (58) | 16.2 (252) | 15.8 (1,241) | 16.0 (3,263) |
| two cores, before | 10.3 (59) | 12.9 (384) | 11.0 (1,968) | 11.6 (4,703) |
| two cores, after | 17.0 (53) | 20.2 (237) | 22.1 (936) | 21.1 (2,486) |

(Their other full runs, before: one core 7.8 to 10.0 and two cores 10.4 to 12.2 a second over the five steps; after: the tables above.)

### The slowest routes

One visitor at a time on two cores, p50 in ms, with the number of requests behind each figure; "before" is the unfixed build. This is the cost of the request itself, with nothing queued behind another.

| kind of request | before | after | n after |
|---|---|---|---|
| share image of an event or the home page (`/…/opengraph-image`) | 243 | 248 | 4 |
| share image of a fighter | 259 | 221 | 11 |
| fighters list with a text search (`?q=`) | 200 | 159 | 6 |
| the sitemap file (8.6 MB of XML, built on every request) | not in the run | 95 | 1 |
| all-time list | 76 | 76 | 8 |
| fighters list sorted or paged | 82 | 74 | 19 |
| **fighter page** (22% of the mix) | **168** | **69** | 128 |
| fighters list filtered | 70 | 65 | 29 |
| fighters list | 70 | 63 | 20 |
| events list | 58 | 56 | 19 |
| event page | 46 | 44 | 27 |
| home | 50 | 44 | 48 |
| fight page | 43 | 38 | 26 |
| rankings index | 44 | 37 | 21 |
| **country page** | **319** | **34** | 21 |
| a division's rankings | 32 | 30 | 55 |
| other whole-league pages | 28 | 26 | 19 |
| ⌘K search API | 7 | 11 | 31 |
| type-ahead API | 20 | 4 | 20 |
| fighter card API | 4 | 4 | 8 |

What is left is spread evenly: a typical page is 40 to 80 ms of one thread, and the V8 profiles put the garbage collector at 14 to 16% of all CPU time under the mix. The share image is the dearest single request (it draws a picture), and the text search on the fighters list the slowest page: it normalised every fighter's name on each request (in `applyFilters`, `lib/ai.ts`). Both are fixed since (below); the table above is the measurement before those fixes.

### Memory (before the memory diet; the numbers after it are in "The memory diet and the midnight rebuild")

Resident memory of the server process, no heap cap, two cores, 1 MB = 1,048,576 bytes:

| when | MB |
|---|---|
| ready after start | 1,285 to 1,302 |
| during the mix, 5 to 100 at a time | 1,500 to 1,700 (peak per step in the tables above) |
| soak: six 60-second runs at 20 at a time, 7,600 requests, end of each minute | 1,599, 1,604, 1,632, 1,650, 1,633, 1,633 (peaks 1,594 to 1,671: flat, no leak) |
| peak while the world is rebuilt after a data change | 2,182 (two cores; 2,196 on one core, before the fixes) |

Heap caps (`NODE_OPTIONS=--max-old-space-size=N`), two cores, before the memory diet (the same caps on the current build are in "The leftovers"):

| cap | ready, MB | under load, MB | req/s at 5 and 20 at a time | after a data update |
|---|---|---|---|---|
| none | 1,290 | 1,500 to 1,700 | 20.1, 21.0 | peak 2,182 MB, stall about 10 s |
| 1,024 | 692 | 1,141 to 1,222 | 18.5, 18.7 | peak 1,368 MB, stall about 16 s, survived |
| 700 | 808 | 980 to 1,034 | 14.8, 15.4 | not tried |
| 500 | 635 | died: `JavaScript heap out of memory` in the first 30 s under load | | |

So the world needs between 500 and 700 MB of heap at this size, and a cap near 1 GB leaves room to hold two of them while one is rebuilt. (`docs/deploy.md` measured 250 to 400 MB at 44,000 fights; the heap grows with the fights, as it says.)

### A data update while serving: the measurement that found the stall (before the fix)

Method: 5 at a time on two cores for 70 s; at 20 s the real `vendor:backfill --update` (6.8 to 8.3 s, 324 to 348 requests to the stand-in, a few fights changed) runs against the same database file. The update is a separate process, as the daily job is.

- The server logged **three** `world_built` lines in total, the first at start and **two more for the one update** (keys `2026-10-06|2.3.0` to `3.3.0` to `4.4.0`): `dbVersion` is `PRAGMA data_version` (which moves each time another process commits) plus the newest `ingest_runs` id, and the update commits its fights, then its recomputed ratings, then its run record, so a request that arrives between commits rebuilds again. Each rebuild took 4.4 to 4.8 s on two cores uncapped (6.1 and 6.0 s on one core before the fixes, 8.4 and 6.0 s under the 1 GB cap).
- **Nothing was answered for about 10 s** (two cores, no cap: from second 28 to second 37 of the run at most 5 requests finished; the requests waiting then took up to 7.4 s). The rebuild runs on the one thread that serves requests, so it cannot be overlapped. Under the 1 GB cap the gap was 16 s with a 16.9 s wait. On one core and a busy machine, before the fixes, it was 11 s with 13 to 14 s waits. No request failed in any of these runs.
- Memory went from 1.45 GB to 2.18 GB (old and new world alive together), and returned to 2.0 GB, where it stayed until a collection.
- After the rebuild, the aggregates the pages share (`memo`, per world) start empty and are recomputed by the first visitor to each page: in the minute after the stall the median was 300 to 400 ms and some requests took 1.4 s, back to normal within about 5 s. The warm-up (`lib/warm.ts`) runs only at start and at midnight, not after a data-triggered rebuild.
- Reads and writes do not block each other at the SQLite level (WAL); the stall is the rebuild only.

### The first request after a start

The server answers nothing until the world and the shared aggregates are built, so the first request is close to the second. First request, then the same URL again, in ms, two cores:

| | before | after |
|---|---|---|
| `/` | 428, 90 | 70, 75 |
| `/boxers` | 86, 75 | 113, 98 |
| a fighter page | 163, 111 and 241, 200 | 131, 93 and 84, 66 |
| `/events/27598` | 113, 47 | 110, 47 |
| `/countries/mexico` | 396, 315 | 39, 50 |
| `/api/search?q=fighter 1` | 284, 16 | 60, 13 |
| a fighter's share image | 430, 241 | 409, 239 |
| `/sitemaps/2.xml` | 131, 122 | 107, 104 |

The after column is the build with the two new warm-up lines described under the fixes. The share image's first request is still 170 ms dearer than its second (the drawing library loads); not changed.

### Page assets

A page links about 30 files under `/_next/static/` (measured on the home page), each sent `Cache-Control: public, max-age=31536000, immutable`. Asked for all at once, one core served them at 341 requests a second (5 at a time) to 470 (50 at a time), 21 to 28 MB/s. So for a visitor with an empty browser cache the origin pays about 65 to 90 ms of the one thread for the assets (one core, measured before the fixes; the assets are not touched by them), about as much as for the page itself. A CDN removes that; a returning visitor's browser does.

## What is cached, what is rebuilt, what invalidates

- **The world** (every fighter, fight and event, with ratings and indexes, in memory): built once, kept on `globalThis`, keyed by `today|dbVersion`. Each request checks the key with two one-row queries (`PRAGMA data_version`, newest `ingest_runs` id; `lib/db.ts`) and rebuilds on a mismatch (see "Fixes after the first measurement" for how: a change another process made is rebuilt in the background once it has settled, while the old world keeps answering; a new day, this process's own change and `invalidateWorld` rebuild at once). The key changes when the UTC day changes, when **another process** commits to the database (the daily update; this process's own writes do not move `data_version`), when the newest ingest run changes, and when code in the process calls `bumpDbVersion` (approving a community edit). The rebuild takes 4.4 to 5.2 s of the thread at this size; it now runs in slices of about 25 ms that give the thread back between them (at most about 1 s in one piece, the SQL reads and one sort), so visitors are answered meanwhile. The old world is garbage once nothing uses it, but it is alive until the new one is assigned, hence the 2.1 to 2.2 GB peak.
- **Aggregates** (`lib/memo.ts`): a `WeakMap` per world, so a new world starts empty and the old ones go with it. `WARM_STEPS` fills the slow ones at start, at 00:00:05 UTC each day (`scheduleDailyWarm`) and now before every data-triggered rebuild is shown; anything not in the list is computed by the first visitor.
- **Per request, every time:** the whole HTML of every page (the layout is `force-dynamic`; nothing is cached by Next), the fighters list's filter and sort of up to 35,000 rows, a fighter page's profile and its neighbours, JSON of the APIs. There is no page cache in the app. Kept in memory, bounded by bytes, since the fixes: drawn share images (24 MB, keyed by everything on the card) and gzipped sitemap files (32 MB, per world).
- **Middleware** (`proxy.ts`) runs on every request: a fresh CSP nonce, the locale rewrite.

## What was fixed, and the proof

All three were found in V8 profiles of the production server, and each is a pure re-organisation: the same inputs give the same outputs.

1. **A fighter page recomputed league-wide work.** `similarTo` built a style vector for all 34,000 fighters with five fights and sorted them, on every view; `suggestOpponents` built a full pairing (prediction with its factor notes, translated sentences) for each of thousands of candidates and kept three. Now the vectors are built once per world (`lib/style.ts`, `memo`), the nearest few are kept by insertion rather than a full sort, with the order a stable sort gave (ties in league order); candidates are scored with the numbers only (`evaluate`) and only the few shown get sentences (`explain`); the set of booked fighters is built once per world. Fighter page: 168 to 69 ms.
2. **A country page scanned every event and bout, and slugified each event's country, on every view** (`lib/countries.ts`). The events held in each country (newest first) and the coming fights are now built once per world, and a name's slug is remembered within a loop. Country page: 319 to 34 ms.
3. **Two first-visit costs moved to start-up** (`lib/warm.ts`): the fighter-page and country-page structures, and the ⌘K search's indexes. The search indexes were in module-level `WeakMap`s (`lib/search.ts`), which Next bundles twice (the start-up hook and the routes each get a copy; the same trap `lib/memo.ts` documents), so what the start-up built was never what the route read; they now use the shared registry like the fighter-name index. First search after a start: 284 to 60 ms. Start-up is 1.5 to 2 s longer for it ("pages warmed" took 7.3 to 7.6 s before and 8.7 to 9.1 s after).

Tests (`tests/capacity-hotspots.test.ts`, `tests/capacity-countries.test.ts`, `tests/capacity-search.test.ts`): the old algorithm is written out in the test and the new code must return exactly the same answer, ties included, for a spread of fighters and every country, for several list lengths; a synthetic league of identical fighters checks tie order; `winChances` equals `predict`'s probabilities digit for digit; the shared lists cannot be changed by a caller; the search indexes live in the shared registry. Mutation checks: reversing the tie rule, dropping the rating tie-break, and including upcoming events were each caught by a test.

## Fixes after the first measurement

Found by the measurement above and fixed afterwards, each with a test (`tests/capacity-update.test.ts`, `tests/capacity-textsearch.test.ts`, `tests/capacity-share.test.ts`) and a measurement on the same machine, alternating the old and the new build, same data, same driver. **Caveat on every number here:** the sandbox is a shared 4-core machine; other work was running (1-minute load average 1.2 to 2.0 during these runs, which the driver records, and a number of runs started while other tests were running were thrown away and repeated once it was quiet). Differences under 10% are noise. The "before" build is the commit these fixes start from (the three hot-spot fixes above are in both).

### 1. The update stall: fixed

What happened: another process's update commits three times (its fights, its ratings, its run record); each commit moves `dbVersion`; each request that saw a new version rebuilt the world on the one thread (4.7 s), and everything after the rebuild was cold.

What it does now (`lib/world.ts`):

- **Coalesce.** A change made by another process (not a new day, not this process's own `bumpDbVersion`, not `invalidateWorld`, which still rebuild at once because there is nothing right to show) starts a settle timer. The world is rebuilt when the data has stayed unchanged for `RINGSIDE_WORLD_SETTLE_MS` (default 5 s) or after 60 s of changes whatever happens. Three commits, one rebuild (test: three commits 80 ms apart, one `world_built`).
- **Never block.** Until the new world is ready the previous one keeps answering (stale while revalidate). The build reads from its own read snapshot connection, so the data is one consistent state even though the build yields; it runs in slices of about 25 ms and, as a background rebuild, sleeps 15 ms between slices (giving the thread back for whole stretches: yielding for one turn of the event loop between slices left a request needing a dozen turns waiting a dozen slices, which was measured to be nearly as bad). The new world is published by one assignment, so a request sees all of the old one or all of the new one. Visitors that arrive when there is no world at all (the first build, a new day) wait for it, all for the same build (callers share one build).
- **Re-warm.** The page aggregates (`WARM_STEPS`) are computed on the new world before it is shown (so the first visitors after the swap do not pay for them), in finer steps (one list, one language) and with a sleep as long as the step took (at most 1 s) between them. At start-up the warm-up is as before.
- **On failure** the old world stays, one line is logged per version of the data (`world rebuild failed ... still showing the previous data`), and the next try is made when the data changes again or after 60 s. (Test: a table the build reads is renamed away: 20 more requests are answered from the old world, one log line; repaired, the next rebuild succeeds.)

Measured (two cores, 5 at a time for 70 s, a synthetic update by another process at 20 s: three commits 1.5 s apart, `scripts/capacity-update.ts`; the data is the 35,000-fighter league):

| | before (3 runs) | after (2 runs) |
|---|---|---|
| world rebuilds for the one update | 2 | 1 |
| longest time in which nothing was answered | 6.3, 13.0 s (and about 12 s in the first run, which did not have the metric and ran at a load average of 5.8) | **1.3, 1.7 s** |
| slowest answer | 11.1, 13.3, 14.0 s | **1.9, 2.2 s** |
| answers that took over 2 s after the update | 9, 6 | 0, 2 |
| seconds with no answer at all in the 30 s after the update began | 9, 11, 13 | 1, 1 |
| answers per second in those 30 s (15 to 16 when nothing is going on) | 7.8 to 9.9 | 13.3, 13.3 |
| failed requests (not a 2xx, or no answer in 30 s) | 1, 2, 1 | 0, 0 |
| p95 / p99 of the whole 70 s run | 625 to 767 / 1,433 to 1,695 ms | **915 to 971** / 1,233 to 1,277 ms |
| peak resident memory | 1,875 to 2,117 MB | 2,084 to 2,112 MB |

Read this honestly: the p95 of the whole run is **higher** after, because for about 15 s the rebuild shares the thread with the visitors, who are answered at 13 a second instead of 8 with a few answers of 12 s; the stall, which a percentile hides (five visitors stuck means five slow samples), is gone. The longest block of the thread is now about 1 s (event-loop lag logged at one visitor: 1.9 s before the warm-up was cut into finer steps, 1.07 s after). **The new data is shown later:** at one visitor a second, the swap came 26.3 s after the rebuild started (build 6.5 s, the warm-up 20 s with its sleeps) plus the 5 s settle, so about 30 s after the last commit, where it was shown at once (behind a 10 s stall); under a saturating load it is longer. `world_built` is logged when the build finishes and `world_swapped` when it is shown.

**Memory: the old and the new world are alive together, as before.** The peak is unchanged (about 2.1 GB uncapped; the documented 2.2 GB), because the old world was never freed before the new one was assigned either. Nothing is dropped earlier: the old world is what visitors are being served from, and dropping it first would bring the stall back. What is new is that the new world's aggregates are also alive before the swap; the measured peak did not move. **Under `--max-old-space-size=1024` (one run each, same method):** before, nothing answered for 16.4 s, slowest answer 16.9 s (two rebuilds, 8.7 and 6.0 s); after, 4.7 s and 5.8 s, and 26 answers over 2 s: the process survived and one rebuild took 13.5 s, because two worlds and a warm-up in a 1 GB heap make the garbage collector work hard. So under that cap the stall is shortened (16.4 s to 4.7 s) but not gone; **if updates happen under traffic, give the process a heap above 1 GB, or the 4 GB without a cap that the sizing already recommends.** Everything below that cap is a trade the owner should know about, not a fix.

What is not changed: a request that arrives while the data is newer than its world still runs the caches that are keyed by `dbVersion` itself (the translated-names table, `coverage()` at 0.8 s, the leaderboard) once per new version, so the three commits cost up to three of those recomputations during the settle window. They are small next to a world rebuild.

### 2. The fighters list's text search: fixed

The search normalised (NFD, accent and Arabic folding, regular expressions) every candidate's name, translation, nickname and nickname's translation on every request. It is now computed once per fighter and per language table and kept (`searchTextOf` in `lib/ai.ts`, in the registry every bundle shares; a rebuilt world has new fighter objects, so it follows the data) and filled by the warm-up (`fighter search <locale>`, 0.1 to 0.4 s more at start). Test: the old expression is written out and the results must be identical, same fighters in the same order, for 35 queries (accents, Arabic with and without vowel marks and hamza, Ł Đ Æ ß, "Jr.", translated names, empty and one-letter) over two language tables, first call and cached call. Measured (one visitor, only that kind of request, alternating, two cores): **p50 145 to 62 ms, p95 191 to 206 down to 110 to 113 ms** (n 73 to 86 each); what remains is the parser, the sort and the page.

### 3. Share images: fixed (for repeats)

`ogCard` (`lib/og.tsx`) now keeps what it drew in a cache bounded by bytes (`RINGSIDE_OG_CACHE_MB`, default 24, 0 turns it off; `lib/byte-lru.ts`, least recently used out first, nothing bigger than the whole budget kept), shared by every route that draws a card, and two requests for one card at once draw it once. **The key is the content of the card** (language, kicker, title, subtitle, each statistic, colour, footer), not the address, so a changed record is a different card at once, an unchanged one is the same bytes, and no `dbVersion` is needed. The origin now sends `Cache-Control: public, max-age=600, stale-while-revalidate=3600` (`RINGSIDE_OG_MAX_AGE`; was `public, max-age=0, must-revalidate`). It is safe because a card is the same for every visitor (it depends on the address and the data, never on who asks). One thing to know: the page proxy (`proxy.ts`) still puts a per-request `Content-Security-Policy` header on the image response, as it did before; a shared cache that keeps the image would keep that header too, which does nothing for an image. Test: bytes identical to the uncached drawing, English and Arabic; different words are a different card; simultaneous asks; the cache is bounded.

Measured (curl, the same fighter's card asked six times): **316 to 395 ms each before; after 21 ms for the first ask after a start (a hit, the previous request drew it) and 6 to 10 ms after.** In the capacity mix (a random fighter out of 35,000 each time) it changes nothing (p50 216 to 220 ms both ways, n 59 to 78): there are no repeats in it, and that is the honest limit. The cache helps what link-preview robots and a CDN do, asking for the same card again; it does not make the first draw of each card cheaper (the 220 ms stays).

### 4. Sitemap files: fixed

The 8.6 MB XML is built once per file per world and kept **gzipped** (`sitemapGzip`, `lib/sitemap.ts`; `RINGSIDE_SITEMAP_CACHE_MB`, default 32; one file is about 0.2 MB gzipped, all 19 about 4 MB). The gzip runs on the thread pool, so the main thread is not held for it. The route sends the gzip to a client that accepts it (every crawler does), with `Content-Encoding: gzip` and `Vary: Accept-Encoding`, and the plain XML (unpacked, off the main thread, from the same bytes) to one that does not. `Cache-Control: public, max-age=3600` was already sent and is kept. **The limits from PLAN 208 are untouched**: the XML is exactly what `sitemapXml` wrote (test: gunzipped bytes equal it, for every file), `PATHS_PER_FILE` is still 10,000 (20,000 URLs a file with two languages, under 50,000), the index is unchanged. Measured (curl, a 7.99 MB file): **90 to 96 ms and 7,990,152 bytes on the wire before; after, 2.8 to 4.6 ms and 196,232 bytes (41 times smaller) with gzip, and 40 to 52 ms for the plain XML (80 to 92 before).** The first request for a file after a rebuild still builds it (about 95 ms of the thread, plus the gzip off it).

### Caching the HTML: what it would need (not done, on purpose)

Pages are sent `Cache-Control: private, no-cache, no-store` and that is left alone: each page carries a fresh `Content-Security-Policy` nonce made per request (`proxy.ts`), in the header and in the markup together, which is a security decision (`docs/security.md`), not a performance setting. To let a CDN cache pages for 30 to 60 seconds, all of this would have to be settled and tested first: (1) the nonce: a shared copy gives every visitor one nonce, so either the policy moves to hashes or `strict-dynamic` for those pages (a weaker protection, to be decided), or the edge writes a fresh nonce into the header and the markup of each copy it serves; (2) the cache key must include the query string and honour `Vary` on Next's `rsc` and router headers, or a browser can be handed a page where it asked for data; (3) a purge or a short TTL after each data update (`world_swapped` in the log says when the new data is shown); (4) the origin's own header would change from `private, no-store` to something a shared cache accepts, only on pages that read no cookie (none of the current ones does, as of this measurement). None of this was built or measured here. **Update, round 131:** hashes were tried and are not possible with this Next version (the page's data travels in a per-page inline script whose hash only the rendered page knows, and a policy built from it would approve injected scripts too); what remains is an edge that writes a fresh nonce on each response, a route classification, and a synthetic measurement of the effect (a caching proxy in front: 33 to 115 requests a second of the same mix, origin load unchanged). All in `docs/cdn.md`; nothing was changed in the app.

## The memory diet and the midnight rebuild

The owner asked for a smaller footprint so a 2 GB host is viable, and for the midnight rebuild to stop making visitors wait. Same machine, same synthetic league (35,000 fighters, 160,000 fights, built with `npm run vendor:rehearse` on a temp copy; the stand-in vendor, never a real database), same driver, the old build and the new one alternated (`taskset` 0,1 for the server, 2,3 for `scripts/capacity.ts`, a shared sandbox: the 1-minute load average was 1.4 to 3.2 during the runs).

**What held the memory (profiled with `process.memoryUsage`, `v8.getHeapSpaceStatistics`, and the heap after a full collection at each step of `WARM_STEPS`; 1 MB = 1,048,576 bytes).** After start the server was 1.3 to 1.5 GB resident but only **0.57 GB of it was live heap**: V8 had committed 1.09 GB of heap (475 MB used of 969 MB in the old generation) because its default limit is a few gigabytes, so it left the build's garbage sitting there; the rest was Next.js itself. The live 0.57 GB was the world (221 MB after a full collection) and what the pages compute once per world (282 MB):

| held in memory (full collection, before) | MB |
|---|---|
| the world: fighters, fights, events, ratings history, indexes | 221 |
| the fight score of every fight of every year (`fightsOfYear`, kept as full objects) and the all-time list built from it | 62 + 14 |
| the model's call for every past fight (`accountability.calls`, behind the upset record, track record, signal lift) | 40 |
| the Ask index of fighter names (names, variants, near-spelling words), English and Arabic | 34 + 32 |
| the ⌘K index (people, events, organisations), English and Arabic | 25 + 32 |
| the fighter-search index, English and Arabic | 17 + 17 |
| everything else (countries, on-this-day, rankings, analytics ...) | under 10 |
| share-image cache, sitemap cache (PLAN 226) | at most 24 and 32 (bounded; not filled in this test) |

**What was done** (behaviour and page output identical; `tests/memory-diet.test.ts` sets each new structure beside the old algorithm on the same league):

1. **A full collection when a lot has just become garbage** (`lib/gc.ts`): after the start-up warm-up, right after a swap (the old world and everything computed on it), after a background build, and every eight warm-up steps of a background rebuild. Asked to run as a task of its own (`gc({ execution: "async" })`, switched on at run time with `v8.setFlagsFromString("--expose-gc")`), not as one blocking pause, and not asked at all when the heap is under 64 MB (the demo league, the tests). **This alone took the resident size at start from 1.5 GB to 0.7 GB**, and is most of what lowered the peak.
2. **The build streams its rows** (`mapRows`, `statement.iterate()`) instead of reading every table whole first (160,000 bouts as 160,000 raw objects with thirty fields and their own copy of every string): the peak resident size of the build alone, measured in a script with nothing else running, went **from 899 MB to 532 MB**.
3. **Repeated strings are kept once** (a per-build pool): a weight class, a method, a country, a title, a source, and each rating-history row's date (320,000 of them) were a separate string per row.
4. **Fight scores kept as two typed arrays per year** (bout ids and scores, in rank order) instead of 160,000 `FightScore` objects: 62 MB and 14 MB became under 1 MB; the few a page shows are scored again when asked for (`topFightsOfYear`, a few ms). The year page, the home page, Ask and the fighter page's award use the new accessors; ranks, counts and the all-time list come out identical (tested against the old computation for every year and every division).
5. **`accountability.calls` no longer carries `finishX`** (four numbers per call that only the model fitter reads): `callsForFit` has them. About 11 MB.
6. **The Ask index's word positions are a flat number list**, not an array of two-number arrays per position.

Measured, all with no heap cap, two cores (the "before" is the build before these changes, the same day, the same league):

| | before | after | |
|---|---|---|---|
| resident memory, 8 s after the server answers its health check | 1,495 to 1,507 MB | **711 to 716 MB** (high-water 787 to 793) | |
| resident memory under the mix, 5 at a time, 40 s: start / peak / end | 1,566 / 1,814 / 1,800 | 743 / 1,110 / 1,108 | |
| the same, 20 at a time | 1,800 / 1,873 / 1,861 | 1,108 / 1,160 / 1,139 | |
| peak during a data update (5 at a time, 70 s, update at 20 s) | 2,167 (high-water 2,223) | **1,382 (high-water 1,415)**; a run of the same build, repeated, 1,404; 1,730 in a run before the collections during the rebuild were added | |
| requests a second, 5 / 20 at a time | 18.0 / 20.0 | 20.8 / 21.7 | noise is about 10%; not lower |
| the update run: nothing answered for (longest) / slowest answer / answers over 2 s | 2.0 s / 3.0 s / 5 | 1.4 s / 2.7 s / 5 | the stall fix of PLAN 226 is intact |
| the update run: requests a second | 13.1 | 14.8 | |
| world build / warm-up at start | 4.4 to 5.3 s / 7.3 to 9.8 s | 4.2 to 4.5 s / 7.9 s | |

**Against the target of "comfortably under 1.5 GB peak with the default heap": met, not comfortably.** The peak is 1.38 to 1.42 GB at the worst moment (an update under traffic) and 1.1 to 1.2 GB otherwise, so 2 GB is enough and 1.5 GB is not a safe ask. What is left in it, honestly: old and new world are still alive together while a swap is prepared (that is the price of never making a visitor wait), and about 0.4 to 0.5 GB of the resident size is not heap at all (the framework's code, native buffers, allocator fragmentation). Runs with `MALLOC_ARENA_MAX=2` and under `--max-old-space-size` were made afterwards, on the build with the leftovers: see "The leftovers".

**Midnight.** A new calendar day used to rebuild the world at once with every visitor that arrived waiting for it (only a change made by another process had the background rebuild of PLAN 226). Now the same path serves both (`lib/world.ts`, `startDayRebuild`): the first request after midnight is answered from yesterday's world, which is still whole and consistent, and the new day's world is built beside it in slices, warmed, and swapped in by one assignment; the midnight timer asks for it and waits for the swap (`dailyRebuild`, `lib/warm.ts`). Our own writes, `invalidateWorld` and the very first build still wait, because there is nothing right to show. A failed build keeps yesterday's world, logs once, and tries again after 60 s. A pinned clock (`RINGSIDE_NOW`, tests) still rebuilds at once, since those callers move the date by hand (`setDayRollover` is how the test of this says otherwise).

Tested with an injected clock and no waiting (`tests/midnight-rebuild.test.ts`: visitors answered at once throughout, one rebuild, the new world warm when it arrives, the scheduler on a fake clock and timer, and a failing build). Measured on the real server with its clock shifted (a `--require` shim on `Date`, so UTC midnight arrives 24 s into a 60 s run at 5 at a time; one run each, old build first):

| | before | after |
|---|---|---|
| nothing answered, from the rebuild's start | **15 s** (second 28 to 43 of the run: 0 to 4 answers a second) | 1.2 s at the longest |
| slowest answer | 10.6 s | 2.2 s |
| answers over 2 s | 18 | 1 |
| peak resident memory | 1,989 MB | 1,415 MB |
| the new day's world built | 5.3 s (all of it a stall) | 11 s, in slices behind the traffic (then warmed, then swapped in; the swap itself was not timed) |

For about 10 to 40 s after midnight UTC, pages are still yesterday's (an event of today still says "upcoming", ages and "today" in the lists are a day behind). The same is true after a data change, and it is the price of not stalling.

## The leftovers: the palette's near-spelling index, the Ask index, a capped heap and malloc arenas

Three things the memory-diet report left open, done with the same league (35,000 fighters, 160,000 fights, 74,510 events, built by `npm run vendor:rehearse` on a temporary copy, the stand-in vendor, no real database or vendor) on the same machine. **Everything here is sandbox and synthetic**: a shared 4-core virtual machine, and a league whose fighters are called "Fighter 123". The memory of the two name indexes was therefore measured on a copy of the league with generated, realistic-looking names (35,000 fighters, 3,000 people, 400 organisations, 74,510 events with their own names, and an Arabic table made letter for letter, which has more distinct words than a real league has in Arabic). One run of each kind is one data point; differences under 10% are noise.

### 1. The ⌘K near-spelling index is built by the first search that needs it

`globalSearch` keeps two indexes per world and table of translated names: the exact-match text of every person, event and organisation (every search reads it) and the near-spelling index, the word list the "did you mean" guesses use (only a search that found nothing reads it: `nearOf`, `lib/search.ts`). The warm-up built both, in English and in Arabic, at start-up and for every rebuilt world, because its dummy query matched nothing. Now `warmGlobalSearch` builds only the first (and the fighter index); the near index is built by the first search that finds nothing, and the new world of a swap holds none until someone needs it. It is the same index (its words and items, in the same order, are asserted equal to the old construction), and since it is now made from the exact index's folded text instead of folding all 74,510 events a second time, the first guess costs less than it would have.

| the synthetic league, one process, nothing else running | before | after |
|---|---|---|
| near index, English table, heap kept after a full collection | 52.8 MB, built at start | 52.8 MB, built by the first search that finds nothing; none at start |
| near index, Arabic table | 126.3 MB, built at start | the same, built by the first Arabic search that finds nothing |
| held at start-up, and again by the new world during every swap | both, about 179 MB | none (about 179 MB less in the overlap until the first guess is asked) |
| the warm-up step "global search" | about 1.2 s (both indexes) | 0.4 to 0.5 s (the exact text and the fighter index) |
| the first search that finds nothing (English) | 0.23 s (already built) | **0.75 to 1.0 s, once per world and table**, then 0.23 to 0.4 s as before |
| the first such search, Arabic table | already built | 1.6 s, once |
| a search that finds something (the common case) | unchanged | unchanged |

Read this plainly: the cost moved from start-up (and from every rebuild's warm-up) to the first visitor whose search finds nothing, and it is a block of the one thread of about 0.8 to 1.0 s in English (1.6 s in Arabic) at the synthetic league's 74,510 events (a real league has fewer; the cost follows the number of events). Every later guess is as fast as before. If that is not acceptable the lever is one line: add `nearOf(w, names)` to the `global search` warm-up step and the 53 MB (126 MB) comes back. Tested (`tests/capacity-leftovers.test.ts`): the warm-up does not build it, a search with an answer never does, the first search without one does; the same results from `globalSearch` with the index built early and built late, English and Arabic, with accents, typos and exact matches (more than 300 queries, over 100 with answers); the index equals the old construction; the new world of a swap holds none.

### 2. The Ask index, compacted (per language)

Measured first. What the Ask planner keeps per language table is the list of names a fighter can be called by (the full name, the translated name, the variants: without the suffix, without middle names, without particles, run together) and the near-spelling index of their words (a name of two or more words found a slip or two away). Before, each was an object per fighter with an array of strings, an object per name with an array of its words, and a list of numbers behind every word; each language folded every name again into strings of its own.

Now the folded names are made once per world (`plainNames`) and shared by every language, the variants exist only for the fighters that have any, the name list is two flat lists (the names, and the position of each one's fighter), and the near index is typed arrays (`Int32Array`: each name's word ids, each word's postings, the owner of each name) with one string per distinct word. The planner reads them in the same order as before, so every answer is the same: `tests/capacity-leftovers.test.ts` asks a frozen copy of the old code (`tests/fixtures/ask-rules-before.ts`) and the new one more than 3,000 questions (about 160 fighters each named in full, without accents, by surname, with a letter missing, doubled or swapped, in a pair, with the hyphen or the dot dropped; the same in Arabic with the Arabic spellings and slips; trainers; look-alike names that must tie: Tomás Villalba and Villalta, Marcos and Marcus Quintero, Zhang Wei and Wei Zhang) and expects identical plans and identical fighters in the same order. A question that names someone also does one cheap test (`q.includes(name)`) before the two forms with their spaces; same answers.

| heap kept after a full collection, the realistic-name copy of the league | before | after |
|---|---|---|
| the Ask index, English (names, variants, near-spelling words) | 32.2 MB | **5.4 MB** |
| the Ask index, Arabic (with the translated names) | 16.8 MB | **3.5 MB** |
| the first question after a start (builds the English index) / the Arabic one | 679 / 664 ms | 386 to 465 / 433 to 602 ms (three runs) |
| a question naming a fighter, English / Arabic, when warm | 353 / 56 ms | 119 / 6 ms |

(The 119 ms is the near-spelling scan of the other words in the question, as before; the old code did the same scan and took 353.)

### 3. A capped heap and `MALLOC_ARENA_MAX`, on the build with the leftovers

Method: the 35,000-fighter league copied afresh for every run; the server (`next start`, `BOXING_PROVIDER=licensed`) pinned to cores 0 and 1 and the driver to cores 2 and 3; 8 s after the health check answers, `scripts/capacity.ts` at 5 at a time for 70 s and, at 20 s, `scripts/capacity-update.ts` (another process makes the update's three commits, 1.5 s apart: one rebuild, one swap, in every run). Settings: none; `NODE_OPTIONS=--max-old-space-size=1024` (cap); `MALLOC_ARENA_MAX=2` (arena); both. The rounds alternated in opposite orders (none, cap, arena, both; then both, arena, cap, none), and further rounds were taken inside a real 2 GB limit: the server in a cgroup with `memory.limit_in_bytes` of 2 GB (the driver outside it), which was never reached (peak 0.99 to 1.33 GB counting the file cache) and killed nothing. A run started only once the machine's one-minute load average was 1.3 or below; two runs of the cgroup rounds whose load average had risen to 2.4 and 2.6 by the end, with 4 and 3 answers over 2 s, were thrown away and repeated (the table has the repeats). "Under load" is the highest resident size in seconds 5 to 19, "update peak" the highest after the update began, "steady" the mean of the last 6 s, "silent" the longest time in which no request finished after the update began. Resident memory in MB (1 MB = 1,048,576 bytes) from `/proc/<pid>/status`; one value per run, in the order the runs were taken.

| setting (runs) | 8 s after ready | under load | update peak | steady after | req/s over the 70 s | silent | slowest answer | answers over 2 s |
|---|---|---|---|---|---|---|---|---|
| none (4) | 636 633 628 654 | 1,058 1,061 937 983 | 1,329 1,331 1,389 1,297 | 1,226 1,238 1,305 1,212 | 15.7 16.2 16.1 15.9 | 1.2 1.1 1.2 1.2 s | 1.7 1.9 1.6 2.1 s | 0 0 0 1 |
| heap cap 1024 (5) | 529 539 516 512 525 | 893 1,010 960 984 972 | 1,245 1,234 1,243 1,257 1,247 | 1,166 1,163 1,174 1,192 1,164 | 14.6 16.0 15.3 15.5 16.1 | 1.4 1.0 1.1 1.0 1.1 s | 2.4 1.6 2.1 2.1 1.7 s | 2 0 1 1 0 |
| `MALLOC_ARENA_MAX=2` (4) | 605 596 619 620 | 878 898 847 816 | 1,115 1,122 1,230 1,161 | 1,019 1,046 1,138 1,086 | 15.5 16.6 16.2 16.4 | 1.3 1.1 1.1 1.0 s | 1.7 2.0 1.7 1.7 s | 0 0 0 0 |
| both (4) | 513 526 508 511 | 734 812 847 844 | 1,076 1,103 1,060 1,087 | 969 1,012 969 996 | 14.9 15.3 15.1 15.2 | 1.0 1.0 1.3 1.0 s | 1.8 1.6 1.5 2.2 s | 0 0 0 1 |

(The first two runs of each row, and the cap's third, were on the machine itself; the others in the 2 GB cgroup. `world_built` was logged twice (start and the update) and `world_swapped` once in every run: 12 s to build, the swap 33 s after the update began. No request failed in any run.)

Caps below 1 GB, same method (cgroup, with `MALLOC_ARENA_MAX=2`, one run each): **896 MB**: 13.3 requests a second, p95 1.08 s, 2 answers over 2 s, the update swapped in; **768 MB**: 13.2 requests a second, p95 1.19 s, silent 2.1 s, 7 answers over 2 s, and the new world, built in 13 s, had **not been swapped in after 70 s** (the warm-up under heap pressure crawls). Neither died, but the world's live heap here (about 0.57 GB; two worlds at the swap about 1 GB) leaves them no room: 1,024 MB is about the floor at this league size, and the floor rises with the league.

What it says:

- **`MALLOC_ARENA_MAX=2` is a free win.** It takes 135 to 210 MB off the update peak (1,330 to 1,115 to 1,120 on the machine, 1,297 to 1,389 down to 1,161 to 1,230 in the cgroup) and 90 to 170 MB off the loaded size, 10 to 35 MB at start, with the throughput inside the noise (15.5 to 16.6 against 15.7 to 16.2) and the stall unchanged (1.0 to 1.3 s). glibc's allocator gives each thread that allocates (the thread pool, the garbage collector's helpers) an arena of its own, and a freed world's memory goes back to the system late; fewer arenas hold less. The base image (`node:22-slim`) is glibc, so it applies; on musl (Alpine) it does nothing.
- **A 1 GB heap cap takes about 100 MB off the start and 90 MB off the update peak** (1,330 to 1,245) and keeps the stall short (1.0 to 1.4 s of silence; it was 16.4 s under that cap before the diet and the stall fix). It costs a little speed (14.6 to 16.1 req/s against 15.7 to 16.2, p95 about 10% up) and left 1 or 2 answers just over 2 s in three of five runs, where the uncapped runs had one in four. On top of arenas it saves a further 20 to 70 MB at the peak (and 100 MB at start): not worth a cliff (896 MB and below degrade, a larger league needs a larger cap).
- **V8's default heap limit does not know about the container.** `process.constrainedMemory()` reads 2,048 MB inside the 2 GB cgroup and `v8.getHeapStatistics().heap_size_limit` is still 8.2 GB, so an uncapped process is never pushed to collect harder; it stays under 2 GB because its working set is 1.1 to 1.4 GB, not because anything stops it. The margin (0.6 GB without arenas, 0.8 GB with) is what the league's growth will eat, which is what "What to watch" is for.
- **Recommended for a 2 GB host: `MALLOC_ARENA_MAX=2`, no heap cap.** Both together are for a host below 2 GB (a 1.5 GB container fits: update peak 1.06 to 1.10 GB) and only with the cap raised as the league grows. Nothing in the stall fix (PLAN 226) or the memory diet (PLAN 230) is weakened: silent 1.0 to 1.4 s at the longest and no failed request in any run, resident at start 0.51 to 0.65 GB.

Before and after the leftovers, the same machine, the old build (the commit before this change) and the new one alternated, no settings, 2 cores, 5 at a time, update at 20 s (two runs each):

| | before | after |
|---|---|---|
| resident 8 s after ready | 699, 702 MB | 606, 641 MB (and 636, 633, 628, 654 in the rounds above) |
| update peak | 1,422, 1,403 MB | 1,377, 1,350 MB (1,297 to 1,389 in all six) |
| steady after the update | 1,358, 1,335 MB | 1,302, 1,285 MB |
| requests a second (70 s with the update) | 16.5, 16.4 | 17.2, 16.6 |
| silent / slowest / answers over 2 s | 1.2, 1.2 s / 1.4, 2.3 s / 0, 2 | 1.2, 1.1 s / 1.8, 1.5 s / 0, 0 |

The two indexes explain it: about 60 to 95 MB at start and 45 to 55 MB at the update peak (the runs vary by about 20 MB), less than the heap numbers above because the synthetic league's names ("Fighter 123") share almost every word, so its Ask indexes were small, and its palette near index (74,510 events) was the bigger one.

## Left

- **Ties in the garbage collector:** 14 to 16% of the CPU under the mix. A larger young generation (`--max-semi-space-size`) was not tried. (left)
- **The public API** (`/api/v1`) is closed for licensed data by design and was not measured. (left)
- **The first search that finds nothing builds the palette's near index** (0.75 to 1.0 s of the one thread in English, 1.6 s in Arabic, at 74,510 events; once per world and table; "The leftovers"). The way to give it back is one line in `lib/warm.ts`, at the price of 53 and 126 MB held at start and in every swap. (left, on purpose)
- **The list re-sorts 35,000 rows per request** (about 10 ms). (left)
- **A share image's first draw** still costs 220 to 380 ms, and the first request for each sitemap file after a rebuild about 95 ms. (left; the repeats are fixed)
- **Under a 1 GB heap cap the update was slow** (4.7 s of nothing, 26 answers over 2 s, measured before the memory diet): re-measured on the current build, it is not (1.0 to 1.4 s of nothing, 0 to 2 answers over 2 s), but a heap of 896 MB or less is too tight at this size ("The leftovers"). (done)
- **A new day** no longer makes visitors wait (see "The memory diet and the midnight rebuild"): yesterday's world is served for the 10 to 40 s the new one takes.
- **The data update's own half-applied state** (a world built between the update's commits) can no longer be shown for long: it is rebuilt after the writer is quiet. Before, a request in the middle built a world from fights without their recomputed ratings.

Every item of the first list ("Found, not fixed" in the first version of this report) is now either fixed above or listed here as left: the update stall (fixed), no warm-up after a rebuild (fixed), the text search (fixed), share images (fixed for repeats), sitemap files (fixed), garbage collector and public API (left).

## Sizing recommendation

For a league the size of the one tested (35,000 fighters, 160,000 fights), one instance:

| | ask for | because (measured) |
|---|---|---|
| CPU | **2 vCPU** (1 works at about 70% of the speed; more than 2 is wasted on one instance) | one thread serves; the second core gave 35 to 40% (14.9 to 21.0 req/s at 20 in flight) |
| RAM | **2 GB, `MALLOC_ARENA_MAX=2`, no heap cap** (the margin is 0.8 GB at the worst moment with it, 0.6 GB without; 3 GB if the host has room) | after the memory diet and the leftovers: 0.60 GB at start, 0.8 to 0.9 GB under load, 1.12 to 1.23 GB at a rebuild under traffic with `MALLOC_ARENA_MAX=2` (1.30 to 1.39 GB without it; before the diet 1.5, 1.6 to 1.9, 2.2 GB); a 1 GB heap cap saves another 0.1 GB at 4 to 7% of the throughput and is not needed ("The leftovers") |
| disk | a persistent volume of **5 GB** or more, SSD | database 62 MB, vendor cache 122 MB, 14 backups of the database about 0.9 GB; the database is read into memory at start, so disk speed matters only for the start and the update |
| network | nothing special; pages are 27 KB gzipped (65 KB for the Arabic home page), share images 80 KB | |
| instances | exactly 1, with the CDN or a proxy in front | `docs/deploy.md` |

What one such instance carries (calculation, from the measured throughput and two assumptions: 85% of requests are pages, as in the mix; a reader asks for a new page every T seconds): concurrent readers = req/s × 0.85 × T. At T = 30 s, 14.9 req/s gives about 380 and 21 req/s about 535; at T = 60 s, double. The assets of a visitor with a cold browser cache count against this (a page plus about 30 assets), so a CDN in front of the assets raises it, and a CDN that can serve pages for a minute raises it by the cache's hit rate (unmeasured here).

Put a limit of 10 to 20 requests in flight to the origin in the proxy, and queue or shed the rest: past that the answer only gets later (3.3 s at 50 in flight on one core), and at 100 on one core some requests waited 30 s.

**What to watch** (all in the logs or the health check already): resident memory against the container limit, with a margin of 0.5 GB above the loaded figure for the rebuild; the `world_built` and `world_swapped` log lines (one `world_built` a day at midnight UTC, and one `world_built` plus one `world_swapped` per data update; more means something is writing to the database all day or the clock is wrong), and any `world rebuild failed` line (the site is serving old data); `/api/health` latency and `data.stale` (an update that has stopped); the error lines (`"level":"error"`); the proxy's own request time at the 95th percentile (the origin's p95 at 5 in flight is 0.5 to 0.8 s here); the count of requests the proxy queued.

**Running the update:** a quiet hour is still kinder (the rebuild and its warm-up take about 15 to 25 s of background work, during which visitors are answered at roughly 80% of the normal rate, and the new data appears about 30 s after the update's last commit), but it no longer stalls the site: the old data keeps being served. Give the process more than a 1 GB heap if updates run under traffic. Do not restart the container to cover the update any more: a start is 12 to 16 s with the health check failing, a worse stall than the one that was fixed.

## What to put in front

Cache headers measured on the production server (localhost, `Accept-Encoding: gzip`):

| | `Cache-Control` | note |
|---|---|---|
| pages, English and Arabic | `private, no-cache, no-store, max-age=0, must-revalidate` | `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding`; gzipped by the app (27 KB for a fighter page; 197 KB plain) |
| `/_next/static/*` | `public, max-age=31536000, immutable` | correct as it is |
| share images (`…/opengraph-image`) | `public, max-age=600, stale-while-revalidate=3600` (was `public, max-age=0, must-revalidate`) | 80 KB; drawn once per card and kept in memory (6 to 21 ms after), 220 to 380 ms the first time |
| `/api/art/portrait/*` | `public, max-age=86400, stale-while-revalidate=604800`, `ETag` | |
| `/api/fighter-card/*` | `public, max-age=300` | |
| `/api/search`, `/api/fighters` | none | 1 KB; cheap (4 to 11 ms) except the first search after a start |
| `/api/v1/*` | `public, max-age=300, s-maxage=300` (404 and 429 `no-store`) | closed for licensed data |
| `/sitemap.xml`, `/sitemaps/*.xml` | `public, max-age=3600` | a file is 8.0 to 8.6 MB of XML; `/sitemaps/*.xml` is sent gzipped (0.2 MB) to a client that accepts it, with `Vary: Accept-Encoding` |
| `/feeds/*` | `public, max-age=900` | |
| `/robots.txt`, `favicon.ico` | `public, max-age=0, must-revalidate` | |
| `/api/health`, account and forum APIs | `no-store` | must never be cached |

Recommendations:

1. **Always put a CDN or caching proxy in front for the static files, images, sitemaps and portraits**, (the app now compresses the sitemap XML itself). That alone removes the assets (about as much origin work as the page itself, for a first-time visitor), the sitemaps and the share images (the dearest single requests) from the origin. The share images now say `max-age=600, stale-while-revalidate=3600`, which a CDN with default rules honours; a longer edge time (an hour or more; a stale card is harmless) is still fine.
2. **Pages: the origin says "do not cache", and that is a decision, not an accident.** No page reads a cookie (nothing in `app/` outside the APIs calls `cookies()`), the language is in the URL, and there is no redirect on `Accept-Language`, so the HTML of a URL is the same for everybody, and a CDN told to cache it for 30 to 60 seconds would lift the ceiling by the hit rate. Two things must be settled first, neither tested here: **(a)** each page's `Content-Security-Policy` header and the `nonce` attributes in its markup are made together per request (`proxy.ts`); a cached copy gives every visitor the same nonce, which still works but means the nonce no longer keeps an injected script out of those pages, so it is a security decision for `docs/security.md` before it is a performance one; **(b)** the pages `Vary` on Next's `rsc` and router headers, and navigation inside the site fetches the same URL with an `_rsc` query: the cache key must include the query string and honour `Vary` (or bypass requests carrying an `rsc` header), or the browser can be handed a page where it asked for data.
3. **Pass `X-Forwarded-For`** (`docs/deploy.md`): without it the per-address limits see one visitor.
4. **Serve stale on error and while the origin is busy** (`stale-while-revalidate`, `stale-if-error`): the origin starts in 12 to 16 s, and the CDN can cover that for pages it has. (A data update no longer stalls the origin.)
5. **Do not scale out.** If the origin is the limit, raise the CDN's hit rate; a second instance has its own database copy, ledger and AI counters.

## Reproduce

```bash
npm run build
npm run vendor:rehearse -- --fighters 35000 --fights 160000 --keep      # prints the folder; the database is real.db in it
DATABASE_PATH=<copy>/real.db ACCOUNTS_DB_PATH=<copy>/accounts.db BOXING_PROVIDER=licensed SITE_URL=https://capacity-test.example.org \
  taskset -c 0,1 npm start -- -p 3417
# find the server's pid (the process is named next-server)
taskset -c 2,3 npm run capacity -- --base http://localhost:3417 --pid <pid> --steps 1,5,20,50,100 --seconds 30 --json out.json
npm run capacity -- --base http://localhost:3417 --pid <pid> --cold          # right after a start
npm run capacity -- --base http://localhost:3417 --pid <pid> --steps 5 --seconds 70 --event-at 20 --event-cmd "npx tsx scripts/capacity-update.ts <copy>/real.db"   # a data update by another process, in three commits
```

The settings run ("The leftovers", 3): the same, with `NODE_OPTIONS=--max-old-space-size=1024` and/or `MALLOC_ARENA_MAX=2` in front of `npm start`; for a real 2 GB limit on Linux, start the server inside a memory cgroup (`memory.limit_in_bytes` 2147483648) or a container with `--memory 2g`, and read the process's `VmRSS` and `VmHWM` from `/proc/<pid>/status` as well as the driver's numbers.

On a real host, run the driver from another machine (so it does not take the server's cores), against a copy of the database, never against a site other people use. `RINGSIDE_MEMO_LOG=1` on the server logs every aggregate a first visit computes; `node --cpu-prof` on it gives the profile the hot spots were found with. The per-run JSON from this report was not kept in the repository (it is a few KB each); re-running takes about 12 minutes per core configuration.
