# Real data runbook: the first load, then every day

For the day a plan with full history is bought. **Storing the vendor's data is on by default while its written answer on storage is pending** (the owner's decision): every run that stores says so, until `BOXING_API_STORAGE_CONFIRMED=1` records that the vendor agreed in writing. If it says no, the data has to go: see "Undoing it" (a separate database file and a cache directory make that a clean delete). See `docs/real-data-readiness.md` for what the adapter does and does not know.

Everything here is one command, `npm run vendor:backfill`, in four modes. It resumes after any interruption, backs up before writing, and refuses the mistakes that are easy to make (the wrong database, a half-fetched league, a failing validator).

## 0. Before you start

- [ ] The vendor's **written** answer that a historical backfill may be stored and kept (`docs/boxing-data-api-enquiry.md`): pending. Until it comes, everything below stores provisionally and says so. Also which plan has the full history.
- [ ] That plan subscribed, and its request allowance known (Mega is listed at 500,000 a month; the first load is thousands, a day's update is tens).
- [ ] **A new database file** for the real league: `DATABASE_PATH=/path/real.db`. Never the demo database: the command refuses to load into one that holds other fighters, because real and invented fighters would share the same rankings.
- [ ] The readiness checklist read once (`docs/real-data-readiness.md`): the footer wording, photos, a way to report errors.

```bash
export BOXING_API_KEY='...'                      # from your shell or secret store, never from a file in the repo
export DATABASE_PATH=/data/real.db               # a NEW file
export BOXING_API_STORAGE_CONFIRMED=1            # once the vendor has agreed in writing (silences the provisional warning); =0 refuses to store at all
```

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

- `approximated or skipped`: how much of the league rests on an assumption (an unknown birth year, an imputed reach, a division taken from a fighter's last fight). A large count is a reason to look, not to proceed. The table in `docs/real-data-readiness.md` says what each means.
- `validator`: errors drop rows (the command will refuse to load while there are any); warnings are worth a look (a reach of 123 cm on a 177 cm fighter is the vendor's data, not ours).

It takes a while at full size (the plan told you how long; the command prints its progress and a time to go). **If it stops for any reason, run the same command again**: every answer that arrived is already in the cache, so the second run makes only the requests that never completed. A rate limit is waited out (Retry-After, else 1, 2, 4 ... seconds) up to four times per request before it gives up.

## 3. Load: no flags

```bash
npm run vendor:backfill -- --cache-dir /data/vendor-cache
```

Uses the cache (so it makes no new requests if `--check` finished), then in order:
1. refuses if the database holds fighters that did not come from this feed (`--into-existing` overrides, if you really mean it);
2. refuses if any fighter could not be fetched (it names the cure; `--allow-incomplete` loads without those fights);
3. refuses while the validator has errors (`--allow-errors` drops those rows and loads the rest);
4. **backs the database up** if it has data (`backups/` beside the database, the last 14 kept; copy them off the volume, a backup on the disk that dies is not one; `--no-backup` skips it);
5. loads everything in one transaction and recomputes every rating.

A running app notices the change by itself: its next request rebuilds the in-memory world (a few seconds at full size; no restart).

## 4. Check the result (once, by hand)

- [ ] Fighter, fight and event counts match what `--plan`/`--check` reported.
- [ ] Ten fighters you know: record, age, reach, division and last fight are right. The fighter record counts from the fights loaded, so a fighter whose early career is missing from the feed has a short record; compare with the vendor's own career totals (`stats` on each fighter record, kept in the cache).
- [ ] The rankings at the top of the heaviest and lightest divisions are people you would expect.
- [ ] `npm run model:fit` runs, and the Track record page says what it did. Ratings and the model need history: a feed with two years of fights rates everyone off two years.
- [ ] The site is indexable and says nothing about "fictional" (`isDemoData()` is false once `BOXING_PROVIDER` is not `demo`): set `SITE_URL`, then decide deliberately that it is ready for search engines and the public.
- [ ] **The live ledger** now has real coming fights to predict. It starts its clock the first time the running app builds the world; keep the app running.

## 5. Every day: `--update`

```bash
npm run vendor:backfill -- --update --cache-dir /data/vendor-cache
```

Fetches the fights since the latest card in the database (less 14 days, so a late result is caught) plus the coming weeks. It never reuses a cached fight list (yesterday's list would hide today's results) but does reuse cached fighters, so a day costs a handful of requests: the list, the schedule, and any fighter not seen before. Results that arrive later replace "no result yet"; nothing is duplicated. It backs up first, like a load.

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
| `nothing to update yet` | `--update` on a database with no completed card | Run the backfill first |
| The app says the database is empty and names `vendor:backfill` | It was started before the first load | Run the backfill; the app deliberately never fetches a licensed history on a page view |
| Data looks stale after a mapping fix | The cache holds the old answers | Nothing to refetch: re-run the load (it re-maps from the cache for free). `--refresh` refetches everything |

## Undoing it

- **Wrong data loaded:** restore the last backup (`npm run backup -- verify <dir>` first, then copy `ringside.db` back over the database with the app stopped), or delete the database file and load again from the cache (free).
- **The vendor says no (or the licence ends or asks):** delete the vendor's data. Stop the app, remove the cache directory, the real-league database file (with its `-wal` and `-shm`), and the `backups/` folder beside it: the cache is the vendor's data verbatim and the database and backups hold it in rows. This is why the real league lives in its own database file: nothing else has to be untangled. Then set `BOXING_API_STORAGE_CONFIRMED=0` so nothing stores again.

## What is stored where

| Where | What | Notes |
|---|---|---|
| `data/vendor-cache/` or `--cache-dir` | Every API answer, as received | The vendor's data on disk: counts as storage under their terms (provisional until confirmed). Gitignored; never commit it |
| The database | The league, ratings, the live ledger | The ledger cannot be rebuilt: back it up and copy the backups off the volume |
| `backups/` beside the database | Rolling copies (14) | Made before every load into a database with data |
