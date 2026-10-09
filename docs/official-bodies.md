# The four sanctioning bodies' own pages: what they allow, read on 2026-10-09

The question: may Ringside read the WBC's, WBA's, IBF's and WBO's published champions and ratings and use them? What follows is what each body's site says and does, as seen by a polite reader that identifies itself and obeys `robots.txt`. It is not legal advice, and a site saying nothing is not a permission.

| | WBC | WBA | IBF | WBO |
|---|---|---|---|---|
| Site | wbcboxing.com | wbaboxing.com | ibf-usba-boxing.com (the old ibf-usba.com no longer resolves) | wboboxing.com |
| Publishes | Champions and monthly ratings by division, men's and women's, as pages and as a PDF (Spanish and English) | "Current WBA champions", ratings (men's, women's, regional), movements, statistics | Monthly ratings in 17 classes and the ratings criteria (as pages and PDFs) | Male and female champions, ratings report by division, ratings criteria |
| `robots.txt` | Allows everything except `/wp-admin/` | Allows everything except `/wp-admin/` | Allows all but `/thank-you/`; **Crawl-delay: 10** | Allows everything |
| Terms of use or copyright notice found | **None.** A privacy notice only. The ratings page carries a notice about how disputes over a rating are handled (WBC rules, appeal, mediation, arbitration at CAS) | **"Usage of Content" / "Important Legal Information":** the content "is provided for informational purposes only and its content is not binding", may "not reflect the most current developments and may contain editing errors", the WBA "reserve[s] the right to change the content … without notice", and the user "must always request official certification from the competent body". Footer: "Copyright © 1998 – 2026 The World Boxing Association". **No licence to reuse, and no ban on it either.** | **None seen.** The homepage answered **HTTP 403 to an automated request**, so it could not be read; nothing was done to get round that | **None found** on the home page (no terms or privacy link in it) |
| Does a polite reader get through? | Yes (HTML, no table: each champion is a block linking to a division page; the full lists are PDFs) | Yes | **No (403 on the homepage).** The criteria PDF is linked from search results; the lists were not reachable | Yes |

## What that means

1. **No body grants a reuse licence.** Not one publishes terms saying "you may copy our ratings". The WBA says the opposite of a promise of accuracy and tells users to get certification from the body. A champion's name or a rating's order is a fact, but a body's published list and the way it is laid out can still be protected, and the bodies could object. Silence is not permission.
2. **The IBF cannot be read at all** by a reader that stays within its block. It would need a request to them, not a workaround.
3. **The vendor already relays all four** (`docs/rankings-decision.md`): its API serves the bodies' standings "sourced from BoxingScene". That is the route to ask about, and it is waiting on the vendor's answer (`VENDOR_RANKINGS_CONFIRMED`). Reading the four sites directly would give nothing the vendor's licensed feed will not, and would lean on four sites that have granted nothing.
4. **Wikipedia's lists of champions are already used** (`title_reigns`, 2,640 reigns from the four bodies' pages, CC BY-SA with the revision recorded). They cover who held each belt and when, which is what the bodies' pages would add for champions.

## What to do

- **Do not build a reader of the four sites.** There is nothing to gain over the vendor's feed and the Wikipedia reigns, and no permission to rely on.
- **Link out.** A division page can link to each body's own ratings page ("Official WBC ratings ↗") with no copying. That needs no permission, and it sends the visitor to the body for the authoritative list, which is what the WBA itself says to do. (Not built; say if you want it.)
- **Ask, if you want their lists shown.** `docs/official-bodies-enquiry.md` is a draft to send to each body. Nothing is used until a reply says yes in writing. A "yes" for display with credit would be applied the way `docs/rankings-decision.md` describes: through the vendor adapter's `loadRankings()` and `lib/official.ts`.
- **Cross-check only, by approval.** If the watchers in PLAN 253 are built, a body's page can be a *source of proposals* (for example, "the WBC page shows a different champion in this division"), each proposal approved by a person against the official page before anything changes. That reads a fact to compare with, copies nothing onto the site, and uses a body's page only as the check it is meant to be. WBC, WBA and WBO pages could serve that role today (their `robots.txt` allows it); the IBF's could not.

## Re-checking

`curl -s https://<site>/robots.txt` and the site's footer links are the whole check. Re-read before any change in how the sites are used; a body can add terms at any time.
