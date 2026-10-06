# Arabic review

Every Arabic string on the site was written by a machine (Claude). This is how a native speaker reviews it, and how the site keeps track of what a person has and has not checked.

## The rule
**A string is "reviewed" only when a person approved or edited it through the review sheet.** `i18n/ar.review.json` records who, when, and a hash of the exact Arabic they saw. If the Arabic is changed afterwards (by anyone, including a later machine pass) the hash stops matching and the string goes back to *changed since review*. Nothing is ever marked reviewed by a script, and the data page (`/data`, "Arabic review") shows the live counts to readers.

## Running a review
1. **Build the sheet.** `npm run i18n:review -- export` writes `review/arabic-review.html` (about 500 KB, one file, works offline, loads nothing from the web). `review/` is not committed.
2. **Send it** to the reviewer. They open it in any browser. Their progress is saved in that browser as they go, and they can stop and continue later.
3. **They work through it.** For each string: *Looks right*, edit the Arabic in place, or *Needs discussion* (with a note). Strings are ordered most-seen first (navigation, home, fighter pages) and can be filtered by page, by status, by "has a red check", and searched in either language. There are also tabs for *Questions for you* (decisions that need a native judgement: Latin abbreviations, register, gender, plural forms, boxing terms, name conventions), *Terminology* (the agreed Arabic for each boxing term, editable, with the strings that do not seem to use it) and *Names* (1,848 Arabic spellings of names).
4. **They press "Download my review"** and send back one JSON file. They do not have to finish: whatever they did not touch simply stays machine-written.
5. **Import it:** `npm run i18n:review -- import path/to/their-file.json`. The file is validated first. An edit is rejected, one string at a time, if its `{placeholders}` or `<tags>` differ from the English, a plural form is missing or empty, or the text is empty; everything else goes in. Approved and edited strings are recorded in `ar.review.json`, edits go into `ar.json`, flagged strings are listed with the reviewer's note, glossary changes update `i18n/glossary.json` (and the strings still using the old wording are printed), names are stored as reviewed in `name_translations` (edited ones get source `editor`), and the reviewer's answers to the questions are saved under `review/`.
6. `npm run i18n:extract` is not needed (no keys changed); commit `i18n/ar.json`, `i18n/ar.review.json` and `i18n/glossary.json`.

Other commands: `npm run i18n:review -- status` (counts by page, and names) and `-- qa` (the mechanical checks, below).

## What the automatic checks do and do not do
`lib/i18n/review.ts` checks every string for: placeholders and tags that differ from the English, empty or missing plural forms, Latin words left in Arabic text (brands, abbreviations, code paths and setting names are allowed), Arabic-Indic digits (the site uses 0-9), Latin punctuation between Arabic words, spacing slips, a tatweel inside a word, text identical to the English, an implausible length, numbers that vanished, gendered English (he/she) and glossary terms that seem absent. Red findings are probably wrong; gold ones are notes and often fine. **They find slips, not quality.** They cannot tell whether the Arabic sounds like a Saudi sports desk. That is what the reviewer is for.

On the first run over all 1,533 strings: one hard check (a Latin statistics term, "Brier", left in a sentence), 78 notes (25 gendered pairs, which were read and are correct; the rest glossary and number notes). A skim of 40 random strings found one real defect, a clause ("after 2015") dropped from a translated example, which was fixed. Spot checks are not a review.

## Names
Fighter, trainer, gym, event, venue and city names are kept in the committed file `i18n/names.ar.json` and loaded into the `name_translations` table whenever the database opens (see `docs/i18n.md`). The sheet's *Names* tab reads that file; names a reviewer approves or edits are written back to it by the import, with the review flag, so reviewed names survive a rebuilt database and show up in a diff. Most current names belong to fictional demo fighters, so reviewing them is low value until real data arrives.

## A first pass of an hour: `--first N`
The full sheet is 2,300 strings and 1,800 names, which is too much to ask of a volunteer. `npm run i18n:review -- export review/arabic-review-first-150.html --first 150` builds a sheet of only the 150 most-seen strings (navigation, header, footer, home page, the top of fighter pages; strings that are the English unchanged, like `{date} · {city}`, are left out) with no names tab (`--names` adds it). Its build tag is the full sheet's, so the file a reviewer sends back imports exactly like any other, and what they did not see stays machine-written. `docs/arabic-reviewer-brief.md` is the message to send with it.

## Where to start

`docs/arabic-review-queue.md` lists the strings written most recently, grouped by page, with their Arabic beside the English: the part a reader meets first and that no person has seen. It is a snapshot (dated in its title), regenerated from `i18n/keys.json` against an earlier state; the offline sheet from `npm run i18n:review -- export` is always the complete, current set.
