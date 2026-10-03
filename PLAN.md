# Ringside: architecture and roadmap

A boxing database with better design and far more analytics than BoxRec. This file covers what exists, how the pieces fit, and what comes next.

## 1. Principles
1. **Own the database.** Vendors feed our tables through an adapter and nothing renders from a live vendor call. A vendor can then change pricing or disappear without breaking the site, as long as the licence allows storing the data (see §4).
2. **Provenance on everything.** Every photo shows its licence and author. Every rating is labelled as ours, unofficial.
3. **No scraping, no guessing.** BoxRec forbids scraping. Images come from Wikimedia (free licences) or from the vendor feed. The headshot matcher only accepts a match it can verify, and otherwise shows nothing.
4. **Everything degrades gracefully.** No AI key: search and scouting reports fall back to rules. No photo: a generated portrait. No poster: generated art.

## 2. Current architecture
```
provider adapter ──► ingest ──► SQLite (node:sqlite) ──► world cache ──► server components
 demo | licensed      │             boxers/events/bouts       │            (pages, SSR)
                      │             rating_history            ├─► lib/rankings   (division top 15, 90-day movement)
                      ├─► Elo recompute                       ├─► lib/analytics  (heatmaps, upsets, streaks)
                      └─► media resolver (optional)           ├─► lib/model      (logistic win-probability, pure)
                          Wikidata → Commons                  ├─► lib/style      (archetypes, similarity, PCA map)
                                                              └─► lib/ai         (NL search, scouting reports)
```
- **Stack:** Next 16 (App Router, async `params`/`searchParams`), TypeScript, Tailwind 4, `node:sqlite`.
- **Divisions:** `lib/divisions.ts` holds the 17 official divisions with weight limits. `normalizeDivision()` maps vendor spellings such as "Jr. Welterweight" to canonical names and throws on unknown input, so bad data fails at ingest.
- **Ratings:** Elo (K=24, +15% for stoppages) replayed chronologically on every ingest. Rankings are active fighters with 5+ bouts and a fight in the last 24 months.
- **Prediction:** a logistic regression over fighter differences (`lib/model.ts`). The same pure function runs on the server for default odds and in the browser for the sliders. Weights are hand-set until real results exist to fit them.
- **Images:** a real `photoUrl`/`posterUrl` from a feed or Wikimedia wins. Otherwise generated SVG portraits and posters (deterministic per fighter).

## 3. Media resolver (Wikimedia)
`lib/media/wikimedia.ts`, `lib/media/resolve.ts`, `scripts/resolve-media.ts`

A candidate is accepted only if **all** of these hold:
1. Wikidata lists it with occupation *boxer* (Q11338576).
2. Its birth year equals ours (exactly one boxer must match, so shared names are rejected as ambiguous).
3. It has an image (P18) on Commons that is not non-free, is a JPEG/PNG/WebP at least 250px wide, and carries an accepted licence (CC0, public domain, CC BY, CC BY-SA).

It stores author, licence and page URL in `boxer_media` and renders them under the photo. It is polite to the API: it sends a User-Agent with contact info (`WIKIMEDIA_CONTACT`), spaces requests 250ms apart, and backs off on 429/5xx. Highest-rated fighters are resolved first, and misses are retried after 45 days.
- **Cropping:** CSS `object-position: top` in a 4:5 frame. Face detection is a possible later step.
- **Hotlinking:** thumbnails are loaded from Commons. At scale, mirror them to our own storage (licences allow it).
- **Posters:** Wikimedia rarely has fight posters, so promo art must come from the vendor or promoters. Generated posters fill the gap.
- **Not used:** Google Custom Search for images. It returns other people's copyrighted work.

## 4. Data vendor shortlist (researched 2026-10-03)
Public pages don't answer the questions that matter most: **historical depth, images, and the right to store and redisplay data**. Ask each vendor for a sample and written terms before paying.

| Option | Cost | What the public pages show | Open questions |
|---|---|---|---|
| **Boxing Data API** (RapidAPI, boxing-data.com) | Free: 100 req/mo. Pro $29: 5k. Ultra $99: 50k. Mega $249: 500k | Endpoints: fights, events, fighters, divisions, titles, organizations, rankings (current and historical). Round-by-round punch stats. Major promotions covered. Fighter fields: record, stance, height, reach, nationality, debut year | Run by an individual RapidAPI account. Pro includes only 30 days of historical fights. Mega has the full history. Image fields, storage and redisplay rights and the earliest year covered are not stated |
| **Box.Live data feeds** | Free for publishers | Hourly schedule, results and rankings. Top 15 for WBA, WBC, IBF and WBO from heavyweight to flyweight | Delivered mainly as a WordPress plugin. Whether raw access and database storage are allowed is unclear (their page returned 403 to us). Ask them |
| Sportbex | Custom quote | WBC, WBA, IBF, WBO, The Ring, PBC, BBBofC, JBC. JSON/XML, scores, rankings, odds | No public pricing, depth or terms |
| TheSportsDB | $1 to $20/mo | Boxing league from 1923, fixtures and results, artwork | Community-edited and uneven. Fighter-record quality unverified. Could supply artwork only after a licence check |
| Big Balls Data | Free to $49+/mo | 12k fighter profiles | Only US commission cards from Jan 2025, so no UK or Saudi cards. Does not fit a global database |
| OddsMatrix | From about €2,000/mo | Deep betting-grade feed | Built for bookmakers, far too expensive |
| Sportradar / SportsDataIO | Enterprise | Listed as sports-data suppliers | Boxing depth not confirmed, enterprise pricing |

