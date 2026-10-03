# Real data: readiness checklist

Ringside runs on a fictional league. This is what stands between it and a real feed, what the Boxing Data API adapter does and does not know, and what to check on the first run. Nothing here costs money until the last step.

## Where things stand

- **Adapter:** `lib/providers/boxing-data-api.ts`, selected by `BOXING_PROVIDER=licensed`. Written against the vendor's published docs (`https://boxing-data.com/docs/endpoints/fighters`, `/fights`, `/events`), tested with a mocked feed built from the documented example shapes. **It has never talked to the real API.** The first free-tier run is the real test.
- **Evaluation without risk:** `npm run vendor:sample -- --fights 10` fetches the latest fights, the coming weeks' schedule and each fighter once, writes a gitignored sample file, and prints how much had to be approximated. `npm run data:check -- --file <sample>` then validates it without touching the database. 10 fights cost at most 1 (list) + 1 (schedule) + 2 per fight (each fighter once) requests, so about 20 of the free tier's 100 a month. The default cap is 60 requests; the run stops there.
- **Safety catches built in:** a request budget (default 90, `BOXING_API_MAX_REQUESTS`); the database is **not** filled from this feed until `BOXING_API_STORAGE_CONFIRMED=1`, which you set only after the operator confirms in writing that stored data may be kept (`docs/boxing-data-api-enquiry.md`); the key is never put in an error message or a log line; a failure is loud rather than a half-loaded league.

## The first run (about 20 requests, free)

```bash
export BOXING_API_KEY=...            # the RapidAPI key from the free plan
npm run vendor:sample -- --fights 10
npm run data:check -- --file data/vendor-samples/boxing-data-api-<date>.json
```

Look at the printed list of approximations and the validator's findings, then open the sample and check these against what the docs only imply. Each one is a place the adapter makes an assumption:

| Assumption | Where | If it is wrong |
|---|---|---|
| Auth is `x-rapidapi-key` plus `x-rapidapi-host` | `get()` | A 401/403 on the first call; change the two header names |
| A list endpoint's `data` is an array, `pagination.total_pages` is right | `collect()` | Zero fights loaded, or a loop that stops early; read one raw response |
| `page_size` up to 100 is allowed | `pageSize` | A 400 or a short page; set a smaller `pageSize` |
| `location` looks like "City, Region, Country" | `parseLocation` | `locationUnparsed` is high and countries read "Unknown"; check the real format |
| Event `date` is a UTC instant, so an evening card in the Americas can land on the next calendar day | `mapFight` | Wrong event dates by a day. This matters: the live ledger grades on the last snapshot strictly before the event date. If the feed has a venue time zone or a local date, use it |
| A drawn decision is `outcome: UD/MD/SD/PTS` with no winner | `mapFight` | A genuine draw is stored as "no result yet", or a fight with a missing winner is stored as a draw. `drawInferred` and `resultMissing` count both |
| Outcomes beyond `UD/MD/SD/TKO/KO/PTS` (DQ, RTD, no contest, technical decision) exist in the data | `mapFight` | They become "no result yet". Look for them in the sample and extend the mapping |
| `fighter_1` is the red corner | `mapFight` | The feed has no corner colours; the choice only affects which side is labelled red, and a 50% call counts as red |
| `/v2/fights/` also returns future fights, or only `/schedule` does | `load()` | Handled either way (deduplicated by id), but check upcoming fights actually arrive |

## What the feed does not say, and what the adapter does about it

Every approximation is counted. In a healthy feed these counts are small; a big one means look before trusting.

