# Putting the finished database on the host (Fly.io)

**Status: the packing and the restore are tested on demo data (`tests/ship.test.ts`, `tests/restore.test.ts`). The upload and the restore on a real Fly machine have NOT been run: do each step, check the "You should see", and stop and send the message if it differs.**

Use this **once, for the first load**, before real visitors and before the nightly job is turned on. After that the nightly update keeps the host's database current; do not ship over it again. A ship replaces the host's sports database, including its prediction ledger (`prediction_snapshots`). The host's accounts database (people, picks, edits) is never touched: the packed folder does not contain one.

Check `fly secrets list` for `DATABASE_PATH` and `fly ssh console` `echo $DATABASE_PATH`: that is the live file, and it is the one this guide replaces. Do this after `vendor:enrich` and `post-load` are finished, so the file you ship is the final one. The empty site must already be deployed and healthy ([fly-deploy.md](fly-deploy.md) steps 1–8).

## On your Mac

1. **Pack it.** From the repository folder: `npm run ship -- --database ~/ringside-real/real.db`.
   *You should see* `packed ...`, a path under `~/ringside-real/ship/`, `ringside.db  NNN MB, integrity ok, checksums written`, and the counts (about 33,614 fighters, 41,474 fights, 10,365 cards). It reads `real.db` and writes only the new folder. It refuses a database with fewer than 1,000 fighters (the demo) and says so.
2. **Check it.** `npm run backup -- verify ~/ringside-real/ship/<folder name>`. *You should see* `backup is good`.

## On the host

3. **Upload** (the last lines the pack command printed are these, with your folder name):
   ```
   fly ssh sftp shell
     mkdir /data/incoming
     mkdir /data/incoming/<folder name>
     put ~/ringside-real/ship/<folder name>/ringside.db /data/incoming/<folder name>/ringside.db
     put ~/ringside-real/ship/<folder name>/checksums.sha256 /data/incoming/<folder name>/checksums.sha256
   ```
   *You should see* both files go up. This takes a few minutes for a large file.
4. **Open a console and check what arrived.**
   ```
   fly ssh console
   chown -R node:node /data/incoming
   su node -c "cd /app && npm run backup -- verify /data/incoming/<folder name>"
   ```
   *You should see* `backup is good: every database opens, passes integrity_check, has its tables and matches its checksums`. If a checksum does not match, the upload was cut short: delete the folder and upload again.
5. **Look first (changes nothing).**
   `su node -c "cd /app && npm run backup -- restore /data/incoming/<folder name> --dry-run --even-if-running"`
   *You should see* `verifies`, `the backup has no accounts.db: the current accounts.db is left exactly as it is`, `would copy the current data to /data/backups/before-restore/<time> first`, one `would replace /data/real.db` line (the restore writes to whatever `DATABASE_PATH` names; on your Fly app that is `/data/real.db`, and the file inside the packed folder is called `ringside.db` whatever the live one is called), and `dry run: nothing was changed`. (`--even-if-running` is needed because the site is the container's main program and cannot be stopped from inside it; it is safe here because no visitors or accounts exist yet.)
6. **Restore.** The same command without `--dry-run`. *You should see* `saved the current data to ... (checked)`, `replaced real.db`, a `now in place:` line with the fighter, fight and card counts, `integrity ok`, and `Restored.` **Copy down the `To undo` line it prints.**
7. **Restart the site** so it opens the new file: leave the console (`exit`), then `fly machine restart`. The first start can take up to two minutes (it builds its tables before accepting visitors).
8. **Check it.** Open `https://YOURAPP.fly.dev/api/health`: *`"status":"ok"`* and counts that match step 1. Open a fighter page and the rankings. In `fly ssh console`: `su node -c "cd /app && npm run doctor -- --production"` should show no failure lines.
9. **Tidy.** `rm -r /data/incoming/<folder name>` (it is a copy; the live file is `/data/real.db`; a `/data/ringside.db` beside it is the first deploy's empty demo and the site does not use it).

## If something is wrong

- Undo: stop is not possible inside the container, so run the `To undo` command from step 6 with `--even-if-running`, then `fly machine restart`.
- The fitted prediction model lives at `/data/model-fit.json`. If the doctor says it is missing or stale, run `su node -c "cd /app && npm run model:fit"` in the console. (Not yet tried on a Fly machine.)
- Disk full: the volume must hold the file twice during the restore (the new file beside the old, plus the safety copy). Check `df -h /data`; extend the volume with `fly volumes extend` if needed.
