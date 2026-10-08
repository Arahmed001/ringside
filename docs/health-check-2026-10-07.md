# Health check of main, 2026-10-07 (PLAN 234)

Why: pull request 164 (the memory diet and the midnight rebuild, PLAN 230) was merged without CI, because GitHub Actions was not starting jobs (an account or billing problem: the jobs fail at once with no runner). Several other pull requests landed the same day. This is the whole of what CI would have run, on `origin/main` at `dfc0e20`, run by hand in a sandbox (Node 22.22.0, 2 or more cores, no GitHub Actions), plus a read of the risky merges.

Read this first: **nothing was red that is the code's fault.** The only test failure is the one known to fail in this sandbox. Four small things were fixed (below). One thing could not be run at all: the Docker image build.

## What was run, and the result

| Check | Command | Result |
| --- | --- | --- |
| Route types | `npx next typegen` | ok |
| Type check | `npx tsc --noEmit` | clean |
| Lint | `npm run lint` | clean (0 problems) from a checkout with no `.claude/worktrees` inside it. The config did **not** ignore `.claude/`, so a lint of a checkout that holds agents' worktrees would walk into them (the 87,000 problems): fixed, see F1. |
| Data validation | `RINGSIDE_NOW=2026-10-03 npm run data:check` | 0 errors, 0 warnings, 4 notes (the rows without a source URL in the demo feed: financials, purse, broadcast; known) |
| Tests | `npm test` (the whole suite, 1,237 tests, 235 s) | 1,236 pass, 1 fail: `tests/warm.test.ts` "the memo cache is one cache however many copies of the module are loaded", the known sandbox-only failure. Nothing else failed. |
| Build | `npm run build` | ok. One Turbopack warning ("Dynamic filesystem access causes tracing of the whole project", `lib/accounts/store.ts`): fixed, see F2. |
| Smoke, default (as the pull-request job runs it) | `npm run smoke` | 272 / 272 ok |
| Smoke, the five variants that run on main | `--feed sparse`, `--feed empty`, `--facts unknown`, `--feed partial`, `--feed hostile --crawl 60` | 208 / 208, 140 / 140, 272 / 272, 225 / 225, 382 / 382 ok |
| Accessibility sweep | `npm run a11y` (default sweep: every page, both languages, 375 and 1280 px, in a real Chromium) | 172 page checks, 0 not clean |
| Translations | `npm run i18n:check` | 2,472 keys, 0 missing, 0 malformed, 19 unused (the unused ones are old AI-wording strings kept for now; it exits 0) |
| Doctor against the demo | `npm run doctor -- --production` on a demo database a production server had just created | 0 failed. Two warnings that are only the sandbox's settings (no `SITE_URL`, no backup yet). |
| Docker image | `docker build` | **not run**: see "What could not be run". |
| GitHub Actions | | **not available** (jobs fail at once, no runner). This is the account, not the code. Everything above is a local run. |

## The risky merges

### The world swap and the midnight rebuild (PLAN 230: `lib/world.ts`, `lib/warm.ts`, `lib/gc.ts`)

Read the whole diff of #164 and exercised it:

- **Logic.** `getWorld` returns yesterday's world while the new day's is built beside it (`startDayRebuild`), warmed (`warmAggregates` with `gentle`), then swapped by one assignment. A data change still goes through the settle timer. The first build, `invalidateWorld` and our own writes still make visitors wait for the one shared build, which is right. A pinned clock (`RINGSIDE_NOW`) keeps the old blocking behaviour, so the tests and the smoke runs do not change. `tests/midnight-rebuild.test.ts` pins it, and it passed.
- **The swap in a real production server.** Started `next start` (`NODE_ENV=production`) on the demo league: it logs `world_built`, `world ready`, `pages warmed`, and the server answers `/api/health` 200. Then another process added an `ingest_runs` row, which is what an update does. The next requests found the changed data, and the server logged `world_built` (previous key set) and `world_swapped`, and served every request meanwhile. No error, no warning, nothing noisy on stderr.
- **`--expose-gc` through `v8.setFlagsFromString` (`lib/gc.ts`).** Checked on Node 22.22.0: setting the flag at run time and taking `gc` from `vm.runInNewContext("gc")` works and prints nothing (a 3-million-object heap of 290 MB went to 4 MB after `gc({type: "major", execution: "async"})`). The function does nothing when the heap is under 64 MB (a demo league, the tests), swallows any failure, and never rejects, so it cannot fail a start or a rebuild. `next start` showed no error. Nothing in the repository sets `--expose-gc` except `npm run bench`, so the run-time switch is the only path in production.
- **`.iterate()` in place of `.all()`** in the build (`mapRows`, the rating history): each statement is prepared for the build alone, so nothing else shares it while the loop yields to the event loop. Same rows, in the same order: the whole test suite, the smoke runs and the sweep read the same pages as before.
- **The Docker image.** Could not be built here (see below). Reviewed the `Dockerfile`: the start is `npm start` (what was run here), the runtime stage copies `.next`, `lib`, `node_modules` (production only), and `gc.ts` needs only `node:v8` and `node:vm`, so pruning the dev dependencies cannot affect it. The health check allows 120 s for the world build before the server accepts traffic. Nothing in the diff touches the Dockerfile. One real defect found by reading it: the build context did not exclude `.claude`, see F3.

