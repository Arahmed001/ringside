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

It looks for what went wrong on the first real load: every belt with a sanctioning body, every country placed and spelled once, no card of only cancelled fights, no Olympic or amateur bouts, records the fights contradict marked disputed, no result for a fight not yet held, every bout with its fighters and event. A FAIL means something in the load is wrong: send back the whole output. WARNs are worth a read (a few double-booked fighters is normal). The next step looks at the same database with much more.

## 4c. The first real look, in one report: `npm run post-load`

```bash
npm run build                            # once, if the code changed since the last build (or add --build to the next command)
npm run post-load                        # about ten minutes on 35,000 fighters; writes ~/ringside-real/post-load-report.html and prints a PASS / WARN / FAIL line per section
npm run post-load -- --skip a11y,gallery # just the data checks, the sample and the timings (a few minutes); --quick shortens the browser and timing parts
```

It answers "does the real league look right, and does it run fast?" and gives you and Claude one page to look at (open the HTML file in a browser; the same summary is printed at its end, ready to paste). The sections: (1) the audit of step 4b plus the doctor, (2) counts and completeness (photos, Arabic names, Wikidata ids, full / partial / disputed records, fights and events per year with the holes marked), (3) a sample of 60 fighters (the 10 most active, 10 champions, 10 disputed, 10 longest careers, 10 fewest fights, 10 at random) rendered through the real pages in English and Arabic and in a real browser (record equals the database's, no `undefined` / `NaN` / `null`, no console errors, no broken images, a form strip, a sensible age), (4) speed at your machine's size (cold start, memory, p50 and p95 per kind of page, beside `docs/capacity.md`), (5) the accessibility sweep on about 20 real pages in English and Arabic at 375 and 1280 px, (6) a gallery of screenshots with photos and silhouettes, (7) surprises (duplicate fighters, one venue or country spelled two ways, results for fights not yet held, impossible records, small divisions, one-bout cards, swapped corners), (8) what to look at by hand, with the names filled in.

**It never writes your database.** It copies `real.db` (and its `-wal`) into a temporary folder, analyses and serves the copy (the app writes when it opens a database), deletes the copy, and the report shows that the original's size, time and checksum are the same before and after. It makes no request to the vendor, reads no key, and sends nothing anywhere: the only traffic is to the site it starts on this machine. The report holds fighter names, records and dates (what the public site shows), `~` for your home folder and no setting's value, so it is safe to send. Run it after step 6 (`vendor:enrich`) too: before it, photos, Arabic names and Wikidata ids are 0% and that is expected.

Needs Playwright with Chromium for sections 3 (the browser part), 5 and 6 (`docs/accessibility.md`: `npm i -g playwright && npx playwright install chromium`, or `PLAYWRIGHT_MODULE=/path/to/playwright`); without it those parts say SKIP and the verdict is a WARN, not a PASS. **Read the timings with care if anything else is running**: the report prints the machine's load beside them. Exit code 1 if any section FAILS (so it can sit in a script), 2 if there is no database or no build.

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

(Section 8 of the post-load report is this list with the names filled in.) Ten fighters you know (record, age, division, last fight); the top of the heaviest and lightest divisions; a fighter marked disputed (the note says what disagrees); an Arabic page; the Data page (the credit, the counts); `npm run model:fit`; `npm run backup`. The full list is section 4 of the runbook.

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

**No cron that can reach the volume (Render, Fly, Railway)?** Their scheduled jobs cannot open the database, so the job runs inside the one container: `npm run nightly` (a verified backup, this same update, an optional copy off the host, a status file), started each night by an optional built-in scheduler when `NIGHTLY_SCHEDULE=03:30` (UTC) is set. Its exit codes are the table below. See [nightly.md](nightly.md).

It fetches the recent fights and the coming weeks (tens of requests) and reports a career total that trails a result as lagging, not as a conflict. A mark set by the load stays until the next load.

**Exit codes** (of `vendor:fetch`, which passes through those of `vendor:backfill`; a cron job or a monitor can read them):

| Code | Meaning | Examples |
| --- | --- | --- |
| 0 | Done (or `--plan`, `--check` that found nothing wrong). | |
| 1 | Anything else: a missing key, a bad option, the clock message below, a backup folder that cannot be written, a database error such as "disk is full", `--check` that found errors or would refuse a load. | |
| 2 | The vendor is unreachable or refused. | Network down or connection refused/reset/cut; 401, 403, 404 on the list; 5xx after the retries; 429 (rate limit still in force, or the quota used up); the request budget reached. |
| 3 | A check refused the data (nothing was written). | The validator found errors; the records gate refused; fights were left out because a fighter could not be fetched; the vendor sent something that is not JSON, an unexpected shape or an error envelope, or no usable fights for the window. |
| 75 | Another run holds the lock for this key (`EX_TEMPFAIL`: try again later). | A hand run while the nightly job runs. (`npm run nightly` returns it too, when another nightly job is running.) |
| 130 | Stopped by SIGINT, SIGTERM or SIGHUP (the backfill catches them, gives the lock back and exits). | A cron timeout, Ctrl-C. |
| 128 + n | `vendor:fetch` only: its child died by signal number n, which the child could not catch, and `vendor:fetch` says so ("vendor:backfill killed (SIGKILL)." / "stopped (SIGQUIT)."). | 137 for SIGKILL (the out-of-memory killer, `kill -9`), 131 for SIGQUIT. |

`npm run nightly` (the in-container job, [nightly.md](nightly.md)) returns the update's code when the update failed, and 1 when only its backup failed; a failed copy off the host alone is 0 (the status file says `warning`). `vendor:fetch` passes the backfill's code through unchanged. A cron wrapper can therefore tell the three kinds of failure apart without reading the log (`2` is worth a retry in an hour, `3` needs a look, `75` needs nothing). `vendor:load` passes the code through too.

When an update skipped or ignored anything (fights it could not read, text it cleaned, results it kept as unsettled, values that cannot be true), its last line says so in one sentence ("update done, but 1 fight(s) skipped ..., see "approximated or skipped" above."); a clean night has no such line. When there is nothing to update, it says the newest card's date and today's and asks whether this machine's clock is right. What each failure of the nightly job does is in [update-failure-modes.md](update-failure-modes.md).

## What to send back when something looks wrong

The whole output of the command, from its first line to its last (not the cache files, not the key file). Each step above prints enough to say what happened.

The guided `vendor:load` now runs the audit itself as its step 3, so a separate `npm run vendor:audit` is only needed to look again later. Exit code 4 means the load worked but a check FAILED: nothing was undone; send back the whole output.
