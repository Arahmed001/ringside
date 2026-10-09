# The vendor update gate: a plan for review

Status: **plan only, nothing is built. The owner's decisions of 2026-10-09 are recorded in section 11 and applied below.** It follows PLAN 253 (source watchers), whose steps A to C are on main. This page is what to read and decide on before step D starts, because the gate touches `lib/ingest.ts`, the most sensitive code in the project.

## 1. What was asked

- Changes the licensed vendor makes to data we **already hold** wait for an administrator's approval. **That includes a blank being filled** (decision 1): a result arriving for a fight we hold as scheduled is an update to that fight.
- **Only updates to existing rows** wait. A brand-new record (a new fighter, fight or card) goes in at once.
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

| Kind of change | Rule | Why |
|---|---|---|
| **A new row** (a fighter, fight, card, organisation or person we do not hold) | **goes in at once**, listed in a "new this run" digest | asked: only updates to existing data wait |
| **A result arriving** for a fight we hold as scheduled, or **a result changed** | **waits**, as one `result_change` per fight | decision 1. The proposal carries everything that is part of the result: winner, method, end round, round time, knockdowns, status (completed), and the judges' `scores` (decision 3), so approving it publishes the whole result at once |
| **A fighter's career totals** (`vendor_wins`, `vendor_losses`, `vendor_draws`, `vendor_ko_wins`, `vendor_stopped`) | a change **explained by a result being held** is folded into that result's proposal and applied with it; any other change **waits** on its own | the totals follow the result, so they must not show a record that the results do not yet support |
| **A blank filled** in anything else (a missing height, birth date, nickname, country) | **waits** | decision 1 |
| **A value replaced by a different value** in a gated field | **waits** | an update to existing data |
| **A fight's status** to cancelled, an **event's date** moved, an event's name, venue or attendance changed | **waits** | real changes to something we showed |
| **A person's facts**: name, country, division, stance, reach, height, birth data, active, retired date, nickname, aliases, Wikidata and BoxRec ids | **waits** | |
| **Odds** (`odds_red`, `odds_blue`) | **goes in** | prices that move all day; not a fact anyone would audit; no page treats them as a record |
| **Pictures**: `photo_url`, `poster_url` and the photo credit | **goes in** | media paths, not facts; the fighters' headshots also arrive from Wikimedia and this keeps both routes the same |
| **The judges' scores** (`vendor_scores`) | in the result's proposal (above) | decision 3. **What the vendor supplies:** three strings such as "116-109" on the fight, stored on the fight's own row, with no judge names and no order we can rely on (the vendor email asks). So scorecards are in version 1 as that column. The judge-level `scorecards` table, officials, corners, punch stats and weigh-ins are not supplied by this vendor today and are not gated; money rows (financials, purses, earnings) are not gated either and are listed in the digest |
| **Official rankings** | **per list**, see decision 4 below | |

Derived numbers (records, ratings, streaks, rankings pages) are never gated: they are recomputed from the facts that are.

**Official rankings (decision 4).** Each body's list for each division (a champion line and the contenders) is one proposal when it differs from the one we hold, so there are at most one per list (four bodies by the divisions they rank), and the group action **"Approve all lists"** is the whole snapshot in one click, while any single list can still be approved or rejected on its own. The first snapshot ever received (nothing held) goes in. This needs a temporary copy of the (small) `official_rankings` table in the gate.

**An approved correction still wins.** `applyCorrections` runs on the live rows after the gate, as now; a vendor value that disagrees with a correction stays on the existing `vendor_changed` flag path and does not also become a proposal.

**What this means day to day.** Because results wait, every day's new results are a queue (a card of 8 fights is 8 results; a busy weekend is dozens), and the site shows a fight as scheduled until you approve its result. The two things that keep it a two-minute job: **approve the group** ("Results: 37, approve all"), and, if you want it, a **standing rule** you write yourself (for example "accept a result whose fight was in the last 3 days"). No such rule exists by default, so nothing is auto-approved unless you make it. If you are away for a week the site simply lags the vendor and says how long it has been waiting (section 7).

## 5. What a proposal is

It reuses the `proposals` table and the approval page from steps A and B:

