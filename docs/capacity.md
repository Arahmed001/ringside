# Capacity: how many visitors can one instance serve

Ringside must run as exactly one copy (one Node process, one SQLite file; `docs/deploy.md` says why). This is the measurement of what one copy can serve at the size of the real league, and what to ask of a host. **Every figure below was measured here, in the sandbox described under "What this is and is not"; nothing is quoted from elsewhere or estimated, except where a line says "assumption" or "calculation".** The numbers will differ on a real host: use them for the shape and the order of magnitude, then re-run the driver on the host (last section).

## Summary

- **One instance is limited by one thread.** The site renders every page on request in one Node thread. On one core it served about **15 requests a second** of a realistic mix (a request is a page, an API call, an image); on two cores about **21**. A second core helps by 35 to 40% (garbage collection and compression run beside the main thread); a third or fourth core does nothing for one instance. Ask for **2 vCPUs**.
- **In visitors** (calculation, with an assumption: 85% of requests in the mix are pages, and a reader looks at a new page every 30 seconds): one core carries about 380 people reading at once, two cores about 530. Look at a page every 60 seconds and the numbers double. These are the ceiling, not a comfortable load: at the ceiling a request waits behind the others (about 1 second at 20 requests in flight on two cores, 3.3 seconds at 50 on one).
- **Memory: ask for 2 GB with the heap capped, or 4 GB without a cap.** The process is 1.29 GB right after start, 1.6 to 1.7 GB under load (it plateaus; no growth over 7,600 requests), and **2.2 GB at the moment a data update makes it rebuild its in-memory world** (old and new world are both alive). With `NODE_OPTIONS=--max-old-space-size=1024` it was 0.7 GB idle, 1.2 GB under load, 1.4 GB at the rebuild, at the price of about 10% of the throughput. A 700 MB cap costs 27%; a 500 MB cap started and then crashed out of memory under load.
- **Disk is not a constraint:** the database for 35,000 fighters and 160,000 fights is 62 MB.
- **A data update under traffic stalls the site for about 10 seconds** (two back-to-back rebuilds of the in-memory world, 4.7 s each, nothing is answered meanwhile; 16 s with the 1 GB heap cap), and the process peaks at 2.2 GB. A start takes 11 to 16 seconds before it answers. Put a cache in front that can serve stale pages for a minute, and run the update at a quiet hour.
- **Nothing sits in front of the server today that can take load off it:** pages are sent `Cache-Control: private, no-cache, no-store`, and the share images `public, max-age=0, must-revalidate`, so a CDN with default rules caches neither. What a CDN can and cannot safely be told is in "What to put in front".
- The measurement found two hot spots that were not about traffic, and fixed them: a fighter page worked out the style of every fighter in the league and scored every possible opponent, and a country page scanned every event and bout, on each view. Throughput of the mix went from **9-10 to 15-16 requests a second on one core, and from 11-13 to 20-22 on two** (alternating runs, same machine); the fighter page went from 168 to 69 ms and the country page from 319 to 34 ms. The behaviour is unchanged (tests below).

## What this is and is not

