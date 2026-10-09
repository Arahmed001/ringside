# The nightly job inside the container (optional)

For a host where **no cron can reach the data volume**: Render's Cron Jobs "can't provision or access a persistent disk", and on Fly and Railway the volume belongs to one machine, so a separate scheduled job can never open Ringside's database. The daily update has to run **inside the one container**. This is that: `npm run nightly`, and an optional tiny scheduler that starts it for you. On a plain server (a VPS) you do not need any of this: use the host's cron and `docker exec`, as in [real-data-runbook.md](real-data-runbook.md) section 5.

> Plain words: the *volume* is the permanent disk mounted at `/data`. The *update* is `vendor:backfill -- --update`, which fetches the recent fights from the vendor. *UTC* is the clock hosts use for logs; `03:30` UTC is the middle of the night in Europe and the evening before in the Americas.

**Status of this page:** built and tested on a laptop with a stand-in vendor (`tests/nightly*.test.ts`). The image change was reviewed but **not built here** (no Docker daemon in the sandbox), and nothing has run on a real host. Check the first night on your host by hand (section 5).

## 1. Turn it on

Set these in the host's environment for the one service, next to the ones the update already needs:

| Setting | What | Default |
|---|---|---|
| `NIGHTLY_SCHEDULE` | `HH:MM`, UTC. **Setting it is what turns the scheduler on.** | off |
| `BOXING_API_KEY` | the vendor key (a secret: the host's secret store, never the image) | none: the update step fails, the backup still runs |
| `BOXING_API_STORAGE_CONFIRMED` | `1` once the vendor has agreed in writing, exactly as in the runbook | provisional |
| `NIGHTLY_KEEP` | how many nightly backups to keep | 7 |
| `NIGHTLY_OFFSITE_CMD` | a command that copies the new backup off the host (section 4) | none |
| `NIGHTLY_OFFSITE_TIMEOUT_MIN` | stop that command after this many minutes | 30 |
| `NIGHTLY_JITTER_MIN` | random delay added to the time, 0 to 60 minutes | 5 |
| `NIGHTLY_NODE_OPTIONS` | Node options for the update process only | `--max-old-space-size=768` |
| `WATCH_SOURCES` | which public sources to look at for changes, and how often: `champions`, `champions:nightly` or `champions:weekly` (Mondays, UTC), comma-separated (section 2b). Needs `WIKIMEDIA_CONTACT` in the same environment. | none: nothing is watched |
| `NIGHTLY_ENRICH` | `weekly` (Sundays, UTC) or `nightly` adds the enrichment step (section 2d). Needs `WIKIMEDIA_CONTACT`. A failure is a warning in the status and never fails the night. | off |
| `NIGHTLY_PING_URL` | a heartbeat address from a free monitor, asked once when a night ends (`/fail` added for a failed night); `docs/monitoring.md`. | none |
| `NEWS_REFRESH` | `1` adds the news step: the boxing headlines and the official videos are refreshed each night (docs/news.md). It needs `NEWS_CONTACT`; videos also need `YOUTUBE_API_KEY`. A failure is a warning in the status and never fails the night. |

`DATABASE_PATH` is already `/data/ringside.db` in the image; the job works in `/data` (backups in `/data/backups`, the vendor cache in `/data/vendor-cache`, the status file `/data/nightly-status.json`). The container still runs as the non-root `node` user and opens no new port.

Redeploy. The container's start command (`scripts/docker-entrypoint.sh`) starts the scheduler beside the site when `NIGHTLY_SCHEDULE` is set; without it the command is exactly `npm start`, as before. `npm run doctor -- --production` (inside the container) says whether the schedule is valid and what the last night did.

By hand, any time (it takes the same lock, so it cannot overlap the scheduled one): `npm run nightly`.

## 2. What a night does

One lock (`ringside-nightly.lock` in `RINGSIDE_LOCK_DIR`, default the temp folder) means two nightly jobs never overlap, and a hand-run `vendor:backfill` holds the vendor key's own lock, so it never overlaps the update either (whichever came second stops with 75).

1. **A verified backup** of both databases (and `model-fit.json`) into `/data/backups/<time>/`: the same folder the `npm run backup` command makes, checked with `integrity_check` and the checksum list. Only after it verifies, the oldest dated folders beyond `NIGHTLY_KEEP` are removed. Only folders named like a backup this tool writes are ever removed: `before-restore/` (the safety copies a restore makes), a folder you made by hand, and loose files stay. A copy that fails its checks is discarded and removes nothing.
2. **The update**: `vendor:backfill -- --update --cache-dir /data/vendor-cache --no-backup`, run as a child process with the container's own environment. It is the runbook's in-container form; `--no-backup` is the only addition, because step 1 has just made a better (complete) backup.
3. **The watch**, if `WATCH_SOURCES` is set (section 2b).
3b. **The news**, if `NEWS_REFRESH=1` (section 2c): `npm run news:refresh` reads the outlets' public feeds and the official channels, keeps new headlines and drops old ones; a failure is a warning, not a failed night.
4. **The off-host copy**, if `NIGHTLY_OFFSITE_CMD` is set (an encrypted copy to your own S3-compatible storage is built in: `docs/offsite-backups.md`).
4b. **The enrichment**, if `NIGHTLY_ENRICH` is set and it is its day (section 2d). It runs last, so a long run never delays the off-host copy.
5. **The status file**, rewritten after every step so a job killed half-way leaves a true account of how far it got.

**Why the backup comes first and is always taken.** The update is the only step that changes the data, so the copy that matters is the one from just before it. Taking it only after a successful update would leave no fresh copy on exactly the nights something is wrong with the vendor's data. The update still runs when the backup failed (it is one transaction and repeatable, and a stale site is the worse risk); the failure is recorded and the job exits 1.

### 2-update. Only new and changed fights are fetched

The update reads the vendor's fight list for the last 14 days (so a late result is caught) and the coming weeks. The list is cheap: a few pages. What costs is each **fighter** (about 450 an hour is all the vendor allows). Fighters are fetched only for fights that are **new or changed** compared with the database: a different date, fighters, winner, method, round, rounds, belt, status, knockdowns or round time. A fight already held with the same values is left out, with its fighters. The log says so: `N of M listed fights are already loaded and unchanged: left out, with their fighters; K new or changed`.

- A normal night fetches the fighters of one day's results and any changed fights: tens of fighters, minutes, not hours.
- The first update after a long gap (or after loading from an old cache) still has many changed fights and is slow, once.
- The comparison errs towards fetching: a result the feed called unsettled, or one an approved source filled in, makes a fight count as changed. It costs a fetch, never a missed update.
- The "records" check after an update covers the fighters fetched that night, so it can say "2 of 2 fighters" on a quiet night.
- To fetch every fighter of the window again (as every earlier version did): `npm run vendor:backfill -- --update --refetch-all`.

### 2a. Holding the vendor's changes for approval (optional)

With `VENDOR_GATE=hold` the update (step 2) puts back, before it commits, every change the vendor makes to a row the site already holds that the policy says must wait (a corrected height, a result arriving or overturned, a renamed card, a changed ranking list), and stores each as a proposal for an administrator at `/review/updates`. New fighters, fights and cards, odds and picture paths go in at once. The night is still a success. A night that would change one field in a large share of the rows it touched (the usual sign of a format change at the vendor) is refused whole with **exit code 3** and writes nothing. **The first night of holding on a data folder skips the flood guard by itself** (nothing to remember or pass), so the pile left from before is recorded as proposals instead of refused; `--gate-baseline` does the same on any other night. The night's line in the status file says how many changes were held (`N change(s) held for approval`), `/api/health` shows `data.updatesWaiting` and, after `UPDATES_OVERDUE_DAYS` (7) days, `data.updatesOverdueDays`, and the doctor warns. `--accept-all` lets one night through unheld. Use `VENDOR_GATE=observe` first to see the numbers. Standing rules an administrator has made at `/review/updates` are read at the start of the update and applied inside it (a change a rule accepts is not held; each night's use is logged). See [vendor-gate-plan.md](vendor-gate-plan.md).

