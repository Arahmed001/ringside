# When the nightly update goes wrong: every failure that was injected, and what happens

The real league is kept current by one nightly job ([load-day.md](load-day.md) step 8: `vendor:fetch -- --update`, which runs `vendor:backfill -- --update`). It asks the vendor for the fights since the newest card the database holds (less 14 days) and the coming weeks, fetches the fighters in them, checks all of it, and then writes it in one transaction. This page is the result of breaking each part of that on purpose, against a stand-in vendor and a throwaway database (never `~/ringside-real`, never the real vendor): `tests/update-failures.test.ts` (about 40 seconds, part of `npm test`).

For every case below the test proves the same five things:

1. the database passes `PRAGMA integrity_check`;
2. the update is whole or not at all (no half of a night);
3. nothing that was good is lost (no row disappears, no stored result changes);
4. the command exits with a non-zero code and says in plain words what happened (no stack trace, no key in the output);
5. the next run, against a healthy vendor, brings the database to exactly what a clean update gives.

**Verdicts.** *safe*: it did the right thing and said so. *surprising*: it is safe, but not what you would guess, so read the note. *fault (fixed)*: the test found a real fault; the fix is in this change and the test failed before it. *not covered*: said plainly at the end.

**Exit codes.** Every failure is `1` (the output says why). A run stopped by SIGTERM (a cron timeout, `kill`) is `130`. A run killed by SIGKILL has no exit code of its own (the shell reports 137) and says nothing: there is nothing in the log. The code does not tell "the vendor is down" from "the vendor sent rubbish" from "another run holds the key"; read the last lines of `update.log`.

**What to look at first, always.** The last ten lines of `~/ringside-real/update.log`. The block headed `approximated or skipped:` counts what the night had to guess or leave out; a number that is new, or suddenly large, is the vendor changing something.

## 1. The vendor refuses or fails

| Injected failure | What the system does | Verdict | What you do |
| --- | --- | --- | --- |
| 429, no `Retry-After` | The nightly job has patience (`--patience-min 240`): it waits 1, 2, 5, then 10 minutes at a time and tries the same request again, then stops with "rate limit ... still in force after waiting N minute(s)". With no patience it stops at once: "rate limit hit ... (retry after unknown s)". Nothing is written. | safe | Nothing for one night. If it repeats, the plan's hourly limit is being hit by something else using the same key: `vendor:status`. |
| 429 with `Retry-After: N` | Waits exactly N seconds (up to an hour) when it has patience; without patience a retry honours it up to two minutes. A date instead of a number of seconds is not understood and gets the standard first wait (a minute). | safe | Nothing. |
| 429 saying the monthly or daily quota is used up | Stops at once with the vendor's own words: "quota used up ... Waiting will not help". | safe | RapidAPI dashboard: the plan, the key's app. The site keeps its last data; `/api/health` goes stale after 48 hours. |
| 403, key lapsed or wrong | Stops: "Boxing Data API 403 on /v2/fights/: Invalid API key". The key is never printed. | safe | `npm run vendor:fetch -- --setup` with the new key. |
| 500, 502, 503, 504 (a burst) | Retried with a back-off of 1, 2, 4, 8 seconds (4 retries by default); `Retry-After` is honoured, but never more than two minutes. A burst longer than the retries: stops with the status. | safe | Nothing for one night. |
| 5xx or 404 on one fighter | That fighter is named ("fighter f33 skipped: ..."), then the run stops: "N fight(s) were left out because a fighter could not be fetched ... Run the same command again". Nothing is written. | safe, but it blocks the night | Run it again by hand. If one fighter stays broken for days (a profile the vendor deleted), every night stops on it until its fight leaves the 14-day window; run once with `--allow-incomplete` to load the rest. |
| The vendor's host is down (connection refused) | "unreachable on /v2/fights/: fetch failed (ECONNREFUSED)". With patience: waits 10 s, 30 s, 1, 2, 5, 10 minutes, then "the network looks down". | safe (the reason was hidden before: *fault, fixed*) | Wait; run it again when the vendor is back. |
| Connection reset before the answer | Same as above, with the reason (`UND_ERR_SOCKET`). | safe | Same. |
| Connection cut in the middle of a page | **Fault, fixed.** The body was read outside the retry handling: no retry, no waiting, and the message was the HTTP library's single word "terminated". Now it is a network failure like any other: retried, waited out with patience, and named. | fault (fixed) | Nothing; the night retries it. |
| The vendor accepts the request and never answers | **Fault, fixed.** There was no time limit of the adapter's own (only the HTTP library's five minutes a request, times every request of the night). Now one request may take 60 seconds, then it is a network failure. | fault (fixed) | Nothing. |
| A run stopped by SIGTERM (cron timeout) or killed (SIGKILL) while waiting | The database is as it was. SIGTERM gives the lock back and exits 130. SIGKILL leaves the lock file, and the next run sees its process is gone and takes it over. | safe | Nothing. |
| 200 with a JSON body that stops short; an HTML "maintenance" page with status 200; an error envelope on a 200 | Stops: "sent something that is not JSON on /v2/fights/: <first 120 characters>", or "Boxing Data API error on ...: {...}". Not retried: such a page is usually still there a minute later. | safe | Run it again later. |
| The body is `null`, or a JSON list instead of the envelope | **Fault, fixed.** `null` stopped with "Cannot read properties of null"; a list was read as "no fights" and the run succeeded. Now: "sent an unexpected answer ... got null / a list. The vendor may have changed its format". | fault (fixed) | If it repeats: send back the whole output. |