- **The league.** 34,992 fighters, 160,012 fights, 74,510 events, a 62 MB database, built by the real load path against the stand-in vendor (`lib/vendor-mock.ts`, no network, no real API): `npm run vendor:rehearse -- --fighters 35000 --fights 160000 --keep`, which runs `vendor:backfill` as a plan (64 s, 288 MB), a check that fetches and validates (3.1 min, 610 MB, 36,627 requests to the stand-in, 122 MB of cache), the load into a new database (17 s, 762 MB peak) and a daily `--update` (7.5 s, 390 requests), and passed all its own checks (every fight loaded, every fighter's record adds up). The copy used for the tests was made in a temporary folder; no real database was touched and no real vendor was called.
- **It is synthetic.** Fighters are "Fighter 123", fights are random pairings inside a division, there are only 10 countries (so a country page here has about 3,500 fighters, more than a real one would), and the league has no punch statistics, no money, no people, no organisations, no pictures and no official lists. A real league is smaller in fights per fighter (about 1.4 against 4.6 here) and richer in the other tables. The real size of fighters and fights is what drives the memory and the world build; the mix of pages is an assumption.
- **The machine.** A 4-core virtual machine with 16 GB (`nproc` = 4), Linux 6.18, Node 22.22.0, Next.js 16.3.8, production build, shared with other work (the machine's 1-minute load average was 1.5 to 2.7 during the runs reported, and up to 13 during one run that was thrown away and repeated; each table row's `load1` was recorded by the driver). "One core" and "two cores" mean the server was pinned with `taskset -c 0` or `taskset -c 0,1` and the load driver with `taskset -c 2,3`. A rented vCPU is usually slower than a core of this machine, and shares more; expect lower numbers, not higher.
- **The test.** Closed loop on localhost: each of N virtual visitors asks again the moment it is answered (no think time), so it finds the ceiling. No TLS, no network, no proxy, no CDN, no browser. Each virtual visitor sends its own `X-Forwarded-For` so the per-address limits behave as behind a proxy. Each row is one 30-second run (the "before" one-core runs 20 s); repeating a configuration moved the throughput by up to 10%, so treat differences under 10% as noise.
- **The mix** (`scripts/capacity.ts`, an assumption, not measured traffic; shares of requests): 8 home, 3 rankings index, 8 a division's rankings (some with the women's list, a page, a sort or an official list), 14 the fighters list (plain, sorted and paged to any of 200 pages, filtered by division and status, and a text search), 22 a fighter page, 3 events list, 5 an event, 3 a fight, 5 country pages and the countries index, 2 all-time lists, 3 other whole-league pages (analytics, map, upset watch, money, trainers, titles, matchmaking, on this day), 5 the ⌘K search API, 3 the type-ahead API, 3 share images, 1 the fighter card API, about 1 the sitemap. A quarter of page requests are in Arabic. Paths come from the server's own sitemap, so they exist. The public API (`/api/v1`) is off for licensed data until the owner switches it on, so it is not in the mix (`--v1` adds it); it was not measured.

## Method

1. `npm run build`; `npm start` on a free port with `BOXING_PROVIDER=licensed`, `SITE_URL=https://capacity-test.example.org` (a non-localhost name, so the site is indexable and serves sitemaps), the copy as `DATABASE_PATH`.
2. `scripts/capacity.ts` (`npm run capacity`): replays the mix at 1, 5, 20, 50 and 100 at a time for a fixed time each, recording requests a second, p50/p95/p99/max latency, failures (anything not 2xx, or no answer in 30 s), and the server's CPU and resident memory from `/proc/<pid>` every 250 ms. `--cold` times the first request of each kind straight after a start. `--event-cmd` runs a command part-way through a step (here the real `vendor:backfill --update` against the stand-in, writing into the database the server was reading) and prints a second-by-second table.
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

What is left is spread evenly: a typical page is 40 to 80 ms of one thread, and the V8 profiles put the garbage collector at 14 to 16% of all CPU time under the mix. The share image is the dearest single request (it draws a picture), and the text search on the fighters list the slowest page: it normalises every fighter's name on each request (in `applyFilters`, `lib/ai.ts`), which is left alone (below).

### Memory

Resident memory of the server process, no heap cap, two cores, 1 MB = 1,048,576 bytes:

| when | MB |
|---|---|
| ready after start | 1,285 to 1,302 |
| during the mix, 5 to 100 at a time | 1,500 to 1,700 (peak per step in the tables above) |
| soak: six 60-second runs at 20 at a time, 7,600 requests, end of each minute | 1,599, 1,604, 1,632, 1,650, 1,633, 1,633 (peaks 1,594 to 1,671: flat, no leak) |
| peak while the world is rebuilt after a data change | 2,182 (two cores; 2,196 on one core, before the fixes) |

Heap caps (`NODE_OPTIONS=--max-old-space-size=N`), two cores:

| cap | ready, MB | under load, MB | req/s at 5 and 20 at a time | after a data update |
|---|---|---|---|---|
| none | 1,290 | 1,500 to 1,700 | 20.1, 21.0 | peak 2,182 MB, stall about 10 s |
| 1,024 | 692 | 1,141 to 1,222 | 18.5, 18.7 | peak 1,368 MB, stall about 16 s, survived |
| 700 | 808 | 980 to 1,034 | 14.8, 15.4 | not tried |
| 500 | 635 | died: `JavaScript heap out of memory` in the first 30 s under load | | |

So the world needs between 500 and 700 MB of heap at this size, and a cap near 1 GB leaves room to hold two of them while one is rebuilt. (`docs/deploy.md` measured 250 to 400 MB at 44,000 fights; the heap grows with the fights, as it says.)

### A data update while serving

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

- **The world** (every fighter, fight and event, with ratings and indexes, in memory): built once, kept on `globalThis`, keyed by `today|dbVersion`. Each request checks the key with two one-row queries (`PRAGMA data_version`, newest `ingest_runs` id; `lib/db.ts`) and rebuilds on a mismatch. The key changes when the UTC day changes, when **another process** commits to the database (the daily update; this process's own writes do not move `data_version`), when the newest ingest run changes, and when code in the process calls `bumpDbVersion` (approving a community edit). The rebuild is synchronous: 4.4 to 5.2 s at this size, and the thread serves nothing meanwhile. The old world is garbage once nothing uses it, but it is alive until the new one is assigned, hence the 2.2 GB peak.
- **Aggregates** (`lib/memo.ts`): a `WeakMap` per world, so a new world starts empty and the old ones go with it. `WARM_STEPS` fills the slow ones at start (and at 00:00:05 UTC each day, `scheduleDailyWarm`); anything not in the list is computed by the first visitor.
- **Per request, every time:** the whole HTML of every page (the layout is `force-dynamic`; nothing is cached by Next), the fighters list's filter and sort of up to 35,000 rows, a fighter page's profile and its neighbours, share images, sitemap XML (8.6 MB a file, 19 files), JSON of the APIs. There is no page cache and no response cache in the app.
- **Middleware** (`proxy.ts`) runs on every request: a fresh CSP nonce, the locale rewrite.

## What was fixed, and the proof

All three were found in V8 profiles of the production server, and each is a pure re-organisation: the same inputs give the same outputs.

1. **A fighter page recomputed league-wide work.** `similarTo` built a style vector for all 34,000 fighters with five fights and sorted them, on every view; `suggestOpponents` built a full pairing (prediction with its factor notes, translated sentences) for each of thousands of candidates and kept three. Now the vectors are built once per world (`lib/style.ts`, `memo`), the nearest few are kept by insertion rather than a full sort, with the order a stable sort gave (ties in league order); candidates are scored with the numbers only (`evaluate`) and only the few shown get sentences (`explain`); the set of booked fighters is built once per world. Fighter page: 168 to 69 ms.
2. **A country page scanned every event and bout, and slugified each event's country, on every view** (`lib/countries.ts`). The events held in each country (newest first) and the coming fights are now built once per world, and a name's slug is remembered within a loop. Country page: 319 to 34 ms.
3. **Two first-visit costs moved to start-up** (`lib/warm.ts`): the fighter-page and country-page structures, and the ⌘K search's indexes. The search indexes were in module-level `WeakMap`s (`lib/search.ts`), which Next bundles twice (the start-up hook and the routes each get a copy; the same trap `lib/memo.ts` documents), so what the start-up built was never what the route read; they now use the shared registry like the fighter-name index. First search after a start: 284 to 60 ms. Start-up is 1.5 to 2 s longer for it ("pages warmed" took 7.3 to 7.6 s before and 8.7 to 9.1 s after).

Tests (`tests/capacity-hotspots.test.ts`, `tests/capacity-countries.test.ts`, `tests/capacity-search.test.ts`): the old algorithm is written out in the test and the new code must return exactly the same answer, ties included, for a spread of fighters and every country, for several list lengths; a synthetic league of identical fighters checks tie order; `winChances` equals `predict`'s probabilities digit for digit; the shared lists cannot be changed by a caller; the search indexes live in the shared registry. Mutation checks: reversing the tie rule, dropping the rating tie-break, and including upcoming events were each caught by a test.

## Found, not fixed

- **A data update rebuilds the world twice and stalls the site for 10 to 16 s.** Needs a design decision (build in a worker thread and swap, or debounce rebuilds until the writer is quiet, or restart after the update). Until then: run the update at a quiet hour, expect the stall, serve stale pages from the proxy meanwhile. Because the update commits in separate steps, a request in the middle also builds a world from a half-applied update (fights loaded, ratings not yet recomputed); the next rebuild corrects it.
- **No warm-up after a data-triggered rebuild** (see above); the first visitors to each page pay for the aggregates.
- **The fighters list's text search** normalises 35,000 names on each request (159 to 211 ms); a per-world, per-language index of normalised names, like the one `fighter-search.ts` keeps, would remove it. The list also re-sorts 35,000 rows per request (about 10 ms).
- **Share images** cost 220 to 380 ms each and are never cached by the origin.
- **Sitemap files are 8.6 MB each, built per request (95 to 125 ms) and not compressed by the app** (HTML is: 197 KB becomes 26 KB; XML is not). 19 files, about 160 MB for a crawler that reads them all.
- **Ties in the garbage collector:** 14 to 16% of the CPU under the mix. A larger young generation (`--max-semi-space-size`) was not tried.
- **The public API** (`/api/v1`) is closed for licensed data by design and was not measured.

## Sizing recommendation

For a league the size of the one tested (35,000 fighters, 160,000 fights), one instance:

| | ask for | because (measured) |
|---|---|---|
| CPU | **2 vCPU** (1 works at about 70% of the speed; more than 2 is wasted on one instance) | one thread serves; the second core gave 35 to 40% (14.9 to 21.0 req/s at 20 in flight) |
| RAM | **2 GB with `NODE_OPTIONS=--max-old-space-size=1024`**; or **4 GB with no cap** | 1.2 GB under load and 1.4 GB at a rebuild with the cap; 1.7 GB under load and 2.2 GB at a rebuild without |
| disk | a persistent volume of **5 GB** or more, SSD | database 62 MB, vendor cache 122 MB, 14 backups of the database about 0.9 GB; the database is read into memory at start, so disk speed matters only for the start and the update |
| network | nothing special; pages are 27 KB gzipped (65 KB for the Arabic home page), share images 80 KB | |
| instances | exactly 1, with the CDN or a proxy in front | `docs/deploy.md` |

What one such instance carries (calculation, from the measured throughput and two assumptions: 85% of requests are pages, as in the mix; a reader asks for a new page every T seconds): concurrent readers = req/s × 0.85 × T. At T = 30 s, 14.9 req/s gives about 380 and 21 req/s about 535; at T = 60 s, double. The assets of a visitor with a cold browser cache count against this (a page plus about 30 assets), so a CDN in front of the assets raises it, and a CDN that can serve pages for a minute raises it by the cache's hit rate (unmeasured here).

Put a limit of 10 to 20 requests in flight to the origin in the proxy, and queue or shed the rest: past that the answer only gets later (3.3 s at 50 in flight on one core), and at 100 on one core some requests waited 30 s.

**What to watch** (all in the logs or the health check already): resident memory against the container limit, with a margin of 1 GB above the loaded figure for the rebuild; the `world_built` log lines (one a day at midnight UTC, and two per data update: more means something is writing to the database or the clock is wrong); `/api/health` latency and `data.stale` (an update that has stopped); the error lines (`"level":"error"`); the proxy's own request time at the 95th percentile (the origin's p95 at 5 in flight is 0.5 to 0.8 s here); the count of requests the proxy queued.

