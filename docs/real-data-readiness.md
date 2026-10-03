# Real data: readiness checklist

Ringside runs on a fictional league. This is what stands between it and a real feed, what the Boxing Data API adapter does and does not know, and what to check on the first run. Nothing here costs money until the last step.

## Where things stand

- **Adapter:** `lib/providers/boxing-data-api.ts`, selected by `BOXING_PROVIDER=licensed`. Written against the vendor's published docs (`https://boxing-data.com/docs/endpoints/fighters`, `/fights`, `/events`) and tested with a mocked feed. **It has talked to the real API on the free plan** (the first runs, 2026-10-03: see "What the first free-tier runs showed"); it has not yet loaded a full history, which needs the top plan.
- **Replay without spending:** `npm run vendor:sample -- --fights 10 --save-raw` keeps each raw response in `data/vendor-samples/raw/`; `npm run vendor:sample -- --from-raw data/vendor-samples/raw` re-runs the mapping over them with no requests and no key, so a mapping fix is tested on real responses for free.
- **Evaluation without risk:** `npm run vendor:sample -- --fights 10` fetches the latest fights, the coming weeks' schedule and each fighter once, writes a gitignored sample file, and prints how much had to be approximated. `npm run data:check -- --file <sample>` then validates it without touching the database. 10 fights cost at most 1 (list) + 1 (schedule) + 2 per fight (each fighter once) requests, so about 20 of the free tier's 100 a month. The default cap is 60 requests; the run stops there.
- **Safety catches built in:** a request budget (default 90, `BOXING_API_MAX_REQUESTS`); storing the vendor's data is **on by default, provisionally** (the owner's decision while the vendor's answer is pending): every run that stores says so until `BOXING_API_STORAGE_CONFIRMED=1` records the vendor's written agreement, and `=0` refuses to store; the key is never put in an error message or a log line; a failure is loud rather than a half-loaded league, and an API refusal says why: the vendor's own message is in the error (with the key scrubbed out).

## The first run (about 20 requests, free)

Set the key through a prompt (never shown, never saved in your history). On a Mac (zsh):

```bash
read -s "BOXING_API_KEY?RapidAPI key: "; export BOXING_API_KEY; echo
```

Then take the sample (`--save-raw` keeps every raw response in `data/vendor-samples/raw/`, gitignored) and check it; the script prints the exact file name at the end, so use that one in place of the date:

```bash
npm run vendor:sample -- --fights 10 --save-raw
npm run data:check -- --file data/vendor-samples/boxing-data-api-2026-10-03.json
```

Look at the printed list of approximations and the validator's findings, then open the sample and check these against what the docs only imply. Each one is a place the adapter makes an assumption:

| Assumption | Where | If it is wrong |
|---|---|---|
| Auth is `x-rapidapi-key` plus `x-rapidapi-host` | `get()` | A 401/403 on the first call; change the two header names |
| A list endpoint's `data` is an array, `pagination.total_pages` is right | `collect()` | Zero fights loaded, or a loop that stops early; read one raw response |
| `page_size` up to 100 is allowed | `pageSize` | A 400 or a short page; set a smaller `pageSize` |
| ~~`location` looks like "City, Region, Country"~~ | `parseLocation` | **Wrong; the real format is "City, Region"** (see above); handled |
| Event `date` is a UTC instant, so an evening card in the Americas can land on the next calendar day | `mapFight` | Wrong event dates by a day. This matters: the live ledger grades on the last snapshot strictly before the event date. If the feed has a venue time zone or a local date, use it |
| A drawn decision is `outcome: UD/MD/SD/PTS` with no winner | `mapFight` | A genuine draw is stored as "no result yet", or a fight with a missing winner is stored as a draw. `drawInferred` and `resultMissing` count both |
| Outcomes beyond `UD/MD/SD/TKO/KO/PTS` (DQ, RTD, no contest, technical decision) exist in the data | `mapFight` | They become "no result yet". Look for them in the sample and extend the mapping |
| `fighter_1` is the red corner | `mapFight` | The feed has no corner colours; the choice only affects which side is labelled red, and a 50% call counts as red |
| `/v2/fights/` also returns future fights, or only `/schedule` does | `load()` | Handled either way (deduplicated by id), but check upcoming fights actually arrive |

## What the first free-tier runs showed (2026-10-03)

