# FightFax enquiry (draft, not sent)

**To:** the contact on https://fightfax.info/ (the site's contact form or the licensing address it lists; check before sending)

**Subject:** Data licence enquiry: bout records and national suspension cross-checks for a boxing database

---

Hello,

I'm [YOUR NAME], [ROLE] at [COMPANY / PROJECT]. We're building Ringside, a boxing database and analytics product (fighter and bout records, division rankings, ratings, predictions, search). It is at prototype stage and not yet public. Your site describes FightFax as the record keeper for the Association of Boxing Commissions and offers data licensing, so I would like to ask what is possible and what it costs, before choosing how to source official records.

**What we would use it for.** Two things, and we would like to know whether either is covered by a licence:
1. **Checking** the career record of each fighter in our database against the official record (does 19-0-1 add up?), so we never publish a record an official source contradicts.
2. **Showing** official records, and medical suspensions that are public, on fighter pages, with credit.

**Questions.**
1. **Coverage:** how many fighters and bouts, and how far back? Which commissions report to you, and how complete are the records for a US card that happened last month, and for fights abroad?
2. **Format:** is there an API or a bulk file? What identifies a fighter and a bout (stable IDs), and how are merges, corrections and deletions handled?
3. **Rights:** under a standard licence, may we (a) store the records in our own database and keep them if we stop paying, (b) display them publicly, and what attribution do you require, (c) use them to check other sources and for derived statistics?
4. **Suspensions:** is the national suspension list available to a licensee, and what may be shown publicly (suspension, length, reason)? We want to handle personal and medical information carefully and would follow your guidance.
5. **Price:** is there an option for a small, non-media, early-stage product, a time-limited licence for a one-off backfill, or a verification-only licence (we send fighter names and dates, you answer match or mismatch)?
6. **Evaluation:** could you provide a small sample (about 20 fighters we name) so we can test how it lines up with our data?
7. **Terms:** is there a written agreement we can read before committing?

Happy to talk by phone or video if that is easier. Thank you.

[YOUR NAME]
[COMPANY / PROJECT] · [WEBSITE OR REPO] · [EMAIL] · [PHONE]

---
**Notes for the sender (delete before sending).**
- The survey (`docs/data-sources-survey.md`, section 4) read the FightFax site: the claim of "1M+ fighters, about 1M bouts, 145+ commissions" is theirs and unverified; ask for a sample before believing it.
- fightfax.com refused an automated request from our tool (403) while fightfax.info is the site the survey read: use the address the site currently shows.
- If the answer is a licence at a price, the adapter work is separate: the career-record check in `lib/vendor-verify.ts` already takes a vendor's `stats`, so a second source of records slots in as a second reconciliation.