- `source` = `vendor:boxing-data-api`; `kind` = `field_change` (one per fighter or event field) or `result_change` (one per fight, carrying winner, method and round together);
- `target_key` = `boxer|<external_id>|<field>`, `event|<external_id>|<field>`, `bout|<external_id>|result`;
- `old`, `new`, and `evidence` = the run id and the vendor's own updated-at if the feed gives one;
- the fingerprint rule: a rejected change is not raised again while the vendor says the same thing, **for 30 days** (decision 5); after that it is raised again, once, for a fresh decision. The live value stays ours meanwhile, and every night the gate puts it back again. This also applies to the source watchers' proposals (a small change to `reconcile`, made in D1, setting `PROPOSAL_REJECT_MEMORY_DAYS`, default 30).

Approving applies one value with a stale check (the live value must still equal `old`), writes the audit row, and recomputes ratings once per approved batch when a result changed. A change that no longer fits is refused and stays waiting.

## 6. Making the volume manageable

- **Groups by field, not by row.** The page shows "boxers.height_cm: 412 changes (median change 2 cm, largest 15 cm)" with ten samples, and **Approve all in this group** takes the whole group, in chunks, whatever its size (PR B's limit of 50 per call is for single rows).
- **Standing rules** (a table in the accounts database, edited by an administrator, each use logged): "accept `height_cm` changes of 3 cm or less", "accept `active` changes", "accept any change to `nickname`". A rule applies on the next run, before a proposal is written, and is shown in the digest ("accepted by rule: 214").
- **A baseline step**: when the gate is first switched on, the first run's proposals are the pile left from before. The administrator can **accept the present state** group by group, after looking at the samples, in one logged action each; this is the "heavy at first" part and it ends.
- **Noise is removed before it becomes a proposal**: text compared after trimming and normalising, lists compared as sets, `updated_at` ignored.
- **A flood guard**, measured per field and calibrated on real nights (decision 7). A update touches a bounded set of rows (recent and coming fights and their fighters), so "5% of the whole table" would mean nothing: a normal night's results are a large share of the fights it touched. What a format change looks like is **one field changing in a large share of the rows touched** (heights switching units changes nearly every height). The first setting, to be replaced by numbers from real nights: **refuse the run (exit code 3, "a check refused the data", nothing written) when a single field would change in more than 30% of the rows touched and in at least 100 rows, or when a night would propose more than 2,000 changes in all.** Result fields are exempt from the share test (they legitimately change in most of a card's fights) but not from the ceiling. Baseline mode (the first gated run) is exempt from both. `--gate-report` (section 8) is run for the first five to seven nights with the gate off, and the thresholds are then set to about three times the largest legitimate night it shows, so a real night is never refused and a format change always is. The settings are `VENDOR_GATE_MAX_FIELD_SHARE`, `VENDOR_GATE_MAX_FIELD_ROWS` and `VENDOR_GATE_MAX_NIGHT`.

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
| **D1** | The policy table, the diff and `--gate-report` (reads, rolls back, prints, so the first nights' volume and the flood-guard numbers are seen for real); the 30-day rejection memory in `reconcile`. No reverting yet. | none to data |
| **D2** | The restore-in-transaction hook in `ingest`, behind `VENDOR_GATE`; proposals written; `apply` for vendor proposals; the equivalence test. | the sensitive one; reviewed alone |
| **E1** | Group approval by field and "Approve all lists", with samples; standing rules and their screen; the baseline action; Arabic. | screens only |
| **E2** | Nightly wiring, health `updatesOverdueDays`, doctor line, runbook and handbook, a rehearsal at full size. | low |
| **Later** | Judge-level scorecards, officials and other detail rows, if the vendor ever supplies them; money rows. | separate plan |

## 11. Decisions (owner, 2026-10-09)

| # | Question | Decision |
|---|---|---|
| 1 | Do blanks filled go in without approval? | **No, they wait too.** Applied in section 4 (results, missing details). A new row still goes in at once. |
| 2 | Which fields go in without approval? | **Left to me; recommended and applied in section 4:** odds, picture paths (photo, poster, credit). Career totals ride with the result they follow. Everything else waits. |
| 3 | Scorecards in version 1? | **Yes, as far as the vendor supplies them:** the judges' `scores` on the fight are part of the result's proposal. Judge-level rows and officials are not supplied. |
| 4 | Rankings: whole snapshot or per list? | **Both, recommended:** one proposal per list, plus "Approve all lists" for the whole snapshot in one click. |
| 5 | Is a rejection permanent? | **Asked again after 30 days.** |
| 6 | Overdue warning threshold | **7 days.** |
| 7 | Flood guard share | **Left to me; recommended:** per field (30% of rows touched and at least 100 rows) plus a ceiling of 2,000 changes a night, calibrated on five to seven nights of `--gate-report` before it is enforced. See section 6. |

Nothing starts until you say "build D1".
