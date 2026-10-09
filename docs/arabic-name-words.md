# Arabic for the words in fighters' names

On the real data only 1,030 of 33,614 fighters have an Arabic name, and 91.8% of fight appearances belong to fighters without one. Writing 32,584 whole names for review is not realistic, but their names are made of about 29,900 distinct words, and the commonest of those cover most of them (measured 2026-10-09): the top 1,000 words complete the names of 5,375 fighters, the top 3,000 about 9,500, the top 12,000 about 18,300.

So names are reviewed **a word at a time** and written to the page by joining the words.

## The rule
- `i18n/name-words.ar.json` holds one Arabic spelling per word, each with `source` and `reviewed`.
- A word is `reviewed` only when a person approved or edited it through the review sheet and the import recorded it (`source: "reviewer"`). A machine suggestion (`source: "claude-session"`) stays in the file for the reviewer to see and **is never shown on a page**.
- A fighter or person gets a composed Arabic name only if **every** word of the name is reviewed. Otherwise the English name stays, as it does today.
- A whole name in `i18n/names.ar.json` (or from Wikidata) always wins over a composed one.
- A single-word name is never composed; it is reviewed as a whole name.
- Words are keyed by the exact token (`Jr.` and `Jr` are two words; `De`, `de` and `la` are too), so particles and suffixes are reviewed like any other word.

## Doing a round of review
1. `DATABASE_PATH=path/to/real.db npm run i18n:words -- todo 1000` lists the most useful words first, and says how many fighters each completes.
2. `npm run i18n:words -- suggest file.json` stores machine suggestions for words that have none (`{ "Word": "Arabic" }`). A reviewed word is never overwritten, and a suggestion with Latin letters left in is refused. The first 3,000 words (ranked 2026-10-09, covering about 9,500 fighters once reviewed) already carry suggestions in the file.
3. `DATABASE_PATH=… npm run i18n:words -- export` writes `review/name-words-review.html`: one offline file, loads nothing from the web, progress kept in the browser. For each word the reviewer presses *Looks right*, edits the Arabic, or skips. *Download my review* gives one JSON file.
4. `npm run i18n:words -- import their-file.json` marks approved words reviewed (and edited ones with `source: "reviewer"`). Commit `i18n/name-words.ar.json`.
5. `DATABASE_PATH=… npm run i18n:words -- status` shows how many fighters now have an Arabic name on a page.

The site reads the words file when the names table is built (`lib/i18n/names.ts`), so a new reviewed word shows after a restart.

## What to watch
- A word has one Arabic spelling, but one English spelling can be two names (Spanish `Jose` and English `Joe`; Korean `Lee` and English `Lee`). Review the commonest by what most fighters carrying it are.
- Names in other scripts or from languages the suggestions handle less well (Tanzanian, Indian, Kazakh, Ghanaian names are over-represented among the missing) are best checked by a reader who knows the origin; the sheet's search box finds a word fast.
- The ranking leaves out words in names that already have an Arabic name, so it shrinks as whole names are added.
