# Boxing Data API: what we found in the first 11,000 fighters (draft, for the owner to send; 2026-10-05)

A companion to `boxing-data-api-vendor-email.md` (the questions about licences, field values and the hourly limit). This one is a report of concrete inconsistencies, with ids the vendor can look up, so they can be fixed at the source. Not sent as of this commit. Fill in the bracketed placeholders first.

Notes for the sender:
- Every figure is from the part of the league fetched so far: about 11,300 of the roughly 35,000 fighters, against the 44,259 fights in the fight list as read on 2026-10-04 (the fighters fetched are the most recently active). Update the counts if you send it later; `npm run vendor:backfill -- --check --cached-only --explain-conflicts` reproduces them.
- The ids below are the vendor's own (the `id` of the fight as the API returns it; Ringside stores it with a `bda-b-` prefix, which is left off here). Examples are fights and records anyone can check against the public record; nothing here is private.
- Section 2 is the answer to a question in the other email (are the `stats` totals kept in step with the fights?): on this evidence, no, for about 2% of fighters. If the other email is sent first, mention that this follows it.
- Tone: these are reports, not accusations. The data is mostly good (about 98% of fighters whose totals could be checked were consistent with their fights, or short only because the fight list does not reach their early career).

---

**To:** hello@boxing-data.com

**Subject:** Mega plan: inconsistencies we found while loading, with ids

---

Hello,

I'm [YOUR NAME] at [COMPANY / PROJECT] (Ringside, on your Mega plan). While loading your data we check each fighter's `stats` record (wins, losses, draws) against the fights we hold for them. Mostly it agrees or is short because the fight list does not reach their early career, which is expected. A small part contradicts itself, and we think you would want to know. We have set these fighters aside rather than publish a record we cannot stand behind. Counts are from the first ~11,300 fighters we fetched, of about 35,000.

**1. The same bout under more than one record (about 120 extra copies in the list).** Examples:
- Floyd Mayweather v Canelo Alvarez, 2013-09-14 (`671d0f253012a998846ef7a3`) and 2013-09-15 (`696f9561112ecc42c35483a5`): the same fight a day apart; the two records appear to name two different fighter ids for Alvarez.
- Michael Hunter v Martin Bakole, 2018-10-13: `696163456d169b2d09bde79e` (KO) and `671ce5b43012a998846ed556` (TKO).
- Michael Hunter v Devon Young, 2023-08-15: three records, `696162aa6d169b2d09bde6ff` (W, UD), `6961629a6d169b2d09bde6ef` (L, SD) and `6961628c6d169b2d09bde6df` (L, UD); and 2023-05-18: `696162cc6d169b2d09bde726` and `696162bd6d169b2d09bde716` (both W, UD).
- Mayweather v Oladeji Olatunji, 2022-11-13: `696fbb22112ecc42c354d431` (TKO) and `671cceb53012a998846ebeaf` (KO).
It looks like two generations of fight records (ids starting `671c…` and `696…`). Is one meant to supersede the other, and could the old ones be removed or marked?

**2. Career totals that do not match the fighter's own fights (172 fighters, about 2%).** For these the fight list shows more wins or losses than `stats` states, and the totals look short rather than the list wrong: in 38 cases, reversing the winner of the fight in question would break the exact record of the opponent, so the list's winner agrees with the opponent's totals. Examples:
- Ibrahim Nadim: `stats` 0-1-0; the list has two wins (`6973382f3864ef89230b7f96`, 2020-03-07; `691d67e29b5e213380993d3e`, 2025-11-22) and a loss (`69e3735d562c6e1198975140`, 2026-06-06).
- John Ume: `stats` 4-0-0; the list has a loss, 2025-12-09 (`6937cec5d8777bbb09e24cf5`).
- Omar Rivera: `stats` 0-12-0; the list has a win, 2026-08-09 (`6a7752ec3eea67c5335c53a4`).
- Hugo Grau (`stats` 3-0-0) and Chad Lebaron (`stats` 0-0-0) each show a loss on 2026-09-24 and 2026-09-26 (`6ab4691986df7fe14ab3c3fc`, `6aab2e5de86829189bd4eedc`) that their totals did not yet include when we read them eight to eleven days later.
Roughly twice as many fighters show more losses than the totals count (120) as more wins (55). How are the totals computed, how soon after a result are they updated, and are losses counted differently (for example only some methods)?

**3. Bouts that look like exhibitions or amateur fights, counted as professional.** Mayweather v Tenshin Nasukawa 2018-12-31 (`696fbe41112ecc42c354db01`, scheduled for 3 rounds, a KO win) and Mayweather v Olatunji (above, 12 rounds scheduled) are in the list and appear not to be in the 50-0 career total; Bakhodir Jalolov v Joe Joyce, 2016-08-16 (`696e4197df65f4c52ebdaa92`), dated the day of the Rio Olympic final, is listed as a professional loss. Is there a field that marks an exhibition or an amateur bout?

**4. Fights where one fighter has no `fighter_id` (3,413 of 44,259, 7.7%).** The opponent is named but has no profile. Could these have ids, or is there another way to match them? Without ids we cannot place the fight in either fighter's history.

**5. Finished fights with no winner and no outcome (6,059).** Many are 3-round fights on small cards (for example `68bb10ac853a38654faa3013`, 2025-09-06; `68be20ab0d81aeb81e9c02e2`, 2025-09-08). Are the results still to come, or are they missing?

**6. Smaller things.**
- A knockout or TKO with no winner marked: 504.
- A stoppage in a round after the scheduled number ("round 12 of 10"): 499.
- A fight whose two fighters have the same id: 6. Both fighters marked as the winner: 4.
- About 1,365 of the fighters we fetched have no `stats` block, and about 1,080 have no weight division.
- Reach recorded as 312 cm (17 fighters) or 123 cm against a height of 170 to 193 cm (57); a debut age of 5, 10 or 13 (11).

We can send the complete lists of ids for any of these, as a file, if that helps. We are glad to credit the data wherever it appears and to tell you when the fixes make the numbers match.

Thank you,

[YOUR NAME]
[COMPANY / PROJECT] · [WEBSITE OR REPO] · [EMAIL]
