# What data Ringside collects and stores

**Generated from the code on 9 October 2026** (the tables and columns are read from the schemas themselves, so they are exact; the "source" and "kept for" columns are from the code and docs). Counts are from your live site on 9 October 2026 unless marked. This is a description of what is stored, not legal advice: the privacy page (`/privacy`) says the same thing to visitors, and `tests/privacy.test.ts` fails if the two drift apart.

**Summary:** two SQLite databases (31 sports tables with 330 columns; 16 accounts tables with 159 columns), plus about a dozen folders and files of working data. Nothing is sent to analytics, no advertising or tracking cookies exist, and **only the accounts database holds personal data**.

## 1. Where it lives (on Fly: the volume at `/data`)

| Item | What it is | Personal data? |
|---|---|---|
| `real.db` (your `DATABASE_PATH`) | The sports database: fighters, fights, cards, results, ratings, news, pictures. 31 tables (section 2). | No |
| `accounts.db` | People, sessions, picks, forum, reports, editors' work, approvals. 16 tables (section 3). | **Yes** |
| `backups/<time>/` | The nightly verified copies of both databases (last 7). | Yes (holds a copy of the accounts) |
| `vendor-cache/` | Every answer the Boxing Data API gave, as files, so a reload needs no new requests. | No |
| `wikipedia-cache/` | Wikipedia's champions lists as read. | No |
| `wikidata-staging.json` + the `wikidata_boxers` table | 19,651 boxers' facts from Wikidata, held until linked to our fighters. | No |
| `video-thumbs/`, `news-images/` | Pictures of official videos and news cards, saved and shrunk by this site (30-day and 120-day life). | No |
| `photos/` (beside the accounts database) | Photos people sent in for a fighter's page, with location and camera data removed. A waiting one is private to its sender and the editors; an approved one is public. Not copied by `npm run backup`. | Yes (the picture; the sender is in the accounts database) |
| `model-fit.json` | The fitted prediction model's numbers. | No |
| `nightly-status.json`, `gate-reports/` | What the last nights did; what the vendor's updates would have changed. | No |
| `disputed.csv`, `dropped.csv` | Records where the vendor's total and the fights disagree; rows left out of a load. | No |
| `research/` | Documents an editor placed for the claim checker, with their hashes. | No |
| `/data/incoming/`, `ship/` | Temporary: a database being shipped. | Only while it exists |
| Off-host: an S3 bucket (if you set it up) | Encrypted copies of the nightly backups. | Encrypted |

## 2. The sports database (`real.db`): 31 tables

### Fighters and their facts
| Table | Holds | Source | Live count |
|---|---|---|---|
| `boxers` (34 columns) | One row per fighter: name, nickname, country, birth date and place, stance, height, reach, division, turned pro, active, rating, photo address and credit, ids at Wikidata, BoxRec, the Hall of Fame and Olympedia, the vendor's own win/loss/draw/KO totals, and a "record disputed" flag. | Vendor API, then Wikidata | 33,614 |
| `wikidata_boxers` (24) | Staged Wikidata facts per boxer (birth, height, awards, Arabic label, nickname, article title), and which of our fighters it was matched to and by what rule. | Wikidata | 19,651 |
| `boxer_media` (11) | The photo found for a fighter, with its licence, author, file page and why it was accepted or refused. | Wikimedia Commons | 136 matched |
| `honours` (6) | Hall-of-fame and Olympic marks, awards. | Wikidata | 1,415 |
| `name_translations` (5) | English to Arabic names and words, with whether a person reviewed it. | Wikidata, glossary, editors | not counted here |
| `rating_history` (5) | A fighter's rating after each fight (the chart on a fighter's page). | Computed | one per fight per fighter |
| `earnings` (10) | A fighter's earnings by year, with how it was worked out and the source link. | Claims, editors | only what an editor has entered |

### Fights, cards and results
| Table | Holds | Source | Live count |
|---|---|---|---|
| `bouts` (22) | One row per fight: both fighters, weight class, rounds, winner, method, round ended, title and which body's, odds, status, the vendor's own scores. | Vendor API | 41,474 |
| `events` (12) | Cards: name, date, venue, city, country, poster address, promoter, broadcaster, attendance, status. | Vendor API | 10,365 |
| `scorecards` (5) | Each judge's score for each fight (where supplied). | Vendor API | where supplied |
| `punch_stats` (9) | Punches thrown and landed per round. | Vendor API | where supplied |
| `weigh_ins` (7) | Official and fight-night weights, whether the weight was made. | Vendor API | where supplied |
| `prediction_snapshots` (9) | The model's forecast for a fight, locked before it starts, to judge it afterwards. | Computed | grows daily |
| `event_financials` (14), `purses` (10), `event_broadcasts` (11) | Gate, PPV buys, sponsorship, a fighter's purse, viewing figures, each with its basis and source link. | Claims, editors | only what an editor has entered |

