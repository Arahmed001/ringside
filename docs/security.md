# Security headers and the content security policy

What the browser is told about every response, why, and how it is checked. (The account system's own protections, such as password hashing, CSRF checks and rate limits, are in `docs/accounts.md`.)

## What is sent

| Header | Value | Why |
|---|---|---|
| `Content-Security-Policy` | built per page in `proxy.ts` (`lib/security.ts`), with a fresh nonce | a script injected into a page, through a bug in how we show someone's text, does not run: only scripts with this response's nonce do, and the ones they load (`strict-dynamic`) |
| `X-Frame-Options: DENY` (and `frame-ancestors 'none'`) | | the site cannot be framed, so it cannot be used for click-jacking |
| `X-Content-Type-Options: nosniff` | | a response is only ever treated as the type it says it is |
| `Referrer-Policy: strict-origin-when-cross-origin` | | outbound links carry the site, not the page, so a fighter page or a search is not leaked to a source link |
| `Permissions-Policy` | camera, microphone, geolocation, payment, usb, topics off | the site uses none of them |
| `Cross-Origin-Opener-Policy: same-origin` | | a window opened from here cannot reach back into the page |
| `Strict-Transport-Security: max-age=31536000` | only when the site is served over https (`SITE_URL` or `X-Forwarded-Proto`) | no `includeSubDomains` or `preload`: those are commitments about domains this app does not know |
| (no `X-Powered-By`) | | the framework is not announced |

## The policy, and what it deliberately allows

`default-src 'self'`; scripts: this origin plus the nonce plus `strict-dynamic`, **never** `unsafe-inline` or `unsafe-eval` in production; styles: this origin plus the nonce; `img-src 'self' data: blob: https:` (licensed headshots come from Wikimedia Commons or a vendor's CDN); fonts and connections: this origin; no objects, no media, no `<base>`, forms post only to this origin, no framing, `upgrade-insecure-requests` over https.

Two concessions, stated plainly: `style-src-attr 'unsafe-inline'`, because charts, posters and bars set `style="..."` on elements and an attribute cannot carry a nonce (style *elements* still need the nonce); and `img-src https:` for the photo hosts. In **development** only, `unsafe-eval`, websockets and inline styles are allowed (React's debugging, hot reload and Next's error overlay need them).

## Rules for writing code under it

- No inline `<script>` without the nonce. The layout reads it (`headers().get("x-nonce")`) and passes it to `InlineScript`; a JSON-LD block (`type="application/ld+json"`) is data and needs none. A test scans `app/` and `components/` for any other inline script or inline event handler string.
- The proxy also sets an `x-pathname` request header (the path asked for) for the not-found page, which uses it to offer the fighter a mistyped link probably meant. It is overwritten on every request, so a visitor cannot choose it; the page shows names from the database only, and only letters, digits and spaces of the slug reach the search (`lib/not-found.ts`).
- No `onclick="..."` strings or `javascript:` links; use React handlers.
- A new third-party origin (analytics, an embed, a font host) needs a deliberate change to `lib/security.ts` and a line in this file saying why. Nothing third-party is loaded today.
- Pages must stay dynamically rendered (the root layout is `force-dynamic`): a nonce cannot be baked into a page at build time.
- A hash-based policy (so a CDN could cache pages) was evaluated in round 131 and **not adopted**: Next 16.3.8 puts each page's data in an inline script that differs per page, a hash of it can only be computed from the rendered page, and a policy built that way would also approve a script injected into that page. The policy above is unchanged; the findings and the safe alternative (a fresh nonce written by the edge) are in `docs/cdn.md`.

## How it is checked

- `tests/security.test.ts` (7): the policy for production and development, nonces fresh and well-formed, the proxy (a new nonce each request, passed to the page, HSTS only over https, the language rewrite and the 308 untouched), the standing headers on every route, `securityProblems` on good and bad responses, and a source scan. Nine mutations were made on purpose (no response policy, no nonce passed to the page, a constant nonce, HSTS over http, `unsafe-inline` in scripts, the layout dropping the nonce, the framework announced, framing allowed, and a header missing) and each fails a test.
- `npm run smoke` runs `securityProblems` on every page in both languages (a missing header, a policy without this response's nonce, an inline script without it, an inline handler) and the standing headers on every API response.
- By hand on a production build in a browser: the site hydrates (rail toggle, client navigation, the command palette), signing up and the account page work, 95 images load, 6 fonts load, and a `securitypolicyviolation` listener saw nothing. The policy is really enforced there: an injected style element and an inline `onerror` handler were both blocked.

## Dependencies

`npm audit --omit=dev` (what CI gates on, at `high`) reports 0. `npm audit` including development tools reports 5 high advisories, all one chain: `braces` (a stack-exhaustion bug in glob patterns) reached through `eslint-config-next`. That affects the linter on a developer's machine, not the running site; the only offered fix is downgrading `eslint-config-next` to a version that does not match Next 16, so it is left alone and re-checked each time `eslint-config-next` is updated.

## Not covered

No web application firewall, no bot or DoS protection beyond the application's own limits (`docs/accounts.md`), no `Cross-Origin-Resource-Policy`/`COEP` (images and share cards are meant to be embedded by crawlers and previews), no CSP violation reporting endpoint (add `report-to` only with somewhere to read the reports), no automated scanner (such as ZAP) has been run against it, and the policy has been tried in Chrome only.