## 2. The vendor's answers change shape

| Injected failure | What the system does | Verdict | What you do |
| --- | --- | --- | --- |
| An empty fight list, `data: null`, or every fight without its fighters (a renamed field) | **Fault, fixed.** The run succeeded: nothing changed and the data was stamped as freshly updated, so `/api/health` said fine while the nightly job was doing nothing. An update's window starts at a card the database already holds, so it is never empty. Now: "returned no usable fights for 2026-09-18 to 2026-10-04 (N listed, M unreadable) ... Nothing was loaded". | fault (fixed) | Run it again later; if it repeats, send back the whole output. |
| `data` is an object, not a list | **Fault, fixed.** "object is not iterable". Now: "changed shape on /v2/fights/: data should be a list". | fault (fixed) | As above. |
| A fight with a missing field (no second fighter, no id, no date), or the same fighter on both sides | That fight is skipped and counted (`fightsSkippedNoFighter`, `fightsSkippedNoId`, `fightsSkippedNoDate`, `fightsSkippedSameFighter`); the rest is loaded; the run exits 0. A skipped fight is not removed if it was already in the database. | safe | Read the `approximated or skipped` block; the next night picks the fight up when the vendor fixes it (the window overlaps by 14 days). |
| A date, a name or a nationality that is a number or an object, not text | **Fault, fixed.** One such row stopped the whole night with a message such as "`.slice is not a function`" or "`n.normalize is not a function`", and would again every night until the vendor fixed it. Now a fight that cannot be read is skipped and counted (`fightsSkippedUnreadable`, named once in the log); a fighter with no usable name is not loaded, and the run stops with the "fighter could not be fetched" message above. | fault (fixed) | As above. |
| An extra field anywhere | Ignored. The result is exactly a clean update's. | safe | Nothing. |
| Numbers as text (birth year "1990", totals "5") | Read as unknown: the birth year and the vendor's career total are not replaced (the stored ones stay). | safe | Nothing. |
| Scheduled rounds as text or absurd (`"twelve"`, a billion) | Counted (`roundUnreadable`) and read as ten. A decision's last round is its scheduled rounds, so for that night the decisions concerned read round 10; the next healthy night puts them right. Before the fix a billion rounds was a validator error that stopped the night. | surprising (a night, then self-corrects) | Nothing. |
| A division nobody has heard of | A fight takes the division of its fighters, a fighter that of his latest fight (`divisionUnknown`, `boutDivisionFromFighters`); the result equals a clean update's. | safe | Nothing. |
| A country nobody has heard of | Stored as written and counted (`nationalityUnplaced`); it shows on the Countries page as a country of its own until you add the spelling to the country list. | surprising | Add the spelling in `lib/countries.ts` / `lib/format.ts` and run the next update. |
| A result word, or a status, the importer has never seen (`ZZZ`, `POSTPONED`), or `results: null`, or two listings of one fight that disagree | **Fault, fixed.** The fight's stored result was replaced by "no result yet" for every fight of the window; after a night with a new word the 14-day window of results was gone (and not fetched again once older than 14 days). Now the importer flags such a fight "result unsettled" (as against "no result yet"), and an ingest keeps a stored result for a flagged fight until the feed names another; a plainly result-less re-ingest still clears it, and a cancelled fight still loses its result. The count is in `outcomeUnreadable` / `duplicateFightsDisagree`. | fault (fixed) | If `outcomeUnreadable` is not 0: send the word (the log shows how many; `vendor:sample` shows the fights). |
| The same fight twice in one page; the same bout under two ids; one id again with other fighters | The first listing wins; two ids with the same fighters and winner are merged (`duplicateFightsMerged`); where they disagree no winner is believed (and, now, none that is stored is erased). | safe | Nothing. |
| A fight whose fighter has vanished (404 on his profile) | Stops, naming the fighter (see "5xx or 404 on one fighter" above); `--allow-incomplete` loads the rest. Nothing is deleted either way. | safe, but it blocks the night | As above. |