### People, organisations and places
| Table | Holds | Source |
|---|---|---|
| `people` (6) | Trainers, judges, referees, managers (a name, country, Wikidata id). | Vendor API |
| `orgs` (8) | Sanctioning bodies and promoters. | Vendor API |
| `team_stints` (10) | Who trained or managed whom, and when, with the source. | Vendor API, editors |
| `corners` (4) | Who was in a fighter's corner for a fight. | Vendor API |
| `officials` (4) | Who judged or refereed a fight. | Vendor API |
| `venues` (12) | Venue's coordinates, capacity and Wikidata id (583 located). | Wikidata |
| `venue_places` (11) | Where a venue is when Wikidata could not place it: coordinates, a street address and a kind of place (Arena, Stadium, Casino hotel...), each accepted only by strict rules (`docs/venue-map.md`), with the OpenStreetMap object it came from. Credit: © OpenStreetMap contributors (ODbL). | OpenStreetMap |

### Titles and rankings
| Table | Holds | Source |
|---|---|---|
| `title_reigns` (22) | Each champion's reign for each body and division: dates, who they beat, defences, and the Wikipedia revision it came from. 2,642 held. | Wikipedia lists |
| `official_rankings` (11) | The bodies' own lists, one whole snapshot at a time. **Left out until you set `VENDOR_RANKINGS_CONFIRMED=1`.** | Vendor API |
| `entity_media` (12) | Logos, belts and venue pictures with licence and credit (138). | Wikimedia Commons |

### News
| Table | Holds | Source |
|---|---|---|
| `news_items` (10) | A headline, the feed's own short excerpt, date, the original's address, and an archived copy's address (never a body). Videos from official channels are rows here too. 229 kept. | Outlets' feeds, YouTube API |
| `news_images` (3) | The address of the picture a feed offered for a headline. | Outlets' feeds |
| `news_feeds` (6) | Per feed: when last read, the version marker, the status. | Computed |

### The update's own records
| Table | Holds |
|---|---|
| `ingest_runs` (8) | One row per update or load: when, which provider, counts of errors/warnings, and the totals written. This is what makes "last updated" and the stale alert. |
| `ingest_issues` (6) | What each run noticed and what it left out, with a code and the entity. |

### Short-lived "sub-tables"
- `gate_*` temporary tables exist only inside one update's transaction (the vendor update gate compares before and after); they are dropped at commit.
- In-memory indexes (the "world") are rebuilt at start-up from these tables and hold nothing extra.

## 3. The accounts database (`accounts.db`): 16 tables, the only personal data

| Table | Holds | Who can see it |
|---|---|---|
| `users` (9) | Username, a salted password hash (never the password), role, created, last login, disabled, whether picks are public. **No email address, no real name is required.** | the user; admins by role |
| `sessions` (6) | A hash of each sign-in token, when it started and ends, a device label. | the user |
| `resets` (3) | A hash of a password-reset token and its expiry. | nobody (short-lived) |
| `picks` (4) | A user's pick for a fight and when. | the user; public if they chose |
| `watchlist` (3) | The fighters a user starred. | the user |
| `forum_threads` (10), `forum_posts` (16), `forum_reports` (9) | Discussion threads and posts (the user's own words, an edit time, moderation state), and reports of a post with the reason. The forum is built but **not announced**. | public (posts), moderators (reports) |
| `reports` (24) | A visitor's report of a mistake: what, the value shown, the value proposed, the source link and quote, an optional contact, and the decision. | editors |
| `contributions` (18) | A signed-in person's proposed team-history edit with its source and quote, and the review. | editors |
| `boxer_owners` (6) | Which user is verified as a fighter's own account (for corrections the fighter makes). | admins |
| `licensed_images` (10) | Photos an editor recorded, with licence or permission, credit and evidence. | editors |
| `photo_submissions` | Photos people sent in, who they said they are to it, the credit, a note, and the editor's decision. Waiting ones are deleted with the account. | the sender, editors |
| `social_posts` (10) | Public posts an editor chose to show (provider, address, account, note). | public |
| `proposals` (15) | Changes a public source or the vendor suggested, waiting for an administrator, with the old and new values and the evidence. | admins |
| `watch_rules` (10) | Standing rules an administrator made for source changes. | admins |
| `audit` (6) | A log of account and review actions: who did what to what and when. | admins |

What a visitor's browser stores (declared on the privacy page): a sign-in cookie, a language choice, and a few conveniences such as the watchlist kept in the browser. No analytics, advertising or cross-site cookies.

## 4. What is deliberately not stored
- No article bodies from news outlets, no video files, no video descriptions.
- No ratings, odds or results from sources that forbid reuse (BoxRec is on a never-fetch list).
- No visitor IP addresses or page-view history (rate limits are in memory only).
- No email addresses, phone numbers or real names for ordinary accounts.
- The vendor's storage terms are **provisional**: `BOXING_API_STORAGE_CONFIRMED` is not set until the vendor agrees in writing.