**Recommendation:** use the Boxing Data API as the primary source and Box.Live for official sanctioning-body top 15s.
1. Use the free tier (100 requests) to check the schema and spot-check about 20 fighters.
2. Email the operator for written confirmation that Mega can be used to take a **one-time historical backfill** and keep it, plus how far back it goes and whether images exist. Buy Mega for one month only if yes. Then drop to Pro or Ultra for daily updates.
3. Ask Box.Live whether the feed can be consumed as raw data and stored.
4. If the operator is unresponsive or terms forbid storage, move to Sportbex quotes. The adapter interface makes this a one-file change.

## 5. Interactive predictor
`lib/model.ts` and `components/MatchupLab.tsx`. Six terms (rating, reach, age past 34, ring rust past 12 months, power, chin). The page has presets (Balanced, Pure Elo, Old school, Father Time), a 0–3× weight slider per term, and what-if sliders for each fighter's rating, age, reach and layoff. Win probability, stoppage chance and a per-factor breakdown update live.

## 6. Roadmap
**Next (needs the vendor decision)**
- Write the vendor adapter and map its division strings into `normalizeDivision` aliases.
- Fit the model weights by logistic regression on real results, with a held-out calibration check.
- Official sanctioning-body ranking tables, shown separately from our Elo rankings.

