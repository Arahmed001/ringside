# Boxing Data API enquiry (answered: the vendor confirmed storage to the owner, 2026-10-03; kept for reference)

**To:** hello@boxing-data.com (shown on https://boxing-data.com/contact, which also has a contact form)

**Subject:** Evaluating Boxing Data API for a commercial product: coverage, fields and data rights

---

Hello,

I'm [YOUR NAME], [ROLE] at [COMPANY / PROJECT]. We're building Ringside, a boxing database and analytics product (fighter and bout records, division rankings, ratings, predictions and search). It's at prototype stage and not yet public, and I'm choosing a licensed data source for it. Boxing Data API looks like a strong candidate, and I've read your docs and pricing, but the public pages leave a few things I need in writing before choosing a plan.

**1. Coverage**
- Roughly how many fighters and fights are in the database, and what is the earliest fight date?
- Which promotions, countries and levels (world title through undercard and regional shows) are covered, and how complete are they?
- Does a fighter's record reconcile with the fights returned for that fighter?

**2. Fields.** Which of these exist in the API today, and which are planned?
- Trainers, managers, promoters and gyms per fighter, ideally with dates, current and historical
- Official weigh-in weights, fight-night weights, and missed weights
- Referee, judges and per-judge scorecards; knockdowns; round and time of stoppage
- Fighter birth date and birthplace; fighter photos and event posters
- Odds and punch statistics
- Stable fighter and fight IDs, and any external IDs such as Wikidata

**3. Provenance.** Where does the data come from, and are you licensed to provide it to customers for storage, display and analysis? I'm asking because we'd be building on it commercially and need a clean chain of rights.

**4. Rights.** Under the standard plans, may we:
- store the data in our own database and keep it after cancelling a plan;
- display it publicly, and what attribution do you require;
- use it for derived analytics, model training, and AI-generated summaries or search?

**5. Getting the data in.**
- Your Pro plan includes 30 days of historical fights and Mega includes full history. If we take Mega for a month to backfill history, may we keep that data after downgrading?
- Is there a way to sync changes (an updated-since filter or webhooks), and how are merged or deleted records handled?
- The docs note an offset limit of 10,000 documents for page numbers. Is cursor pagination the supported route for a full export?

**6. Reliability.** Is there an uptime commitment, a changelog or deprecation policy, and a plan for customers if the service changes or ends?

**7. Terms.** Do you offer a custom or direct (non-RapidAPI) agreement, a bulk export, or enterprise pricing for a product like ours?

**8. Evaluation.** The free tier's 100 requests is too small to test fit. Could you give me a temporary evaluation key, or a sample response for about 20 fighters I name, so I can check the fields above?

Happy to jump on a short call if that's easier. Thank you for building this.

[YOUR NAME]
[COMPANY / PROJECT] · [WEBSITE OR REPO] · [EMAIL] · [PHONE]


---
## Follow-up: the hourly limit (draft, not sent; 2026-10-03)

The first full run stopped on `429 You have exceeded the rate limit per hour for your plan, MEGA, by the API provider`. The public pricing page gives no hourly figure; the RapidAPI plan card says 500 requests per hour (500,000 a month, hard limit; 10,240 MB of bandwidth a month, then $0.001 per MB). So the question is no longer what the limit is but whether it can be lifted:

> Hello, thank you for confirming that the data may be stored. On the Mega plan my first full run was refused with "You have exceeded the rate limit per hour for your plan, MEGA, by the API provider". I see the plan card gives 500 requests an hour. I need about 36,000 requests (one per fighter) for a one-off historical backfill, which is about three days at that rate. Could the hourly limit be raised for a day or two for this one pass? If not, I will pace the run under it over several days; no reply is needed in that case.
>
> Two more things I would like in writing: that the backfilled data may be kept if I later move to a cheaper plan, and how far back the history on Mega goes.