**Running the update:** at a quiet hour, right after midnight UTC (the midnight rebuild and warm-up are one stall of about 12 s; the update adds two more of about 5 s each), with the proxy serving stale pages meanwhile. Alternatively restart the container after the update: one 12 to 16 s start instead of two rebuilds under traffic, with the health check failing meanwhile.

## What to put in front

Cache headers measured on the production server (localhost, `Accept-Encoding: gzip`):

| | `Cache-Control` | note |
|---|---|---|
| pages, English and Arabic | `private, no-cache, no-store, max-age=0, must-revalidate` | `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding`; gzipped by the app (27 KB for a fighter page; 197 KB plain) |
| `/_next/static/*` | `public, max-age=31536000, immutable` | correct as it is |
| share images (`…/opengraph-image`) | `public, max-age=0, must-revalidate` | revalidates every time; 80 KB, 220 to 380 ms to draw |
| `/api/art/portrait/*` | `public, max-age=86400, stale-while-revalidate=604800`, `ETag` | |
| `/api/fighter-card/*` | `public, max-age=300` | |
| `/api/search`, `/api/fighters` | none | 1 KB; cheap (4 to 11 ms) except the first search after a start |
| `/api/v1/*` | `public, max-age=300, s-maxage=300` (404 and 429 `no-store`) | closed for licensed data |
| `/sitemap.xml`, `/sitemaps/*.xml` | `public, max-age=3600` | 8.6 MB a file, not compressed by the app |
| `/feeds/*` | `public, max-age=900` | |
| `/robots.txt`, `favicon.ico` | `public, max-age=0, must-revalidate` | |
| `/api/health`, account and forum APIs | `no-store` | must never be cached |

