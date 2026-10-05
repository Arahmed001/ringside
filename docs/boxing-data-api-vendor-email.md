# Boxing Data API enquiry: rankings licence, field values and the hourly limit (draft, for the owner to send; 2026-10-05)

Supersedes the follow-up drafts in `boxing-data-api-enquiry.md` (the hourly limit) and `boxing-data-api-rankings-enquiry.md` (the rankings): send this one instead of those two. Fill in the bracketed placeholders first. Not sent as of this commit.

Notes for the sender:
- The "about 35,000" fighter requests figure comes from the earlier drafts, which said both 35,000 and 36,000: use whichever you now trust. The 500 requests an hour is the RapidAPI plan card's figure, not verified against the live API.
- Section 2 asks for the lists of values the adapter has to guess at today (`outcome` words, `weight_class` names including catchweight, `scheduled_rounds` above 15, both fighters marked winner); the answers go in `lib/providers/boxing-data-api.ts` (`mapFight`, `divisionOf`) and `docs/real-data-readiness.md`.
- The BoxingScene answer decides whether the official lists may be shown publicly: see "The sanctioning bodies' official lists" in `real-data-runbook.md`.

---

**To:** hello@boxing-data.com (the contact form on https://boxing-data.com/contact also works)

**Subject:** Mega plan: rankings licence (BoxingScene), field values, and the hourly limit

---

Hello,

I'm [YOUR NAME], [ROLE] at [COMPANY / PROJECT]. We're the team behind Ringside, a boxing database that is loading your data on the Mega plan (you kindly confirmed in writing that we may store it). Before the first full load I have four questions.

**1. The sanctioning-body rankings (the main question).** Your docs say `GET /v2/rankings/` returns the official IBF, WBA, WBC and WBO standings and that `updated_at` is "sourced from BoxingScene". We would like to store each list (body, division, rank, fighter, champion and belt type, `updated_at`) and show it on our division pages and as a badge such as "#3 WBC" on a fighter's page.
- May we store and display these lists, as you confirmed for fights and fighters?
- What credit do you want? We credit "Boxing Data API" today; should the rankings also name BoxingScene, and in what words?
- Is BoxingScene's permission something you hold, or should we ask them ourselves?
- How often are the lists refreshed, how many contenders does each hold, and is there any history or only the current lists?

**2. Field values.** To read your data correctly, could you send (or point me to) the full lists of values for:
- a fight's `outcome` (we see UD, MD, SD, KO, TKO, PTS; are DQ, RTD, technical decision, no contest and draw also used, and how is each written?);
- `weight_class` (are Bridgerweight, Super Heavyweight and catchweight used, and how is a catchweight fight labelled?);
- `scheduled_rounds`: does it ever exceed 15 for historical fights? (We will keep those.)
Also: can both fighters in one fight ever be marked as the winner?

**3. Two fields we would like to use.**
- `scores` on a fight (for example `["116-109","117-108","116-109"]`): are the three scores in a fixed order, such as by judge seat, and are judge names or IDs available anywhere? Without names we show the scores only.
- The fighter `stats` block (`ko_wins`, `stopped`, `total_rounds`): are these career totals kept in step with `wins`, `losses` and `draws`? We would show them, labelled as yours, for fighters whose earlier fights we do not hold.

**4. The hourly limit.** On Mega we are held to 500 requests an hour. We are starting with the 5,000 most recently active fighters, and the full history is about 35,000 fighter requests, which takes days at that rate. Would you raise the hourly limit for a fixed period (a week, say) so we can finish the one-time load, or is there a bulk export we should use instead? If not, no reply is needed on this point: we will pace the run under the limit.

Thank you. We credit Boxing Data API wherever your data appears and can send you the page when it is public.

[YOUR NAME]
[COMPANY / PROJECT] · [WEBSITE OR REPO] · [EMAIL]