- The key and the plain list call (`/v2/fights/`, no dates) work. **The list includes coming fights**: its first record was a `NOT_STARTED` fight six days away. So the live ledger has something to predict on the free plan, and the adapter takes coming fights from the list and skips the schedule request when the list already has them.
- **The free plan has an allowed date range.** `/v2/fights/schedule` (60 days ahead) answered `403 DateOutOfRange`. How far the range reaches, backwards or forwards, is not known yet; the history depth is the thing to learn before paying for a backfill (`--save-raw` keeps the responses to look at the oldest date).
- **A start date needs an end date.** `date_from` alone is `400 InvalidDateRange`; the adapter always sends both.
- **`location` is "City, Region", not "City, Country"** (`"Quebec City, Quebec"`). The adapter maps US states, Canadian provinces, UK nations, Australian and Mexican states to their country, and counts each inference (`locationCountryInferred`). Anything else is taken as the country as written. Regions that are also country names ("Georgia") are not guessed (`locationRegionAmbiguous`). A region outside those lists would be stored as the country, so scan the sample's countries.
- **Dates:** the event's `date` has a midnight time (a plain date, which the adapter uses); the fight's `date` has a real time with no time zone (looks like UTC). The two can fall on different days for an evening card; the sample will show whether `event.date` is the local date.
- **The free plan has no real history.** Asking for any fight in 2025 or 2020 is `403`; the plain list returns only the last few weeks. The vendor's tiers (from its public pages, not verified on the plans): Pro shows 30 days of history, only Mega shows the full history. Ratings, the model and the track record need history, so a backfill needs the top tier.
- **Fighter records differ from the docs' example.** The real record has `birth_year` (the docs show `age`), and gives reach and height in several forms: `reach_cm` can be null while `reach_in` is 70, and `height_ft` is `6'1\"`. The first version of the adapter read only `age` and the `_cm` fields and so reported every fighter's birth year as unknown and nearly half the physicals as missing; it now reads `birth_year`, then inches, feet-and-inches and the docs' combined text and leaves anything still missing unknown instead of guessing it. Records also carry `stats` (wins, losses, draws, total_bouts), a career record that could seed ratings.
- Fields the docs did not mention but the real record has: `card_billing` ("Main Card", a possible card order), `statistics` (null here; might carry punch statistics for some fights), `slug`.
- Fighters carry `nationality_code` (ISO). Flags and Arabic country names used to cover ten and about eighty countries; they now work for any country by name (`countryCode` in `lib/format.ts`: the platform's own region names plus a short alias list, England, Scotland and Wales with their own flags), so the code is not needed.

## What the feed does not say, and what the adapter does about it

Every approximation is counted. In a healthy feed these counts are small; a big one means look before trusting.

| Count (`notes()`) | What was missing | What is stored instead | What to do |
|---|---|---|---|
| `birthYearUnknown` | The feed has no `birth_year` (an age alone is not used: it can be a year out) | **Unknown (null), shown as nothing or a dash.** No age appears on the page and the model's age term gives no edge either way | Wikidata (CC0) fills it for fighters it matches by BoxRec ID (`npm run wikidata:import -- --enrich`); an accepted correction or the fighter's own confirmed account can fill it too |
| `physicalsUnknown` | Height and/or reach is null for some fighters | **Unknown (null), shown as a dash.** Nothing is taken from the other measurement, a median or a default; the model's reach term gives no edge and the reach statistics skip these fighters | Wait for the feed, or an accepted correction |
| `debutUnknown` | No debut year | **Unknown (null)**; "Pro since" is left out. The first fight we hold is not used: it may not be the first fight | A correction, or a full history (the first fight is then the debut, but that is for a person to say) |
| `scheduleUnavailable` | The `/v2/fights/schedule` endpoint was refused (403/404), as it can be on a plan that does not include it | The coming fights are asked for from the list endpoint instead (from today on, soonest first) | Check upcoming fights still arrive; the refusal's own message is shown in the log |
| `upcomingUnavailable` | The list showed no coming fights, and both the schedule endpoint and a date-ranged list were refused | History only; no coming fights | The live ledger needs coming fights to predict. Not what the free plan did (its list includes them), but a plan could differ |
| `divisionFromFight` | The feed gave a fighter no division (2 of 20 in the first sample; the validator rejects "Unknown" and would drop the fighter and their fights) | The division of their most recent fight | Fine for a fighter who fights in their own class; a fighter with no recognised fight stays unknown and is reported by the validator |
| `liveTreatedAsUpcoming` | `LIVE` fights | Treated as not yet decided | Fine |
| `fightsSkipped` | A fight with no date or fewer than two fighters | Skipped | Check the count |
| `boutsDroppedUnknownFighter` | A fighter's record could not be fetched | The bouts involving them are dropped, not stored with a hole | Re-run; a persistent one is a data gap |
| `stanceUnknown` | No stance | **Unknown (null)**: the stance is left out, and counted as neither group in the stance statistics | An accepted correction or the fighter's own account |
| `locationUnparsed` | Location with no comma | The whole text as the city, country "Unknown" | Check which these are |
| `locationCountryInferred` | The feed gives a region ("Quebec"), not a country | The region's country (Canada) | Scan the sample's countries for a region the lists do not cover |
| `locationRegionAmbiguous` | A region that is also a country's name ("Georgia") | Left as written | Fix by hand, or decide a rule |
| `divisionUnknown` | A division name Ringside does not know | Kept as written | It will not appear in the rankings pages; map it in `lib/divisions.ts` |

Not in the feed at all, so absent from the real-data version of the site: punch statistics, judges' scorecards by judge (scores are an unlabelled list of strings), referees, weigh-ins, trainers and managers, odds, purses, venue capacity, photos, round time, knockdowns, and the card order within an event (bouts are ordered as the feed returns them). The pages that show these already hide when the data is absent; the money pages and "style" analyses will be thin or empty. **Check each section page against an empty league before going public.**

## Gaps in Ringside itself that real data exposes

1. **Missing facts are unknown, not invented (done).** Height, reach, birth year, stance and debut year are stored and carried as unknown (null) from the adapter to the page. A page shows a dash or leaves the line out, the model's reach and age terms give no edge when either fighter's is unknown, the written previews and scouting text leave an unknown out of the sentence, a search for a reach or an age never matches an unknown, and the style map, statistics and fit treat an unknown as neutral. `npm run smoke -- --facts unknown` renders every kind of page, in both languages, with two fighters in three missing most of them, and CI runs it. A stored 0 from an older load also counts as unknown.
2. **Ratings need depth.** Elo starts every fighter at the same number. A feed that goes back two years rates everyone off two years of fights, so the ratings, the model and the track record are weaker than they will be with a career's history. Prefer a backfill that loads whole careers for anyone who is active, even if it means fetching old fights.
3. **The live ledger starts its clock when real upcoming fights are loaded and the server is running.** Everything before that is a backtest, which the Track record page already labels. Load the schedule early.
4. **Names and claims about real people.** The previews, scouting reports and "Ask" answers state facts about real fighters. They are built from the data and the answer-grounding checks throw out numbers the data does not contain, but a wrong source row becomes a published wrong fact. There is now a way to report an error for signed-in people and a policy for it (`docs/accounts.md`, "Reporting a wrong fact, and corrections"): a private queue, an editor who reads the source, a sourced correction that survives the daily update, and a separate admin-only route for a fighter asking about their own details. The source follows the owner: a fight's facts only on a commission's or sanctioning body's own publication, a fighter's details from their admin-verified account or their own official page, anything else leaves the ingested value standing. The screens (a report page, an editors' queue, and a note on the page that shows where a corrected fact came from) are built (PLAN §60). A contact address for people who are not signed in is on the Data and Report pages once `SITE_CONTACT` is set (the doctor warns when a licensed site has none).
5. **Photos.** Real fighters get the generated portrait until a photo is licensed (Wikimedia Commons photos via `npm run media:resolve` carry their licence and credit). Do not hotlink or store vendor images.
6. **Wording (fixed while writing this).** The footer used to say "fictional, simulated data" on every page unconditionally, which would have been false the day real data loaded. It, the Data page's "Demo mode" note, the noindex rule, the sitemap and the structured data now all hang on one check (`isDemoData()` in `lib/seo.ts`, true unless `BOXING_PROVIDER` names a real provider). Checked by serving the demo league's feed as a non-demo provider: 20 section pages in real mode contain none of "fictional", "simulated", "demo build", "demo league" or "demo mode"; the footer points to the Data page for sources; the pages are indexable and the sitemap is served. Demo mode is unchanged.
7. **Credits and terms (done, terms pending).** The Data page credits the vendor whenever `BOXING_PROVIDER=licensed` ("Data supplier") and links its licence terms once `VENDOR_TERMS_URL` is set; the doctor notes when it is not. What the vendor requires beyond a credit is not known until its written answer comes: if it asks for specific wording, that is a one-line change in `app/[locale]/data/page.tsx`.

## What can and cannot be checked

The vendor's facts cannot be proven true from here. The feed's own career records can be compared with the fights loaded (`docs/real-data-runbook.md`, "What 'verified' means"), and a load is refused when they do not add up. On the free plan almost nothing adds up, which is the point: it shows a few weeks of fights, and a fighter with 20 fights would appear to have one.

## When the plan is bought

`docs/real-data-runbook.md` is the procedure: price it, fetch and inspect, load, check, then the daily update. Everything in it resumes after an interruption.

## Decision gate before any money

1. Run the 20-request sample above and read the approximations.
2. Send the enquiry (`docs/boxing-data-api-enquiry.md`; it needs your name and project). The questions that decide it: may a one-time historical backfill be stored and kept, how far back does history go on each tier (Pro shows only 30 days), is there a source URL or ID that makes a row checkable, and is the service run with any continuity commitment (it is a single operator's RapidAPI listing).
3. If yes: one month of the Mega tier for the backfill, then drop to a cheaper tier for daily updates, with `BOXING_API_STORAGE_CONFIRMED=1`.
4. If no or silent: Sportbex quote, or a different adapter behind the same `DataProvider` contract (a one-file change).

Until step 3, storing the vendor's data is provisional: it is on by default (the owner's decision), every run says so, and `BOXING_API_STORAGE_CONFIRMED=0` switches it off. If the vendor says no, delete the cache and the database (`docs/real-data-runbook.md`, "Undoing it").
