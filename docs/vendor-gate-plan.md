# The vendor update gate: a plan for review

Status: **plan only, nothing is built.** It follows PLAN 253 (source watchers), whose steps A to C are on main. This page is what to read and decide on before step D starts, because the gate touches `lib/ingest.ts`, the most sensitive code in the project.

## 1. What was asked

- Changes the licensed vendor makes to data we **already hold** wait for an administrator's approval.
- **Only updates to existing data** wait. New records (a new fighter, fight or card) go in at once.
- Heavy at first (the first weeks), light afterwards.
- Administrators only decide.

## 2. How the daily update works today (why this is delicate)

`npm run nightly` runs `vendor:backfill -- --update`, which fetches the fights since the latest card in the database (less 14 days) and the coming weeks, with fresh records for the fighters on them, and calls `ingest(db, provider)` (`lib/ingest.ts`). `ingest`:

1. validates and cleans the feed (`sanitizeFeed`),
2. opens **one transaction** (`BEGIN IMMEDIATE`) and upserts straight into the live tables by `external_id`: organisations, people, boxers (about 28 columns, many `COALESCE`d), events, bouts (result fields guarded by the `resultUnsettled` flag), then replaces per-bout detail rows (officials, scorecards, corners, punch stats, weigh-ins, money) and the whole official-rankings snapshot,
3. commits, re-applies accepted corrections (`applyCorrections`), recomputes every rating (`recomputeRatings`), records the run, and bumps the world version.

So there is no point at which "the vendor's value" and "our value" both exist: the upsert overwrites. The gate has to create that moment without rewriting the upserts.

**Good news on volume:** an update touches a bounded set (recent and coming fights and the fighters on them), not the whole league. After the first weeks, a night's changes to *existing* values should be tens to low hundreds, not thousands.

## 3. The design in one paragraph

Keep `ingest` exactly as it is. Wrap it: before the upserts, copy the rows of the gated tables that the feed is about to touch into temporary tables **inside the same transaction**; after the upserts and **before the COMMIT**, compare each live row with its saved copy, field by field; for every changed field that the policy says must wait, **put the old value back** and write a proposal. Everything else (new rows, filled blanks, fields the policy lets through) stays. The transaction commits once, so either the whole night happens or none of it does, and nothing unapproved is ever visible to a page. Approving a proposal later writes that one value (the same pattern PR B uses for reigns), then ratings are recomputed once for the approved batch.

Why this and not the alternatives:

| Option | Verdict |
|---|---|
| **A. Restore-in-transaction** (above) | **Recommended.** `ingest`'s SQL is untouched; the hook is about five lines before `COMMIT` plus a module (`lib/watch/vendor-gate.ts`); atomic; no id mapping; the diff is exactly what the real upsert did, including every `COALESCE`. |
| B. Ingest into a scratch copy of the database, diff, then copy accepted rows to live | Rejected. Internal ids differ between copy and live for new rows, so copying rows needs id remapping; copying a database nightly is wasteful; two code paths to keep equal. |
| C. Compare inside every upsert statement | Rejected. 28 columns across 4 tables, each with its own `COALESCE` rule: a rewrite of the riskiest code, with the most ways to be subtly wrong. |

## 4. What waits and what does not

Policy is a table in code (`lib/watch/vendor-policy.ts`), not scattered conditions, so it can be read in one place and tested.

| Kind of change | Default | Why |
|---|---|---|
| **New row** (fighter, fight, card, organisation, person) | goes in, listed in a "new this run" digest | asked: only updates to existing data wait |
| **A blank filled** (`NULL` or empty to a value): a result arriving for a scheduled fight, a missing height, a photo | goes in, listed in the digest | it is new information, not a change to something we hold. This is also what keeps the daily flow of results from needing approval |
| **A value replaced by a different value** in a gated field | **waits** | this is "an update to existing data" |
| **Odds** (`odds_red`, `odds_blue`), **photo and poster URLs**, `round_time` | goes in | they move constantly or are media paths, not facts anyone would audit |
| **A fighter's career totals** (`vendor_wins`, `vendor_losses`, `vendor_draws`, `vendor_ko_wins`, `vendor_stopped`) | goes in when the same run adds or fills a fight for that fighter and the change is explained by it (a win is one more win); otherwise **waits** | a result moves the totals; an unexplained jump is exactly what an administrator should see |
| **A result changed** (`winner`, `method`, `end_round` of a fight that already had one) | **waits**, as one proposal per fight | moves ratings and records; the most important kind |
| **A fight's `status`** from scheduled to completed alongside a filled result | goes in | part of the result arriving |
| **A fight's `status`** to cancelled, or an **event's date** moved | **waits** | a real change to something we showed |
| **Name, country, division, stance, reach, height, birth data, active, retired date, nickname, aliases, ids** | **waits** | facts about a person |
| **Detail rows** (officials, scorecards, corners, punch stats, weigh-ins, money) | **version 1 does not gate them** (they are replaced per fight as today and listed in the digest); scorecards are the first candidate for version 2 | they are replaced as sets, which needs set-level proposals; worth doing, not worth delaying the rest |
| **The official-rankings snapshot** | goes in as a whole, listed in the digest (a weekly snapshot, a different thing from correcting a fact); per-list gating is an option | see decision 4 |

Derived numbers (records, ratings, streaks, rankings) are never gated: they are recomputed from the facts that are.

**An approved correction still wins.** `applyCorrections` runs on the live rows after the gate, as now; a vendor value that disagrees with a correction stays on the existing `vendor_changed` flag path and does not also become a proposal.