| Count (`notes()`) | What was missing | What is stored instead | What to do |
|---|---|---|---|
| `birthYearFromAge` | Only an age is published, not a birth date | `birthYear = this year - age`, which can be a year out | Wikidata (CC0) has birth dates for many fighters (`npm run wikidata:import -- --enrich`). Today enrichment only fills a *missing* birth date, so a wrong year here is not corrected by it; deciding whether it should override is open |
| `birthYearUnknown` | No age either | `birthYear` 0 | The age shows as nonsense. Make it nullable (below) before real use |
| `physicalsImputed` | Height and/or reach is null for some fighters | Reach from height and the reverse, then the division median, then everyone's median, then 175 cm | **Schema gap, below** |
| `turnedProFromFirstFight` | No debut year | The year of the first fight in the feed, which may be later than the real debut | Fine once the whole career is loaded |
| `ptsAsUnanimousDecision` | `PTS` is "points", not a decision type | `UD`, which claims unanimity the feed did not | Acceptable for ratings, wrong on a bout page's wording; consider a neutral "decision" method |
| `drawInferred` / `resultMissing` | No draw value | See the table above | Check the sample |
| `liveTreatedAsUpcoming` | `LIVE` fights | Treated as not yet decided | Fine |
| `fightsSkipped` | A fight with no date or fewer than two fighters | Skipped | Check the count |
| `boutsDroppedUnknownFighter` | A fighter's record could not be fetched | The bouts involving them are dropped, not stored with a hole | Re-run; a persistent one is a data gap |
| `stanceDefaulted` | No stance | Orthodox | The page says Orthodox for someone whose stance is unknown. Small, but a made-up fact about a real person |
| `locationUnparsed` | Location with no comma | The whole text as the city, country "Unknown" | Check the real format |
| `divisionUnknown` | A division name Ringside does not know | Kept as written | It will not appear in the rankings pages; map it in `lib/divisions.ts` |

Not in the feed at all, so absent from the real-data version of the site: punch statistics, judges' scorecards by judge (scores are an unlabelled list of strings), referees, weigh-ins, trainers and managers, odds, purses, venue capacity, photos, round time, knockdowns, and the card order within an event (bouts are ordered as the feed returns them). The pages that show these already hide when the data is absent; the money pages and "style" analyses will be thin or empty. **Check each section page against an empty league before going public.**

## Gaps in Ringside itself that real data exposes

1. **Missing facts cannot be "unknown".** `height_cm`, `reach_cm`, `birth_year` and `turned_pro` are required numbers, so the adapter fills them. The honest fix is to make them nullable and show a dash, with the model treating a missing reach as no reach advantage. That touches `lib/world.ts`, the model features, the fighter and compare pages and the style analysis. It is the most important code change before real use, and it is not made here because it reaches into many files.
2. **Ratings need depth.** Elo starts every fighter at the same number. A feed that goes back two years rates everyone off two years of fights, so the ratings, the model and the track record are weaker than they will be with a career's history. Prefer a backfill that loads whole careers for anyone who is active, even if it means fetching old fights.
3. **The live ledger starts its clock when real upcoming fights are loaded and the server is running.** Everything before that is a backtest, which the Track record page already labels. Load the schedule early.
4. **Names and claims about real people.** The previews, scouting reports and "Ask" answers state facts about real fighters. They are built from the data and the answer-grounding checks throw out numbers the data does not contain, but a wrong source row becomes a published wrong fact. Keep a visible way to report an error (a contact address on the Data page) and a policy for correcting or removing a row.
5. **Photos.** Real fighters get the generated portrait until a photo is licensed (Wikimedia Commons photos via `npm run media:resolve` carry their licence and credit). Do not hotlink or store vendor images.
6. **Wording (fixed while writing this).** The footer used to say "fictional, simulated data" on every page unconditionally, which would have been false the day real data loaded. It, the Data page's "Demo mode" note, the noindex rule, the sitemap and the structured data now all hang on one check (`isDemoData()` in `lib/seo.ts`, true unless `BOXING_PROVIDER` names a real provider). Checked by serving the demo league's feed as a non-demo provider: 20 section pages in real mode contain none of "fictional", "simulated", "demo build", "demo league" or "demo mode"; the footer points to the Data page for sources; the pages are indexable and the sitemap is served. Demo mode is unchanged.
7. **Credits and terms.** The Data page lists sources; add the vendor with its licence terms and any attribution it requires, once the terms are known.

## Decision gate before any money

1. Run the 20-request sample above and read the approximations.
2. Send the enquiry (`docs/boxing-data-api-enquiry.md`; it needs your name and project). The questions that decide it: may a one-time historical backfill be stored and kept, how far back does history go on each tier (Pro shows only 30 days), is there a source URL or ID that makes a row checkable, and is the service run with any continuity commitment (it is a single operator's RapidAPI listing).
3. If yes: one month of the Mega tier for the backfill, then drop to a cheaper tier for daily updates, with `BOXING_API_STORAGE_CONFIRMED=1`.
4. If no or silent: Sportbex quote, or a different adapter behind the same `DataProvider` contract (a one-file change).

Until step 3, the database is never filled from the vendor, whatever the environment says.