## 3. Values that cannot be true

| Injected failure | What the system does | Verdict | What you do |
| --- | --- | --- | --- |
| A finished fight with a result, dated after tomorrow | **Fault, fixed.** It was stored with its result (a warning in the validator, then a result for a fight not yet held; `vendor:audit` FAILs on that). Now the result is dropped, the fight stays one to come, and it is counted (`finishedInFuture`). One day of slack is allowed: a card that is already tomorrow where it was held. | fault (fixed) | Nothing; it corrects itself when the date does. |
| Negative or fractional career totals | Ignored: the fighter has no total to check against that night; the stored one stays. | safe | Nothing. |
| Absurd career totals (nine trillion wins), heights and reaches (minus 300 cm, a million kilometres) | **Fault, fixed.** They were stored (the Data page would show "vendor total 9000000000000-4-0"). Now a total must be a whole number up to a thousand and a height or reach between 50 and 300 cm; anything else is no value, and is counted (`careerTotalImplausible`, `physicalsImplausible`). | fault (fixed) | Nothing. |
| A round number past anything (9999) | Read as unknown (`roundUnreadable`). | safe | Nothing. |
| A name or nickname of two million characters | **Fault, fixed.** Stored whole. Now cut at 200 characters (`textCleaned`). | fault (fixed) | Nothing. |
| Control characters, zero-width characters, and right-to-left overrides and isolates (U+202A to U+202E, U+2066 to U+2069) in names, nicknames, card titles, venues, places and belts | **Fault, fixed.** Stored as they came (an override can make one name read as another on the page). Now they are removed; text that is not text is no name; an Arabic name is left exactly as it is. | fault (fixed) | Nothing. A nickname that was ever stored with such characters stays until the vendor sends another: an update never clears a nickname (it keeps the stored one when the feed has none). |
| The page limit (10,000 documents a page number can reach) hit without an error: the vendor answers an empty page instead | If the command knows the limit (`--offset-limit`), it reads the list in date windows and the result is a clean update's. If it does not, the oldest fights of the window are silently missing and nothing says so. The list is newest first and the window overlaps by 14 days, so tonight's fights are in; a 14-day window never comes near 10,000. | surprising (silent), harmless for an update | Nothing. It matters for a first load, not here. |

## 4. Clocks

| Injected failure | What the system does | Verdict | What you do |
| --- | --- | --- | --- |
| This machine's clock two days behind | The vendor is asked for fights up to "today", so it leaves out tonight's. The run succeeds; the next night, with the right date, adds it. | safe | Fix the clock. |
| Clock years behind | "There is nothing to update yet: the database has no completed card. Run the backfill first." Exit 1, nothing written. The message is misleading: the cause is the clock. | surprising | `date`. Fix the clock. (Proposed patch below.) |
| Clock years ahead | The run goes through, but every fighter's `active` flag is recomputed from that date (nobody has fought in 30 months), so everyone shows as inactive until the next run with the right date, which puts it right. | surprising | Fix the clock; run the update by hand once. |
| An update that ran while the clock was wrong stamped itself with a date in the future | **Fault, fixed.** `/api/health` and the doctor measured its age as 0 (negative ages were clamped), so a dead nightly job would have looked fresh for as long as the wrong date lay ahead. Now a stamp more than six hours ahead counts as stale (its `ageHours` is negative, to show why) and the doctor says "this machine's clock was wrong when the update ran". | fault (fixed) | Fix the clock; run the update by hand once. |

## 5. The process, the lock and the disk