## 5. What a proposal is

It reuses the `proposals` table and the approval page from steps A and B:

- `source` = `vendor:boxing-data-api`; `kind` = `field_change` (one per fighter or event field) or `result_change` (one per fight, carrying winner, method and round together);
- `target_key` = `boxer|<external_id>|<field>`, `event|<external_id>|<field>`, `bout|<external_id>|result`;
- `old`, `new`, and `evidence` = the run id and the vendor's own updated-at if the feed gives one;
- the fingerprint rule is unchanged: a rejected change is not raised again while the vendor says the same thing. The live value stays ours, and every night the gate puts it back again, so a rejection means "we keep our value" until the vendor says something different.

Approving applies one value with a stale check (the live value must still equal `old`), writes the audit row, and recomputes ratings once per approved batch when a result changed. A change that no longer fits is refused and stays waiting.

## 6. Making the volume manageable

- **Groups by field, not by row.** The page shows "boxers.height_cm: 412 changes (median change 2 cm, largest 15 cm)" with ten samples, and **Approve all in this group** takes the whole group, in chunks, whatever its size (PR B's limit of 50 per call is for single rows).
- **Standing rules** (a table in the accounts database, edited by an administrator, each use logged): "accept `height_cm` changes of 3 cm or less", "accept `active` changes", "accept any change to `nickname`". A rule applies on the next run, before a proposal is written, and is shown in the digest ("accepted by rule: 214").
- **A baseline step**: when the gate is first switched on, the first run's proposals are the pile left from before. The administrator can **accept the present state** group by group, after looking at the samples, in one logged action each; this is the "heavy at first" part and it ends.
- **Noise is removed before it becomes a proposal**: text compared after trimming and normalising, lists compared as sets, `updated_at` ignored.
- **A flood guard**: if one run would propose more than a set share of an entity's rows (default 5%, never in baseline mode), the run is refused with exit code 3 ("a check refused the data"), as the existing checks do, and nothing is written. The usual cause is the vendor changing a format, not boxing.

## 7. If nobody approves

The site keeps serving the last approved data. `/api/health` already shows `updatesWaiting`; this adds **`updatesOverdueDays`** (the age of the oldest waiting proposal) and a doctor line when it passes a threshold (default 7 days). The existing stale-data warning still tracks whether the *update ran*, so it will not hide that the data is waiting. The trade is deliberate: the site can lag the vendor but never shows an unreviewed change.

## 8. Switching it on safely

- **Off by default** (`VENDOR_GATE=0`); `1` turns it on. **First load into an empty database is never gated.** `vendor:backfill -- --update --accept-all` is the explicit override (logged), the same idea as `champions:import --apply-all`.
- **A dry-run report first**: `npm run vendor:backfill -- --update --gate-report` runs the whole update in a rolled-back transaction and prints what the gate would have held, by field, with counts and samples. Nothing changes. This is how the first week's volume is seen before anything waits.
- **The kill switch** is the setting itself; turning it off restores today's behaviour on the next run. Proposals already waiting stay in the queue and can still be decided on.
- Every night still starts with the verified backup.

## 9. How it will be tested (the part that makes it safe)

1. **Equivalence property test**: for the same feed, run the ungated ingest on a copy of a database, and the gated ingest on another copy followed by **approving everything**: the two must be **identical, table by table**. This is the single strongest guarantee that the gate loses and invents nothing.
2. With the gate on and nothing approved: new rows and filled blanks are present, every gated changed field holds its old value, and a proposal exists for each.
3. Each row of the policy table above has a test (a result arriving, a result changed, odds moving, a height corrected, a total explained and not explained).
4. A crash between the upserts and the commit leaves the database exactly as before the night (the transaction already guarantees it; the test pins it).
5. The flood guard, the baseline step, rule application and the stale check.
6. **Scale**: run the gate through `npm run vendor:rehearse` (the mock vendor at full size) and record the time and memory it adds, against the figures in `docs/capacity.md`. The temporary copy covers only the rows the feed touches, so it should be small; the rehearsal proves it.

## 10. Build order (each its own PR, on your say-so)

| Step | What | Risk |
|---|---|---|
| **D1** | The policy table, the diff, and `--gate-report` (reads, rolls back, prints). No reverting yet. | none to data |
| **D2** | The restore-in-transaction hook in `ingest`, behind `VENDOR_GATE`; proposals written; `apply` for vendor proposals; the equivalence test. | the sensitive one; reviewed alone |
| **E1** | Group approval by field with samples; standing rules and their screen; the baseline action; Arabic. | screens only |
| **E2** | Nightly wiring, health `updatesOverdueDays`, doctor line, runbook and handbook, a rehearsal at full size. | low |
| **Later** | Scorecards and other detail rows; rankings per list. | separate plan |

## 11. Decisions I need from you

1. **Blanks filled go in without approval** (a result arriving, a missing height). Confirm. The alternative, approving every new result, is the permanent heavy workload you did not want.
2. **The fields that go in without approval**: odds, photo and poster URLs, round time, and career totals when explained by a new result. Add or remove any.
3. **Detail rows (scorecards, officials, punch stats, money) are not gated in version 1.** Agree, or should scorecards be in the first version?
4. **Official rankings** (replaced as a whole snapshot): let each snapshot in, or hold each changed list for approval?
5. **A rejection**: "we keep our value for good", or "ask again after N days" (default for N: never)?
6. **Overdue threshold** for the health and doctor warning: 7 days?
7. **The flood guard share**: 5% of an entity's rows in one night?
