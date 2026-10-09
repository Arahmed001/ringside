# Boxing Data API: results missing for finished fights (draft, for the owner to send)

**To:** hello@boxing-data.com (the contact form on https://boxing-data.com/contact also works)

**Subject:** Mega plan: fights marked FINISHED with no outcome or no winner (list attached)

Written 2026-10-09, counts refreshed the same evening from our own copy of your fight-list pages (a clean reload of the whole cache). Counts only here; the fight ids are in the attached file (`~/ringside-real/vendor-gaps.csv`, 7,153 rows, made by the owner's machine, not committed). Nothing in this draft has been sent.

---

Hello,

I'm [YOUR NAME] at [COMPANY / PROJECT]. We load your data on the Mega plan and show it in Ringside. Reading our copy of your `/v2/fights/` pages, we found three groups of fights that are dated in the past but have no usable result. We do not want to guess any of them, so they show on our site as "no result yet". Could you tell us whether these are results you do not hold yet, or something on our side?

**1. FINISHED with no outcome (5,368 fights).** `status` is `FINISHED` but `results.outcome` is empty. 4,720 are dated 2026, 639 are 2025 and 9 are older. 844 whole cards fall in this group or the next: not one fight on the card has an outcome.
- Are results for these cards still to come? Roughly when?
- Are small cards without a broadcaster (almost all of them) covered at all?

**2. An outcome but no winner (1,703 fights).** `results.outcome` is a decision (UD, SD, MD) but neither fighter is marked `winner: true`. Almost all are 2025. We cannot tell a draw from a result that has not been filled in, so we leave them with no result (and we used to count them as draws, which made some fighters' records disagree with your `stats`).
- Is a decision with no `winner` flag a draw, or an unfilled result?

**3. Dated in the past, not finished (58 fights).** `status` is `NOT_STARTED` or `LIVE` for a fight whose date has passed.

We also found fights listed twice under two fighter profiles (a fighter with two profile ids, for example Canelo Alvarez appears as `6715fc1faf69bb50508b79da` and under a second id). That was our side, and we now read such copies as one fight; 24 fights where an outcome and a winner are present still came out as "no result yet" because two copies disagreed. Mentioning it in case you would like to merge duplicate profiles.

Could you tell us how and how often your results are updated, so that we can refresh these fights when you fill them in? We pull `/v2/fights/` daily.

Thank you,
[YOUR NAME]

*Attach:* `vendor-gaps.csv` (columns: category, fight_id, event_id, date, outcome_in_feed, status_in_feed, note).