### 2b. Watching public sources for changes (switching it on)

With `WATCH_SOURCES=champions` (or `champions:weekly`) the job also looks at the Wikipedia lists of world champions after the update: it compares them with the reigns the site holds and stores every difference as a **proposal**. It never changes what the site shows. An administrator decides on each at `/review/updates`; see [accounts.md](accounts.md#source-updates-administrators) and PLAN 253. Weekly means Mondays (UTC). The step is a **warning at worst**: if a list was refused (a page that changed shape, an empty read), the look failed or the contact is missing, the night's result is `warning` with the reason in the step's message, and neither the update before it nor the off-host copy after it is affected. `/api/health` shows `data.updatesWaiting` when proposals are waiting. By hand: `npm run watch -- --source champions` (`--dry-run` shows the differences without storing them).

**To switch it on:** (1) check the server holds reigns: `npm run first-look -- --database /data/real.db` should not list `title_reigns` under "What is empty" (if it does, run `npm run champions:import` once there with `WIKIMEDIA_CONTACT` set; a watcher refuses to run against an empty table); (2) `fly secrets set -a <app> WATCH_SOURCES=champions:weekly WIKIMEDIA_CONTACT=<your address>`; (3) try it without storing anything: `npm run watch -- --source champions --dry-run`; (4) decisions arrive at `/review/updates` (administrators only), and `/api/health` shows `updatesWaiting` while any wait.

`npm run champions:import` follows the same rule once reigns are held: it only proposes. `--apply-all` replaces the stored reigns at once, without approval, and is logged as `update.apply_all` in the audit log.

### 2d. Enrichment from Wikidata and Commons

With `NIGHTLY_ENRICH=weekly` (Sundays, UTC) or `nightly` the job runs `vendor:enrich --yes` after everything else: the same resumable steps you run by hand (Wikidata staging, linking and Arabic names, honours, champions' reigns, venues, their addresses and places from OpenStreetMap, headshots, belt and venue pictures), which skip what is done, so a week with few new fighters is quick. It needs `WIKIMEDIA_CONTACT` (sent to Wikimedia with every request) and gives up after 3 hours (it resumes next time). It only fills what is blank or new from those sources; the reigns step proposes rather than overwrites once reigns are held (2b). A failure is a warning in the status, never a failed night. Turn it on: `fly secrets set -a <app> NIGHTLY_ENRICH=weekly WIKIMEDIA_CONTACT=<your address>`.

## 3. Exit codes (the ones from PLAN.md section 224)

The job's code is the update's own code when the update failed, so a monitor can tell the kinds of failure apart. The same table is in [load-day.md](load-day.md) step 8.

| Code | Meaning |
|---|---|
| 0 | Done. Also when only the off-host copy failed (the status file says `warning`). |
| 1 | Anything else: no `BOXING_API_KEY`, a backup that could not be made or did not verify, the update stopped after 4 hours, a database error. |
| 2 | The vendor is unreachable or refused (network, 4xx/5xx, rate limit or quota). Worth a retry in an hour. |
| 3 | A check refused the data; nothing was written. Needs a look. |
| 75 | Another nightly job is running (nothing was changed), or a hand-run update holds the key's lock (the backup was still taken). Needs nothing. |
| 130 | Stopped by SIGTERM, SIGINT or SIGHUP (a redeploy, a host restart): the update was told to stop and gave its lock back. |

A failed update **leaves the site serving the old data** and records no update, so the 48-hour `stale` alert in `/api/health` keeps counting from the last good one. The job never retries by itself and the scheduler does not run it twice in a day: one failed night is a thing to look at, two raise the alert.

## 4. Copying the backup off the host

A backup on the disk that dies is not one. Set `NIGHTLY_OFFSITE_CMD` to a command; the job runs it through `sh -c` with **the new backup's folder as its one argument** (`$1`), for example `NIGHTLY_OFFSITE_CMD=/app/copy-backup.sh`. It has `NIGHTLY_OFFSITE_TIMEOUT_MIN` minutes; after that it, and everything it started, is stopped. It runs only after a verified backup, and **only reported, never fatal**: a failure, a hang or a missing command is recorded (`warning`, with the command's exit code, 124 for a timeout) and the update is not affected. It gets the container's environment **without `BOXING_API_KEY` and `ANTHROPIC_API_KEY`**, so put its credentials in settings of their own. The job never prints that environment, and the command's own output goes to the log lines marked `offsite:` and nowhere else (not to the status file or `/api/health`).

**The image has no `rclone`, `scp`, `rsync` or `curl`** (it is `node:22-slim`). The command has to exist in your image: add the tool to your Dockerfile (a single `apt-get install` line) or write the copy in Node. Which tool and which storage is your choice; I have not picked one for you (the host guide, PR #165, compares the hosts).

## 5. Reading the result

- **The log.** One line per step, easy to find in the host's log viewer by the prefix:
  ```
  [nightly] started; keep 7 backup(s), schedule 03:30 UTC
  [nightly] step=backup ok exit=0 (done) 1.4s: 2026-10-08T03-31-12Z verified (ringside, accounts); 0 old one(s) removed, newest 7 kept
  [nightly] update: node --import tsx scripts/vendor-backfill.ts --update --cache-dir /data/vendor-cache --no-backup (node options: --max-old-space-size=768, MALLOC_ARENA_MAX 2)
  [nightly]   | 03:31:20  loaded: fighters 41, events 6, bouts 38 ...
  [nightly] step=update ok exit=0 (done) 94.2s: applied: fighters 41, events 6, bouts 38 ...
  [nightly] update peak memory about 331 MB (its own process, beside the site)
  [nightly] step=offsite skipped exit=- (not run) 0s: NIGHTLY_OFFSITE_CMD is not set: the backup stays on this volume only
  [nightly] finished: ok, exit 0 (done); next scheduled 2026-10-09T03:30:00.000Z
  ```
  The vendor key is cut out of every line before it is printed. The scheduler's own lines start `[nightly-scheduler]`.
- **`/data/nightly-status.json`**: `started`, `finished`, `result` (`ok`, `warning`, `failed`, `interrupted`, or `running`), `exitCode` and its meaning, every step's exit code, one-line message and seconds (the update's peak memory too), and `next`. It holds no key and no environment.
- **`/api/health`** gains `data.nightly` once the job has run: `{ result, startedAt, finishedAt, exitCode, steps: { backup, update, offsite }, next }`. No message, no path, no setting (a test checks the whole answer for secrets and paths). **`stale` is unchanged**: it still comes only from the database, so a job that says "ok" cannot hide old data. Point the monitor at `"stale":true` as before; `data.nightly.result` is the reason to look.
- **`npm run doctor -- --production`**: warns when the last night failed or its off-host copy failed.

**The first night, by hand.** In the host's shell, with the real environment: `npm run nightly`. Watch the lines above, then `GET /api/health`, then `npm run backup -- verify /data/backups/<newest>`. Do this before relying on the schedule.

## 6. Memory

The site peaks near **1.4 GB** (docs/capacity.md); the update measured **about 340 MB** on a 19,000-fighter test league ([real-data-runbook.md](real-data-runbook.md), the real figure is unknown). Together about 1.75 GB: **on a 2 GB machine the margin is about 0.25 GB for the minutes the update runs, so use 3 to 4 GB if the host offers it, and pick a quiet hour.** What the job does to keep it small:

- The update is **its own process**, never inside the web server. The scheduler and the job are further small processes (the job's own Node is capped at 256 MB of heap).
- The update gets `--max-old-space-size=768` (twice what it measured; an out-of-memory then ends the update, not the site; change it with `NIGHTLY_NODE_OPTIONS`) and `MALLOC_ARENA_MAX=2` (fewer memory arenas in the C library, which is what usually keeps a short-lived Node process from holding more memory than it uses; your own value of `MALLOC_ARENA_MAX` wins).
- Its **peak resident memory is read from `/proc` once a second** while it runs and written to the log and the status file, so after the first night you know the real figure for your league. If the host's out-of-memory killer ends the update it shows as exit 137.

## 7. Restarts, redeploys, and doing it twice

The scheduler decides from the **status file on the volume**, not from memory: it runs the job when today's time (plus the random delay) has passed and **no run has started since it**. So a restart cannot run the job twice in a day (a run that began is recorded even if it failed). A container that was down at the time runs the job when it comes back, ten minutes after starting so the site can finish building its world first. A run cut off by a redeploy is not repeated the same day: it is recorded as interrupted (or, if the container was killed outright, shown as interrupted after six hours); run `npm run nightly` by hand.

SIGTERM (a stop or redeploy) reaches the site, the scheduler and, through it, a running job: the update stops, gives back its lock, and the status says `interrupted`.

## 8. Why no scheduler dependency

The scheduler is about 80 lines of Node (`lib/nightly-schedule.ts`, `scripts/nightly-scheduler.ts`) and a 20-line shell entrypoint. `supercronic` (Fly's blueprint) would add a binary to download in the image build, a checksum to maintain and a crontab file, to say "once a day". It has no memory of whether tonight's run already happened (the status file on the volume is what gives that here), and the random delay needs extra shell. Not worth a dependency.
