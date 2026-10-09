# The Ringside operator handbook

This is the one page to keep open when you run the site. It does not replace the detailed documents. It tells you what is true, what to do and when, and which document has the detail. It is written for a project manager, not an engineer: short steps, and after each one what you should see. If you do not see it, stop and ask Claude before the next step.

Everything here was read from the repository's own documents and code. Where two documents disagreed, section 8 says so and says which one is right.

Contents: [1 What Ringside is](#1-what-ringside-is-and-what-runs-where) · [2 Timeline](#2-the-life-of-the-site-on-one-page) · [3 Checklists](#3-the-checklists) · [4 If X happens, do Y](#4-if-x-happens-do-y) · [5 Decisions still open](#5-decisions-still-open) · [6 Who can do what](#6-who-can-do-what) · [7 Every setting](#7-every-setting-that-matters) · [8 Doc fixes](#8-doc-fixes-needed)

## Words used here (read once)

| Word | What it means |
|---|---|
| **Host** | The company or server that keeps the site running. Not chosen yet. |
| **Container** | The packed-up copy of the site the host runs. Built from the `Dockerfile`. Called `ringside` in every command below; if yours has another name, use that. |
| **Volume** | The permanent disk the data lives on, mounted at `/data`. Without one, every restart wipes the data. |
| **Terminal / console** | A window where you type a command. Most hosts have a "Console" or "Shell" button on the site's page. |
| **Setting** | A named value the site reads when it starts, such as `SITE_URL`. Also called an environment variable. Section 7 lists them all. Change one in the host's settings screen, then restart. |
| **Secret** | A setting that must never be shown, pasted in chat, or saved in the repository. Put it only in the host's secrets screen (or the hidden prompt of `--setup`). |
| **Vendor** | The company whose data fills the site: Boxing Data API, sold through RapidAPI. |
| **Statement flag** | A setting that is *your statement* that something is allowed, for example that the vendor said in writing that we may store its data. The site never sets one for you. Set one only when it is true, and keep the proof. |
| **Nightly update** | The job that fetches the last two weeks of fights and the coming weeks from the vendor once a day. |
| **Cron** | The clock on a machine that starts a job at a set time every day. |
| **Backup** | A safe, checked copy of the two data files. **Restore** puts one back. |
| **Doctor** | `npm run doctor`: a check that prints problems with the fix beside each. |
| **Health check** | The page `/api/health`. It says whether the site is up, how many fighters it holds and whether the nightly update has stopped. |
| **Stale** | The data is more than two days old, so the nightly update has probably stopped. The pages still work and say nothing; only the health check tells you. |
| **Uptime monitor** | An outside service that opens a page every few minutes and emails you if it fails or contains certain text. |
| **Editor / admin** | A signed-in account that may review corrections, community edits and forum reports. Nobody is one until you make them one. An admin may also handle "About me" requests. |
| **Wikidata, Wikimedia Commons** | Free public sources the site reads by hand (not on page views) for Arabic names, birth details, honours and freely licensed photos. |
| **Exit code** | The number a command ends with. 0 means it worked. The nightly update uses 2, 3 and 75 for different kinds of trouble (section 4). |
| **Rollback** | Going back to the previous version of the site after a bad update. |
| **CDN** | A service in front of the site that keeps copies of files near visitors. |
| **Claude** | The AI assistant that writes and tests the code and these documents. It cannot log in to your accounts (section 6). |

## 1. What Ringside is, and what runs where

Ringside is a boxing database: fighters, fights, events, ratings, rankings and win predictions, in English and Arabic. It is one program with one set of data files. The picture in words:

- **The site.** One container running one copy of one program. It must be exactly one copy: two copies would each keep their own data and drift apart. It needs 2 GB of memory and 2 processor cores (`docs/capacity.md`). It holds all fights in memory, so pages are fast, and it never asks the vendor for anything while a visitor waits.
- **The two data files**, both on the volume at `/data`:
  - `ringside.db`: the fighters, fights, events and ratings, **and the live ledger**, the list of predictions the site made before fights. The ledger cannot be rebuilt after the fact.
  - `accounts.db`: people's accounts, picks, watchlists, forum posts, community edits and corrections. It is **personal data**: private, never in the repository, never in the container image.
  - Beside them: `model-fit.json` (the fitted prediction model), `backups/` (the safe copies) and, if you keep it there, `vendor-cache/` (every vendor answer, as received).
- **The vendor** (Boxing Data API). Supplies fights, fighters and events, and, if you allow it, the official IBF, WBA, WBC and WBO lists. The Mega plan allows 500 requests an hour, so the first full fetch of about 35,000 fighters takes days. The vendor confirmed to you in writing that its data may be stored (2026-10-03). Keep that message.
- **The nightly update.** Once a day a job on the same machine asks the vendor for recent and coming fights and writes them into `ringside.db` in one step: all of a night or none. The site notices the change and rebuilds in the background, with no restart. If the job stops, the site keeps showing the last results and says nothing.
- **Wikidata, Wikipedia and Wikimedia Commons.** Run by hand (`npm run vendor:enrich`), not on page views. They add Arabic names, birth details, honours, belt and venue pictures and fighter photos, each with its licence and credit. Wikimedia asks you to identify yourself, so `WIKIMEDIA_CONTACT` is required.
- **Headlines, videos and chosen posts.** `npm run news:refresh` (by hand, or `NEWS_REFRESH=1` in the nightly job) reads the boxing outlets' public feeds and the official channels (with your YouTube key) and keeps a title, a date and a link for each, never a body or an image. Editors choose specific posts at `/review/social`. A visitor's browser contacts YouTube, X, Reddit, Instagram or Facebook only when they press the button for a post (`docs/news.md`).
- **Recorded pictures.** An editor records a fighter's photo with its licence or the rights-holder's permission at `/review/photos`; it shows with its credit. After a reload, `npm run photos:apply` puts them back (`docs/photo-permissions.md`).
- **Backups.** `npm run backup` takes a checked copy of both data files while the site runs. Fourteen are kept. **A backup on the same disk is not a backup**: you copy the newest folder somewhere else.
- **The AI key** (`ANTHROPIC_API_KEY`, optional). Powers plain-English search, scouting reports, fight previews and `/ask`. Without it, or when it fails or runs out, everything falls back to built-in rules: plainer text, nothing broken. A daily call limit protects the bill.
- **The host.** Runs the container, the volume, https and the front door (a proxy). It must keep one copy only, give the volume, pass on each visitor's real address (`X-Forwarded-For`, overwritten, not appended) and not publish the container's own port. `docs/deploy.md` has the technical detail.
- **Watching it.** The health check, `npm run doctor`, the nightly job's log and an uptime monitor.

Where the first load happens: today's documents describe the first load on **your own computer** (key file `~/.ringside-key`, data in `~/ringside-real/`), and the public site on a **host**. No document yet says how the loaded database gets onto the host's volume. See section 5, decision 7.

## 2. The life of the site on one page

| When | What happens | Detail |
|---|---|---|
| **Before launch** | Choose a host. Subscribe to the vendor's full-history plan. Send the vendor questions (rankings, other sites using the data) and read the answers. Have the Terms, Privacy and forum rules read by someone who can advise on the law. Pick `SITE_URL` and a role mailbox for `SITE_CONTACT`. | [host-guide.md](host-guide.md), [deploy.md](deploy.md), [boxing-data-api-vendor-email.md](boxing-data-api-vendor-email.md), [rankings-decision.md](rankings-decision.md), [launch-pages.md](launch-pages.md), [forum.md](forum.md) |
| **Load day** (days of fetching, then an hour of checking) | Save the key. Fetch the league at the plan's pace. Dry-run the load, load it, audit it, look at it. Add Arabic names and photos. Check ten fighters you know. | [load-day.md](load-day.md), [real-data-runbook.md](real-data-runbook.md) |
| **Launch day** | Back up. Put the version on the host with the real settings. Run the checks. Run the doctor. Turn on the monitor. Schedule the nightly update and the backups. | [go-live.md](go-live.md) sections 2 to 4 and 6 |
| **First week** | Look at the health check every day. Confirm the nightly job ran on three nights in a row. Confirm a backup reached somewhere that is not the host. Rehearse a restore (dry run). Make at least one editor. Read the first reports. | [update-failure-modes.md](update-failure-modes.md), [go-live.md](go-live.md) section 5, [forum.md](forum.md) |
| **Ongoing** | Daily 30 seconds. Weekly 5 minutes. Monthly an hour. Answer the vendor, visitors' corrections and removal requests. Update the site from `main` with a backup first. | Section 3 below, [go-live.md](go-live.md), [capacity.md](capacity.md) |
| **When a change is wanted** | Ask Claude; it changes the code, tests it and opens a pull request for you to read. | Section 6 |

## 3. The checklists

Tick each box only when it is true, not when it is planned.

### 3a. Pre-launch: what must be true

**Host and address**

- [ ] A host is chosen and written down (name, login). It gives a permanent disk at `/data`, runs exactly one copy, has 2 GB of memory and 2 processor cores, and puts the site on https. Choosing: [host-guide.md](host-guide.md). The decision is section 5, decision 3.
- [ ] The host's front door overwrites `X-Forwarded-For` with the visitor's address and the container's own port is not open to the internet. Why: the sign-in and AI limits are keyed on that address. [deploy.md](deploy.md), "Putting it on the internet".
- [ ] `SITE_URL` is the public https address, with nothing after the host name (for example `https://ringside.example`).
- [ ] `SITE_CONTACT` is a shared mailbox you read daily (for example `corrections@...`), never a personal one. It is printed on the Data and Report pages.

**The vendor, in writing.** These four settings are *your statement that the vendor allows it*. The site never sets them for you. Set one only when you hold the vendor's written answer, and keep the message where you can find it.

| Setting | Your statement | Proof to hold | If you do not set it |
|---|---|---|---|
| `BOXING_API_STORAGE_CONFIRMED=1` | The vendor said in writing that we may **store** its data. | The vendor's message of 2026-10-03. (`=0` refuses to store at all.) | Storing is "provisional": it works and every run says so. |
| `VENDOR_RANKINGS_CONFIRMED=1` | The vendor said in writing that we may **store and show the sanctioning bodies' official lists** (BoxingScene is their source) and told us what credit to give. | A written answer to the rankings question. The email is drafted in [boxing-data-api-vendor-email.md](boxing-data-api-vendor-email.md) and was **not sent** as of 2026-10-05. | The lists are never fetched or shown. Ringside's own rating is the ranking. |
| `PUBLIC_API=1` **and** `VENDOR_REDISTRIBUTION_CONFIRMED=1` | The vendor said in writing that **other sites may receive its data** through our public API and embeds. | A written answer. **No drafted email asks this question yet** (section 8). | The public API and embeds are off for real data. |

- [ ] The vendor plan with the full history is subscribed; the request allowance is known (Mega: 500 an hour, 500,000 a month).
- [ ] The vendor's answer on the rankings is read, and `VENDOR_RANKINGS_CONFIRMED` is set only if the answer is yes. [rankings-decision.md](rankings-decision.md) says what to do for yes, no, "some of it" and silence. **Silence is no.**
- [ ] `VENDOR_TERMS_URL` is the vendor's public licence page (optional, but the Data page links it).

**Legal reading**

- [ ] Someone who can advise on the law where the site is run has read `/terms`, `/privacy` and `/forum/rules`. All three are plain-language drafts, not legal advice. The Arabic of all three is machine-written. [launch-pages.md](launch-pages.md), [forum.md](forum.md) ("Opening it to the public").
- [ ] You have decided how you answer a request from a fighter to change or remove details (section 5, decision 6).

**Data and checks**

- [ ] The real league is loaded, audited (`npm run vendor:audit`: no FAIL) and checked by hand on ten fighters you know ([load-day.md](load-day.md) steps 3 to 7).
- [ ] The doctor shows no failure lines (the command is in 3b, step 4).
- [ ] You know the site stays hidden from search engines until a real data source **and** a public `SITE_URL` are both set. The moment both are, the site invites search engines in. Set them last.

**Backups and watching**

- [ ] A backup is scheduled **daily**, each one is checked with `verify`, and the newest folder is copied **off the host** every day. [go-live.md](go-live.md) section 2.
- [ ] **One restore has been rehearsed** with `--dry-run` on the real host ([go-live.md](go-live.md) section 5, step 5 of section 2). It has never been run on a real host; the docs say so plainly.
- [ ] The nightly update is scheduled on the same machine as the data, and one run has been seen to finish. [load-day.md](load-day.md) step 8.
- [ ] An uptime monitor watches `https://your-address/api/health`, alerts on the text `"stale":true` and on no answer, and emails an address you read daily.
- [ ] At least one editor exists (section 4, "forum post reported") so reports and corrections have someone to review them.

**Optional**

- [ ] `ANTHROPIC_API_KEY` set in the host's secrets screen, and `AI_DAILY_BUDGET` chosen (default 1,000 calls a day, whole site).
- [ ] `WIKIMEDIA_CONTACT` known (needed only when you run the enrichment).

### 3b. Launch day

1. Back up and copy the folder off the host ([go-live.md](go-live.md) section 2).

   ```bash
   docker exec ringside npm run backup
   ```

   You should see `backup written to /data/backups/<date and time>` and two lines ending `integrity ok`.
2. Put the settings in the host's secrets screen. Set `SITE_URL` last.
3. Deploy the version from `main` ([go-live.md](go-live.md) section 3). Keep the previous version available.
4. Check, in order ([go-live.md](go-live.md) section 4): `/api/health` shows `"status":"ok"`; `/` and `/ar` load; `/tour` plays; a test account can star a fighter and see it again after sign-out and sign-in. Then:

   ```bash
   docker exec ringside npm run doctor -- --production
   ```

   You should see no failure lines.
5. Open `/robots.txt` and `/sitemap.xml` in a browser. You should see a sitemap and no "disallow everything". If the site is still hidden, `SITE_URL` or the data source is not set as you meant.
6. Confirm the nightly update and the backup are in the host's schedule and the monitor is on.
7. Tell the vendor the page is public: the email you drafted promises them a credit and the page.
8. Stay near the screen for the first hours. If a check fails, roll back (section 4) and tell Claude exactly what you saw.

### 3c. Daily: 30 seconds

1. Open this page in a browser:

   ```
   https://your-address/api/health
   ```

   You should see `"status":"ok"`, the fighter and fight counts, and `"stale":false`.
2. Glance at your alert mailbox. No alert means the monitor saw nothing wrong.

That is all. If you see `"stale":true`, or the page does not answer, go to section 4.

### 3d. Weekly: 5 minutes

1. Run the doctor.

   ```bash
   docker exec ringside npm run doctor -- --production
   ```

   You should see no failure lines. Warnings are worth reading (a backup more than two days old, disk under 500 MB, a forum with posts and no editor).
2. Check that the newest backup is under two days old, that a copy is somewhere that is not the host, and that the copy is good.

   ```bash
   docker exec ringside npm run backup -- verify /data/backups/<newest folder>
   ```

   You should see `backup is good`.
3. Read the end of the nightly update's log: the file named after the `>>` in its cron line.

   ```bash
   tail -n 10 <that file>
   ```

   Look at the block headed `approximated or skipped:`. A number that is new, or suddenly large, means the vendor changed something. Send it to Claude.
4. Open `/review/reports` and `/review/forum` (signed in as an editor). Is anything waiting?
5. Disk: the doctor says how much is free. Under 500 MB is a warning; under 100 MB is a failure.

### 3e. Monthly: about an hour

1. Rehearse a restore, changing nothing ([go-live.md](go-live.md) section 5).

   ```bash
   docker exec ringside npm run backup -- restore /data/backups/<newest folder> --dry-run
   ```

   You should see `verifies (integrity and checksums)`. While the site runs you will then see `REFUSED: the site might be running, so nothing was changed`. That is the safety working and it proves the backup was read.
2. Delete `before-restore` folders you no longer need (the last 50 are kept).
3. Vendor: open the RapidAPI dashboard. Look at the plan, this month's requests (limit 500,000) and the key's status. Read any message from the vendor.
4. AI spend: look at the balance and usage in your Anthropic account. If the bill matters, lower `AI_DAILY_BUDGET`.
5. Host: the bill, the memory graph (the peak should stay under about 1.5 GB of 2 GB), the free disk, and, if you run a server yourself, the operating system and Docker updates.
6. Ask Claude to update the site's packages (`npm audit --omit=dev` must report 0 problems, see [security.md](security.md)), to refit the model (optional; no schedule is documented), and to report anything waiting in the pull-request queue.
7. Skim the Terms, Privacy and forum rules against what the site now does. If a feature was added, the wording may need a legal reading again.

## 4. If X happens, do Y

Find your case in the table, then follow its steps below it. When you are told to "send Claude the output", paste the **whole** output from the first line to the last, never a key. Commands run in the host's terminal unless it says otherwise.

| If this happens | Short answer | Steps |
|---|---|---|
| The site is down | Find out whether the container or the data is at fault; roll back or restore. | [4.1](#41-the-site-is-down) |
| `/api/health` says `"stale":true` | The nightly update has stopped. The site is fine; its results are old. | [4.2](#42-apihealth-says-staletrue) |
| The nightly update ends with exit code 2 | The vendor was unreachable or refused. Nothing written. Retry in an hour. | [4.3](#43-the-nightly-update-ended-with-a-non-zero-exit-code) |
| ...exit code 3 | A safety check refused the data. Nothing written. Needs a look. | [4.3](#43-the-nightly-update-ended-with-a-non-zero-exit-code) |
| ...exit code 75 | Another run holds the lock. Do nothing. | [4.3](#43-the-nightly-update-ended-with-a-non-zero-exit-code) |
| The vendor emails about terms | Save it, change nothing yet, tell Claude. Every switch is reversible. | [4.4](#44-the-vendor-emails-about-its-terms) |
| A visitor asks to remove their details | An account holder can delete their own account. A fighter's request is considered; promise no outcome. | [4.5](#45-a-visitor-asks-to-remove-their-details) |
| A forum post is reported, hidden or appealed | An editor decides in `/review/forum`. | [4.6](#46-a-forum-post-is-reported-hidden-or-appealed) |
| A visitor reports a wrong fact | An editor checks the source in `/review/reports`. | [4.7](#47-a-visitor-reports-a-wrong-fact-the-corrections-flow) |
| The disk is nearly full | Delete only copies already taken off the host, or grow the volume. | [4.8](#48-the-disk-is-nearly-full) |
| The container restarts, or memory hits the limit | 2 GB is the minimum. Use a bigger plan. | [4.9](#49-the-container-keeps-restarting-or-memory-hits-the-limit) |
| The AI key runs out or is wrong | Nothing breaks; the site uses its rules. Replace the key. | [4.10](#410-the-ai-key-runs-out-or-is-wrong) |
| Actions CI will not start | A GitHub account matter. Claude runs the same checks locally. | [4.11](#411-actions-ci-will-not-start) |
| After a bad update | Roll back; if the old version will not start, restore the pre-update backup. | [4.12](#412-after-a-bad-update-rollback) |
| You need to restore from a backup | Follow go-live section 5 exactly. | [4.13](#413-restore-from-a-backup) |
| The Arabic looks wrong | Send Claude the page and the fix. | [4.14](#414-the-arabic-looks-wrong) |
| A fighter's photo is wrong or unlicensed | Send Claude the page; there is no operator command yet. | [4.15](#415-a-fighters-photo-is-wrong-or-unlicensed) |

### 4.1 The site is down

1. Open `https://your-address/api/health` from your phone on mobile data. `{"status":"unavailable"}` with a 503 means the site is up but cannot read its data. No answer at all means the container or the host is down.
2. In the host's screen, is the container running? If not, start it. A start takes 12 to 16 seconds before it answers; the health check allows 120 seconds.
3. Read the last lines. Each error is one line of JSON containing `"level":"error"`.

   ```bash
   docker logs --tail 100 ringside
   ```

4. If the container will not stay up, run the doctor on its volume (use your volume's name if it is not `ringside-data`):

   ```bash
   docker run --rm -v ringside-data:/data ringside npm run doctor -- --production
   ```

   A line that starts `FAIL` says what is wrong and the fix beside it.
5. If it began right after an update, roll back (4.12). If the data file is damaged, restore (4.13). Send Claude the log lines either way.

Detail: [deploy.md](deploy.md) "When a page breaks".

### 4.2 `/api/health` says `"stale":true`

The nightly update has not worked for more than two days. The site is fine; its results are old. **Never restart the container for this; it does not help.**

1. Read the last lines of the log the nightly job writes to (the file named after the `>>` in its cron line).
2. Run the update by hand, once, with the same command as the cron line, and watch it. On a host that is:

   ```bash
   docker exec ringside npm run vendor:backfill -- --update --cache-dir /data/vendor-cache
   ```

   Its ending tells you what is wrong (4.3).
3. Open `/api/health` again. `"stale":false` and a new `updatedAt` mean it is fixed.
4. Check the machine's clock. A wrong clock can hide a dead job.

   ```bash
   date
   ```

Detail: [go-live.md](go-live.md) section 6.

### 4.3 The nightly update ended with a non-zero exit code

The number the command ends with says which kind of trouble. (PLAN.md section 224 added these.)

| Code | What it means | What you do |
|---|---|---|
| 0 | Done. | Nothing. |
| **2** | **The vendor was unreachable or refused.** The network was down, the vendor was down or sent an error, the key lapsed or is wrong (a 401 or 403), or a limit was hit (a 429: the hourly limit or the month's quota). Nothing was written. | Retry in an hour. If it repeats: a 403 means save a new key (`npm run vendor:fetch -- --setup` on a laptop, or the new key in the host's secrets). A quota message means look at the plan in the RapidAPI dashboard. An hourly limit usually means something else is using the same key. |
| **3** | **A safety check refused the data.** Nothing was written and the old data is intact. Typical causes: the checker found errors; a fighter could not be fetched so fights were left out; the vendor sent something that was not expected (a changed format) or no usable fights. | Read the message and the `approximated or skipped` block, run it once more by hand, and send Claude the whole output. Do not force it through. |
| **75** | **Another run already holds the lock** (you ran it by hand while the nightly job ran). Nothing is wrong. | Wait for the first to finish. Do nothing. |
| 1 | Anything else: a missing key, a bad option, a wrong clock, a backup folder that cannot be written, a database error such as "disk is full". | Read the words it printed. |
| 130 | The job was stopped (a cron timeout, Ctrl-C). Harmless. | Run it again. |
| 137 | The process was killed, most often because the machine ran out of memory. | See 4.9. |

The log's last line may say `update done, but N fight(s) skipped`. That is the vendor's data having something the importer left out. Read the block above it and send it to Claude if a number is new or large.

Detail: [update-failure-modes.md](update-failure-modes.md) (every failure that was injected, and what happens), [load-day.md](load-day.md) step 8.

### 4.4 The vendor emails about its terms

Do not reply with a promise and do not change anything yet. Save the email. Send it to Claude and say what it asks. The switches are reversible and take effect after a restart.

- **They say stop storing the data.** Set `BOXING_API_STORAGE_CONFIRMED=0`, then follow "Undoing it" in [real-data-runbook.md](real-data-runbook.md): stop the site; delete the cache, the real-league database file (with its `-wal` and `-shm`) and the backups folder beside it. The real league has its own file so that nothing else has to be untangled.
- **They say not the rankings.** Unset `VENDOR_RANKINGS_CONFIRMED`. The lists vanish from the pages at once. ([rankings-decision.md](rankings-decision.md))
- **They say not other sites.** Set `PUBLIC_API=0` and unset `VENDOR_REDISTRIBUTION_CONFIRMED`. ([public-api.md](public-api.md))
- **They want different credit.** Claude changes the wording; [vendor-credit.md](vendor-credit.md) lists the places.
- **A new price or plan.** Part of the monthly check, 3e.

### 4.5 A visitor asks to remove their details

**An account holder.** They can download everything and delete their account themselves on `/account` (their password is needed). Deleting removes the person, their picks, watchlist, sessions and forum words. Edits they proposed stay, with no name on them. If they forgot the password, make a one-time code, valid an hour, and tell them it:

```bash
docker exec ringside npm run accounts -- reset NAME
```

**A fighter, or someone for them.** Removal is deliberately not advertised. The Terms page says only that each request "is considered". Do not promise an outcome. Reply from `SITE_CONTACT` that the request will be considered, and keep the request and your answer. A signed-in "About me" report reaches only an admin. Ask Claude what can be done: today nothing hides a single fighter's birth date or photo; the options are written in [launch-pages.md](launch-pages.md) but not built.

Detail: [accounts.md](accounts.md) "Privacy", [launch-pages.md](launch-pages.md).

### 4.6 A forum post is reported, hidden or appealed

Sign in as an editor and open `/review/forum`. Reported posts come first, most reported first; an appeal is marked and sits on top.

- For a post: **Hide**, **Restore**, or **Dismiss** the reports.
- For an appeal: **Restore** it, or **Keep hidden**.
- Six different established members reporting a post hides it by itself until an editor looks. The author sees "Your post was hidden after reports from other members" and can ask once for a review. Every action is in the activity log with the editor's reason.

If nobody is an editor, make one now. The person signs up at `/account` first, then:

```bash
docker exec ringside npm run accounts -- role NAME editor
```

To stop an account that is abusing the forum:

```bash
docker exec ringside npm run accounts -- disable NAME
```

Detail: [forum.md](forum.md), [forum-security-review.md](forum-security-review.md).

### 4.7 A visitor reports a wrong fact (the corrections flow)

The visitor uses `/report` (signed in) or writes to `SITE_CONTACT`. Reports are a **private queue**: nothing appears on a page because someone reported it. An editor who is not the reporter opens `/review/reports` and reads the source.

- **Who is the source matters.** A fight's result is accepted only from a commission's or sanctioning body's own page. A fighter's details are accepted from the fighter's own page. Anything else can only be marked "noted", and the vendor's value stands.
- An accepted correction overrides the vendor and survives every nightly update. If the vendor later changes the same value, the correction is flagged "Look again" for an editor.
- A name misspelt or a record one fight short is "something else": an editor looks, nothing is applied.

Detail: [accounts.md](accounts.md) "Reporting a wrong fact, and corrections".

### 4.8 The disk is nearly full

The doctor warns under 500 MB free and fails under 100 MB. Disk is rarely the problem: the database for 35,000 fighters is about 62 MB, and the advice is a volume of 5 GB or more.

1. Find what is big.

   ```bash
   docker exec ringside du -sh /data/*
   ```

2. The usual causes are backups (each is a full copy of both files; 14 are kept), `before-restore` folders (the last 50) and the vendor cache (about 122 MB at full size). Delete only what you have already copied off the host. To keep fewer backups from now on:

   ```bash
   docker exec ringside npm run backup -- --keep 7
   ```

3. If the data itself is what grows, grow the volume. You can grow one but never shrink it.

A full disk during the nightly update is rolled back safely. Free space and run it again. Detail: [capacity.md](capacity.md) "Sizing recommendation", [update-failure-modes.md](update-failure-modes.md) section 5.

### 4.9 The container keeps restarting, or memory hits the limit

The site needs about 0.7 GB at start, 1.1 to 1.2 GB under load and about 1.4 GB at the moment a data update rebuilds its in-memory picture. **2 GB is the minimum.** 1 GB is not enough; 3 or 4 GB is safer.

- The nightly job is a second process (about 340 MB on a test league the size of the real one; the real figure is not measured). Run it in a quiet hour.
- Do not put a low memory cap on the program itself. In a test, a cap of 250 MB would not even start.
- A restart makes the health check fail for 12 to 16 seconds, so do not restart "to be safe".
- The fix is a bigger plan. Ask Claude to measure on the real host.

Detail: [capacity.md](capacity.md), [host-guide.md](host-guide.md).

### 4.10 The AI key runs out or is wrong

**Nothing breaks.** The site falls back to its built-in rules and pauses the model for a minute at a time, so a broken key costs no waiting. The server log shows `[ai] model call failed, using the built-in answers for a minute: <reason>`.

1. Open your Anthropic account. Add credit, or create a new key.
2. Put the new key in the host's secrets screen (never in chat) and restart.
3. To stop all model spending now, set `AI_DAILY_BUDGET=0`.

Detail: `lib/ai-guard.ts`, [features.md](features.md).

### 4.11 Actions CI will not start

If GitHub's jobs fail at once with no runner, it is a GitHub account matter, usually billing. Open the failed job: the message says why. You fix it in GitHub's account settings. It is not a bug in the code.

Meanwhile Claude runs the same checks on its own machine. It is one command that runs route types, type check, lint, translations, the data check, all the tests, the production build, six smoke runs and the audit of what ships:

```bash
npm run gate -- --fresh
```

Ask Claude to show you that output before you accept a change. Do not merge anything whose checks nobody has run. Detail: PLAN.md section 231.

### 4.12 After a bad update (rollback)

1. Use the host's "rollback" or "previous release" button, or redeploy the previous version.
2. Open `/api/health`. You should see `"status":"ok"`.
3. If the old version starts and works, you are done. A code rollback does not roll the data back, and an update does not delete data.
4. If the old version will not start or behaves oddly, the new version probably changed the data file's layout (a new start moves it forward, and an older version on a newer file is not supported). Then restore the backup you took before the update (4.13). This is why you back up first.

Detail: [go-live.md](go-live.md) sections 3 and 4, [deploy.md](deploy.md) "Updating".

### 4.13 Restore from a backup

Only when the current data is wrong or lost. It replaces the fight data and the accounts with the backup's. Anything added since (predictions, sign-ups, picks) is gone from the live site. The command first saves what is there, so it can be undone.

Follow [go-live.md](go-live.md) section 5 exactly. In short: verify the backup, stop the site, dry run, restore, check the counts, start the site, check `/api/health`. Copy down the `To undo` line it prints. A line starting `REFUSED` says why in plain words; nothing was changed.

### 4.14 The Arabic looks wrong

Every Arabic sentence was written by a machine, and the Data page says how much a person has reviewed. Send Claude the page address, the Arabic that is wrong and what it should say. It fixes the string and shows you the change. For many strings, build the review sheet and send it to a native speaker:

```bash
npm run i18n:review -- export
```

Their file comes back and Claude imports it. Nothing counts as reviewed until a person did it. You have put this review at low priority (section 5). Detail: [arabic-review.md](arabic-review.md), [arabic-reviewer-brief.md](arabic-reviewer-brief.md).

### 4.15 A fighter's photo is wrong or unlicensed

Photos come only from Wikimedia Commons under a free licence, with the credit and licence on the page. They are matched by name, "is a boxer" and birth year, so a wrong match can happen. **There is no operator command yet to remove one photo.** Send Claude the fighter's page address and what is wrong. It will remove the photo and stop it coming back (a matched photo is not looked up again, so this needs an explicit change). If a photo is truly unlicensed, say so at once. Never put a picture from a promoter, a vendor or BoxRec on the site without written permission. Detail: [media.md](media.md).

## 5. Decisions still open

Read from the documents. Each says what is open, which document explains it, and **what happens if you do nothing**.

| # | Decision | Explained in | If you do nothing |
|---|---|---|---|
| 1 | **The official rankings.** May the site store and show the IBF, WBA, WBC and WBO lists, and with what credit? The email is a draft that was not sent as of 2026-10-05. | [rankings-decision.md](rankings-decision.md), [boxing-data-api-vendor-email.md](boxing-data-api-vendor-email.md) | The lists stay off. The site shows only Ringside's own rating ranking, labelled unofficial. Nothing is broken. |
| 2 | **The legal reading** of Terms, Privacy and the forum rules, and the Terms line about forum posts. | [launch-pages.md](launch-pages.md), [forum.md](forum.md), [forum-security-review.md](forum-security-review.md) | The drafts stay as they are. They are plain-language drafts, not legal advice. |
| 3 | **The host** (Fly.io, Render, Railway or a plain server), size, address and who runs it. The requirement list and four options are in the host guide. | [host-guide.md](host-guide.md), [deploy.md](deploy.md), [go-live.md](go-live.md) | There is no public site. The project has never been deployed to any host. |
| 4 | **A CDN, and the edge worker option.** A CDN cannot cache the pages under the present security policy. The safe route (a small program at the edge that writes a fresh value into each page) needs a vendor and tests; the weaker policy is not recommended. Pull request 166. | [cdn.md](cdn.md), [security.md](security.md), [capacity.md](capacity.md) "What to put in front" | Pages are not cached. One instance serves about 15 requests a second on one core, 21 on two, roughly 380 to 530 people reading at once. A CDN is used only for static files, images and sitemaps. |
| 5 | **The Arabic review.** A native speaker has not checked the site. You de-prioritised it. | [arabic-review.md](arabic-review.md), [arabic-reviewer-brief.md](arabic-reviewer-brief.md) | The Arabic stays machine-written and the Data page says how much is reviewed. |
| 6 | **Privacy wording and removal requests.** Three stances (corrections only; corrections plus personal details removed on request; full removal) and the Arabic of the Privacy page. Decided 2026-10-06: removal is not advertised and the Terms say each request "is considered". | [launch-pages.md](launch-pages.md), [forum-security-review.md](forum-security-review.md) item H | Corrections only, in practice, and no promised outcome. Nothing is built to hide one fighter's details. |
| 7 | **How the loaded database gets onto the host.** The first load is described on your computer; the public site runs on the host. No document says how `real.db` becomes the host's `ringside.db`, or whether to load on the host itself. | Section 8 below, [load-day.md](load-day.md), [real-data-runbook.md](real-data-runbook.md) | The host would start with the fictional demo league. Ask Claude to write and test the steps for the host you choose before launch day. |
| 8 | **Other sites using the data** (`PUBLIC_API`). The vendor may not allow it, and no drafted email asks. | [public-api.md](public-api.md) | Off for real data. |
| 9 | **Vendor credit wording.** The repository records no wording the vendor asked for. | [vendor-credit.md](vendor-credit.md) | The credit stays in every page footer and on the Data page. |
| 10 | **The forum in the menu and in search.** It is reachable from every fighter and fight page, off the menu, and not indexed. | [forum.md](forum.md) "Opening it to the public" | Stays as it is. |
| 11 | **The monitor** you will use (any service that alerts on page text). | [go-live.md](go-live.md) section 6 | Nothing alerts you. Put a weekly reminder in your calendar to open `/api/health`. |

## 6. Who can do what

| You (the owner) | Claude, on request |
|---|---|
| Hold the logins: host, vendor (RapidAPI), Anthropic, GitHub, domain, the shared mailbox. | Write, test and prepare the code, and open a pull request for you to read. |
| Type commands in the host's terminal and tell Claude exactly what you see (the whole output). | Walk you through each step, read the output you paste and say what it means. |
| Send emails to the vendor and anyone else; read their answers. | Draft the emails ([boxing-data-api-vendor-email.md](boxing-data-api-vendor-email.md)). Claude never sends them. |
| Make the statements: set the four statement flags (`BOXING_API_STORAGE_CONFIRMED`, `VENDOR_RANKINGS_CONFIRMED`, `PUBLIC_API`, `VENDOR_REDISTRIBUTION_CONFIRMED`) only when you hold the written proof. | Explain what each flag does and what happens either way. It will not set one for you. |
| Put secrets into the host's secrets screen. Never paste them in chat. | Check the settings without seeing them: `npm run doctor` never prints a secret. |
| Decide (section 5), pay, choose the host, choose the monitor. | Compare options, restate the requirements and write the files a chosen host needs (a compose file, a front-door setting, the nightly-job scheduler inside the container, a script that pulls the backup off the host). |
| Have the legal texts read by someone qualified. | Change the wording once you tell it what to say. |
| Copy backups off the host, and keep them private (they hold people's details). | Write the copy script once the host is chosen, and rehearse the restore on a copy. |
| Fix GitHub billing so CI runs. | Run `npm run gate` locally in the meantime. |
| Act as an editor: review corrections, forum reports, community edits, and choose posts and record pictures. `/review` lists every editors' page with what waits on it. | Explain the editor's screens and the command that makes someone an editor (`npm run accounts -- role NAME editor`, which you run on the host). |
| Reply to visitors, vendors and fighters. | Fix wrong Arabic strings, remove a wrong photo, add a missing country spelling, read a failed night's log, measure memory on the real host, update packages and keep the documents true. |

Claude cannot log in to your host, your vendor account, your mailbox or GitHub's billing, cannot see your keys, cannot send email on your behalf, and will not guess at a host. It does not merge changes unless you ask.

## 7. Every setting that matters

Set in the host's settings (secrets screen for the secret ones), then restart. `.env.example` is the master list; `npm run doctor` warns about a misspelt name, since a misspelt setting is silently ignored. A test keeps this table in step with the doctor's list: it fails if a setting is missing here.

"Secret" means: never show it, never paste it in chat, never commit it. Defaults are what the site does if the setting is unset.

| Setting | What it does | Safe default | Secret? |
|---|---|---|---|
| `SITE_URL` | The public https address. Used for canonical links, sitemaps, share images and the sign-in origin check. Without it, or if it points at this machine, the site stays hidden from search engines. | none (set it, origin only) | no |
| `SITE_CONTACT` | Where someone not signed in reports a mistake. An email or an https page, printed exactly as written on the Data and Report pages. Use a role address. | none (the doctor warns on a real-data site) | no |
| `BOXING_PROVIDER` | Where the data comes from: `demo` (fictional league), `licensed` (the vendor's data, read from the database) or `file` (a JSON file). | `demo` | no |
| `BOXING_FILE` | Path of the JSON file when `BOXING_PROVIDER=file`. | none | no |
| `BOXING_API_KEY` | The vendor's RapidAPI key. Lets a load or the nightly update run. On a laptop `vendor:fetch` reads it from the key file instead. | none | **yes** |
| `BOXING_API_URL` | The vendor's address. Change only if told to. | `https://boxing-data-api.p.rapidapi.com` | no |
| `NIGHTLY_SCHEDULE` | Turns on the built-in nightly job inside the container: a time of day `HH:MM`, in UTC (for example `03:30`). It runs `npm run nightly` (a verified backup, the update, an optional copy off the host) once a day with a few minutes of random delay. See [nightly.md](nightly.md). | off (not set; no nightly job runs unless your host runs one) | no |
| `CLIENT_IP_HEADER` | The name of a header your host sets to the visitor's real address and that a visitor cannot write (Fly: `Fly-Client-IP`). When set, only that header is used for per-visitor limits and a visitor-written `X-Forwarded-For` is ignored (see `docs/fly-deploy.md`). | empty (the proxy chain is read as before) | no |
| `VENDOR_GATE` | The vendor update gate (`docs/vendor-gate-plan.md`). `observe`: record what each daily update changed in rows the site already holds, and what would wait (a report in `<data>/gate-reports/`, lines in the log); holds nothing. `hold`: **hold** what the policy says must wait: those changes are put back before the update commits, so no page shows them, and become proposals for an administrator at `/review/updates`; new rows, odds and picture paths go in at once; a night over the flood guard is refused whole (exit 3, nothing written). `off` (or unset): the update is exactly what it was. A first load into an empty database is never held. `--accept-all` on the update lets one night through unheld (logged); the **first night of holding** skips the flood guard by itself (so the pile left from before is recorded, not refused); `--gate-baseline` skips it on another night; `--gate-report` is a dry run that rolls the update back. | off | no |
| `UPDATES_OVERDUE_DAYS` | How many days the oldest change waiting for an administrator may wait before `/api/health` shows `data.updatesOverdueDays` and the doctor warns. While changes wait, the site shows the last approved data. | `7` | no |
| `VENDOR_GATE_MAX_FIELD_SHARE` | The flood guard's share: one field changing in more than this share of the rows the feed touched (and at least `VENDOR_GATE_MAX_FIELD_ROWS` of them) is reported as a night that would be refused. | `0.3` | no |
| `VENDOR_GATE_MAX_FIELD_ROWS` | The least number of changed rows in one field for the share test to apply. | `100` | no |
| `VENDOR_GATE_MAX_NIGHT` | The most changes one night may propose before the flood guard would refuse it. | `2000` | no |
| `PROPOSAL_REJECT_MEMORY_DAYS` | How long a rejected change is remembered, so it is not raised again while its source says the same; after that it is raised once more. | `30` | no |
| `WATCH_SOURCES` | Which public sources the nightly job looks at for changes, and how often (`champions`, `champions:nightly`, `champions:weekly` for Mondays UTC). Differences become proposals an administrator decides on at `/review/updates`; nothing changes on the site until then. A failed look is a warning only. See `docs/nightly.md` section 2b. | empty (nothing is watched) | no |
| `NEWS_REFRESH` | `1` makes the nightly job refresh the boxing headlines and official videos (needs `NEWS_CONTACT`; videos need `YOUTUBE_API_KEY`). A failure is a warning, never a failed night. | unset (off) | no |
| `NIGHTLY_KEEP` | How many of the nightly job's dated backups to keep; older ones it made are removed after a new one verifies. | `7` | no |
| `NIGHTLY_OFFSITE_CMD` | A command of yours that copies the newest backup off the host; it receives the backup folder as its first argument and a failure never stops the update. The image has no `rclone`, `scp`, `rsync` or `curl`: you add what it needs. | none | no (but the command may use your own credentials: keep them out of the command text) |
| `NIGHTLY_OFFSITE_TIMEOUT_MIN` | Minutes the off-host copy may run before it is stopped. | `30` | no |
| `NIGHTLY_JITTER_MIN` | The most random minutes added to the scheduled time (0 to 60). | `5` | no |
| `NIGHTLY_NODE_OPTIONS` | Node settings for the update process the nightly job starts (its memory cap). Raise it if the update runs out of memory on a bigger league. | `--max-old-space-size=768` | no |
| `BOXING_API_STORAGE_CONFIRMED` | Statement flag: the vendor said in writing that we may store its data. `1` yes; `0` refuse to store; unset provisional. | unset (provisional; every run says so) | no |
| `BOXING_API_MAX_REQUESTS` | Cap on vendor requests for one ingest run. (`vendor:backfill` has its own `--max-requests`, default 100,000.) | 90 | no |
| `BOXING_API_PER_HOUR` | The plan's hourly limit, with a margin, so a long fetch spaces its requests (Mega allows 500). | unset; use 450 on Mega | no |
| `BOXING_API_SINCE` | Only fetch fights from this date (`yyyy-mm-dd`). | unset (the plan's range) | no |
| `VENDOR_RANKINGS_CONFIRMED` | Statement flag: the vendor said in writing we may store and show the official IBF, WBA, WBC and WBO lists. | unset (lists left out) | no |
| `PUBLIC_API` | Turns the public JSON API (`/api/v1`) and the embeds on or off. For real data it also needs the next flag. | on for the demo and a file; off for real data | no |
| `VENDOR_REDISTRIBUTION_CONFIRMED` | Statement flag: the vendor's terms allow other sites to receive its data. With `PUBLIC_API=1`, turns the API on for real data. | unset (API off) | no |
| `VENDOR_TERMS_URL` | The vendor's public licence page, linked from the Data page. | none | no |
| `INDEXABLE` | `1` invites search engines even with the demo league. Almost never wanted. | unset | no |
| `DATABASE_PATH` | Where `ringside.db` lives. | `data/ringside.db`; `/data/ringside.db` in the container | no |
| `ACCOUNTS_DB_PATH` | Where `accounts.db` lives. Keep it on the volume. | next to `DATABASE_PATH` | no (the file is private) |
| `VENDOR_LAG_DAYS` | How many days a vendor's career total may trail yesterday's result before the nightly audit calls it a conflict. | 7 | no |
| `VENDOR_LOAD_LAG_DAYS` | The same, for the first load (it reads a cache that may be days old). | 14 | no |
| `RINGSIDE_KEY_FILE` | Where `vendor:fetch` reads the vendor key on a laptop. Not read by the site. | `~/.ringside-key` | no (the file is private, mode 600) |
| `ANTHROPIC_API_KEY` | Turns on model-written search, scouting reports, previews and `/ask`. Without it, built-in rules. | unset | **yes** |
| `ANTHROPIC_MODEL` | Which model answers visitors. | `claude-haiku-4-5-20251001` | no |
| `ANTHROPIC_MODEL_TRANSLATE` | The model for `npm run i18n:translate`, a developer tool. | its own default (`claude-sonnet-5-5`) | no |
| `AI_DAILY_BUDGET` | Model calls per UTC day for the whole site. `0` turns the model off. A restart refills it. | 1,000 | no |
| `AI_CLIENT_LIMIT` | Model calls per visitor per window. | 20 | no |
| `AI_CLIENT_WINDOW_MS` | The window for the last limit, in milliseconds. | 600,000 (10 minutes) | no |
| `FORUM_AUTO_HIDE_REPORTS` | How many different established members must report a forum post to hide it until an editor looks. Never below 2. | 6 | no |
| `WIKIMEDIA_CONTACT` | Your email or web page, sent to Wikimedia with every request. Required for photos and enrichment. | none | no (it is published to Wikimedia) |
| `WIKIMEDIA_GAP_MS` | Pause between requests to Wikimedia Commons. Do not go faster. | 250 | no |
| `WIKIDATA_GAP_MS` | Pause between requests to Wikidata. Do not go faster. | 1,200 | no |
| `MEDIA_RESOLVER` | `wikimedia` fetches photos automatically after each ingest. | unset (by hand only) | no |
| `MEDIA_RESOLVER_BATCH` | How many fighters that automatic step handles per run. | 100 | no |
| `RESEARCH_CONTACT` | Your email or website for the money-research bot's User-Agent. Without it the bot will not run and "check the source" on edits answers "unavailable". | none | no |
| `CLIENT_IP_HEADER` | The name of the request header your host sets to the visitor's real address (Fly.io: `Fly-Client-IP`), so per-visitor limits use it instead of an address a visitor could type. Unset: the limits fall back to the forwarded address. See docs/fly-deploy.md, step 9. | unset | no |
| `NEWS_CONTACT` | Your email or website for the news refresh's User-Agent (`npm run news:refresh`). Required for it to run; an outlet can reach you with it. | none | no |
| `NEWS_NONCOMMERCIAL` | `1` is your statement that the site earns nothing; it adds the feeds of outlets (BBC Sport, The Guardian, Sky Sports) that allow their feeds on non-commercial sites only. | unset (open feeds only) | no |
| `NEWS_IMAGE_SOURCES` | Which outlets' pictures the news cards show: unset is every open outlet; `none` is no outlet; or a comma list of outlet ids (`boxing-news`, `boxing-news-24`, `15-rounds`, `world-boxing-news`). The pictures are saved by this site and shown from its own address; an outlet left out has its saved pictures deleted at the next refresh. Use it if an outlet asks you to stop. | unset (all open outlets) | no |
| `NIGHTLY_ENRICH` | `weekly` (Sundays, UTC) or `nightly`: the nightly job also runs `vendor:enrich`'s resumable steps (Wikidata, Commons) for fighters not yet looked up, last, after the off-host copy. Needs `WIKIMEDIA_CONTACT`. A failure is a warning. | unset (off) | no |
| `NIGHTLY_PING_URL` | The heartbeat address a free uptime monitor gives you; pinged when a night ends (`/fail` added for a failed night). A night that never ends sends nothing, which is what the monitor alerts on. See `docs/monitoring.md`. | unset | **yes** |
| `OFFSITE_S3_ENDPOINT` | The https address of your S3-compatible storage (Cloudflare R2, Backblaze B2, Amazon S3) for the off-host backup (`docs/offsite-backups.md`). | none | no |
| `OFFSITE_S3_BUCKET` | The bucket the encrypted backups go to. | none | no |
| `OFFSITE_S3_ACCESS_KEY_ID` | The storage access key's id (not a secret on its own; the secret key below is). | none | no |
| `OFFSITE_S3_SECRET_ACCESS_KEY` | The storage access key's secret. | none | **yes** |
| `BACKUP_PASSPHRASE` | Encrypts every off-host file (12 characters or more). Nothing is sent without it. Keep a copy away from this server: without it a copy cannot be read. | none | **yes** |
| `OFFSITE_S3_REGION` | The storage region (R2 and B2 accept `auto`). | `auto` | no |
| `OFFSITE_S3_PREFIX` | The folder in the bucket. | `ringside/` | no |
| `OFFSITE_KEEP` | How many dated copies stay in the bucket; older ones are deleted after a good upload. | 30 | no |
| `YOUTUBE_API_KEY` | Your own key for YouTube's Data API (free), used by `npm run news:refresh` to list the newest uploads of the official boxing channels. Without it no official videos are listed; the headlines still work. | unset | **yes** |
| `RESEARCH_DELAY_MS` | Pause between the research bot's requests. | 3,000 | no |
| `RESEARCH_BLOCKLIST` | Comma-separated sites that asked not to be fetched. | none | no |
| `RINGSIDE_NOW` | Pins "today" for tests and rehearsals. **Never set in production**; it freezes the site's clock. | unset | no |
| `RINGSIDE_WORLD_SETTLE_MS` | After the nightly job changes the data, how long the data must stay quiet before the site rebuilds once. | 5,000 | no |
| `RINGSIDE_OG_MAX_AGE` | Seconds a share image may be reused by browsers and link-preview robots. | 600 | no |
| `RINGSIDE_OG_CACHE_MB` | Memory kept for drawn share images. `0` keeps none. | 24 | no |
| `RINGSIDE_SITEMAP_CACHE_MB` | Memory kept for compressed sitemap files. `0` keeps none. | 32 | no |

Set by the container itself; leave alone: `NODE_ENV=production`, `PORT=3000` (the app's port), `HOSTNAME`, `NEXT_TELEMETRY_DISABLED`. A few more names exist only for tests and tools (`I18N_DIR`, `REVIEW_OUT`, `RINGSIDE_LOCK_DIR`, `RINGSIDE_NO_SEED`, `RINGSIDE_MEMO_LOG`, `WIKIPEDIA_API_URL`, `RESEARCH_DIR`, `PLAYWRIGHT_MODULE`); do not set them on a live site.

## 8. Doc fixes needed

Reading ten-odd documents against the code found these. **Fixed in the same change** (the doc named is now right):

1. `capacity.md`, summary: said a data update still peaks at about 2.1 GB. That was before the memory diet. The measured peak is now 1.38 to 1.42 GB, and 2 GB with no heap cap is enough. The code and the sizing table agree with the new figure.
2. `load-day.md` step 8 showed only the cron line for a laptop (`vendor:fetch -- --update`, key read from a file). It now also shows the form for a container (`vendor:backfill -- --update --cache-dir /data/vendor-cache`, key from the container's settings) from the runbook, and says to use that one on a host.
3. `deploy.md`, "Build and run": said the world is ready in about 4 seconds at full size. That is only the first half; the pages' shared computations bring a real start to 11 to 16 seconds before it answers (`capacity.md`, "Start-up"). Corrected.
4. `forum.md`, "Known limits": said that with no editor the only protection was the "four-report auto-hide" (it is six since PLAN 229, and set by `FORUM_AUTO_HIDE_REPORTS`), and that the Terms page does not yet mention forum posts (it does, since PLAN 227). Corrected.
5. `real-data-runbook.md`, "Undoing it": told you to copy `ringside.db` back by hand. The restore command (`npm run backup -- restore`) exists and does it safely, with a dry run and an undo. Pointed there. The notes table also listed six rows twice (`statusUnknown`, `finishedInFuture`, `fightsSkippedUnreadable`, `careerTotalImplausible`, `physicalsImplausible`, `textCleaned`); the duplicates are removed.
6. `go-live.md`: "use the host's rollback" did not say that an older version on a newer data file is not supported (`deploy.md`, "Updating"). It now says what to do if the old version will not start.

**Disagreements where both documents are right, for different tools:** the request cap is 90 for the app's own ingest (`BOXING_API_MAX_REQUESTS`) and 100,000 for `vendor:backfill --max-requests`. The nightly log is `~/ringside-real/update.log` on a laptop and wherever your cron line's `>>` points on a host (the runbook uses `/data/vendor-update.log`).

**Gaps found and not fixed (they need a decision or a tested procedure):**

1. No document says how the database loaded on your computer reaches the host's volume (section 5, decision 7).
2. No drafted vendor email asks whether other sites may receive its data (`PUBLIC_API`). The drafted email covers rankings, field values, scorecards and the hourly limit only.
3. The vendor email on rankings is a draft, "Not sent as of this commit" (2026-10-05). `boxing-data-api-enquiry.md` still carries an older, superseded hourly-limit draft.
4. There is no operator command to remove one wrong photo or to hide one fighter's personal details.
5. `docs/host-guide.md`, `docs/cdn.md`, `docs/nightly.md` and `docs/hosting-options.md` are all on `main` now and linked from this page. `hosting-options.md` (written in parallel) says the nightly job is `npm run data:ingest`; for the real vendor data it is the update in [nightly.md](nightly.md) and [load-day.md](load-day.md) step 8, and where a price differs between the two host pages the provider's own page wins.
