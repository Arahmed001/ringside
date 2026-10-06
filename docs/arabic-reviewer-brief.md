# Arabic review: the message to send to a reviewer

Written 2026-10-06. Send this with the file `arabic-review-first-150.html` (build it with `npm run i18n:review -- export review/arabic-review-first-150.html --first 150`; `review/` is not committed). Change the first line to your own words and name.

---

**Subject: One hour of Arabic proofreading for a boxing statistics website**

Hello,

I'm building Ringside, a boxing statistics site (ratings, rankings, fighter pages and fight previews) with an Arabic version for Saudi and Gulf readers. All of the Arabic was written by a machine, and no person has read it yet. I'd be grateful for about an hour of your time, from someone who reads Arabic natively and ideally follows sport.

**What you have.** One file, `arabic-review-first-150.html`. Double-click it and it opens in your browser. It works offline and sends nothing anywhere. It holds the 150 pieces of text readers see first: the menus, the header and footer, the home page and the top of a fighter's page.

**What to do.** For each one, you see the English and the Arabic:
- if it reads naturally to you, press **Looks right**;
- if it needs changing, type the better Arabic into the box;
- if you're unsure, press **Needs discussion** and add a short note.
You can stop and come back: the sheet remembers where you were, in that browser.

**What I'm after.**
- Does it sound like something an Arabic sports writer would write, or like a translation?
- Is the register right: clear modern standard Arabic, not stiff and not colloquial?
- Are the boxing terms the ones fans use? (See the "Terminology" tab. I'd especially like to know about ساوثباو and ستاندرد for southpaw and orthodox, and whether the usual abbreviations, KO and Elo, should stay in Latin letters.)
- Where the English says "he" or "she", the Arabic is meant to work for either. Is that natural, or awkward?

The words in curly brackets, such as `{name}` or `{n}`, are filled in by the site. Please leave them exactly as they are; the sheet warns you if one goes missing.

**What to send back.** Press **Download my review** at the top and email me the one small file it gives you. You don't need to finish all 150: anything you don't touch simply stays as it is.

Thank you. If you'd like to do more later, there is a longer version with the other 2,000 or so strings and a list of names, and I'd be happy to credit you on the site if you want that.

[Your name]

---

## For you, once the file comes back
1. `npm run i18n:review -- import path/to/their-file.json`: it checks every edit (a lost placeholder or an empty plural form is rejected, one string at a time) and reports what it applied.
2. Commit `i18n/ar.json`, `i18n/ar.review.json` and `i18n/glossary.json`.
3. `npm run i18n:review -- status` shows what is reviewed. A string counts as reviewed only when a person approved or edited it through the sheet.
4. Their answers to the questions go in the file too (`review/answers-*`): read them before the next batch, since one answer (say, abbreviations in Arabic) can change many strings.

## What to expect
- 150 strings is about an hour for someone who reads quickly; 2,326 is several evenings. The full sheet (`npm run i18n:review -- export`) is for a reviewer who has offered more time; the 1,848 names are a separate job for someone who knows how fighters' names are written in Arabic.
- Four strings carry a mechanical check for the reviewer to judge (`npm run i18n:review -- qa`): two that join a letter to a number with a kashida ("بـ ⁦8+⁩ رطل"), which looks intended, and two that leave the statistics terms "log-loss" and "Brier" in Latin letters, which is a real question for the reviewer. Another 103 carry a note (25 he/she pairs, the rest glossary words), which is information, not a fault. They are in the sheet like any other string.
