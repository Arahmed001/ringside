# Real data runbook: the first load, then every day

For the day a plan with full history is bought. **The vendor has confirmed that its data may be stored (to the owner, 2026-10-03):** set `BOXING_API_STORAGE_CONFIRMED=1` and keep the vendor's message where you can find it. Until it is set, every run that stores says so. If it says no, the data has to go: see "Undoing it" (a separate database file and a cache directory make that a clean delete). See `docs/real-data-readiness.md` for what the adapter does and does not know.

Everything here is one command, `npm run vendor:backfill`, in four modes. It resumes after any interruption, backs up before writing, and refuses the mistakes that are easy to make (the wrong database, a half-fetched league, a failing validator).

## 0. Before you start

- [x] The vendor's answer that a historical backfill may be stored and kept (`docs/boxing-data-api-enquiry.md`): received 2026-10-03. Check the message also says the data may be **kept after you drop to a cheaper plan**, and that the plan you buy has the **full history** (and how far back it goes).
- [ ] That plan subscribed, and its request allowance known (Mega is listed at 500,000 a month; the first load is thousands, a day's update is tens).
- [ ] **A new database file** for the real league: `DATABASE_PATH=/path/real.db`. Never the demo database: the command refuses to load into one that holds other fighters, because real and invented fighters would share the same rankings.
- [ ] The readiness checklist read once (`docs/real-data-readiness.md`): the footer wording, photos, a way to report errors.

Set the key through a prompt, so it is never shown on screen and never saved in your shell history. On a Mac (zsh):

```bash
read -s "BOXING_API_KEY?RapidAPI key: "; export BOXING_API_KEY; echo
```

(In bash: `read -s -p "RapidAPI key: " BOXING_API_KEY; export BOXING_API_KEY; echo`.) Paste the key and press Enter. `echo ${#BOXING_API_KEY}` should then print about 50, and the command stops at once with a clear message if what you pasted cannot be a key (a placeholder such as `...` or `…`). Never keep the key in a file in the repository.

Then the database, a **new** file in a folder that exists (not the placeholder path in any example you copied):

```bash
mkdir -p $HOME/ringside-real
export DATABASE_PATH=$HOME/ringside-real/real.db
```

In a container use the volume instead (`/data/real.db`). Finally, now that the vendor has agreed (this silences the "not yet confirmed" warning; `=0` refuses to store at all):

```bash
export BOXING_API_STORAGE_CONFIRMED=1
```

**A note on pasting commands.** A Mac's zsh does not treat `#` as the start of a comment, so a command pasted with a trailing `# comment` fails in confusing ways (`export: not valid in this context`, `cd: too many arguments`). The commands in this document carry no trailing comments; if you copy one from elsewhere, drop the comment, or run `setopt interactive_comments` once.

In a container the cache must live on the volume, not in the image: add `--cache-dir /data/vendor-cache` to every command below. The default (`data/vendor-cache/` under the project) is inside the container's disposable layer.

## 1. Price it: `--plan`

```bash
npm run vendor:backfill -- --plan
```

Reads the fight list in memory (no cache, no database, so nothing is stored and there is nothing to confirm) and prints how many fights, events and distinct fighters the feed has and how many requests and minutes the fighters will cost. Nothing is written. If the numbers surprise you, stop here. On the free plan this shows only the last few weeks: that is the plan's date range, not the league.

## 2. Fetch and inspect: `--check`

```bash
npm run vendor:backfill -- --check --cache-dir /data/vendor-cache
```

Fetches everything into the cache and runs the validator over the whole feed, then stops: **the database is not touched**. Read two things:

- `approximated or skipped`: how much of the league has a fact unknown (a birth year, stance, height, reach or debut year: these stay unknown, they are never filled in) or rests on an assumption (a division taken from a fighter's last fight). A large count of unknowns is not a reason to stop: the pages show a dash and the model ignores what it does not know. A large count of assumptions is a reason to look. The table in `docs/real-data-readiness.md` says what each means.
- `validator`: errors drop rows (the command will refuse to load while there are any); warnings are worth a look (a reach of 123 cm on a 177 cm fighter is the vendor's data, not ours).
- `records`: how many fighters have loaded fights that add up exactly to the career record the vendor states for them. **This is the check to read.** See "What 'verified' means" below. `--check` exits 1 if a load would be refused.

It takes a while at full size (the plan told you how long; the command prints its progress and a time to go). **If it stops for any reason, run the same command again**: every answer that arrived is already in the cache, so the second run makes only the requests that never completed. A rate limit is waited out (Retry-After, else 1, 2, 4 ... seconds) up to four times per request before it gives up.

## 3. Load: no flags

```bash
npm run vendor:backfill -- --cache-dir /data/vendor-cache
```

Uses the cache (so it makes no new requests if `--check` finished), then in order:
1. refuses if the database holds fighters that did not come from this feed (`--into-existing` overrides, if you really mean it);
2. refuses if any fighter could not be fetched (it names the cure; `--allow-incomplete` loads without those fights);
3. refuses while the validator has errors (`--allow-errors` drops those rows and loads the rest);
   3b. **refuses unless the records add up**: at least 90% of fighters must have loaded fights that equal the vendor's career record (`--min-complete 0.8` lowers the bar, `--allow-partial` waives it), and no fighter may have *more* wins, losses or draws in the loaded fights than the vendor's own career total (`--allow-conflicts`);
4. **backs the database up** if it has data (`backups/` beside the database, the last 14 kept; copy them off the volume, a backup on the disk that dies is not one; `--no-backup` skips it);
5. loads everything in one transaction and recomputes every rating.

A running app notices the change by itself: its next request rebuilds the in-memory world (a few seconds at full size; no restart).

## 4. Check the result (once, by hand)

- [ ] After the load, with the same `DATABASE_PATH` and `WIKIMEDIA_CONTACT` as the Wikidata staging: `npm run wikidata:import -- --extras-only` (once, if the staging was done before Arabic names were read), `npm run wikidata:import -- --enrich`, `npm run champions:import -- --link-only`, then `npm run media:resolve`. The enrichment line reports how many Arabic names, nicknames and article links it added. Then `npm run media:resolve -- --entities` for belts, logos and venue photos (after `venues:resolve`, which links the venues to Wikidata first).
- [ ] Fighter, fight and event counts match what `--plan`/`--check` reported.
- [ ] Ten fighters you know: record, age, reach, division and last fight are right. The fighter record counts from the fights loaded, so a fighter whose early career is missing from the feed has a short record; compare with the vendor's own career totals (`stats` on each fighter record, kept in the cache).
- [ ] The rankings at the top of the heaviest and lightest divisions are people you would expect.
- [ ] `npm run model:fit` runs, and the Track record page says what it did. Ratings and the model need history: a feed with two years of fights rates everyone off two years.
- [ ] The site is indexable and says nothing about "fictional" (`isDemoData()` is false once `BOXING_PROVIDER` is not `demo`): set `SITE_URL`, then decide deliberately that it is ready for search engines and the public.
- [ ] **The live ledger** now has real coming fights to predict. It starts its clock the first time the running app builds the world; keep the app running.

## Rehearse it first, for nothing: `npm run vendor:rehearse`

Before a plan is bought, the whole procedure can be run at full size against a stand-in vendor on your own machine (`lib/vendor-mock.ts`, the real answer shapes, nothing leaves the machine):

```bash
npm run vendor:rehearse
npm run vendor:rehearse -- --fighters 3000 --fights 25000 --beyond silent
```

It runs the real `vendor:backfill` (`--plan`, `--check`, the load, `--update`), then kills a fresh fetch part way and runs it again, and prints eleven checks (every fight and fighter loaded, every career record adding up, the update costing a few hundred requests, the second run making exactly the requests the first did not finish, no half-written answer on disk). Measured on the machine this was written on, **19,000 fighters and 160,000 fights over 35 years**:

| Step | Time | Peak memory | Requests |
|---|---|---|---|
| `--plan` (read the list) | 21 s | 211 MB | 1,635 |
| `--check` (fetch, validate, reconcile) | 37 s | 453 MB | 20,635 (cache 108 MB) |
| the load | 11 s | 516 MB | 0 (all cached) |
| `--update` (the daily job) | 4.7 s | 339 MB | 392 |
| a crash 45% through, then run again | 9.5 s | | 11,322 (exactly the unfinished ones) |

**These are the machine's own times, with the stand-in answering instantly.** A real vendor adds its delay to every request: at the default `--gap-ms 300` the first fetch is about 20,000 requests, so **about an hour and three quarters** of waiting, and a daily update of 400 requests about two minutes. The database came to 54 MB. Give the container at least 768 MB (`docs/deploy.md`).

**What the rehearsal does not show:** the stand-in's data is perfectly consistent (every career record adds up), a real feed will not be; it does not rate-limit; and what the real API does past the page limit is not known (below). Treat it as proof that the plumbing holds at size, not that the vendor's data will be clean.

**Why the list is read in date windows.** The vendor's docs say page numbers stop at 10,000 documents; a full history is about 160,000 fights. What happens beyond that (an error, or an empty page that looks like the end of the list) is not known, and the rehearsal showed that the loader as first written would have failed on one and silently stopped at the newest 10,000 fights on the other. So when the list is longer than a page number can reach, it is asked for in date windows, each split in two until it fits (about 35 windows for 160,000 fights, 1,635 list requests). A plan with a short history never sends a date range (a limited plan refuses one), so the free plan is read exactly as before. A single day with more fights than a page number can reach is loaded as far as it can be and counted (`windowTooBig`); `--offset-limit` changes the 10,000.

## What "verified" means here, and what it does not

**Nothing in this tool can prove the vendor's facts are true.** That needs a primary source (a commission record, the fight itself), and no code can supply one. What it can prove is whether the feed agrees with itself, and the one figure in the feed that can contradict the fights we hold is each fighter's **career record**. The vendor says "19-0-1"; the fights we loaded either add up to that or they do not.

| Result | What it means | What the site would show | What the command does |
|---|---|---|---|
| **complete** | The loaded fights give exactly the vendor's wins, losses and draws | The right record | Loads |
| **partial** | Fewer of at least one, more of none: fights are missing (the plan's window is shorter than the career, or a fighter could not be fetched) | A **shorter record than the fighter has** (a 19-0-1 fighter shown as 1-0) | Refuses unless 90% are complete (or `--allow-partial`) |
| **conflict** | More of something than the vendor's own career total: a duplicated fight, a wrong winner, a stale career record | A record the vendor itself contradicts | Refuses unless `--allow-conflicts` |

So a load that passes means: every field was copied faithfully (tested against real records), the validator found no errors, and for at least 90% of fighters the fights add up to the vendor's own totals with none contradicting them. It does **not** mean the vendor's fights, winners or dates are right: two systems agreeing with each other is evidence, not proof. Anyone who needs more (a commission record for a title fight) has to check that by hand.

This is also why the free plan is the wrong thing to load as a league: a window of a few weeks leaves almost every fighter partial, so the gate refuses it, correctly. Your sample shows the case: one fighter's record says 20 fights (19-0-1) and the window held one of them.

The check is the vendor's `stats`, which the adapter keeps (`provider.vendorRecords()`). A fighter whose record the vendor did not give is set aside, not counted as complete.

## 5. Every day: `--update`

```bash
npm run vendor:backfill -- --update --cache-dir /data/vendor-cache
```

Fetches the fights since the latest card in the database (less 14 days, so a late result is caught) plus the coming weeks. It never reuses anything from the cache: yesterday's list would hide today's results, and a fighter's cached career record predates the fight he has just had, so the check below would call it a contradiction. A day therefore costs the list, the schedule and one request per fighter in the window (tens to a couple of hundred), and the cache is refreshed as it goes. Results that arrive later replace "no result yet"; nothing is duplicated. It backs up first, like a load. **Afterwards it audits the careers as the database now holds them** against the fresh vendor records, for the fighters in its window, and prints the same `records:` lines: a fighter who no longer adds up (a result the vendor reversed, a fight it removed) shows as a conflict or partial. The update itself is not refused (a window of recent fights cannot add up to careers on its own); the audit is what to read in the log.

**A career total that trails yesterday's result is reported as `lagging`, not as a conflict.** The vendor's totals are updated after its results: a fight on the 27th was still missing from the fighter's record two days later (`npm run vendor:explain -- --name <surname>` shows the raw fight beside the total). So in this audit only, a surplus that vanishes when the fights of the last 7 days are set aside is printed as `probably lagging`: the next day's run shows whether the total caught up. A surplus that an older fight causes, or that the last week's fights cannot explain, is still a `CONFLICT`. `VENDOR_LAG_DAYS` changes the 7. A first load never gets this allowance: `--check` and the load stay strict.

Schedule it once a day (the vendor's data for a card is usually settled by the next morning):

```cron
17 6 * * *  cd /app && npm run vendor:backfill -- --update --cache-dir /data/vendor-cache >> /data/vendor-update.log 2>&1
```

In a container, run it with the container's own environment: `docker exec ringside npm run vendor:backfill -- --update --cache-dir /data/vendor-cache` from the host's cron (the key, `BOXING_API_STORAGE_CONFIRMED` and `DATABASE_PATH` must be in the container's environment). Look at the log now and then: a run that fails does not change the database, and the site keeps showing the last good data.

## When something goes wrong

| What you see | What it means | What to do |
|---|---|---|
| `403 ... DateOutOfRange` | The plan does not cover that date range | Check the plan; `--since` a later date; nothing was written |
| `403 ... Invalid API key` | Wrong or rotated key | Re-export it. Do not paste it anywhere |
| `429`, then waits | The vendor is limiting you | It waits and retries by itself; raise `--gap-ms` (default 300) if it keeps happening |
| `Stopped after N requests (limit ...)` | `--max-requests` reached (default 100,000) | Raise it only if the plan allows; re-run: the cache keeps your progress |
| `left out because a fighter could not be fetched` | Some fighter requests failed even after retries | Run the same command again |
| `already holds N fighter(s) that did not come from this feed` | You pointed at the demo or another league | Use a new `DATABASE_PATH` |
| `The validator found N error(s)` | Rows the checks reject | Read the list; fix the cause; or `--allow-errors` |
| `windowTooBig` in `approximated or skipped` | One day had more fights than a page number can reach, so the ones beyond were not loaded | Rare (needs thousands of fights on one date); the record check will show the fighters who are short. Ask the vendor how to read past the limit |
| `Nothing was loaded, because only N% of fighters ...` | Too few fighters' loaded fights add up to the vendor's career records (fights missing) | The plan's history is shorter than the careers, or fighters failed to fetch. Get a plan with the full history, or re-run; `--min-complete` / `--allow-partial` only if you accept shorter records on the site |
| `... have MORE wins, losses or draws ... than the vendor's own career total` | The feed contradicts itself | Read the names listed; usually a stale cached record (`--refresh`) or a duplicated fight at the vendor |
| `nothing to update yet` | `--update` on a database with no completed card | Run the backfill first |
| The app says the database is empty and names `vendor:backfill` | It was started before the first load | Run the backfill; the app deliberately never fetches a licensed history on a page view |
| Data looks stale after a mapping fix | The cache holds the old answers | Nothing to refetch: re-run the load (it re-maps from the cache for free). `--refresh` refetches everything |

## Undoing it

- **Wrong data loaded:** restore the last backup (`npm run backup -- verify <dir>` first, then copy `ringside.db` back over the database with the app stopped), or delete the database file and load again from the cache (free).
- **The vendor says no (or the licence ends or asks):** delete the vendor's data. Stop the app, remove the cache directory, the real-league database file (with its `-wal` and `-shm`), and the `backups/` folder beside it: the cache is the vendor's data verbatim and the database and backups hold it in rows. This is why the real league lives in its own database file: nothing else has to be untangled. Then set `BOXING_API_STORAGE_CONFIRMED=0` so nothing stores again.

## What is stored where

| Where | What | Notes |
|---|---|---|
| `data/vendor-cache/` or `--cache-dir` | Every API answer, as received | The vendor's data on disk: counts as storage under their terms (confirmed by the vendor, 2026-10-03). Gitignored; never commit it |
| The database | The league, ratings, the live ledger | The ledger cannot be rebuilt: back it up and copy the backups off the volume |
| `backups/` beside the database | Rolling copies (14) | Made before every load into a database with data |