### The forum policy migration (PLAN 229: `migrateForumPosts` in `lib/accounts/store.ts`)

Built an `accounts.db` with the code from **before** the change (`lib/accounts/store.ts` at `e9c08e6^`, so the old `forum_posts` without the new columns), with two users, a thread, four posts (a recent visible one, a recent hidden one, a month-old one, a deleted one) and a report. Opened it with the current code **twice in a row** and compared:

- the five new columns (`wave_fp`, `withdrawn_body`, `withdrawn_at`, `appeal_at`, `appeal_result`) and the three indexes are added once; the second open changes nothing;
- every old row in `users`, `forum_threads`, `forum_posts` and `forum_reports` is identical afterwards (the new columns aside); 4 posts before, 4 after;
- the `wave_fp` of the two recent, non-deleted posts is filled in from their words; the old and the deleted post are left empty, as designed;
- `PRAGMA integrity_check` ok, `PRAGMA foreign_key_check` empty, both times.

No data loss. The migration is additive only (nothing rewritten or dropped), so rolling the code back to the old version still opens the file.

### The exit-code changes (`vendor:backfill` now exits 2, 3 or 75; `vendor:fetch` passes them on)

Searched the docs, `scripts/`, `lib/`, `tests/`, `package.json` and `.github` for anything that assumes "failure is 1":

