# Before the first public visitor: the pages and notices a real-data site needs

Written 2026-10-06 from reading the site, not from legal advice. The wording below is a draft for the owner to decide on and, ideally, have read by someone who can advise on the law where the site is run. Nothing here is published until it is put in the code.

## What is already there

| Need | Where | Notes |
|---|---|---|
| What the site holds about visitors, cookies, the AI service, accounts, deletion | `/privacy` (`app/[locale]/privacy/page.tsx`, `lib/privacy.ts`) | one cookie, only for signed-in accounts; download and delete your account; says plainly which text goes to the AI service and which does not |
| Where the data comes from, and its licence | `/data` | field coverage, supplier credit, licence terms link (`VENDOR_TERMS_URL`), photo licences per image |
| Vendor credit on every page | footer (`vendorCredit()`, `lib/site-info.ts`) | how it is removed: `docs/vendor-credit.md` |
| "Ratings are unofficial" | footer, `/learn`, `/accountability` | |
| Tell us something is wrong | `/report` (signed-in), `SITE_CONTACT` (everyone else) | an editor checks the source; a fight's result is only changed from the commission's or sanctioning body's own page, a fighter's details from the fighter's own page |
| A person's own record is not changed on a vendor's say-so alone | `docs/accounts.md`, the corrections table | corrections survive vendor updates |
| Search engines | `INDEXABLE`, `SITE_URL` | the demo league is not indexable |
| A doctor that warns about missing settings | `npm run doctor` | warns when `SITE_CONTACT` is unset on a licensed league |

## What was missing, and what this change does about it

1. **"Not betting advice" and "not affiliated"** appeared nowhere, on a site that shows win probabilities and odds sliders and the names and belts of the four sanctioning bodies. **Done:** one sentence in the footer of a real-data site ("Ratings and predictions are Elo-style, unofficial and not betting advice. Ringside is independent: it is not affiliated with any sanctioning body, promoter or broadcaster."), in English and Arabic. The demo build's footer is unchanged. The Arabic is unreviewed, like the rest.
2. **Terms of use: none.** Decided 2026-10-06 and built: a `/terms` page in small type, linked from the footer next to Privacy, with the terms drafted below and the corrections-and-removal line.
3. **A fighter who asks to be corrected or removed.** Corrections have a route (`/report`, `SITE_CONTACT`). **Decided 2026-10-06: removal is not advertised on the pages people read; it is mentioned only in small print on the Terms page**, in words that promise no outcome ("to ask for a correction, or for personal details about you to be reviewed for removal, write to <contact>. Each request is considered."). `tests/terms.test.ts` fails if that wording appears on any other page. The options below stay for when a request actually arrives; none of them is built.

## Draft: terms of use (short)

> **Using Ringside.** Ringside is a boxing statistics site. Its ratings and win probabilities are the site's own calculations from public results: they are estimates for information and entertainment, not betting, financial or any other advice, and they are not official rankings. The site is independent and is not affiliated with, endorsed by or sponsored by any sanctioning body, promoter, broadcaster, fighter or data supplier named on it; their names and marks belong to them.
> **The data.** Fight, fighter and event data comes from the suppliers named on the Data page and may be incomplete or wrong; where it is known to be partial or disputed, the page says so. Do not copy the data in bulk; the public API (see the developers page) is the way to use it, within its limits.
> **Accounts and contributions.** An account keeps your picks and watchlist. If you propose an edit, you confirm you may share the source you give, and an editor decides whether it is published. We may close an account that is used to abuse the site.
> **No guarantee.** The site is provided as it is. We do not promise it will always be available or correct.
> **Contact.** `<SITE_CONTACT>`.

Published as `/terms` (small type, linked from the footer). Still worth having someone who can advise on the law where the site is run read it.

## Asking to be removed or corrected: the options, if a request arrives

A boxing record is public, but the site also shows a birth date and place for people who may not want them. Choose a stance and write it on `/data` next to the corrections text:

- **Corrections only (simplest).** "If a fact about you is wrong, tell us at `<SITE_CONTACT>` with the page that says so." Matches what the site does today. Says nothing about removal.
- **Corrections, plus personal details on request.** The record (fights and results) stays, as it is public and the supplier's; a fighter's birth date, residence and photo are taken down on their own request, from their own contact or page. Needs a small operator command (a per-fighter "hide these fields" flag that survives vendor updates, like a correction). Not built.
- **Full removal on request.** Hardest to keep: the vendor's data would put the fighter back at the next update unless the removal is stored as a rule. Not recommended without advice.

## Settings that must be right on the day

- `SITE_CONTACT`: a role address you read (the doctor warns when it is missing on a real league).
- `VENDOR_TERMS_URL`: the vendor's licence page, once you have read what it requires.
- `SITE_URL` and `INDEXABLE=1`, only when you want search engines in.
- The vendor email sent, and its answer on the rankings licence read, before the four official-ranking tabs are shown (`docs/vendor-credit.md`).
