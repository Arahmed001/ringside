# Embeds (cards other sites can frame)

Two bare pages, made to sit in an `<iframe>` on someone else's site:

| Address | Shows |
|---|---|
| `/embed/{en\|ar}/fighter/{slug}?theme=dark\|light` | name, country, division, record, knockouts, rating and rank, the last five results, the next fight |
| `/embed/{en\|ar}/rankings/{division}?limit=5&sex=male&theme=dark\|light` | a division's top fighters (1 to 10 rows) |

`/developers` has a builder: choose a card, theme and language, see a preview, copy the `<iframe>` code. Each card has a link back to Ringside (opens in a new tab) and, when the feed is licensed, the data supplier's credit; both are part of the card and should stay.

**Framing is allowed here and nowhere else.** Every other path of the site (pages, the API, the feeds) refuses to be framed: `X-Frame-Options: DENY` and `frame-ancestors 'none'`. Only `/embed/...` is different: `next.config.ts` leaves `X-Frame-Options` off for that path (every other header stays), and `proxy.ts` gives it a policy that is the standard one except `frame-ancestors *`. The cards have no script of ours, no cookie, no storage and no request to another site, and are `noindex` (and disallowed in `robots.txt`). Tests: `tests/embeds.test.ts` (the policy, the config's rules read as patterns against real paths, the proxy, the pages, the code builder); the smoke crawl fetches four cards and holds them to the framable rules.

**The switch.** The embeds use the same switch as the public API (`docs/public-api.md`): on for the demo league and a file feed (`PUBLIC_API=0` turns them off); for a licensed feed off until both `PUBLIC_API=1` and `VENDOR_REDISTRIBUTION_CONFIRMED=1` are set by the owner. When off, an embed is a 404 and `/developers` says so.

**Built from the API's own fields** (`apiFighter`, `apiRankings`), so a card can show nothing the API does not.

Code: `app/embed/[locale]/` (its own root layout, no site chrome), `components/EmbedFrame.tsx`, `components/EmbedBuilder.tsx`, `lib/embed-code.ts`, `app/[locale]/developers/page.tsx`, and the framing rules in `lib/security.ts`.
