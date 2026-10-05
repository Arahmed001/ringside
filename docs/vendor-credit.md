# The vendor credit: where it is, why it is there, and how to remove it

Written 2026-10-05, at the owner's request, so the credit can be taken out later if it turns out not to be required. Nothing here has been decided: this is the map.

## Why it is there

- The draft email to the vendor (`boxing-data-api-vendor-email.md`) says: "We credit Boxing Data API wherever your data appears and can send you the page when it is public." That is the promise the credit keeps.
- **The repository records no requirement from the vendor** to credit them, and no wording they asked for. The only written permission on record is that the data may be stored (the owner's note of 2026-10-03). Whether the vendor's terms (the RapidAPI listing, the plan, or a reply to that email) require attribution is not known here: check before deciding.
- It is also plain provenance: the site shows real people's records, and says where they come from.

## Where it appears (only when `BOXING_PROVIDER=licensed`; the demo league shows none of it)

| Where | What a visitor sees | In the code |
|---|---|---|
| **Every page's footer** (added in round 92) | "Fight, fighter and event data: Boxing Data API", linking boxing-data.com | `app/[locale]/layout.tsx`, the `vendorCredit() && …` line inside `<footer>` (and the `vendorCredit` import) |
| **The Data page**, "Data supplier" section | the same sentence, a link to the licence terms when `VENDOR_TERMS_URL` is set, and "Ringside adds its own ratings… those are Ringside's, not the supplier's" | `app/[locale]/data/page.tsx`, the `{credit && (<section aria-labelledby="credit">…` block |
| **The official sanctioning-body lists** (rankings pages) | "These are the body's own standings, relayed by Boxing Data API from BoxingScene. They are not Ringside's ranking…" | `components/OfficialList.tsx` |

The first two come from one function, `vendorCredit()` in `lib/site-info.ts`. The third is a different matter: it is where the official lists come from (BoxingScene, via the vendor: the open licence question in section 1 of the vendor email), and it also says the lists are not Ringside's ranking. **Keep it even if the other two go**, unless the lists themselves go.

## How to remove it

- **Both the footer and the Data page credit at once:** make `vendorCredit()` in `lib/site-info.ts` return `null` (one line). Nothing else breaks: both places already handle `null` (that is what the demo league gets).
- **Just the footer:** delete the `vendorCredit() && …` line in the footer of `app/[locale]/layout.tsx` and the `import { vendorCredit }` line.
- **Then update what checks for it:** `tests/site-info.test.ts` (the tests that `vendorCredit({ BOXING_PROVIDER: "licensed" })` returns the credit, and the one that the footer carries it); the doctor's note in `lib/doctor.ts` ("VENDOR_TERMS_URL is not set: the Data page credits the vendor…"); the sentences in `docs/deploy.md` (`VENDOR_TERMS_URL`) and `docs/real-data-runbook.md` that mention the credit; and the translated string "Fight, fighter and event data: <a>{name}</a>." stays in `i18n/` until `npm run i18n:extract` finds it unused. Then `npm test`, `npm run lint`, `npm run i18n:check`.
- `VENDOR_TERMS_URL` can stay set or be unset; it only affects the Data page's terms link.

## Before removing it

1. Read the vendor's terms for an attribution requirement, and the vendor's reply to the email if it was sent.
2. If the vendor was told the credit would be there (the email), tell them it is going.
3. Remember it is not only a courtesy: the footer is the one place every page shows where its numbers come from.
