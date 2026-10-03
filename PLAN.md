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

**Verified:** type check and lint clean; production build passes; all 12 routes return 200 (404 for unknown fighter/division); no horizontal overflow at 390px on 10 pages; Next upgraded 16.2.6 to 16.3.8 (`npm audit`: 0 vulnerabilities, it was 1 critical and 2 high); interactive predictor checked in the browser (age slider, presets and reset move the odds correctly; "Pure Elo" equals the Elo expectation); Wikimedia resolver checked against mocked Wikidata/Commons responses (14 decision cases + 17 licence strings) and its SQLite path (upsert, retry window, re-ingest keeps photos).

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
On the demo league: refitting only the Elo scale cuts held-out log-loss from 0.6175 to 0.5862; adding all other features makes it slightly *worse* (0.5900), because most are noise; the planted weigh-in and trainer effects are too small to detect at ~4k bouts (z of about -0.4 and -0.7 against a 2.0 threshold). The app therefore applies only the fitted Elo scale (about 2.6× the plain expectation: ratings are compressed relative to true skill gaps) and leaves other terms hand-set. **Re-run this on real data**: it will say what is really predictive.

### 8.6 What the demo league plants (so analytics have something to find)
Trainer skill boosts (sd 45 Elo) · a fight-night weight edge (2.2 Elo per lb) · judges with home-fighter bias · referees with early-stoppage tendencies. These are simulator properties, not claims about boxing.

### 8.7 Next
1. Pick the licensed vendor; ask specifically for **trainer/manager history, weigh-in weights and scorecards** in the sample and in writing, plus storage and redisplay rights.
2. Ask BoxRec about data licensing (the one source that has trainers and weigh-ins at scale).
3. Download a few Nevada/California result PDFs and build a parser for official and pre-fight weights.
4. Add an editor workflow for trainer/manager history, each row carrying a source.
