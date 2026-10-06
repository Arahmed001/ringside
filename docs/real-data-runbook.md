# Real data runbook: the first load, then every day

For the day a plan with full history is bought. **The vendor has confirmed that its data may be stored (to the owner, 2026-10-03):** set `BOXING_API_STORAGE_CONFIRMED=1` and keep the vendor's message where you can find it. Until it is set, every run that stores says so. If it says no, the data has to go: see "Undoing it" (a separate database file and a cache directory make that a clean delete). See `docs/real-data-readiness.md` for what the adapter does and does not know.

**The short version, in order, with what to look at after each step: `docs/load-day.md`** (keep that one open; this page is the reference).

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

**On a plan with an hourly limit, give the plan a cache directory.** The fight list is about 500 requests (477 pages on the full feed), which is an hour of Mega's allowance by itself, and `--per-hour 450` spaces them 8 seconds apart: the plan takes **an hour or more**, and a rate-limit wait is normal in the middle of it. Without `--cache-dir` the plan keeps nothing, so stopping it (or running it twice) pays that hour again. With it:

```bash
npm run vendor:backfill -- --plan --per-hour 450 --cache-dir $HOME/ringside-real/vendor-cache
```

the list pages are kept there (that is storing, so it says "provisional" until `BOXING_API_STORAGE_CONFIRMED=1`, and `=0` refuses it before anything is created), Ctrl-C is safe, and the `--check` or load that follows, with the same `--cache-dir`, asks for no list page at all. Still no database is touched.

### Starting the fetch without handling the key: `npm run vendor:fetch`

The key kept ending up in the wrong place (typed into a chat box, missing from the tab that ran the command, a placeholder). Save it once to a file only you can read, and start the fetch from any tab:

```bash
npm run vendor:fetch -- --setup     # once, in a real terminal tab: a hidden prompt, saved to ~/.ringside-key (mode 600)
npm run vendor:fetch                # the paced fetch: --check --per-hour 400 --patience-min 240, into ~/ringside-real/vendor-cache
```

`--setup` refuses to run anywhere that is not a real terminal (a chat box or a pipe), because it could not hide what you type. The fetch reads the key from the file, puts it in the fetch's environment only (never on a command line, never printed), and on a Mac keeps the machine awake while it runs. A key file that other users can read is refused with the `chmod 600` that fixes it. Extra options go through and win over the same default (`npm run vendor:fetch -- --per-hour 450`); `--no-check` drops `--check` for the load itself; `--key-file PATH` and `--cache-dir DIR` choose the files. One fetch runs at a time per key: stop the first with Ctrl-C in its tab. `npm run vendor:status` says whether the key file is ready.

### Where does it stand? `npm run vendor:status`

```bash
npm run vendor:status -- --cache-dir $HOME/ringside-real/vendor-cache
```

Run it in the project folder, in the terminal tab you use for the fetch. It makes no request and never prints the key (only its length), and in about ten seconds says: how many fighters are in the cache of those the fight list names and how long is left at the recent pace; whether a fetch is running on this machine (and its command); whether `BOXING_API_KEY` is set **in this tab** (and whether it is plainly a placeholder); whether storage is confirmed and `DATABASE_PATH` is set; and the next command that fits. `--no-total` skips reading the fight list (the total and the time left).

### One run at a time, and what the first real run taught

