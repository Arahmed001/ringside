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
- The in-memory data cache refreshes every 10 minutes. After a manual ingest call `invalidateWorld()`.
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
- `npm test` (Node's built-in runner, 84 tests, about a second): divisions, methods, model, validator rules, ingest (quarantine, strict mode, idempotency, slugs), world invariants (every record equals the results that count; league wins equal losses; rankings are sex-separate, active, winning-record), a hand-built calendar with every status combination, search parsing, the Wikimedia and Wikidata importers (mocked network, fixtures from real responses), the resolver's database path, the model fitter (recovers known coefficients), the parsimony rule, and the `data:check` CLI including its exit codes.
- `.github/workflows/ci.yml` runs on every push and PR: `npm ci`, type check, lint, tests, `data:check` on the demo feed, production build; plus a non-blocking `npm audit`. The exact steps were replayed in a clean copy with a fresh `npm ci` and all passed. It has not yet run on GitHub itself.
- Test hygiene: a deliberate-breakage check confirmed the suite fails when a corner retirement stops counting as a knockout, when the validator keeps unknown divisions, when the age penalty has the wrong sign, when women fight men, and when cancelled bouts count as upcoming (that last one initially slipped through, which is why `tests/calendar.test.ts` exists).

### 9.4 Still open
Everything in §8.7, plus: the CI workflow's first real run on GitHub; a UI for the quality report beyond the Data page; amateur and multi-day (tournament) results; per-round scorecards; weigh-in video/photo evidence (not planned).
