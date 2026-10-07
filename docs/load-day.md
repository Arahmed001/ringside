# Load day: the short version

> Running the site day to day? [operator-handbook.md](operator-handbook.md) is the one page with the timeline, the checklists, what to do when something goes wrong, and every setting.

The commands, in order, with what to look at after each. Everything is explained in `real-data-runbook.md`; this is the page to keep open. Run every command in the project folder, in a real terminal tab:

```bash
cd ~/Documents/Claude\ Proj./ringside-sample
```

Never type the API key anywhere but the hidden prompt of `--setup` (not a chat box, not a command line). None of these commands ever prints it.

## 1. Once: the key and your contact

```bash
npm run vendor:fetch -- --setup          # a hidden prompt; saves the key to ~/.ringside-key (readable by you only)
export WIKIMEDIA_CONTACT=you@example.org # an email address or a web page Wikimedia can reach you at (needed only for step 6; once per terminal tab)
```

## 2. While the fetch runs (days, not hours)

```bash
npm run vendor:status                    # how much of the league is in the cache, whether a fetch is running, how long is left, the next command
npm run vendor:fetch -- --background    # starts or resumes the paced fetch DETACHED from the terminal: closing the tab or the panel does not end it (log: ~/ringside-real/fetch.log)
npm run vendor:fetch -- --stop          # ends the background fetch (nothing fetched is lost)
npm run vendor:fetch                     # the same fetch in this tab (Ctrl-C stops it; closing the tab does too, which is how a run ended overnight)
npm run vendor:load -- --dry-run         # what the load would do with what is cached today: sends nothing, needs no key, writes nothing
```

A network drop is waited out, not skipped; a Mac is kept awake while it runs.

## 3. When `vendor:status` says the cache is complete: the dry run

```bash
npm run vendor:load -- --dry-run
```