**Later**
- Accounts, server-side picks and streaks (pick'em currently lives in the browser), and fight-night alerts for watched fighters.
- Postgres, once there is hosting. SQL is isolated in `lib/db.ts` and `lib/ingest.ts`.
- Charts via Recharts and card animations via Framer Motion.
- Round-by-round punch stats if the vendor supplies them.
- Computer-vision punch heatmaps only on footage we have rights to. Public boxing video is mostly copyrighted, and this is a research project in its own right.

## 7. Status and known issues (2026-10-03)

**Verified (round 1):** type check and lint clean; production build passes; all 12 routes return 200 (404 for unknown fighter/division); no horizontal overflow at 390px on 10 pages; Next upgraded 16.2.6 to 16.3.8 (`npm audit`: 0 vulnerabilities, it was 1 critical and 2 high); interactive predictor checked in the browser (age slider, presets and reset move the odds correctly; "Pure Elo" equals the Elo expectation); Wikimedia resolver checked against mocked Wikidata/Commons responses (14 decision cases + 17 licence strings) and its SQLite path (upsert, retry window, re-ingest keeps photos).

**Not verified:** the Wikimedia resolver against the real Wikimedia APIs (needs a `WIKIMEDIA_CONTACT`); text contrast on generated posters; behaviour in Safari or Firefox; any real vendor data.

**Known issues and dev notes**
- **Do not set `turbopack.root` in `next.config.ts`.** With it set, `next dev` hung at "Compiling /", repeatedly respawned `next-server` and leaked hundreds of `postcss.js` worker processes until the machine hit its process limit ("fork failed: resource temporarily unavailable"). It happened twice, and each time went away when the setting was removed. The cause inside Next is not isolated. If you see that error, run `pkill -f "ringside/node_modules/.bin/next"; pkill -f "ringside/.next/dev/build/postcss.js"`.
- Editing `lib/db.ts` while `next dev` is running can break the `node:sqlite` import until the server restarts.
- `node:sqlite` is experimental in Node 22 and prints a warning. Requires Node 22.5+.
- Demo data is generated on first run into `data/ringside.db`. After changing `lib/providers/demo.ts`, stop the server, delete `data/` and restart.
- The in-memory world is rebuilt when the calendar day changes or the database changes (another process committed, or a new ingest run was recorded), not on a timer; see §10. Anything that writes to the database from inside the server process without recording an ingest run should call `invalidateWorld()`.
- The demo league has fewer qualified contenders in some divisions (5 to 15 per division). Ranking rules require a winning record, so thin divisions list fewer than 15.
- Rankings, ratings and predictions are unofficial and computed from the (fictional) demo results.

## 8. Data landscape and data model (round 2, 2026-10-03)

### 8.1 What data actually exists
Measured, not assumed. Open sources cover fighter biography well and everything else poorly.

| Fact | Best open source | Coverage | Real route for the rest |
|---|---|---|---|
| Birth date / place, nationality, height, weight, image, cross-IDs | **Wikidata (CC0)** | ~19.6k boxers; birth date 17.4k, birthplace 12.2k, citizenship 16.4k, BoxRec ID 10.1k, image 3.5k, height 3.5k, weight 1.5k | n/a, already good |
| Fighter photos | **Wikimedia Commons** (CC BY / BY-SA / CC0 / PD) | follows Wikidata images | vendor-supplied |
| Bout records, results, belts, rankings | none | none | licensed feed (Boxing Data API, Box.Live, Sportbex) |
| **Trainers / managers / gyms, with dates** | none | Wikidata lists 654 boxing trainers but only ~16 have any student linked, and ~25 boxers any "student of" | BoxRec licensing enquiry; vendor fields (undocumented); editors; Wikipedia prose |
| **Weigh-in and fight-night weights** | US athletic commission result PDFs (Nevada, California) are public records | US only, PDF, no bulk API | commission PDFs downloaded by hand + a parser (not built); vendor fields (undocumented) |
| Judges, referees, scorecards | commission results; vendor | partial | same |
| Punch statistics | CompuBox (paid) | partial | licence |

Not usable: BoxRec (scraping prohibited; data licensed to partners only) and Kaggle "boxing" sets (no provenance or licence statement found; several are scrapes of the above). Nevada's site rejected automated requests, so commission files need to be downloaded manually.

**Wikidata gotcha (handled):** raw quantity values mix units. One property returned `1.74` (m), `70.5` (inches) and `173` (cm) for different boxers. The importer reads the unit-normalised fields (`psn:`) and drops implausible values.

### 8.2 Data model (SQLite; every optional table is filled only if the provider supplies it)
```
boxers      + birth_date, birth_place, residence, wikidata_id, boxrec_id, aliases, debut_date, retired_date
events      + promoter_org_id, broadcaster, attendance
bouts       + round_time, kd_red, kd_blue, odds_red, odds_blue, contract_lb, title_org_id, title_vacant
people      trainers, managers, judges, referees (one table; roles come from relationships)
orgs        gyms, promotions, sanctioning bodies, broadcasters
team_stints boxer ↔ person/org, role (head_trainer, assistant_trainer, strength_coach, cutman, manager, promoter, gym),
            start_date, end_date (NULL = current), source
weigh_ins   (bout, boxer): official_lb, fight_night_lb, limit_lb, made_weight, source
officials   bout ↔ referee/judge (+ seat);  scorecards: bout, judge, seat, red_score, blue_score
corners     who was actually in the corner for a bout
punch_stats (bout, boxer, round 0 = total): thrown/landed, power, jabs
wikidata_boxers  staging copy of the Wikidata import + match method
```
Provider contract: `lib/providers/index.ts`. Re-ingest is idempotent: stints and weigh-ins are replaced per `source`, so enrichment rows from other sources (e.g. `wikidata`) survive. Slugs are unique against rows that already exist.

### 8.3 Pipelines
- `npm run wikidata:import -- --limit 500` then `-- --enrich`: bulk biography import (batched SPARQL, one request per ~1.2s, needs `WIKIMEDIA_CONTACT`); enrichment links our fighters by BoxRec ID, otherwise by normalised name + birth year when exactly one candidate exists, and fills **only** blank fields so a licensed feed always wins.
- The same import now also stages **International Boxing Hall of Fame IDs (P4474), Olympedia IDs (P8286) and awards (P166 with year)** in a second, separate query per batch (`--limit N` as before); `--enrich` copies the IDs onto linked fighters (blanks only) and rewrites each linked fighter's `honours` rows with `source = 'wikidata'` (rows from other sources are never touched).
- `npm run media:resolve`: photos; fighters already linked to Wikidata skip the name search.
- `npm run model:fit`: fits win-probability weights from the bouts in the database (§8.5).

### 8.4 New pages
`/bouts/[id]` (weigh-in, corners, officials, scorecards, knockdowns, odds, punch stats) · `/people` and `/people/[slug]` (trainer leaderboard and stables with timelines, managers, judges, referees) · `/orgs` and `/orgs/[slug]` (gyms, promotions, sanctioning bodies with current titleholders) · `/weights` · `/data` (field coverage, source registry, model report). Fighter profiles gain bio facts, a corner-and-camp timeline and a weigh-in chart. Search understands "trained by", "managed by", "promoted by", "out of the X gym", "born in", "missed weight", "new trainer".

### 8.5 Model fitting: what we learned
Features known before the fight (Elo gap, reach, age, layoff, KO rate, KO losses, experience, usual rehydration, fight-night weight edge, new-trainer flag, trainer's prior win rate), L2 logistic regression, time-ordered split (train on the first 75% of bouts, test on the last 25%).
On the demo league (4,760 training + 1,587 held-out bouts): refitting only the Elo scale cuts held-out log-loss from 0.6165 to 0.5813; adding every other feature reaches 0.5796, a gain of 0.0017 that is within noise, so the **parsimony rule** (a more complex model must beat a simpler one by at least 0.002) keeps "Elo refit". The planted weigh-in and trainer effects are too small to detect at this size (z of about 0.0 and 0.2). The app therefore applies only the fitted Elo scale (about 2.7× the plain expectation: ratings are compressed relative to true skill gaps) and leaves other terms hand-set. **Re-run `npm run model:fit` on real data**: it will say what is really predictive. (An earlier, smaller demo league recommended Elo refit for a different reason: extra features were slightly *worse* there. The recommendation can change as data grows; that is the point of re-running it.)

### 8.6 What the demo league plants (so analytics have something to find)
Trainer skill boosts (sd 45 Elo) · a fight-night weight edge (2.2 Elo per lb) · judges with home-fighter bias · referees with early-stoppage tendencies. These are simulator properties, not claims about boxing.

### 8.7 Next
1. Pick the licensed vendor; ask specifically for **trainer/manager history, weigh-in weights and scorecards** in the sample and in writing, plus storage and redisplay rights.
2. Ask BoxRec about data licensing (the one source that has trainers and weigh-ins at scale).
3. Download a few Nevada/California result PDFs and build a parser for official and pre-fight weights.
4. Add an editor workflow for trainer/manager history, each row carrying a source.


## 9. Real-data readiness and quality gates (round 3, 2026-10-03)

### 9.1 Real-world cases the model now handles
Found by reviewing the code against what real feeds contain; each would otherwise have failed an import or corrupted records.
- **Result methods:** KO, TKO, RTD (corner retirement), DQ, UD/MD/SD, TD (technical decision), DRAW, TDRAW (technical draw), NC. `lib/methods.ts` defines what each means for records: a corner retirement counts as a knockout (as on BoxRec), a DQ is a win but not a knockout, a no-contest is excluded from both records, technical results are scored over the rounds fought. `normalizeMethod` maps vendor spellings ("Decision - Split", "Technical Knockout", "N/C").
- **Women's boxing:** `sex` on every fighter; rankings, pound-for-pound, search and labels are separate ("Women's Welterweight"). Women never fight men in the demo.
- **Stance:** Orthodox, Southpaw, Switch.
- **Cancelled and postponed:** events and bouts carry a status. A cancelled bout on a live card is shown but never upcoming and never headlines; a postponed card stays on the calendar; cancelled cards never appear as results or calendar entries.
- **Pinned clock:** everything date-dependent goes through `lib/clock.ts`, so `RINGSIDE_NOW=2026-10-03` makes runs reproducible.

### 9.2 Data-quality gate
`sanitizeFeed` (lib/validate.ts) checks a feed **before** anything is written:
- **Errors drop the row** (and anything that depends on it): duplicate or missing IDs, unknown division or method, bad dates, a winner who was not in the bout, a result with no winner (or a draw with one), end round past the scheduled distance, references to fighters/events/bouts/people that do not exist, team stints with no person/organisation or with end before start.
- **Warnings keep the row and flag it:** scorecards that contradict the recorded result, incomplete or out-of-range scorecards (technical decisions are range-checked over the rounds fought), a made-weight flag that contradicts the scale, rehydration or weights that are implausible, a limit that doesn't fit the division, a fighter on two cards the same night, overlapping head trainers, implausible height/reach/debut age, punch stats that don't add up.
- **Info:** people or organisations linked to nothing.

Every ingest records its run and issues (`ingest_runs`, `ingest_issues`), shown on the Data page. Strict mode (abort before touching the database if any row has an error) is `ingest(db, provider, { strict: true })`.

**Evaluating a vendor sample:** convert it to the `FeedData` JSON shape (`lib/feed.ts`; any missing array is treated as empty), then `npm run data:check -- --file sample.json`. It prints rows in/kept, issues grouped by code with examples, and exits 1 if any row would be dropped. `BOXING_PROVIDER=file` with `BOXING_FILE=sample.json` loads such a file into the app.

### 9.3 Tests and CI
- `npm test` (Node's built-in runner, 96 tests, about two seconds): divisions, methods, model, validator rules, ingest (quarantine, strict mode, idempotency, slugs), world invariants (every record equals the results that count; league wins equal losses; rankings are sex-separate, active, winning-record), a hand-built calendar with every status combination, search parsing, the Wikimedia and Wikidata importers (mocked network, fixtures from real responses), the resolver's database path, the model fitter (recovers known coefficients), the parsimony rule, and the `data:check` CLI including its exit codes.
- `.github/workflows/ci.yml` runs on every push and PR: `npm ci`, type check, lint, tests, `data:check` on the demo feed, production build; plus a non-blocking `npm audit`. The exact steps were replayed in a clean copy with a fresh `npm ci` and all passed. It has not yet run on GitHub itself.
- Test hygiene: a deliberate-breakage check confirmed the suite fails when a corner retirement stops counting as a knockout, when the validator keeps unknown divisions, when the age penalty has the wrong sign, when women fight men, and when cancelled bouts count as upcoming (that last one initially slipped through, which is why `tests/calendar.test.ts` exists).

### 9.4 Still open
Everything in §8.7, plus: the CI workflow's first real run on GitHub; a UI for the quality report beyond the Data page; amateur and multi-day (tournament) results; per-round scorecards; weigh-in video/photo evidence (not planned).

## 10. Scale test (round 4, 2026-10-03)

The demo league is 968 fighters and 7,755 bouts. A licensed feed could be 20 to 1000 times that, so the app was tested at 5× and 20× (19,360 fighters, 159,296 bouts, 1.1 million punch rows, 324 MB database) with `npm run bench -- --scale N [--keep]` (generation, validation, ingest, world build, the server-side work behind every page, and what each page ships to the browser) plus per-route HTTP timings against `next start`. Numbers are from one Apple-silicon Mac, Node 22, single process.

### 10.1 What it found, and what changed

| At 20× | Before | After |
|---|---|---|
| `/compare` HTML | 8.9 MB (every fighter in a `<select>`), 320 ms | 23 KB, 4 ms (type-ahead over `/api/fighters`) |
| `/map` HTML | 5.4 MB, 181 ms | 555 KB (82 KB gzipped), 50 ms (400 highest-rated per style, tuples, 3-decimal coordinates) |
| `/` HTML | 1.8 MB, 151 ms | 514 KB (44 KB gzipped), 81 ms (watchlist fetched for the few starred fighters; 12 posters in the strip) |
| `/events` HTML | 1.3 MB | 1.2 MB: 24 upcoming cards unless `?upcoming=all`; the rest is the 48 generated posters (see 10.3) |
| `/people?role=judge` | 735 ms per view | 5 ms warm (154 ms once per world) |
| `/analytics` | 457 ms | 10 ms warm (240 ms once) |
| `/orgs` | 351 ms | 5 ms warm (276 ms once; stats for the top 36 gyms and promotions only) |
| `/weights` | 280 ms | 8 ms warm (138 ms once) |
| `/data` | 278 ms | 5 ms (cached per database version) |
| `/people` (trainers) | 160 ms | 6 ms warm (231 ms once) |
| 4 simultaneous world builds | 4 separate builds, 16.2 s | 1 build, 3.9 s |

Every route is now under 100 ms warm at 20×, and at the demo size every route is under 30 ms (the same as before). Over HTTP, the first request after a restart still pays for the world build (8 concurrent cold requests all finished after 4.6 s; the benchmark puts the world build itself at 3.5 to 3.7 s).

What was done:
- **World cache** (`lib/world.ts`, `lib/db.ts`): the world is now valid until the calendar day changes or the database does (`PRAGMA data_version` moves when another process commits; the latest ingest run id covers a re-ingest here). The 10-minute timer is gone, so the 3.6 s blocking rebuild no longer happens every ten minutes. Callers that arrive together share one build (it used to be one build each). `eventById`, `boutById` and `officialsByPerson` replace per-request linear scans (judge stats, bout and event pages, official profiles, head-to-head).
- **Memoised aggregates** (`lib/memo.ts`): analytics, judge/referee/dispute tables, trainer leaderboard, weigh-in aggregates, the organisations index and the coverage queries are computed once per world (or database version), not per page view. The world is never mutated, so a rebuilt world starts with empty caches. Rule: results are shared, copy before sorting (the trainer table does).
- **Algorithms:** `upcomingEvents`/`recentEvents` walk back from the end of the date-ordered list instead of filtering every event; `finishHeat`, `byWeightClass` and `divisionWeights` are single passes (they re-scanned all bouts or weigh-ins once per division); the organisations index ranks on a cheap count and computes full stats for 36 cards.
- **Payloads:** fighter pickers search on the server (`lib/fighter-search.ts`, about 1 ms at 20,000 fighters, accent-insensitive, prefix matches first); a typed name still works without JavaScript because the server resolves it. The home watchlist asks `/api/watch` for just the starred slugs (capped at 100).
- **Generator** (`lib/providers/demo.ts`, `scale` option): quadratic loops removed and a gym-name infinite loop fixed (320 gyms from 96 plain name combinations spun forever at 5×). The scale-1 output is byte-identical (fingerprint SHA1 `a756f32cb042b1b216235aee10c1806e642b9dcf`, 968 fighters, 7,755 bouts).
- **Tests** (`tests/scale.test.ts`, `tests/calendar.test.ts`, 96 in all): shared build, rebuild on day change and on another connection's commit, no rebuild on a timer, every lookup map and memoised aggregate against the plain scan it replaced, type-ahead ranking and the no-JavaScript fallback, API bounds, style-map sampling, org index and weigh-in aggregates against the old formulas, a scaled feed that validates with unique names. Breaking each fix on purpose makes a test fail (checked for the cache key, the shared build, the calendar filters, the sampling order, the search ranking, gym names and the weigh-in pass).

### 10.2 Where the architecture runs out

| | 1× (demo) | 5× | 20× | extrapolated 100× |
|---|---|---|---|---|
| bouts | 7,755 | 39,779 | 159,296 | ~800,000 |
| world build (blocking) | 0.12 s | 0.67 s | 3.7 s | ~19 s |
| world heap | 22 MB | 114 MB | 456 MB | ~2.3 GB |
| process RSS (bench process) | 179 MB | 589 MB | 1.7 GB | ~8 GB |
| database file | 14 MB | 79 MB | 324 MB | ~1.6 GB |
| ingest (validate, write, Elo) | 0.3 s | 2.1 s | 9.7 s | ~50 s |

Build time and memory are linear in bouts (the extrapolation is a straight line, not a measurement). The single-process, in-memory world is **comfortable to about 50,000 bouts, tolerable to about 200,000** (a 4 s pause at midnight and after each ingest, 2 GB of RAM), and **not viable beyond roughly 500,000** (a 10 s freeze of the whole server on every rebuild, which no cache tuning fixes because the build is synchronous). Decision rule for the vendor choice: if the licensed feed has fewer than about 150,000 bouts (an active-fighter or last-decade subset does), stay on this design and SQLite; if it carries full history for 400,000+ fighters, the world must shrink to a hot set (active fighters, their bouts, current rankings) with the rest read from the database per page, and the database should move to Postgres at the same time (concurrent writers for ingest, real indexes for search, no 2 GB process). That is a substantial rewrite of `lib/world.ts` and of every page that scans `w.bouts`; it is not started because the vendor and its volume are not known.

### 10.3 Still open from this round
- **Cold start and first request after a rebuild** block for the build time above. A warm-up at server start (Next's `instrumentation.ts`) would move it off the first visitor; not added.
- **Generated art is heavy:** each generated portrait is about 9 KB of inline SVG and each poster about 25 KB, so `/rankings` is 892 KB and `/events` 720 KB to 1.2 MB of HTML at every scale (50 to 80 KB gzipped, which the server does send). Real photos are `<img>` tags and cost almost nothing, so this fades as licensed headshots arrive; serving generated art from cacheable SVG endpoints would fix it sooner.
- The per-request linear scans that remain are small (judge profiles use `officialsByPerson`, but `/orgs/[sanctioning body]` still filters all bouts for its title fights; not measured, a single pass), `/boxers` filters and sorts everyone per search (8 ms), and the trainer table and organisation index take 230 to 280 ms once per world.
- Fighter search is a linear scan; past about 200,000 fighters it needs an index (or Postgres trigram search).

## 11. Step 1 of the feature list: Arabic/English site, SEO foundation, ⌘K (round 5, 2026-10-03)

**Bilingual, whole site.** English stays at the bare path, Arabic is `/ar/...` (`proxy.ts` rewrites English requests into `app/[locale]/` and 308-redirects `/en/...` so each page has one URL per language; crawlers are never redirected by `Accept-Language`). Every page, component, API answer, search result, share image and AI scouting prompt is localised; details and the writing rules are in `docs/i18n.md`.
- **Text:** the English sentence is the key (`t("Find a fighter")`), Arabic lives in `i18n/ar.json` (783 keys, 0 missing), a missing entry falls back to English. Plurals use Arabic's six forms; gendered sentences have he/she variants; markup inside a sentence via `t.rich`. A source scanner (`npm run i18n:extract`) reads every key, and a test fails if any key lacks Arabic or any placeholder differs. Only the keys client components use are sent to the browser (`i18n/client-keys.json`).
- **Names:** fighters, trainers, gyms, events, venues, cities, nicknames and belt names are Latin in every feed, so their Arabic forms live in a `name_translations` table keyed by the English spelling (survives re-ingest, records source and review state). The 1,847 demo names were transliterated in this session by Claude and are all marked **unreviewed**; given names and surnames were unified across batches (39 inconsistent spellings fixed). `npm run i18n:names -- export|import|auto|review`. Search matches Arabic spellings (alef/hamza/yeh/teh-marbuta folded, vowel marks ignored); the rule-based natural-language parser understands common Arabic phrases (divisions, stance, "undefeated", "N knockouts", countries) and with an API key Claude parses any wording.
- **Layout:** fully mirrored with logical Tailwind classes. Charts, bars, posters and timelines keep red on the left and blue on the right in both languages (`.ltr-fixed`). Fonts: IBM Plex Sans Arabic (text), Tajawal (display), Amiri (nicknames). Letter-spacing is zeroed for Arabic (it breaks letter joining). Western digits (0-9) and the Gregorian calendar in both languages; country names from `Intl.DisplayNames`; units in Arabic (سم, رطل, كجم).
- **Verified:** every page returns 200 in both languages, none overflows horizontally at 390, 768, 1000 or 1280 px, a sweep of the Arabic HTML found no unlocalised sentences (remaining Latin: brand, Elo/PCA, division codes, source names, ingest table names on the Data page, the language switch itself), ⌘K and the type-ahead work in Arabic, 107 tests pass. **Not done:** a native Arabic speaker has not read any of it. Names and UI strings are machine translations and should be reviewed before launch (the dictionary and the names table are plain data, so edits are easy).

**SEO foundation.** Per-page `generateMetadata` (title, factual description built from real data, canonical, hreflang en/ar/x-default, Open Graph, Twitter card); JSON-LD (Person for fighters and corners, SportsEvent with competitors for events, Organization, WebSite with SearchAction); `robots.txt`; a sitemap index plus sitemap files of up to 10,000 paths each listed in both languages with `xhtml:link` alternates (title fights and main events get bout URLs, undercard bouts do not: thin pages); 1200×630 share images for the site, fighters, events and bouts, rendered in both languages (Arabic shapes correctly) from fonts in `assets/fonts` (Barlow Condensed, Tajawal; OFL).
- **The demo is never indexed.** Unless `BOXING_PROVIDER` is a real provider (or `INDEXABLE=1`), every page is `noindex, nofollow`, `robots.txt` disallows everything and the sitemap 404s, so fictional fighters can't reach search results. Set `SITE_URL` in production (canonical URLs, hreflang and the sitemap use it).
- Honest limits: nothing ranks until the site is on a public domain with real licensed data and links pointing at it; this removes the technical obstacles, it does not buy ranking. Core Web Vitals are not yet measured (generated portraits are heavy inline SVG; see §10.3).

**⌘K.** `Ctrl/⌘+K` or `/` opens one box over fighters, trainers/managers/judges/referees, events (name, city, venue), gyms/promotions/bodies and the site's pages, in both scripts, with arrow-key navigation, grouped results and a quick-links list when empty (`/api/search`, `lib/search.ts`; dialog and combobox roles; focus returns to where it was).

**Still to do for this step:** an accessibility and design audit (keyboard and screen-reader walkthrough, poster text contrast, Arabic typography review by a native reader), the review pass over machine-written Arabic, Search Console submission after launch, and surfacing "unreviewed" names in the editor workflow when that exists.

## 12. Money data and the research pipeline (round 6, 2026-10-03)

**Data model.** Four new optional provider feeds (`fetchFinancials`, `fetchPurses`, `fetchBroadcasts`, `fetchEarnings`; contract in `lib/providers/index.ts`) and tables `event_financials`, `purses`, `event_broadcasts`, `earnings`: gate, tickets, capacity, site fee, PPV buys/price/revenue, sponsorship; one purse per fighter per bout (guaranteed, bonus, total); broadcaster, platform, region, average and peak audience per card; yearly earnings (ring and off-ring). **Every row carries a basis** (`disclosed` official record / `reported` named outlet / `estimated`), a named source, an optional URL and a reading date, and several sources can coexist for one figure: the strongest wins per field and each figure shows its own source (`lib/money.ts`). Validation (`lib/validate-money.ts`) drops rows with no basis or source, bad references, negative amounts or duplicate sources, and flags (keeps) implausible figures: tickets over capacity, PPV revenue that disagrees with buys × price, a purse below its guarantee, a peak below the average. `lib/ingest-money.ts` writes rows per source (re-runs never duplicate) and can add money to a database that already has its fighters and cards.

**Pages.** `/money` (biggest gates, PPV leaders, highest purses, top earners overall and for the year, broadcasters with average audiences, gate+PPV by year, coverage line); a "The money" panel on every event (each figure with its basis chip, linking to its source) and an Earnings card on every fighter; money coverage rows on the Data page. All bilingual. The demo league has simulated money (`lib/providers/demo-money.ts`, its own random stream, marked "simulated" in the source names, league output byte-identical).

**Research pipeline** (`docs/research.md`, `lib/research/`, `npm run research`). Researchers (Claude agents browsing the web, or the extraction bot) only write *claims*: a figure, the page URL and a word-for-word quote. Code then re-fetches every page (`PoliteFetcher`: identifies itself via `RESEARCH_CONTACT`, obeys robots.txt and crawl-delay, 3 s per host, never touches BoxRec, never retries or works round a 403/429/challenge), requires the quote to be on the page and every number to be in the quote, and publishes only figures that two independent sites (one not Wikipedia) agree on within 5%, or one official `.gov` record; a lone source is held (`single_source`), disagreeing sources are a `conflict`. `promote` matches verified claims to bouts by date and both boxers' names and refuses to guess; `apply` writes them through the quality gate. The extraction bot (`research extract`, needs `ANTHROPIC_API_KEY`) drops any fact whose quote is not on the page before the checker sees it; only its logic is tested (mock model), not live. 

**First harvest (run today).** Six agents researched about 35 marquee fights from 1987 to 2025 plus 2015-2025 earnings lists: 427 claims. The code re-check result: **267 verified, 110 single source, 18 conflicts, 32 unconfirmed** (10 of those because ESPN's and Fight News's robots.txt disallow the page, which the agents' curl ignored and the pipeline correctly refused; the rest quote mismatches or paywalled/blocked pages). Digest in `docs/research-results.md`; raw claims in `data/research/inbox/`, checked output in `data/research/checked.jsonl`. Findings worth knowing: the Nevada commission stopped releasing purses in July 2020 (NRS 467.1005; Florida and Arizona followed), so every recent purse is `reported` or `estimated`, never `disclosed`; no PPV buy counts exist officially for most Saudi-era cards; Forbes and Sportico earnings lists cover different 12-month windows, so a "conflict" between them is a period difference (the notes say which list); several agents' fight dates in my brief were wrong (Pacquiao–Vargas is 2016-11-05, Pacquiao–Marquez IV 2012-12-08) and they corrected them from the sources.
- **These facts are about real fights and cannot be shown yet**: the app's database holds the fictional league, and `promote` only attaches claims to fighters and cards it finds. They go live when a real feed is loaded. (Showing real money for fictional fighters would be nonsense, and the site must not mix the two.)
- **Source survey** (`docs/data-sources-survey.md`, from a seventh agent, desk research with evidence tags): Wikidata is under-used (19.6k boxers; 392 Hall of Fame IDs, 5.8k Olympedia IDs, 2.8k awards, ~1.9k dated events, no attendance); FightFax (the Association of Boxing Commissions' record keeper, ~1M bouts, sells a licence) is not on our vendor shortlist and is worth a quote; every large open boxing dataset it could trace is a BoxRec scrape and must be avoided (a CC0 label does not clean it); CompuBox, The Ring and Box-Rank forbid automated extraction; commission PDFs (Nevada, Texas) must be fetched by hand.

**Still open:** the Arabic money labels are my own translations and need the same native review as the rest; the 110 single-source and 18 conflicting claims need a person (or a third source); the extraction bot and `RESEARCH_CONTACT` use have only been run in tests/with the repo URL as contact; adding FightFax/Wikidata/Olympedia imports (survey §"prioritised plan") is the next data step.

## 13. Matchmaking and title lineage (round 7, 2026-10-03)

**Title lineage** (`lib/lineage.ts`, `/titles`, `/titles/[belt]`, a Titles card on fighter profiles). A belt is one sanctioning body + title name + division + sex (so an interim belt is its own line). Walking its title fights in date order: the first winner on record is champion; a vacant-title fight crowns its winner (and ends any reign still running as "vacated"); the champion beating a challenger is a defence, losing hands the belt over; a draw keeps it (counted); a no-contest, cancelled or upcoming bout changes nothing; a title fight the champion is not in passes the belt to the winner ("inherited"). It shows reign length, defences, who beat whom, a through-time strip of every reign (gaps = vacant), longest reign, most defences, most reigns, and marks a belt **dormant** when its holder is inactive or no title fight was held for 18 months. What results cannot show (stripped, vacated by retirement, belts passed with no fight) is not guessed. Verified on a hand-built feed covering every transition, and on the demo.
- **The demo's belts were incoherent** (title labels on random main events), which made every lineage a chain of strangers. `lib/providers/demo-belts.ts` now relabels title fights in its own pass after every result exists: a champion's fights in their division are for the belt, a belt left vacant (never held, or dormant for 18 months) is fought over by two proven fighters, a champion who loses hands it over. Results are untouched: the pre-change generator with its title labels removed hashes identically to the current league (`tests/money.test.ts`). Also fixed: re-ingesting never updated a bout's `title`.

**Matchmaking** (`lib/matchmaking.ts`, `/matchmaking`, a "who should he fight next" card on profiles, Open-in-dream-fight links). A pairing's **fight score (0-100)** is a weighted sum of six parts, each 0-1: *competitive* (how close the model has it), *relevance* (rating gap, both top-10), *style* (archetype clash, finishing power, star rating), *availability* (rested but not rusty; retired = 0), *novelty* (never met > a rematch of a close fight > a repeat) and *stakes* (a unification or a champion against a top-5 contender, from the lineage). Weights 0.28/0.18/0.14/0.14/0.12/0.14, written in the code and tested to sum to 1. Every score comes with plain-language reasons. Three views: **fights to make now** (the best pairing among each division's top eight available fighters, strongest eight overall), **who should he fight next** (active, unbooked, same sex, same division or one either side, not training partners, within 260 rating points), and the **dream-fight builder** (any two fighters: model odds, catchweight midway between the divisions' limits, reasons it may never happen such as different sex or divisions, retired, careers that did not overlap, already booked, reach gap, plus their meetings and common opponents with each one's result). All bilingual, reasons included.
- Honest limits: the weights are judgment, not fitted to anything (there is no outcome to fit a "good fight" against; a future version could learn from box-office and viewing data once real money data is loaded); a champion is rated so far above everyone that "competitive" is near zero for most opponents, so their list leans on relevance and stakes; availability is a proxy (time since last fight, no booking), not contract knowledge.

## 14. Wikidata extras: honours and amateur pedigree (round 8, 2026-10-03)

First item of the survey's prioritised plan (`docs/data-sources-survey.md` §12). All of it is CC0 and needs no new vendor.

- **Import** (`lib/importers/wikidata.ts`): `extrasQuery` / `parseExtras` read Hall of Fame boxer ID (P4474, a path such as `modern/golovkin`), Olympedia people ID (P8286, numeric) and every award statement with its year. Property IDs and the link formats were checked against Wikidata itself (an early guess of P9058 for Olympedia was wrong: that is a French death-register ID). IDs are validated by shape before they are stored or used in a link. Awards are classified `hall_of_fame` / `award` / `title` by label (Wikidata files belts such as "IBF World Middleweight Champion" under awards, so they are kept but shown apart from honours). An award whose label did not resolve (bare Q-id) is dropped.
- **Data:** `honours (boxer_id, kind, label, year, source, source_ref)`, `boxers.ibhof_id`, `boxers.olympedia_id`, and three staging columns on `wikidata_boxers`. Re-running the import and `--enrich` is idempotent; an award removed upstream disappears; an ID already supplied by a feed is never overwritten.
- **Pages:** the fighter profile gains an Honours block (gold chips for Hall of Fame and awards, titles in plain chips, first 8 then "+N more"; credit line "From Wikidata (CC0)") and Hall of Fame / Olympedia links in Identifiers. The Data page gains three coverage rows. Arabic strings added (machine-written like the rest; award names fall back to English until they are in `name_translations`).
- **Checked live:** 40 real boxers imported through the real query service: 2 Hall of Fame IDs, 9 Olympedia IDs, 5 with awards (Golovkin: Hall of Fame 2026; Fury: Ring Fighter of the Year 2015). Pages checked in both languages against seeded rows. The demo league has no honours (its fighters are fictional), so the block only appears once real fighters are linked.
- **Not done:** venues and dated events from Wikidata (the same survey item) are not imported; a full run over all ~19.6k boxers has not been done (about 330 batches, two requests each); BWAA award names have no Arabic form; the IBHOF link is plain `http://` because that is the formatter Wikidata publishes.