| Injected failure | What the system does | Verdict | What you do |
| --- | --- | --- | --- |
| SIGKILL in the middle of the transaction that writes the update (the machine is switched off, the process is killed) | The whole update is rolled back by SQLite when the database is next opened: valid, and exactly as before. The next run applies it. | safe | Run the update again. |
| SIGKILL after the update was committed, while the ratings are being recomputed | Valid, with the new fights, fighters and results in; but the ratings are the old ones (whole: the recompute is its own transaction and is rolled back) and no "last updated" mark is recorded, so the site shows the new results with last night's ratings, and `/api/health` still counts from the last complete run. The next run repairs both. | surprising (a window of seconds at full size) | Run the update again. |
| Two runs at once (cron and a hand run) | The second stops at once: "Another backfill is already running with this API key (process N ...)", exit 1. The first finishes. A third run (the same night's feed again) changes nothing: an update is idempotent. | safe | Wait for the first, or `pgrep -fl vendor-backfill`. The lock is per key and per machine (`RINGSIDE_LOCK_DIR`, default the temp folder): a run from another machine is not stopped by it, but the write is one transaction, so two cannot interleave. |
| Another process holds the database's write lock (the site writing, a person in the sqlite shell) | **Fault, fixed.** The update failed at once with "database is locked". Now it waits up to five seconds (`busy_timeout`), and takes the write lock before reading (a snapshot that went stale while it waited was the other cause). A lock held longer than that still stops the night with the same message. | fault (fixed) | If it still happens: who holds the file (`lsof ~/ringside-real/real.db`). |
| The disk fills during the write (SQLite's "database or disk is full") | The transaction is rolled back, the database is valid and as it was. **Fault, fixed:** the explicit ROLLBACK then failed ("no transaction is active", SQLite had already rolled back) and *that* was the message the owner saw, not "disk is full". Now the original error is the message. | fault (fixed) | Free space (`df -h`); run it again. |
| The disk fills while the ratings are recomputed | **Fault, fixed.** The recompute left its transaction open on the connection (harmless for the command, which then exits; a trap for any program that keeps its connection). Now it rolls back, keeps the old ratings whole, and leaves the connection usable. | fault (fixed) | As above. |
| The backup folder cannot be written (full or read-only disk) | The backup comes before the write, so the run stops before touching the database, with the operating system's message naming the folder. | safe | Free space or fix the folder; run it again. |

## 6. The site while the update runs, and the alarm

| Injected failure | What the system does | Verdict | What you do |
| --- | --- | --- | --- |
| The running site reads the database during the update | It keeps serving the old data (SQLite's write-ahead log: readers are never blocked), counts are only ever the old or the new, no request fails and nothing is logged as an error; the next request after the commit sees the new database version (`PRAGMA data_version` moved) and rebuilds its world, with no restart. | safe | Nothing. |
| N failed nights | Nothing is recorded for a failed night, so `/api/health` keeps answering 200 with the last good `updatedAt`: `stale:false` up to 48 hours (a single missed night), `stale:true` after (the second). The doctor prints "The fights were last updated 3 days ago ... the daily update is probably not running". Never a 503. | safe | See [go-live.md](go-live.md) section 6. |
| A night that works after that | `updatedAt` moves, `stale:false`, the doctor says ok. | safe | Nothing. |

## What is not covered

- **A real full filesystem.** A test cannot fill the disk it runs on. What is tested is SQLite's own limit on the size of the file (`PRAGMA max_page_count`), which fails the same statements with the same words, and a backup folder that cannot be written. A filesystem that fills while the write-ahead log grows fails the same way (SQLite reports it the same way and rolls back), but that exact path was not run.
- **The real vendor's behaviour past 10,000 documents, its real error words, and its real `Retry-After`.** The stand-in follows what the first runs showed; where the real vendor differs, the answer is in the output of the first night it happens.
- **A power cut during the write of the file itself.** SQLite's write-ahead log is designed for it; the SIGKILL cases are the nearest a test can come.

## Proposed changes to the fetch scripts (not made here: another change owns them)

1. **Distinct exit codes** in `scripts/vendor-backfill.ts`'s final `catch`: for example 2 for "the vendor is unreachable or refused" (`HttpError`, `NetworkError`, `BudgetError`), 3 for "the vendor's answer was refused by a check" (validator errors, the empty-window error, fighters left out), 75 for "another run holds the key". A cron wrapper or a monitor could then say which of the three happened without reading the log.
2. **A clearer message when there is nothing to update.** `updateSince` returns null both for an empty database and for a clock that is behind the newest card; the script says "the database has no completed card. Run the backfill first". Say the newest card's date and today's, and "is this machine's clock right?".
3. **Print the notes line of an update that skipped something.** `fightsSkippedUnreadable`, `finishedInFuture` and `outcomeUnreadable` are in the `approximated or skipped` block; a one-line summary at the very end ("update done; 3 fights skipped, see above") would put them where `tail -n 3` finds them.
4. **A one-line summary for `vendor:fetch -- --update` itself** (the wrapper): it prints nothing when the child is killed by a signal (`close` with code null becomes 1 and no words). Print "the update was stopped (SIGTERM)" or "killed".
