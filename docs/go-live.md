# Going live: the short, step-by-step version

This is the plain version of [deploy.md](deploy.md). Use it when you want to put Ringside on the internet, or put a new version on a site that is already live, and you would rather follow steps than read about options. Every step says what you should see when it worked. If you do not see it, stop and ask before doing the next step.

Words used here:
- **The host**: the company or server that keeps the site running (the project does not choose one for you).
- **Container**: the packed-up copy of the site that the host runs. The project builds it from the `Dockerfile`.
- **Volume**: the permanent disk the site's data lives on. If the host has no volume, every restart loses the data. **Do not use a host that cannot give the site a permanent disk.**
- **Backup**: a safe copy of the two data files: the fight data and the accounts (people's sign-ins, picks and watchlists).

## 0. Two things that must be true of any host

1. It can run a Docker container and give it a permanent disk (a volume) mounted at `/data`.
2. It runs **exactly one copy** of the site. Two copies would each keep their own data and drift apart.

The host also needs to put the site on `https://` for you (most do). It must pass on the visitor's real address; deploy.md has the technical wording if your host asks.

## 1. Decide, once, and write it down

| Question | What to write down |
|---|---|
| Which host? | Its name and the login you use |
| What is the site's public address? | e.g. `https://ringside.example` (this becomes `SITE_URL`) |
| An address visitors can report a mistake to | A shared mailbox such as `corrections@...`, never a personal one (this becomes `SITE_CONTACT`) |
| Do you want the AI features? | If yes, an `ANTHROPIC_API_KEY`; if not, leave it out and the site answers from rules |

Put any key in the host's **secrets** screen. Never in the repository, never in a chat message.

While the site still shows the made-up demo league, it tells search engines **not** to list it. That is on purpose. It switches on when real data is loaded.

## 2. If the site is already live: back up first

Do this before every update. It takes about two minutes and the site keeps running.

1. Open a terminal on the host (most hosts have a "Console" or "Shell" button on the site's page).
2. Type `docker exec ringside npm run backup` and press Enter. (If your container has another name, use that instead of `ringside`.) You should see `backup written to /data/backups/<date and time>` and two lines ending `integrity ok`.
3. Write the folder name down. Check it: `docker exec ringside npm run backup -- verify /data/backups/<that folder name>`. You should see `backup is good: every database opens, passes integrity_check, has its tables and matches its checksums`. Every backup now carries a list of fingerprints (`checksums.sha256`) so a copy that was cut short or changed on its way off the host is caught.
4. **Copy the folder off the host** (to your own computer or cloud storage). A backup on the same disk is lost if the disk is lost. It contains people's details, so keep it private.

5. **Once, before you need it: rehearse putting it back, changing nothing.** On the host's terminal run `docker exec ringside npm run backup -- restore /data/backups/<that folder name> --dry-run`. You should see `backup ... verifies (integrity and checksums)`, then lines starting `would copy the current data to` and `would replace`, and `dry run: nothing was changed`. Because the site is running you will instead see `REFUSED: the site might be running, so nothing was changed`: that is the safety working, and it also proves the backup was read and checked. (To see the full plan anyway, add `--even-if-running`; a dry run still changes nothing.) Section 5 has the real thing.

Hosts that give you no terminal: ask the host how to run one command inside the container, or how to download the contents of the volume. Do not update until you have a verified copy.

## 3. Put the new version on

How you do this depends on the host, but the idea is always the same:

1. Get the latest code (`main` on GitHub is the version to use).
2. Build the container from it: `docker build -t ringside .`
3. Tell the host to run the new container, with the volume mounted at `/data` and these settings: `SITE_URL`, `SITE_CONTACT`, and (optional) `ANTHROPIC_API_KEY`. Many hosts do steps 2 and 3 for you when you press a **Deploy** button or connect the GitHub repository.
4. **Keep the previous version available** (the host's "rollback" or "previous release" button, or the old image) until step 4 below says all is well.

The first start of a new version sets up anything new in the data files by itself (for example the watchlist table added in October 2026). It never deletes data.

## 4. Check it worked

Open each of these in a browser, in this order. All should load without an error page:

1. `https://your-address/api/health`. You should see `"status":"ok"` and counts of fighters and fights.
2. `https://your-address/` (English) and `https://your-address/ar` (Arabic, right to left).
3. `https://your-address/tour`. The video should play when you press play.
4. Sign up with a test account, star a fighter, then reload `/watchlist`. The fighter should still be there. Sign out, sign in again, and check it is still there.
5. On the host's terminal: `docker exec ringside npm run doctor`. It prints a list of problems with the fix beside each. Fix anything marked as a failure.

If step 1 or 4 fails: use the host's rollback (or run the old container), then tell me exactly what you saw. Your data is safe: the update does not delete it, and you made a backup in section 2.

## 5. Afterwards

- Make a backup on a schedule (daily is a good start), and copy it off the host each time. The command is the one in section 2.
- When real data is ready, follow [real-data-runbook.md](real-data-runbook.md). The site stays hidden from search until then.
- Know how to put a backup back before you need to: the steps are just below.

### Putting a backup back (restoring)

Do this only when the current data is wrong or lost (a bad load, a deleted account, a dead disk). It **replaces** the fight data and the accounts with the backup's, so anything added since that backup (predictions locked, sign-ups, picks) is gone from the live site. The command first saves what is there now, so it can be undone. It never prints anyone's details, only file names, sizes and counts.

1. **Pick the backup and check it.** Use the newest good folder (the folder name is a date and time). If it came from your own computer, put it back at `/data/backups/<folder name>` on the volume first. Run `docker exec ringside npm run backup -- verify /data/backups/<folder name>`. You should see `backup is good`. If you see `PROBLEMS`, stop and use an older folder.
2. **Stop the site.** `docker stop ringside`. You should see `ringside`. (Restoring under a running site is refused, because the running site would write over the restore.) The site is down from here until step 6.
3. **Look first (changes nothing).** The site is stopped, so run the command in a throwaway container on the same volume: `docker run --rm -v ringside-data:/data ringside npm run backup -- restore /data/backups/<folder name> --dry-run` (use your volume's name if it is not `ringside-data`). You should see `verifies (integrity and checksums)`, `would copy the current data to /data/backups/before-restore/<date and time> first`, two `would replace` lines, and `Dry run finished. Nothing was changed.` Anything starting `REFUSED` says why in plain words (a damaged backup, or the site still running); fix that and repeat this step.
4. **Restore.** The same command without `--dry-run`. You should see, in this order: `verifies`, `saved the current data to /data/backups/before-restore/<date and time> (checked)`, `wrote 2 files beside the current ones, flushed them to disk and checked them`, `replaced ringside.db, accounts.db and removed the old -wal and -shm files`, a `now in place:` line for each file with its counts (fighters, fights, accounts) and `integrity ok`, then `Restored.` **Copy down the `To undo` line it prints.** If it stops half-way with `the restore stopped ... the files were put back as they were`, nothing was changed; tell me the whole message.
5. **Check the counts** on the `now in place:` lines are what you expect for that day.
6. **Start the site.** `docker start ringside`, then open `https://your-address/api/health` (`"status":"ok"` and the fighter count), sign in with a test account and open `/watchlist`.
7. **Undo, if it was the wrong backup.** `docker stop ringside`, then the `To undo` line it printed (it runs this same command on the folder `before-restore/<date and time>`), then `docker start ringside`. The data is back as it was before step 4. The `before-restore` folders are kept on the volume (the last 50); delete old ones when you no longer need them.

How it was checked: the command was rehearsed end to end on a copy of the demo league (no real data touched), including a damaged backup, a site still running, a dry run and the undo; the record is in PLAN.md section 209. It has not yet been run against your host's volume, so do step 3 once on a quiet day.

## 6. Know when the overnight update stops (once the real league is live)

The real league is kept current by one nightly job (`vendor:fetch -- --update`, in [load-day.md](load-day.md) step 8). If it stops (the machine was off, the vendor's key lapsed, a limit was hit) **the site keeps working and keeps showing the last results, with nothing on the page to say they are old.** The site tells you in two places, but only if you look:

- `https://your-address/api/health` contains `"stale":true` when the last successful update is more than two days old (`"updatedAt"` and `"ageHours"` are in the same answer). The page itself still answers normally; it never turns into an error for this.
- `npm run doctor` prints a warning with the date of the last update.

So make something look for you. Any uptime monitor that can **alert when a page contains some text** will do (several have a free plan; I have not tried any against your host, so choose one you trust): point it at `https://your-address/api/health` and alert on the text `"stale":true`, and also on the page not answering at all. Send the alert to an address you read daily. The threshold is two days: one missed night leaves the data about a day old and does not alert; a second miss does, as soon as that night's job should have finished.

When it fires:
1. Open the log the job writes to (the `>> .../update.log` in the cron line): its last lines say what stopped it.
2. Run the update by hand, once, with the same command, and watch it. A wrong or lapsed key, or the hourly limit, says so in plain words.
3. Open `/api/health` again: `"stale":false` and a new `updatedAt` mean it is fixed.
4. If you cannot tell, paste the whole output of step 2 to me.

If you would rather not use a monitor yet: put a weekly reminder in your calendar to open `/api/health` and check `"stale":false`.

## What I (Claude) can and cannot do for you here

I can write, test and prepare the code, and walk you through each step above. I cannot log in to your host, and I will not guess at it. For steps 2 to 4 you do the clicking and typing, and tell me what you see after each one.