Recommendations:

1. **Always put a CDN or caching proxy in front for the static files, images, sitemaps and portraits**, and let it compress the XML (the app does not). That alone removes the assets (about as much origin work as the page itself, for a first-time visitor), the sitemaps and the share images (the dearest single requests) from the origin. Give the share images an edge cache time (an hour or more; they change with the data, and a stale card is harmless) whatever the origin says: the origin's `max-age=0` makes a CDN with default rules revalidate every time.
2. **Pages: the origin says "do not cache", and that is a decision, not an accident.** No page reads a cookie (nothing in `app/` outside the APIs calls `cookies()`), the language is in the URL, and there is no redirect on `Accept-Language`, so the HTML of a URL is the same for everybody, and a CDN told to cache it for 30 to 60 seconds would lift the ceiling by the hit rate. Two things must be settled first, neither tested here: **(a)** each page's `Content-Security-Policy` header and the `nonce` attributes in its markup are made together per request (`proxy.ts`); a cached copy gives every visitor the same nonce, which still works but means the nonce no longer keeps an injected script out of those pages, so it is a security decision for `docs/security.md` before it is a performance one; **(b)** the pages `Vary` on Next's `rsc` and router headers, and navigation inside the site fetches the same URL with an `_rsc` query: the cache key must include the query string and honour `Vary` (or bypass requests carrying an `rsc` header), or the browser can be handed a page where it asked for data.
3. **Pass `X-Forwarded-For`** (`docs/deploy.md`): without it the per-address limits see one visitor.
4. **Serve stale on error and while the origin is busy** (`stale-while-revalidate`, `stale-if-error`): the origin stalls for 10 to 16 s at each data update and starts in 12 to 16 s, and the CDN can cover both for pages it has.
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
npm run capacity -- --base http://localhost:3417 --pid <pid> --steps 5 --seconds 70 --event-at 20 --event-cmd "<a command that writes to the database>"
```

On a real host, run the driver from another machine (so it does not take the server's cores), against a copy of the database, never against a site other people use. `RINGSIDE_MEMO_LOG=1` on the server logs every aggregate a first visit computes; `node --cpu-prof` on it gives the profile the hot spots were found with. The per-run JSON from this report was not kept in the repository (it is a few KB each); re-running takes about 12 minutes per core configuration.