- **The allowance belongs to the key.** Two runs with the same key, even with different cache folders, share the 500 an hour. The command now refuses to start a second one on the same machine ("Another backfill is already running with this API key (process N …)"). The lock is a small file in the temp folder named by a hash of the key (the key is never written); a lock whose process is gone is taken over by the next run. It cannot see another machine, so do not run it on two computers at once. `pgrep -fl vendor-backfill` lists the runs.
- **The first real run, as it happened:** `--plan` reads about 450 pages of fight list (12 date windows, 44,265 fights, 11,024 events, 35,235 fighters). It took hours longer than the 8 seconds a page it should take, because an older copy of the command (from before the rate-limit fix, which retries a refusal in seconds and skips the fighter) was still running in another terminal and spending the same allowance. Once that was stopped the plan ran at the designed pace and finished in under an hour.
- **Starting it:** the key has to be in the shell that runs it (`echo ${#BOXING_API_KEY}` prints about 50 when it is). On a Mac, `export BOXING_API_KEY="$(pbpaste)"` after copying it avoids pasting into the terminal. An `export` lasts for that terminal window only. Run commands one at a time: a pasted block with a `read -s` in it swallows the next line as the answer.
- **Two checkouts of one repository** (a git worktree) cannot both have `main`; `git switch --detach origin/main` works in the second. A folder on an old branch has no `vendor:backfill` script ("Missing script").
- **Run the plan with `--cache-dir`:** the fight list is kept, so a stop, a second `--plan` or the `--check` that follows does not pay for it again.

## 2. Fetch and inspect: `--check`

```bash
npm run vendor:backfill -- --check --cache-dir /data/vendor-cache
```

Fetches everything into the cache and runs the validator over the whole feed, then stops: **the database is not touched**. Read two things:

- `approximated or skipped`: how much of the league has a fact unknown (a birth year, stance, height, reach or debut year: these stay unknown, they are never filled in) or rests on an assumption (a division taken from a fighter's last fight). A large count of unknowns is not a reason to stop: the pages show a dash and the model ignores what it does not know. A large count of assumptions is a reason to look. The table in `docs/real-data-readiness.md` says what each means.
- `validator`: errors drop rows (the command will refuse to load while there are any); warnings are worth a look (a reach of 123 cm on a 177 cm fighter is the vendor's data, not ours).
- `records`: how many fighters have loaded fights that add up exactly to the career record the vendor states for them. **This is the check to read.** See "What 'verified' means" below. `--check` exits 1 if a load would be refused.

It takes a while at full size (the plan told you how long; the command prints its progress and a time to go). **If it stops for any reason, run the same command again**: every answer that arrived is already in the cache, so the second run makes only the requests that never completed. A rate limit is waited out (Retry-After, else 1, 2, 4 ... seconds) up to four times per request before it gives up.

### The plan's own rate limit (found on the first real `--check`)

The first full `--check` stopped after 11 seconds: the gateway answered `429` with `{"message":"You have exceeded the rate limit per hour for your plan, MEGA, by the API provider"}`. The vendor's public page lists Mega as 500,000 requests a month with unlimited history and says nothing about an hourly limit, but the plan card on RapidAPI (the pricing tab) gives the full terms: **500,000 requests a month (hard limit), 500 requests per hour, and 10,240 MB of bandwidth a month, then $0.001 per MB**. The hourly figure is what stopped the run. At 500 an hour the 35,222 fighters take about three days, whatever the code does; the monthly figure is not the constraint (about 36,000 requests are needed), and the bandwidth very probably is not either (the run prints the megabytes it downloaded, to check).

Two settings deal with it, and both are safe to combine:
- `--per-hour N`: never more than N requests an hour, evenly spaced (3,600 / N seconds apart). Use a number a little under the plan's limit: **`--per-hour 450` on Mega** (or `BOXING_API_PER_HOUR=450` in the environment; the flag wins). `--plan --per-hour N` prints how long the fighter fetch will take at that pace (at 450 an hour, 35,222 fighters take about 78 hours; resumable, so it can run over several days).
- **Without `--per-hour`** a run that sends a burst (a first fetch of thousands of fighters) is refused by a plan with an hourly limit. The run now says so before it starts (how many fighters are not in the cache, and a warning if no `--per-hour` was given), and after the first rate-limit refusal it slows itself to 400 requests an hour for the rest of the run. Choosing the pace yourself (`--per-hour 400`) is still better: the refusal itself, and the minutes waited after it, are wasted. The progress line shows how many are left to fetch and an estimate from the last 100.
- `--patience-min M` (default 90): when the gateway refuses with a rate limit, wait 1, 2, 5, then 10 minutes at a time (or the `Retry-After` it gives) and try the same request again, for up to M minutes in all. Past that the run stops and says so; run the same command again later and it carries on from the cache.
- **The network failing** ("fetch failed", a laptop that woke up with no Wi-Fi) is waited out the same way: with `--patience-min` a run waits 10 s, 30 s, 1, 2, 5 and then 10 minutes at a time for the one request that failed, and carries on when the network is back; only if it is down for the whole patience does it stop ("The network looks down: run the same command again"). Without `--patience-min` a failed request is retried four times and the fighter skipped, and a skipped fighter is a hole the check refuses; the next run of the same command fetches just those. `npm run vendor:status` says when a fetch has slowed (an hour far below the six-hour pace).

A refusal that says a **quota** is used up (monthly, daily) is never waited for: it ends the run at once with the vendor's words, because waiting an hour fixes nothing; check the plan and the key's app in the RapidAPI dashboard. And a 429 now ends the run instead of being counted as "fighter skipped" (a plan that refuses one fighter refuses the next).

### Taking the league in stages (`--fighters N`, `--complete-only`)

At 450 requests an hour the whole fighter fetch is about three days. Rather than wait for all of it, a first load can be **the N most recently active fighters**: ranked by the date of their latest fight (a coming fight counts), fetched newest first, and only the fights between two of them are loaded (the others are counted as `boutsOutsideSelection`, "left for a later run", not as a failure). Run again with a bigger N, or none, and only the fighters not yet fetched cost anything: the first ones are in the cache.

```
npm run vendor:backfill -- --plan --fighters 5000 --per-hour 450 --cache-dir $HOME/ringside-real/vendor-cache
```

`--plan` needs no fighter request at all, and for the whole list and for 1,000, 2,500, 5,000, 10,000 and 20,000 fighters it prints, from the fight list alone: the fights that would load, the share of fighters who have **every** fight in the list loaded, how many sit in **groups chosen whole**, and the time to fetch. Read those two numbers before spending the hours:

- *Every fight loaded* is the usual meaning of "complete": the fighter's own record can come out right, but his opponents at the edge of the choice hold only some of their fights, because their other opponents were not taken. Those pages show the vendor's career total (19-0-1), labelled, instead of the shorter record the held fights add up to (1-0); the fight list, rating and rates on them are built from the fights held, and the page says so.
- *Groups chosen whole* is stricter and is the honest one: fighters are linked through their opponents, and the group a fighter belongs to is the whole chain of opponents' opponents. A record is certain to be right only when the entire group is in. Until most of the league is chosen this number is **much smaller** than the first, because the boxing graph is one big connected group; do not expect it to be large early on.

Then:

- `--check --fighters N` fetches the N fighters and prints the `records:` line as always, so it says how many of them add up to the vendor's own career totals. The load is refused unless 90% do (`--allow-partial` waives it: the partial fighters then show the vendor's career total, labelled, and the page says how many of the fights it holds. Their ratings, which are worked out from the fights held, are thinner than they look).
- `--complete-only` (with or without `--fighters`) loads **only the part that is right**: fighters whose loaded fights add up exactly to the vendor's career record and whose opponents do too, repeated until nothing short remains. Every record on the site is then the vendor's total; the cost is a smaller league, and it can be small early (it prints how many it kept and how many fighters it left out only because an opponent's record is short). An empty core is an error. It also waives the gate for what it leaves out, because nothing short is loaded.
- `--with-opponents` and `--whole-groups` (both need `--fighters N`) change **who** the N are, so records come out right instead of being thrown away afterwards. `--with-opponents` takes the N most recent fighters **and every opponent they ever fought**: the N all have complete records, the opponents at the edge do not, and the league is bigger than N (the plan prints by how much). `--whole-groups` takes fighters in whole linked groups (a fighter and everyone chained to him through fights with a result), newest group first, and a group is taken only if all of it fits in N; groups too big for what is left are skipped. Every record in it is then right, and it never loads more than N. The plan prints, for each size, how many fighters each way would ask for, how many groups it took and skipped and the biggest group. Because the league is one big connected group, `--whole-groups` can end up small until N is large; read the plan before spending the hours.
- The importer also repairs what looked like data gaps but were its own doing, and counts each in the run's notes: a fight of a fighter against himself is skipped; a KO or TKO with no winner becomes a no result; a stoppage in a later round than the fight was scheduled for lengthens the fight (`roundsRaisedToEnd`); fighters with no weight division are dropped, with their fights (`fightersDroppedNoDivision`, `boutsDroppedNoDivision`), instead of failing validation and cascading into fights that point at nobody.
- `--cached-only` (with `--check` or a load, and `--cache-dir`) makes **no request at all**: it answers from the cache and leaves out the fighters that are not in it yet, like fighters outside a selection. Use it to see what a part-way fetch holds while the fetch is still running: `--check --cached-only --explain-conflicts` prints the records line and the conflict tally for the fighters fetched so far, and adding `--complete-only` shows the league that would load. It needs no API key, takes no lock and uses none of the hourly allowance, so it is safe beside a running fetch; the fight list and the fighters it uses must already be cached (an empty cache says the fight list is not in it). Not for `--plan`, `--update` or `--refresh`.
- Neither flag is for `--update`; the daily update fetches the fighters of the recent fights, all of them. Do the staged loads first, finish with a run with no `--fighters` (everything), and only then switch to the daily update.


### The sanctioning bodies' official lists (17 requests)
Besides the fights and fighters, every fetch (`--check`, the load, `--update`) asks the supplier for the **official IBF, WBA, WBC and WBO lists**: `GET /v2/rankings/`, one page per division (17 pages, four bodies each). That is **17 requests**, asked once per run and cached like every other page (so the load after a `--check` asks for nothing, and `--update` refreshes them). The lists are men's only and current only, and are stored whole in the `official_rankings` table, replacing the previous snapshot; they appear on each division's ranking page as the WBA / WBC / IBF / WBO tabs and as a badge ("#3 WBC", "WBC champion") on a fighter's page. They are the bodies' own standings, **not Ringside's ranking**, and a fighter we do not hold is shown by name only.
- A plan without the rankings endpoint (403/404) just has none: the run says so (`rankingsUnavailable` in the approximated-or-skipped list), the lists already stored stay as they were, and nothing fails.
- The supplier's docs say the lists are "sourced from BoxingScene". **Before the site is public, get the supplier's written answer on storing and showing them and on the credit** (`docs/boxing-data-api-rankings-enquiry.md`); the page credits "Boxing Data API from BoxingScene" meanwhile.
- A list the adapter cannot place (a body or a division it does not recognise) is skipped and counted (`rankingsSkipped`); read that count after the first real run: the real response is the test of the mapping, which was written from the docs.

## 2c. Load day: after the fetch, what to decide

For the day the full fetch (`--check --per-hour 400 --patience-min 240`, three days at the Mega plan's pace) has finished and printed its report. Nothing here fetches anything: the cache answers. To rehearse the decision on a part-way fetch, put `--cached-only` on every command below (no key, no lock, no requests).

1. **Read the three numbers in the report.** The *records* line (how many fighters' loaded fights add up to the vendor's career record), the *partial* count, and the *CONFLICT* count with the "why the N conflict(s)" block under it (`--explain-conflicts --show 20` adds the fights behind the first fighters).
2. **Conflicts first; none is ever waved through.** A conflict is the feed contradicting itself, and a load refuses while one exists. What the importer now repairs by itself, and counts in the run's notes: draws the vendor never recorded are left as "no result yet" (`drawDemoted`); the same fight listed twice (the same two fighters, matched by name, within a day of each other: the vendor holds two generations of records for some bouts, sometimes naming two profiles of one opponent: `duplicateFightsAcrossProfiles`) is one fight, and where the copies disagree on the winner the one kept says "no result yet" (`duplicateFightsMerged`, `duplicateFightsDisagree`); and a surplus that is only the last 14 days' fights in a load (the daily update allows 7; `VENDOR_LOAD_LAG_DAYS`, `VENDOR_LAG_DAYS`) is the vendor's total trailing its results, shown as *lagging*, not as a conflict (on the first real cache the totals trailed by 9 to 11 days). What is left in the "why" block cannot be repaired from the fights: "more wins/losses with nothing else to blame" is a wrong winner, a stale total, or a fight the vendor does not count (an amateur or exhibition bout the list holds: Mayweather's win over Nasukawa, a 2016 Olympic final). The "why" block now names a surplus that goes away without the fights scheduled for 3 rounds or fewer (`short`: professional bouts are 4 rounds or more) and prints each fight's scheduled rounds, so the suspected ones can be checked by eye. Choose, for those fighters:
   - **`--keep-disputed` (the default of `vendor:load`)**: keep them and **mark** them. A marked fighter's page shows the vendor's career total (50-0-0, say) with the note that the vendor's total and its own fight list disagree (the list holds N fights, with more wins, losses or draws than the total allows), and builds the fight list, rating and rates from the fights held; the Data page counts them; `disputed.csv` beside the database lists them. Nobody is lost and nothing the vendor's list overstates is published as the record. The mark is set by the load (true or false for every fighter, so a re-load clears one whose conflict has gone) and left alone by the daily `--update`; a fighter marked and later fixed at the vendor stays marked until the next load. Not with `--drop-conflicts`, `--allow-conflicts` or `--complete-only`.
   - **`--drop-conflicts`**: leave them out with their fights, and say so (the first 20 are printed, `--dropped-file dropped.csv` lists all). Their opponents' records can only get shorter, so nobody else becomes a conflict. Use it with `--allow-partial`. About 2.6% of fighters in the first real cache.
   - The "why" block's `flipped` line says reversing the winner of ONE fight would clear the conflict, and under it says what that reversal does to the OTHER fighter in the fight: **mutual** (it clears his conflict too: the fight list's winner flag looks reversed), **no evidence** (his record is partial or unchecked), or **contradicted** (it would break an opponent whose record adds up exactly: that winner looks right and the vendor's total is the odd one). Mostly mutual would mean the list has reversed flags; mostly contradicted, that the vendor's totals are wrong. The fights alone cannot say which, so nothing is changed on it.
   - `--refresh` refetches, and costs the whole fetch again: first look at the fighters listed.
   - `--allow-conflicts` exists and should stay unused: it publishes records the feed itself says are wrong.
   - `--complete-only` leaves out every conflicted fighter too, because it keeps only fighters whose records add up exactly.
3. **Then choose what the partial records mean.** The fight list starts at some date, so a fighter's earlier career is missing even when every fight in the list is loaded: the *records* line stays low however much is fetched.
   - **The whole league, with labelled career totals:** `--allow-partial`. Each fighter's page shows the vendor's career total, labelled, and says how many fights are held; the fight list, rating and rates are built from the fights held, so ratings are thinner than they look for fighters whose early career is missing. Needs conflicts to be zero or to have been dealt with in step 2.
   - **Only what is right:** `--complete-only`. Every record on the site is the vendor's own total; the league is smaller (it prints how many it kept and how many it left out because an opponent's record is short). Read how small before choosing it.
   - **Why `--complete-only` comes out small however much is fetched.** It keeps a fighter only if every opponent is kept too (a fight whose other fighter is missing is dropped, and the fighter's record would then be short), so it keeps whole *connected groups*, and a group counts only if every fighter in it is right. One fighter with an earlier career the list does not reach sinks the group, and the groups are chains of opponents' opponents. The first real run kept 42 of 5,000; a rehearsal with 4% of fighters short and 170 conflicts kept 783 of 32,175 (2.4%) of a sparse 35,000-fighter league, and a denser league keeps none ("not one fighter's loaded fights add up"). Expect a small league from it, or none.
   - Neither is a default. The decision is about what the site says to a visitor, so it is yours.
4. **Load into a new database file, with storage confirmed:**

   ```bash
   export DATABASE_PATH=$HOME/ringside-real/real.db
   export BOXING_API_STORAGE_CONFIRMED=1
   npm run vendor:backfill -- --cache-dir $HOME/ringside-real/vendor-cache   # plus your choice from step 3
   ```

   It refuses a database that holds other fighters, backs up one that has data, and loads in one transaction (section 3 lists every refusal). Everything it needs is in the cache, so it should make no requests; if it reports any, stop and read why before it spends allowance.
5. **Check the result by hand** (section 4), then switch to the daily `--update` (section 5) and not before.

If anything looks wrong after the load: the database file is the only thing it wrote (and a backup if one existed). Delete it and load again from the cache for nothing (see "Undoing it").

## 3a. The load, guided: `npm run vendor:load`

```bash
npm run vendor:load -- --dry-run                       # the check only: what a load would refuse or leave out, and why; writes nothing, needs no key, makes no request
npm run vendor:load -- --storage-confirmed             # the same, then asks you to type LOAD, then loads
```

**`--dry-run` reads only the cache** (`--cached-only`: no key file, no request, none of the hourly allowance), so it can be run at any time, even while the fetch is still going: on a part-way cache it reports the fighters that are in it and leaves out the rest, which is how to see today what the load will look like. The load itself reads the key from the key file (`npm run vendor:fetch -- --setup`), uses the cache (`~/ringside-real/vendor-cache`), and writes `DATABASE_PATH` (default `~/ringside-real/real.db`, new). It prints what it will do (cache and how many fighters it holds, the database and whether it is new, the dropped-fighters file, the key's length) and **changes nothing until you type exactly `LOAD`** (`--yes` skips the question; a terminal that is not interactive refuses without it). Defaults: `--keep-disputed --allow-partial` (fighters whose records contradict the feed are kept and marked, and listed in `disputed.csv` beside the database; partial careers carry the vendor's total), replaced by `--drop-conflicts` (leave them out, listed in `dropped.csv`), `--complete-only` or `--allow-conflicts` if you give one; `--dropped-file`, `--cache-dir`, `--per-hour` and any other option of `vendor:backfill` pass through. **The vendor's written confirmation that its data may be stored is yours to state**: `BOXING_API_STORAGE_CONFIRMED=1` in the environment or `--storage-confirmed` on the command; it is never assumed, and `=0` switches storing off. The cache should be complete first (`npm run vendor:status`): a load asks the vendor for any fighter the cache lacks. It does what section 3 below lists; afterwards: section 4.

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

- [ ] **The enrichment, guided: `npm run vendor:enrich`** (the five commands in the next item, in order, with one confirmation). It reads and writes `DATABASE_PATH` (default `~/ringside-real/real.db`, which must hold the loaded league), needs your contact for Wikimedia (`WIKIMEDIA_CONTACT=you@example.org` or `--contact you@example.org`: an email address or a web page, sent with every request, never chosen for you), lists the steps (`staging`, `enrich`, `champions`, `venues`, `headshots`, `entities`) and what each does, and **runs nothing until you type `ENRICH`** (`--yes` skips the question; a terminal that is not interactive refuses without it). **These steps call Wikidata, Wikipedia and Wikimedia Commons**: the first can take a long time (about 19,600 boxers, batch by batch). `--dry-run` only lists; `--steps a,b` and `--skip a,b` choose steps; `--media-limit N` caps the three media steps. A failed step stops the run and says how far it got; running the same command again continues (the steps resume, skip what is done, or cache what they fetched).
- [ ] After the load, with the same `DATABASE_PATH` and `WIKIMEDIA_CONTACT` as the Wikidata staging: `npm run wikidata:import -- --extras-only` (once, if the staging was done before Arabic names were read), `npm run wikidata:import -- --enrich`, `npm run champions:import -- --link-only`, then `npm run media:resolve`. The enrichment line reports how many Arabic names, nicknames and article links it added. Then `npm run media:resolve -- --entities` for belts, logos and venue photos (after `venues:resolve`, which links the venues to Wikidata first).
- [ ] Fighter, fight and event counts match what `--plan`/`--check` reported.
- [ ] Ten fighters you know: record, age, reach, division and last fight are right. The fighter record counts from the fights loaded, so a fighter whose early career is missing from the feed has a short record; compare with the vendor's own career totals (`stats` on each fighter record, kept in the cache).
- [ ] The rankings at the top of the heaviest and lightest divisions are people you would expect.
- [ ] `npm run model:fit` runs, and the Track record page says what it did. Ratings and the model need history: a feed with two years of fights rates everyone off two years.
- [ ] The site is indexable and says nothing about "fictional" (`isDemoData()` is false once `BOXING_PROVIDER` is not `demo`): set `SITE_URL`, then decide deliberately that it is ready for search engines and the public.
- [ ] **The live ledger** now has real coming fights to predict. It starts its clock the first time the running app builds the world; keep the app running.

### The first real fetch: what to paste back, and what each note means

Paste back: the whole output of `--check` (or the load), from the first line to the last, including the `notes:` block, any `dropped` counts and any warnings. Not the cache files. A note is a count of times the importer had to approximate; **zero means the feed supplied the fact itself**, and every non-zero count is printed automatically. None is an error by itself; what matters is the size next to the number of fights or fighters.

| Note | What it means | When to worry |
|---|---|---|
| `drawInferred`, `resultMissing` | A drawn decision stored as a draw, or a fight with no winner stored as "no result yet" | Both a large share of finished fights: the vendor's `outcome` words are not what the adapter expects; paste a sample |
| `nationalityFromCode`, `nationalityUnplaced`, `titleBodyUnknown` | A demonym nationality read through the feed's code; one that could not be placed and was kept as given; a belt whose title name names no known body | `nationalityFromCode` in the hundreds is the vendor's mixed spellings, not a fault; the other two should be a handful or zero (see `real-data-readiness.md`) |
| `amateurBoutsSkipped` | Fights of an Olympic, Asian, Commonwealth or other games or an amateur championship (by the event title), left out | On the first real cache 497 in the chosen fighters' fights; a few hundred is normal. A large count in a league with no amateur events means a title is matching by accident: paste a sample |
| `resultMissingOld`, `cancelledFights` | A finished fight with no result that is more than 30 days old (the part of `resultMissing` that is not simply recent), and a fight the vendor lists as CANCELLED (kept as a cancelled bout) | On the first real cache 5,091 of 6,059 were old: the vendor's own gap, listed in the findings email, not something the importer can repair |
| `drawDemoted` | A draw dropped to "no result yet" because neither fighter's career total has a draw to spare | A few hundred in 150,000 is the vendor's own records disagreeing; thousands is a pattern to look at |
| `stoppageWithoutWinner` | KO/TKO with no winner, stored as "no result yet" | Same as above |
| `outcomeMapped` | An outcome word outside the feed's own list ("DQ", "RTD", "Corner Retirement", "Technical Decision", "No Contest") read through the importers' spelling table | Informational; a large count means the feed uses words worth adding to the list |
| `outcomeUnreadable` | A winner with an outcome nobody can read: kept in both fighters' history as "no result yet", no winner named | Hundreds or more: paste ten examples of the outcome field |
| `bothMarkedWinner` | Both fighters flagged as winner: neither picked | A handful is a feed slip; many means the winner flag is not what the adapter expects |
| `roundUnreadable` | A result round of 0 or below, treated as unknown | Informational |
| `eventsWithoutFights` | Events left out because none of their fights was kept | Informational (most small cards in a partial first load) |
| `roundsRaisedToEnd` | A stoppage later than the scheduled rounds; the fight's length was raised | Large counts mean the schedule field is unreliable |
| `fightersDroppedNoDivision`, `boutsDroppedNoDivision` | Fighters with no usable weight class (none on the profile, none on any of their fights), and their fights, left out. Placing them from their opponents' divisions was measured and not built: on the first real cache only 322 of 1,199 had a single opponent division to go by (PLAN §160) | Over a few percent of fighters: paste the division spellings; add an alias in `lib/divisions.ts` |
| `divisionFromFight`, `boutDivisionFromFighters` | A fighter's class taken from his fight, or a catchweight fight placed in the heavier fighter's class | Informational |
| `boutsDroppedUnknownFighter`, `boutsOutsideSelection` | Fights whose fighter is not in the loaded set (expected on a `--fighters N` partial load) | Only if no partial load was asked for |
| `fightsSkipped` | Fights skipped (a fighter against himself, unusable rows) | Hundreds is fine; check the sample the run prints |
| `fightsSkippedNoId` / `NoFighter` / `NoDate` / `SameFighter` | `fightsSkipped` split by its first reason: a fight with no id, with a fighter who has no profile id, with no usable date, or a fighter against himself | `NoFighter` is the one to watch: opponents without a profile cost the fighters who do have one a fight in their loaded record |
| `duplicateFightsMerged` / `duplicateFightsDisagree` | The same two fighters within a day of each other counted as one fight; the second counts those whose copies disagree on the winner (kept as "no result yet") | Expect a few percent of fights on the real feed |
| `birthYearUnknown`, `physicalsUnknown`, `stanceUnknown`, `debutUnknown` | Facts the vendor left blank; shown as a dash, never invented | Informational: these are the vendor's gaps |
| `physicalsConverted` | Heights or reaches converted to cm | Informational |
| `locationUnparsed`, `locationCountryInferred`, `locationRegionAmbiguous` | Venue text the importer could not place, or placed by a rule | A large `locationUnparsed` means country pages will be thin; paste ten examples |
| `rankingsUnavailable`, `rankingsSkipped`, `scheduleUnavailable`, `upcomingUnavailable` | The plan does not include that endpoint, or it failed | Expected on lower plans; the pages say so |
| `windowTooBig` | A date window hit the 10,000-document limit and was split | Informational |

A change in these counts between two runs is the signal to watch in daily `--update` use; a sudden jump means the vendor changed something.

After the load, in order: `npm run doctor`; open ten fighters you know; check `/divisions`, one country, one event; then paste the output of `doctor` as well.

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
| **partial** | Fewer of at least one, more of none: fights are missing (the plan's window is shorter than the career, or a fighter could not be fetched) | The vendor's **career total** (19-0-1), labelled: the fighter page says "the record is the career total from the data supplier; Ringside holds N of those M fights, so the fight list, knockouts, rating and rates are built from those N only" (a record shortened to 1-0 is never shown) | Refuses unless 90% are complete (or `--allow-partial`) |
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
| `... have MORE wins, losses or draws ... than the vendor's own career total` | The feed contradicts itself | Run `--check --explain-conflicts` (add `--show 50` for more): it prints **why** each conflict happens (a draw the vendor never recorded, a fight listed twice, two fights on one day, a total that trails the last 14 days, or an extra win/loss with nothing else to blame) and the fights behind the first fighters, so each can be checked by eye. A stale cached record is cured with `--refresh`; a draw the vendor never recorded is already left as "no result yet" since round 74 (`drawDemoted`) |
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
