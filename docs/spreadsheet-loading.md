# Loading your own data from spreadsheets

You do not need to write code or JSON. Keep three tables in Excel or Google Sheets, save each as CSV, and let one command turn them into a file the site can load.

## What you need

Three files in one folder: `fighters.csv`, `events.csv`, `fights.csv`. Working examples are in `docs/sample-csv/`. Copy that folder and replace the rows with yours.

In Excel: **File → Save As → CSV UTF-8 (Comma delimited)**. Choose UTF-8 so Arabic names survive. In Google Sheets: **File → Download → Comma Separated Values (.csv)**, once per sheet.

## The columns

Column names can be in any capitalisation ("Weight class", "weight_class" and "WeightClass" all work).

**fighters.csv**

| Column | Needed? | Notes |
|---|---|---|
| name | yes | Full name, spelled the same way in fights.csv |
| country | yes | e.g. Saudi Arabia |
| weight class | yes | e.g. Welterweight |
| id | no | Your own short code, if you have one |
| stance | no | Orthodox, Southpaw or Switch |
| sex | no | |
| birth year | no | Four digits |
| height cm, reach cm | no | Numbers only |
| turned pro | no | Year |
| active | no | yes / no (blank means yes) |
| nickname | no | |

**events.csv**

| Column | Needed? | Notes |
|---|---|---|
| name | yes | |
| date | yes | Written YYYY-MM-DD, e.g. 2026-11-20 |
| venue, city, country | yes | |
| id, status, broadcaster | no | |

**fights.csv**

| Column | Needed? | Notes |
|---|---|---|
| event | yes | Exactly the event name from events.csv |
| red, blue | yes | Fighter names from fighters.csv |
| rounds | yes | e.g. 12 |
| winner | no | red, blue, draw, nc (no contest), or blank if the fight has not happened yet |
| method | no | e.g. KO, TKO, UD, SD, MD |
| end round | no | Round the fight ended in |
| weight class, title, id | no | |

**Order matters:** the first fight listed for each event is treated as the main event, the second as the co-main, and so on.

## The three steps

1. Put your three files in one folder, for example `my-league`.
2. Convert them:
   `npm run data:from-csv -- --dir my-league --out feed.json`
3. Check the result, then load it:
   `npm run data:check -- --file feed.json`
   then follow `docs/go-live.md` for loading it into the site (provider `file`, `BOXING_FILE=feed.json`, then `npm run data:ingest`).

## If something is wrong

The converter writes nothing and tells you the file and row, in plain words, for example: *fights, row 7: the blue fighter "Nobody Known" is not in the fighters file.* Fix that cell, save, run step 2 again. Typical causes: a name spelled differently between files, a date not in YYYY-MM-DD form, a missing required column.

## Try it first

`npm run data:from-csv -- --dir docs/sample-csv --out feed.json` converts the fictional sample league (names are made up) so you can see the whole path working before using your own.