Read three things in it: the `records:` line (about 3% of fighters add up exactly: expected, the vendor's fight list does not reach their early careers), the `why the N conflict(s)` block (about 2% of fighters have more wins or losses in the list than the vendor's own total; they are kept and marked **disputed**, their pages show the vendor's total and say the two disagree), and the last lines (a load must not say it would be refused).

## 4. The load

```bash
npm run vendor:load -- --storage-confirmed   # asks you to type LOAD; --storage-confirmed is YOUR statement that the vendor confirmed in writing that its data may be stored
```

**A database from an earlier load is in the way** (your first, smaller load, made by an older importer, is `~/ringside-real/real.db`): a re-load updates its fighters, fights and events in place but never removes a fight an earlier load took that the importer now leaves out (a card of cancelled fights, an Olympic or games bout), and an old spelling of a country stays, so the audit would fail. The load says so before it asks you to type LOAD. For the first full load, start clean: `rm ~/ringside-real/real.db ~/ringside-real/real.db-wal ~/ringside-real/real.db-shm` (stop a site serving it first: `npm run vendor:site -- --stop`), then run the command below.

It writes `~/ringside-real/real.db` (new), `disputed.csv` beside it, and a backup if there was a database. Undo: delete `real.db` and its `-wal` and `-shm` files and load again; the cache is the source and costs nothing.

## 4b. Check the load, in a second

```bash
npm run vendor:audit                     # PASS / WARN / FAIL per check; exit 1 if any FAILS; reads the database read-only
```

It looks for what went wrong on the first real load: every belt with a sanctioning body, every country placed and spelled once, no card of only cancelled fights, no Olympic or amateur bouts, records the fights contradict marked disputed, no result for a fight not yet held, every bout with its fighters and event. A FAIL means something in the load is wrong: send back the whole output. WARNs are worth a read (a few double-booked fighters is normal).

## 5. Look at it, then run the site on it

To look at what was loaded, on your own machine (port 3480; detached, so closing the tab does not stop it):

```bash
npm run vendor:site -- --start --build   # builds, starts on the real database, says when it is up and how many fighters it serves
npm run vendor:site                      # what is running
npm run vendor:site -- --restart --build # after the code changed (a new load needs no restart: the running site notices it)
npm run vendor:site -- --stop
```

It checks the port and the database first and says what is wrong in one line. It is for looking: it sets no site address, so do not expose it beyond your machine. For a public site, the doctor first:

```bash
DATABASE_PATH=$HOME/ringside-real/real.db BOXING_PROVIDER=licensed SITE_URL=https://your-site SITE_CONTACT=corrections@your-site VENDOR_TERMS_URL=https://the-vendors-terms npm run doctor -- --production
```

The doctor lists what is still missing for a public site. Start the site with the same settings (`npm run build && npm start`); it is not indexable while `BOXING_PROVIDER` is `demo`.

## 6. Arabic names, photos, champions (calls Wikidata, Wikipedia and Wikimedia Commons)

```bash
npm run vendor:enrich -- --dry-run       # lists the six steps; calls nothing
npm run vendor:enrich                    # lists them again and asks you to type ENRICH; the first step is long and resumable
```

## 7. By hand, once

Ten fighters you know (record, age, division, last fight); the top of the heaviest and lightest divisions; a fighter marked disputed (the note says what disagrees); an Arabic page; the Data page (the credit, the counts); `npm run model:fit`; `npm run backup`. The full list is section 4 of the runbook.

## 8. Every day after

```bash
# cron, on the machine that holds the database; the storage statement is yours, as in step 4
17 6 * * *  cd /path/to/ringside && DATABASE_PATH=$HOME/ringside-real/real.db BOXING_API_STORAGE_CONFIRMED=1 npm run vendor:fetch -- --update >> $HOME/ringside-real/update.log 2>&1
```

**On a host (a container) use this form instead.** `vendor:fetch` reads the key from a file in the home folder of the machine it runs on; a container has no such file, so the nightly job runs `vendor:backfill` directly (which `vendor:fetch` wraps), with the cache on the volume and the key, the storage statement and the database path in the container's own settings (the key as `BOXING_API_KEY`, its secret field; `BOXING_API_STORAGE_CONFIRMED` set to 1 once the vendor has confirmed; `DATABASE_PATH`). The host's cron runs:

```bash
17 6 * * *  docker exec ringside npm run vendor:backfill -- --update --cache-dir /data/vendor-cache >> /data/vendor-update.log 2>&1
```

The log path is on the machine where the cron line runs, so make sure that folder exists and that you read it (go-live section 6 says what to look for). Everything below, including the exit codes, applies to both forms. [real-data-runbook.md](real-data-runbook.md) section 5 has the same line.

It fetches the recent fights and the coming weeks (tens of requests) and reports a career total that trails a result as lagging, not as a conflict. A mark set by the load stays until the next load.

**Exit codes** (of `vendor:fetch`, which passes through those of `vendor:backfill`; a cron job or a monitor can read them):

| Code | Meaning | Examples |
| --- | --- | --- |
| 0 | Done (or `--plan`, `--check` that found nothing wrong). | |
| 1 | Anything else: a missing key, a bad option, the clock message below, a backup folder that cannot be written, a database error such as "disk is full", `--check` that found errors or would refuse a load. | |
| 2 | The vendor is unreachable or refused. | Network down or connection refused/reset/cut; 401, 403, 404 on the list; 5xx after the retries; 429 (rate limit still in force, or the quota used up); the request budget reached. |
| 3 | A check refused the data (nothing was written). | The validator found errors; the records gate refused; fights were left out because a fighter could not be fetched; the vendor sent something that is not JSON, an unexpected shape or an error envelope, or no usable fights for the window. |
| 75 | Another run holds the lock for this key (`EX_TEMPFAIL`: try again later). | A hand run while the nightly job runs. |
| 130 | Stopped by SIGINT, SIGTERM or SIGHUP (the backfill catches them, gives the lock back and exits). | A cron timeout, Ctrl-C. |
| 128 + n | `vendor:fetch` only: its child died by signal number n, which the child could not catch, and `vendor:fetch` says so ("vendor:backfill killed (SIGKILL)." / "stopped (SIGQUIT)."). | 137 for SIGKILL (the out-of-memory killer, `kill -9`), 131 for SIGQUIT. |

`vendor:fetch` passes the backfill's code through unchanged. A cron wrapper can therefore tell the three kinds of failure apart without reading the log (`2` is worth a retry in an hour, `3` needs a look, `75` needs nothing). `vendor:load` passes the code through too.

When an update skipped or ignored anything (fights it could not read, text it cleaned, results it kept as unsettled, values that cannot be true), its last line says so in one sentence ("update done, but 1 fight(s) skipped ..., see "approximated or skipped" above."); a clean night has no such line. When there is nothing to update, it says the newest card's date and today's and asks whether this machine's clock is right. What each failure of the nightly job does is in [update-failure-modes.md](update-failure-modes.md).

## What to send back when something looks wrong

The whole output of the command, from its first line to its last (not the cache files, not the key file). Each step above prints enough to say what happened.

The guided `vendor:load` now runs the audit itself as its step 3, so a separate `npm run vendor:audit` is only needed to look again later. Exit code 4 means the load worked but a check FAILED: nothing was undone; send back the whole output.