- `docs/load-day.md` (the exit-code table), `docs/update-failure-modes.md` and the runbook agree with `exitCodeFor`. `--check` still exits 1 (set explicitly in `scripts/vendor-backfill.ts`), and the docs say so.
- `scripts/vendor-load.ts` and `scripts/vendor-fetch.ts` pass the child's code through (`process.exit(step.code)`, `process.exit(code ?? 1)`); `vendor:load` tests "not zero", never "is one".
- `scripts/vendor-rehearse.ts` (another session's) expects `--check` to exit exactly 1, which is still true, and elsewhere tests "not zero".
- Three tests accept `0 || 1` for a fetch (`tests/vendor-quirks-e2e.test.ts`, `vendor-existing-db.test.ts`, `vendor-preview-e2e.test.ts`). They pass. They are loose rather than wrong: they would not fail on a 2 or 3, so they would not catch a fetch that now fails with a different code. Left alone, because those fetches are meant to succeed, and a failure is already caught by the assertions that follow them.
- No cron line, shell script or workflow in the repository reads the code. The one thing that does is the operator's own cron monitor, which `docs/load-day.md` now tells to read 2, 3 and 75.

Nothing assumes exit 1 any more.

## Findings

| # | Finding | Severity | Status |
| --- | --- | --- | --- |
| F1 | `eslint.config.mjs` did not ignore `.claude/`. A lint of a checkout that holds agents' worktrees (the main checkout does) linted every one of them: 87,000 problems. | Real, for anyone linting from the main checkout | **Fixed**: `.claude/**` added to the ignores. Regression test `tests/repo-hygiene.test.ts`. |
| F2 | The build warned "Dynamic filesystem access causes tracing of the whole project" at `accountsDbIfAny` (`lib/accounts/store.ts`): the accounts path is read from the environment, so the bundler cannot know it, and it traced the whole project into the server output (slower deploys, a bigger image). It has been there since 2026-10-03, so it is not from today's merges. | Warning | **Fixed**: `/* turbopackIgnore: true */` on that one path, as the warning itself suggests. The path is a run-time setting and was never meant to be traced. |
| F3 | `.dockerignore` did not exclude `.claude`. `docker build` from the main checkout would copy every agent worktree (each with its own `node_modules`) into the build context, and `COPY . .` would put them in the build stage. CI builds from a clean checkout, so it never showed there. | Real, for a local build | **Fixed**: `.claude` added to `.dockerignore`. Same regression test as F1. |
| F4 | `tests/warm.test.ts` "the memo cache is one cache however many copies of the module are loaded" fails. | Known, sandbox only | **Left**: not a defect of the code (expected to pass on a CI runner; fails here). It is the one failure in 1,237 tests. |
| F5 | The Docker image could not be built or run here. | Gap in this check | **Left**: see below. |
| F6 | Three e2e tests accept exit code 0 or 1 for a fetch (above). | Loose assertion | **Left**, noted. |
| F7 | 19 unused translation keys (old AI-wording strings). | Note | **Left**: `i18n:check` exits 0; removing them is housekeeping for the translation owner. |

## What could not be run

- **GitHub Actions.** Not available (jobs fail at once with no runner). Every number above is from a local run, not from CI. When Actions works again, the first run on main is the confirmation, and it should be read as such: this check is a stand-in for it, not a replacement.
- **The Docker image.** The sandbox has the `docker` client and a daemon can be started, but the base image `node:22-slim` could not be pulled (`429 Too Many Requests` from the registry), so the image was neither built nor run, and the `docker` job in `ci.yml` (health check, `model:fit` in the container, not running as root) was not exercised. What stands in for it: the same `npm run build` and `npm start` the image runs, on the same Node major, a production server started on an empty data folder, the health endpoint answered 200, the Dockerfile read line by line and found unchanged by today's merges. Run `docker build -t ringside .` once on a machine with registry access before relying on the image.
- **The 2 GB host claim** of PLAN 230 (resident 0.7 GB at start at the real size, 1.4 GB at an update): needs the real-size database, which is not here. The demo league's heap is below the 64 MB threshold at which `collectGarbage` does anything, so the memory effect of the memo diet is not seen by this run; its correctness (same pages) is.
- **The midnight tick itself** was not waited for. `dailyRebuild` and the day-rollover path are covered by `tests/midnight-rebuild.test.ts` with an injected clock; the swap itself was exercised for real (data change), through the same `rebuildInBackground`.

## Housekeeping

Local worktrees under `.claude/worktrees` and local branches, checked against `origin/main` and the merged pull requests (the pull requests are squash merges, so `git branch --merged` alone misses most; a branch was removed only if its tip is an ancestor of `origin/main`, or the head, or an ancestor of the head, of a pull request GitHub reports merged):

- **Removed worktrees (13, all clean, none locked):** capacity-fixes, capacity-test, design-decisions, design-review, faster-ci, forum-policy, forum-security, memory-diet, restore-drill, security-review, seo-audit, update-failures, vendor-patches.
- **Deleted local branches:** those 13 `claude/*` branches, the merged `claude/*` ones that had no worktree (a11y-runner, arabic-packet, launch-disclaimers, neutral-portraits, rankings-switch, reload-updates-fighters, terms-page, update-alert, share-cards), the short aliases of merged branches (`cap`, `cf`, `dd`, `dsg`, `fp`, `rest`, `sec`, `seo`), `scratch`, and 22 `worktree-agent-*` branches with no commit of their own. `claude/share-cards` was reachable from a merged pull request's head; it also still exists on `origin`, so it can be recovered.
- **Kept:** `main`; `md` (the main checkout's own branch, untouched); `claude/health-check` (this one); `claude/capacity-leftovers`, `claude/cdn-cacheable`, `claude/host-guide`, `claude/operator-handbook` (open pull requests 167, 166, 165, 169); `claude/e2e-suite`, `claude/nightly-job`, `claude/post-load-report` (locked worktrees with uncommitted work: other agents are working in them now).
- `git remote prune origin`: pruned 29 remote-tracking branches whose remote branch is gone.

## For next time

When Actions is down, `npm run gate` (PLAN 231) runs the CI steps as one command; this check is what that command does not cover (the Docker image, the risky merges read by hand, the old-schema file). Lint, and any build from the main checkout, should not be run with agents' worktrees inside the tree: `.claude/` is now ignored by the lint and by the Docker build.
