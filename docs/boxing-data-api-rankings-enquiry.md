# Boxing Data API follow-up: the rankings feed, scorecards and the hourly limit (draft, for the owner to send)

**To:** hello@boxing-data.com (the contact form on https://boxing-data.com/contact also works)

**Subject:** Mega plan: storing and showing your sanctioning-body rankings, and two questions about fields

---

Hello,

I'm [YOUR NAME], [ROLE] at [COMPANY / PROJECT]. We're the team behind Ringside, a boxing database that is loading your data on the Mega plan (you kindly confirmed in writing that we may store it). I've now read the Rankings page of your docs, and before we use it I'd like to check the terms in writing.

**1. The rankings (the main question).** Your docs say `GET /v2/rankings/` returns the official IBF, WBA, WBC and WBO standings and that `updated_at` is "sourced from BoxingScene". We would like to store each list in our own database (body, division, rank, fighter, champion and belt type, the `updated_at` date) and show it on our division pages next to our own Elo-style ranking, and as a "#3 WBC" badge on a fighter's page. Please tell us:
- May we store and display these lists, in the same way you confirmed for the fight and fighter data?
- What credit do you want? Today we credit "Boxing Data API" for the data; should the rankings also name BoxingScene, and in what words?
- Is BoxingScene's permission for this something you hold, or should we ask them ourselves?

**2. How the rankings behave.** So that we show nothing misleading:
- How often are the lists refreshed, and is `updated_at` the date the sanctioning body changed its list (as the docs say)? We would refresh once a day and show that date.
- How many contenders does each list hold (the docs' example shows two)? Is it the body's top 15?
- Is there a history (earlier dates), or only the current lists? Are women's divisions or The Ring's ratings planned?

**3. Two fields we would like to use.**
- `scores` on a fight (for example `["116-109","117-108","116-109"]`): are the three scores in a fixed order (for instance by judge seat), and are judge names or IDs available anywhere? Without names we would show the three scores only.
- The fighter `stats` block (`ko_wins`, `stopped`, `total_rounds`): are these career totals, kept in step with `wins`, `losses` and `draws`? We would show them, labelled as yours, for fighters whose earlier fights we do not hold.

**4. The hourly limit.** On Mega we are held to 500 requests an hour, and the full history is about 35,000 fighter requests, which takes days at that rate. Would you consider raising the hourly limit for a fixed period (a week, say) so we can finish the one-time load, or is there a bulk export we should use instead? We are happy to keep to whatever pace you suggest.

Thank you. I'll credit Boxing Data API wherever your data appears and can send you the page when it is public.

[YOUR NAME]
[COMPANY / PROJECT]
