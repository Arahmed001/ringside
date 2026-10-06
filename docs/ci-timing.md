# CI timing

Why the `verify` check took about nine minutes, what changed, and what was measured. Nothing here comes from a real CI run: it was all measured in a four-core sandbox, with `taskset -c 0,1` to give a command the two cores a private repository's runner has. What only CI can confirm is at the end.

## What was slow

The `verify` job ran every step one after another on one runner. Measured here (two cores, warm caches, seconds):

| step | seconds |
| --- | --- |
| route types, data check | 2 |
| type check | 16 |
| lint | 29 |
| `npm test` (1,092 tests, 174 files) | 427 |
| production build (cold) | 37 |
| smoke test | 18 |
| total of the steps | about 529 |

Add installing the packages and the runner start, and that is the eight to nine minutes seen. The tests are 80% of it.

- Node runs test files at most `cores - 1` at a time, so on two cores `npm test` ran one file at a time. The tests are CPU-bound, not waiting on anything, so a second file at once is a second core's worth of work: the same 174 files took 224 s with `--test-concurrency=2` and 199 s with 4, against 427 s.
- About 1.5 s of most files is building the demo world (`getWorld`: 1.5 s, of which importing the modules is under 0.1 s), done again in each file's own process. A shared fixture would cut that, but it touches 100 or so files, each with its own idea of the database and the date, so it was left alone: the risk is to coverage, the gain is on top of what splitting already gives.
- Slowest files (serial, seconds): search-battery 27, vendor-backfill-cli 21, vendor-fetch 19, entity-media 19, venues 17, accounts 15. A hundred and forty-four files take under 3 s each (173 s together).

## What changed

`.github/workflows/ci.yml`: the `verify` job is split into parallel jobs, and `verify` itself became the aggregate that waits for them.

- `static`: route types, type check, lint, data check.
- `tests`: a matrix of three pieces. `scripts/ci-test-shard.mjs` deals the test files out greedily by measured time, so each piece is about 160 weighted seconds; each runs `node --import tsx --test --test-concurrency=$(nproc) <its files>`.
- `build`: the Next build cache, build, smoke test, and on main the five extra smoke variants.
- `verify`: waits for all of them, runs always, and fails unless each passed. On a docs-only change the parts are skipped and `verify` itself runs `tests/config-docs.test.ts`, as before. The check name is still `verify`, so branch protection is unaffected. The `changes` classifier is untouched.

`npm test` is unchanged and still runs everything in one go.

## Coverage: nothing dropped

- `tests/ci-workflow.test.ts` checks that for 1, 2, 3, 4, 5, 7 and the configured number of shards the pieces together are exactly the test files, none twice, none missing and none empty; that the matrix lists every shard number; that `verify` waits for every job, cannot be skipped and checks each result; and that the type check, lint, build and smoke test have no condition of their own.
- The three pieces ran 370, 432 and 292 tests: 1,094 in all, the 1,092 the suite had plus the two new workflow tests (measured before the branch was brought up to date with main; the full `npm test` after that has 1,098 tests, 1,097 passing, and the one sandbox failure below).
- The one failure here, `tests/warm.test.ts` "the memo cache is one cache...", is the known sandbox-only one; it fails the same before and after, and is not touched.

## Measured, before and after

The tests, on two cores (the three pieces ran one after another here; on CI they run on three runners at once, so the time to wait is the slowest):

| | seconds |
| --- | --- |
| before: `npm test` | 427 |
| concurrency 2, no split | 224 |
| after: piece 1 / 2 / 3 | 73 / 84 / 74 |
| after: slowest piece | 84 |

The rest of the job in parallel (two cores): `static` about 47 s, `build` about 55 s (cold build 37 s plus smoke 18 s). So the work on the slowest path went from about 529 s to about 84 s, the tests piece. Each job also installs the packages and starts a runner, which is unmeasured here.

## What only a CI run can confirm

- The wall time of a real run. A fair guess is two to three minutes (84 s of tests plus checkout, `npm ci` and runner start of 30 to 60 s each), against eight to nine.
- How many cores the runner has. If it has four, the old run was already faster than measured here and the saving is smaller; `--test-concurrency=$(nproc)` adapts either way.
- Billed minutes go up: three test jobs, a static job and a build job each pay the install, so about 12 minutes of runner time against about 9. If minutes matter more than waiting, lower the number of pieces (the `shard` list and its count in the `tests` job; the workflow test checks they agree). One piece with the concurrency change alone is about 4 minutes of tests.
- That the required check is still `verify` under branch protection. The job name is unchanged, but a protection rule that names the job is read by GitHub, not by this repository.
- The `tests` jobs are named `tests (1)` to `tests (3)`; if anything required those by name, it needs updating.
