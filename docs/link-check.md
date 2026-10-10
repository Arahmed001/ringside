# Checking the site's links

`npm run check:links` follows the links of a running copy of the site and says which ones are wrong. It reads pages exactly as a visitor's browser would receive them (no script runs), so it answers: *does every link on the site lead to a real page, in the right language, and to the part of the page it names?*

```
npm run check:links -- https://ringsidedb.fly.dev --external     the live site, politely
npm run check:links -- http://localhost:3000 --fast              your own copy, as fast as it goes
```

| Option | Meaning |
|---|---|
| `--per 6` | how many pages of each kind it reads (fighters, events, titles, ...); every link found on them is still checked |
| `--languages en,ar` | which languages to start from |
| `--delay 150` | milliseconds each worker waits before a request (default 150) |
| `--concurrency 2` | requests at a time (default 2); `--fast` is 8 at a time with no pause, for your own copy only |
| `--external` | also ask each outside address (the official ranking bodies, Google Maps) |
| `--json report.json` | write every finding to a file |

**Be polite to the live site.** The defaults are two requests at a time with a pause; a full run is a few thousand page requests and takes ten minutes or more on the live site. It sends an honest `User-Agent` (`RingsideLinkCheck/1.0`), only ever GETs, and never submits a form. Do not run it during the nightly job (03:30 UTC), and do not raise `--concurrency` against the live site.

## What it reports

| Kind | Meaning | Fails the run |
|---|---|---|
| **broken** | the address does not answer 200 (404, 500, no answer) | yes |
| **redirected** | the link is answered with a redirect: it should point at the final address | yes |
| **language** | a page in one language links to a page in the other (the language switch is the one allowed link) | yes |
| **section** | a `#section` link whose section is not on that page | yes |
| **unnamed** | a link a screen reader would announce as nothing (a link with an `aria-label` or `title` has a name; a deliberately hidden one, such as a dot on the map, is not counted) | yes |
| **external** | with `--external`: an outside address that does not answer (a 403 is often a site refusing automated visitors: open it in a browser) | yes |
| **review** | the link's words share nothing with the heading of the page it leads to (for a person to glance at: a filter chip and a "View all" often do not) | no |

The exit code is 1 when anything but "review" is found, so it can sit in a deploy checklist. The rules are in `lib/link-check.ts` and tested in `tests/link-check.test.ts`.

## What it cannot tell you

- It cannot judge whether a link's *meaning* is right, only that its words and its destination's heading are not unrelated. Read the "review" lines.
- It reads only a few pages of each kind (`--per`), so a mistake that only one particular fighter's page has can be missed. Raise `--per` on your own copy to read more.
- It does not run page script, so a link a script adds after loading is not seen.
- A page that needs a sign-in is read as a signed-out visitor sees it.

## When to run it

After a change that moves, renames or restructures pages or navigation, and after a deploy that changes the home page. The result of the first full run, on the demo data and on the live site, is in the project history (PLAN.md section 301).
