# FightFax enquiry (draft, not sent)

**To:** the contact on https://fightfax.info/ (its contact form or the licensing address it lists; use the address the site shows now)

**Subject:** Verification licence enquiry: checking boxers' career records against the official ones

---

Hello,

I'm [YOUR NAME], [ROLE] on Ringside, a boxing database (fighter and bout records, rankings, ratings, predictions) that is not yet public. Our records come from a licensed feed, and before we publish them I would like to check each fighter's career record against the official one, so we never show a record the official source contradicts. Your site describes FightFax as the record keeper for the Association of Boxing Commissions and offers data licensing, so I am asking what is possible and what it costs.

**Two possible uses, and whether each is covered by a licence:**
1. **Verification only:** we send a fighter's name and fights, and you tell us whether the record matches (or what the official one is).
2. **Display (optional, later):** official records and public medical suspensions on fighter pages, with credit.

1. **Coverage:** how many fighters and bouts, and how far back? Which commissions report to you, and how complete are the records for a US card last month and for fights abroad?
2. **Format:** is there an API or a bulk file, with stable fighter and bout IDs? How are merges, corrections and deletions handled?
3. **Rights and price:** may we keep the results (or the records) if a licence ends, and display them publicly, and with what attribution? Is there an option for a small, early-stage product: a verification-only licence, or a time-limited one for a single pass?
4. **Sample:** could you check about 20 fighters we name, so we can see how it lines up with our data?
5. **Terms:** is there a written agreement we can read before committing?
6. **Suspensions:** if the national suspension list is available to licensees, what may be shown publicly? We would follow your guidance on personal and medical information.

I am happy to talk by phone or video if that is easier. Thank you.

[YOUR NAME] · Ringside · [WEBSITE OR REPO] · [EMAIL] · [PHONE]

---
**Notes for the sender (delete before sending).**
- "1M+ fighters, about 1M bouts, 145+ commissions" is FightFax's own claim, not verified: ask for the sample before believing it (`docs/data-sources-survey.md`, section 4).
- fightfax.com refused an automated request while fightfax.info is the site the survey read: use whichever address the site currently shows.
- If a licence at a price comes back, the adapter work is separate. The career-record check in `lib/vendor-verify.ts` already takes a vendor's career totals, so a second source of records slots in as a second reconciliation.
