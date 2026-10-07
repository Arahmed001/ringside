# Letting a CDN cache the pages: what was found, and why the policy was not changed

Round 131, 2026-10-07. The owner approved changing the security design so that pages could be cached by a CDN, provided the content security policy (CSP) is not weakened: move from a per-request nonce to hashes of each inline script and style, or remove the need for inline scripts, "whichever is safer and works with this Next version". The brief said to stop before changing the CSP if hash-based CSP could not be done safely. **That is the outcome: it cannot, with Next 16.3.8, so nothing in the code, the headers or the policy was changed.** This file holds the evidence, the route classification that any future caching work needs, what can be done instead, and one synthetic measurement of what caching would be worth. `docs/security.md` still describes the policy that is in force.

## The finding

Everything below was measured on a production build (`next build`, `next start`) of this repository, on the demo league.

1. **Every page carries three inline scripts, and one of them is the page.** `/`, a fighter, an event, rankings, the forum, and a fighter in Arabic each have exactly three inline `<script>` elements and no inline `<style>` element (styles are external files; the theme-flash script is the only inline code of ours):

   | script | size | same on every page? |
   |---|---|---|
   | `(self.__next_f=self.__next_f\|\|[]).push([0])` (Next's flight-data bootstrap) | 43 bytes | yes |
   | the rail-state script in `app/[locale]/layout.tsx` (`InlineScript`) | 131 bytes | yes |
   | `self.__next_f.push([1,"..."])`, the React Server Components payload that hydration reads | 61,851 bytes (`/forum`) to 283,375 bytes (a fighter in Arabic): `/` 132,472, a fighter 186,939, an event 91,527, rankings 146,825 | **no: its content is the page's data** |

   The first two have a stable hash that could be listed in a header. The third cannot: it is different for every URL, language and data version, and Next writes it while it renders.

2. **Next 16.3.8 has no hash-based CSP for inline scripts.** `node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md` offers nonces (which require dynamic rendering, and say plainly "Pages cannot be cached by CDNs without additional configuration"), a header with `'unsafe-inline'`, and experimental Subresource Integrity (`experimental.sri`). SRI hashes the external `/_next/static` files and puts `integrity` on their tags; it does not touch inline scripts, and the flight payload is inline. A search of `node_modules/next/dist` finds no code that produces a `sha256-` source for an inline script; the only CSP code is the one that reads a nonce back out of the header (`server/app-render/get-script-nonce-from-header.js`).

3. **Tried in a real browser (Chromium, Playwright), against the running build, with the response's CSP replaced and the nonce attributes removed, on a fighter page:**

   | policy | result |
   |---|---|
   | `script-src 'self'` plus the hashes of the two stable inline scripts | 1 CSP violation ("Refused to execute inline script"): the payload script is blocked, React never hydrates (`__reactFiber` absent from `#main`); the server-rendered HTML is visible, nothing is interactive |
   | `script-src 'self'` plus the hash of **every** inline script as rendered | 0 violations, hydrated |

   So hashes work only if the hash of the payload is in the header, and that hash can only come from the rendered page.

4. **Why computing it from the rendered page is not safe.** A policy built from the hashes of whatever inline scripts the finished HTML contains allows whatever the HTML contains. The nonce works because only Next's own scripts are given it; if a bug in how some text is shown ever let an attacker put `<script>...</script>` into the server-rendered markup, it would have no nonce and would not run. A hash computed afterwards over the markup would include the attacker's script, and approve it. That is the same protection as `'unsafe-inline'` for server-side injection, which is exactly the class of bug the policy is there for. Stored text here is escaped by React today (`docs/security-review.md`, "XSS"), so there is no known hole, but a policy that only holds while there is no bug is not the policy the owner asked to keep.

5. **It also cannot be done in the order the response is sent.** The CSP is a response header, sent before the body; the payload script is produced while the body streams. `proxy.ts` runs before rendering and cannot see the body. The only ways to put a hash of the body in the header are to render the page twice (the proxy fetches the page from itself, buffers it, hashes it, and returns it: double the origin work, which defeats the purpose, and no streaming) or to run a buffering layer in front of `next start` that this repository does not have (the container runs `next start`).

6. **A fixed or derived per-URL nonce is not an answer either.** If the nonce is a function of the URL and a secret, every visitor of a page gets the same one, and anyone who can read the page can read it. An attacker who can inject markup into a stored page (a stored version of the bug in item 4) would then know the nonce for that page. That is weaker than today, for the same reason as item 4, and it is what `docs/capacity.md` meant by "a weaker protection, to be decided".

7. **Removing the need for inline scripts is not possible.** The payload is how a dynamic App Router page hands its data to the browser; there is no setting to send it as an external file. The theme script could be moved to a file, but that saves nothing while the payload stays.

8. **Nothing else about the pages stands in the way, which is the useful part.** Checked:
   - A page is the same for every visitor of one URL: two requests for `/boxers` differ in bytes only by the nonce (every occurrence replaced by one token, the two responses are equal). The nonce is also in the `Link: ...; rel=preload; as="font"; nonce="..."` header (25 fonts), which a cache must treat the same way.
   - No server-rendered page reads a cookie or a session (`app/[locale]/**` and `components/` never call `userOf`, `cookies()` or the accounts session; signed-in state is drawn by `AccountMenu` and the picks and watchlist components in the browser, from `/api/account/me` and the other APIs). An anonymous page response has no `Set-Cookie` (`securityProblems` in `lib/security.ts` and the smoke run check it).
   - The language is in the path (`/ar/...`, English at the bare path); there is no redirect on `Accept-Language`.
   - The pages send `Vary: rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding`. A client-side navigation asks for the same URL with an `rsc` request header and an `_rsc=<hash>` query; Next checks that hash and answers a wrong one with a 307 to the URL without it (seen: `GET /boxers?_rsc=abc` with `rsc: 1` returns `307` to `/boxers?_rsc`). The `rsc` request returns a `text/x-component` body, not HTML. A cache that keeps the query string in its key and honours `Vary` handles it; a cache that ignores either can hand a browser a page where it asked for data.

## What can be done, in order of how much it keeps

1. **Keep the policy; let the edge cache the page and write a fresh nonce on each response (works with any CDN that can run code at the edge).** The origin's response is the same for everyone except one token. The edge stores the page once, and on every response it replaces that token with a new random one in three places: the body (`nonce="..."` attributes), the `Content-Security-Policy` header (`'nonce-...'`), and the `Link` header. The browser then sees what it sees today: a nonce no attacker can know, a policy without `unsafe-inline`. Nothing in this repository changes except, if wanted, the response's `Cache-Control` (below). It needs a worker (Cloudflare Workers, Fastly Compute, CloudFront Functions or Lambda@Edge, or a small server of your own); it does not work with a CDN that can only cache bytes. The rule it must follow, and a test it should have: the token to replace is the one in the response's own CSP header, replaced everywhere it occurs as a whole `nonce="..."` value; a page that has no CSP header, or whose body contains the nonce somewhere unexpected, is not cached.
2. **Cache static files, images, sitemaps and portraits only** (what `docs/capacity.md` "What to put in front" already says), and accept that pages hit the origin. That is where the measured ceiling is, and it is the position today.
3. **Accept a weaker policy for pages (`script-src 'self' 'unsafe-inline'`, or a derived nonce): not recommended and not done.** It is the one change the finding above says is a real reduction, and it is the owner's decision, not a performance setting.

## What it would be worth: a synthetic measurement

Method (`scripts/capacity.ts`, unchanged, plus a throwaway 60-line Node caching reverse proxy that is not in the repository): the demo league (968 fighters, 7,755 bouts) served by `next start` pinned to cores 0 and 1 with `SITE_URL` set so the sitemap lists it; the driver at 20 virtual visitors for 20 seconds on core 3, the proxy on core 2. The proxy stands in for option 1: it keeps anonymous `200 text/html` responses without `Set-Cookie` for 60 seconds, keyed by path and query, never keeps a request with a cookie, an `rsc` header or an `_rsc` query, or an `/api`, `/account`, `/picks`, `/watchlist`, `/review`, `/report` or `/contribute` path, and on a hit writes a fresh nonce into the body, the CSP header and the `Link` header.

| | client req/s | p50 | requests that reached the origin |
|---|---|---|---|
| direct to the origin | 32.9 | 626 ms | all 667 (33 a second) |
| through the proxy, empty cache (first 20 s) | 58.0 | 451 ms | 811 including the sitemap discovery and 186 requests that cannot be cached (APIs, share images) |
| through the proxy, warm cache (next 20 s) | 115.3 | 38 ms | 819 in the run; 65 % of the 2,324 requests were hits (1,508) |

What this does and does not say. It is **synthetic**: one machine, the proxy and the origin on loopback (no network time, no TLS, no CDN's own overhead), a 968-fighter league where the same few pages repeat (the real 35,000-fighter league has a much longer tail, so the real hit rate will be lower: the capacity mix picks a random fighter each time), a mix that is an assumption (`docs/capacity.md`), the driver and the proxy are Node and are not free, and the error counts (2 to 6 requests of 667 to 2,324, the sitemap file in the direct run, not investigated in the others) are the same order in all three runs. The origin was at 126 to 146 % of a core in every run: with the cache it did about the same work and answered 3.5 times as many visitors, and that is the shape to expect, not the number. The nonce rewrite on a hit costs the proxy a string replace over 60 to 280 KB; it was not the bottleneck here and might be at a high rate. A cache of 60 s on a nightly-updated site serves at most 60 s of out-of-date data (below).

## Route classification (derived from `app/`; for whoever builds option 1)

Derived by reading every `page.tsx`, `route.ts` and `opengraph-image.tsx` under `app/`, and by grepping for session and cookie use. "Cacheable" means: an anonymous visitor's response, no `Set-Cookie`, no session read, the same bytes for everyone of that URL and language. **The origin sends `private, no-cache, no-store` on every page today; nothing in this table is in force.** If option 1 is built, an edge rule (or the origin) should apply the cacheable headers only to the first block, by this allow-list, and fail closed to `private, no-store` for any route not in it.

**Cacheable if option 1 is built** (both languages; the same list with `/ar` in front):

| route | notes |
|---|---|
| `/`, `/boxers/[slug]`, `/bouts/[id]`, `/events`, `/events/[id]`, `/rankings`, `/rankings/[division]`, `/all-time`, `/all-time/[list]`, `/countries`, `/countries/[slug]`, `/orgs`, `/orgs/[slug]`, `/people`, `/people/[slug]`, `/titles`, `/titles/[slug]`, `/trainers`, `/weights`, `/previews`, `/previews/[id]`, `/upset-watch`, `/tonight`, `/fight-of-the-year`, `/fight-of-the-year/[year]`, `/map`, `/matchmaking`, `/on-this-day`, `/analytics`, `/accountability`, `/learn`, `/tour`, `/data`, `/developers`, `/privacy`, `/terms` | read-only league data, the same for everyone. `/` calls the question answerer with the visitor's address for one fixed example question (`clientId(headers())`): behind a CDN a miss spends the shared address's allowance, not a visitor's. `/boxers/[slug]` and `/bouts/[id]` also show accepted corrections from the accounts database, which change when an editor accepts one, not nightly. |
| `/compare?a=&b=`, `/rankings?...`, list pages with filter parameters | only with a query on an allow-list per route; the query string must be in the cache key. Anything with a query that is not on the list is private. |
| `/forum`, `/forum/[id]`, `/forum/rules`, `/leaderboard` | public, but they change when people post or pick, not nightly: cache for the shortest time (or not at all) and purge on a post. The forum compose form and reporting are client-side calls to `/api/forum/*`, which are private. |
| `/[locale]/*/opengraph-image`, `/api/art/portrait/[slug]`, `/sitemaps/[id]`, `/sitemap.xml`, `/feeds/calendar.ics`, `/feeds/upset-watch.xml`, `/api/v1/*`, `/api/fighter-card/[slug]`, `/api/og/compare` | **already public**, with their own `Cache-Control` (`docs/capacity.md`). The proxy still puts a per-request CSP header on image responses, which does nothing for an image. |
| `/embed/[locale]/fighter/[slug]`, `/embed/[locale]/rankings/[division]` | framed on other sites; the same nonce policy with `frame-ancestors *`; cacheable under option 1 on the same terms. |

**Must stay `private, no-store`** (the origin already sends it on pages; the APIs set `no-store` themselves, which is a test target for the day this changes):

| route | why |
|---|---|
| `/account`, `/picks`, `/watchlist`, `/contribute`, `/report`, `/review`, `/review/reports`, `/review/forum` | signed-in features: the page is a shell, but it is only meant for a signed-in visitor, it carries a sign-in prompt, and the review pages are for editors; keeping them out of shared caches avoids any chance of one visitor's state ever being kept |
| `/boxers?q=`, `/ask?q=`, any URL with a search or free-text query (`hasSearchQuery`) | search results are not pages to share; they spend the per-visitor question budget and send `X-Robots-Tag: noindex` already; unbounded keys fill a cache with one-off entries |
| `not-found` (any 404), `/[locale]/[...rest]` | reads `x-pathname`, answers a different status; cache nothing that is not a 200 |
| `/api/account/*`, `/api/picks`, `/api/watch`, `/api/watch/digest`, `/api/contribute`, `/api/report`, `/api/review/*`, `/api/forum/*`, `/api/ask`, `/api/scout/[slug]`, `/api/preview/[id]`, `/api/health` | session, cookies and writes (`Set-Cookie` on sign-in and sign-out), per-visitor limits, model calls, or a probe that must never be a cached answer |
| `/api/search`, `/api/fighters` | read-only but query-keyed typeahead; not worth a cache entry per keystroke |
| any request with a cookie, an `Authorization` header, or an `rsc` header/`_rsc` query | bypass the cache, whatever the path |

If option 1 is built, the enforcement test belongs next to the rule: a test that lists every route under `app/`, requires each to be in one of the two tables above, and fails if a route in the second table is ever given a shared-cache `Cache-Control` or a route outside both tables appears. That test was not written here because nothing in the repository sends a cacheable header.

## Headers for the cacheable pages (proposal, not built)

`Cache-Control: public, max-age=60, s-maxage=300, stale-while-revalidate=600` is a reasonable starting point and nothing here measured a better one. The data changes once a night (and `world_swapped` in the log says when the new world is shown, `docs/capacity.md`), so five minutes of staleness at the edge is invisible to a reader, and a purge after the nightly update (below) removes even that. `max-age=60` keeps a browser from asking again for a minute; `stale-while-revalidate=600` lets the edge answer at once while it fetches a fresh copy, which is what keeps the origin's 10-second world rebuild off the visitor. The forum and leaderboard should use a shorter `s-maxage` (30 s or less). `Vary` must stay `rsc, next-router-state-tree, next-router-prefetch, next-router-segment-prefetch, Accept-Encoding` and must not gain `Cookie`: that would make every signed-in visitor a separate cache entry, or a CDN refuse to cache. A page must not send `Set-Cookie` (none does for an anonymous visitor).

## After a data update

The origin does not expose a data version today: `/api/health` reports `data.updatedAt` (the time of the last update), the counts and `stale`, and is `no-store`. For an operator or a CDN rule that is enough to poll, or to key a purge on: when `data.updatedAt` changes, purge the pages. A generic recipe, with no vendor call:

1. After the nightly update has finished and `/api/health` shows a new `data.updatedAt`, purge by URL prefix or by tag, whichever the CDN supports (the pages are not tagged today; a `Cache-Tag` or `Surrogate-Key: ringside-pages` header added at the edge on the cacheable block is enough, one tag for all pages, since an update changes the rankings that appear on most of them).
2. Do not purge the static files (`/_next/static`, immutable and content-hashed) or the portraits and share images.
3. If nothing purges, the short `s-maxage` is the fallback: the longest a reader can see old data after an update is `max-age + s-maxage + stale-while-revalidate`, ten and a half minutes with the numbers above (the stale-while-revalidate window only serves old data while a refresh runs).

A `dbVersion` in `/api/health` and an `ETag` on pages would make a purge unnecessary for a CDN that revalidates; neither was added, because nothing sends a cacheable header yet.

## What the owner needs to decide

1. Whether to build option 1 (edge nonce rewrite, no weakening). It needs edge compute and a vendor; it needs the enforcement and nonce-rewrite tests above; it changes nothing visitors see.
2. Or whether to stay as today (pages not cached) and rely on a CDN for static files, images and sitemaps, with the origin sized by `docs/capacity.md`.
3. Option 3 (weaker policy) only if the owner wants it, knowingly.

Not done in this round, because the brief said to stop when hash-based CSP was not safe: any change to `proxy.ts`, `lib/security.ts`, `next.config.ts` or the layout; the route test; the purge script; the `Cache-Control` change. The existing rule stands: **the proxy in front must overwrite `X-Forwarded-For`, not append** (`docs/deploy.md`, `docs/security-review.md` item A), and that holds with or without a cache, because a cache in front makes every origin request come from the cache's address.

## Reproduce

```
npm run build
DATABASE_PATH=/tmp/demo.db ACCOUNTS_DB_PATH=/tmp/acc.db SITE_URL=https://example.test INDEXABLE=1 npx next start -p 3600
curl -s localhost:3600/boxers | grep -o '<script[^>]*>' | sort | uniq -c       # three inline scripts, all with the nonce
curl -s localhost:3600/boxers/<slug> | wc -c                                   # the flight payload is most of it
```

For the browser trial: load a page with Playwright (`scripts/a11y-run.ts` shows how this repository finds it and the browser), intercept the document with `page.route`, remove ` nonce="..."` from the body, set a `Content-Security-Policy` of `default-src 'self'; script-src 'self' 'sha256-...'`, and read the `console` messages and whether `#main` has a `__reactFiber...` key.
