# Deploying Ringside on Fly.io, one step at a time

**Status: written from Fly's documentation, not yet run on a real Fly account.** The Docker image has not been built in the place this was written, so the first deploy may show a problem; if so, stop and copy the message to Claude.

**Cost (Fly's price page, read 2026-10-07; their page wins if it differs):** a 2 GB machine (`shared-cpu-2x`) about **$13.39/month**, plus the disk about **$0.15 per GB per month** (5 GB is under $1), plus outbound traffic $0.02/GB. If the site feels slow in busy periods the shared CPU may be throttled; the stronger machine (`performance-2x`, 4 GB) is about $66/month. Change it in `fly.toml` under `[[vm]]`.

**Where:** Fly has no Middle East region. `fra` (Frankfurt) is set in `fly.toml`; others are `ams`, `cdg`, `lhr`, `arn`, `sin`, `jnb`.

Do one step, check the "You should see", then go to the next.

1. **Account and tool.** Create an account at fly.io (you do this yourself, with your own card). Install `flyctl` from Fly's install page, then run `fly version` and `fly auth login`. *You should see a version number, then a browser sign-in that ends with you logged in.*
2. **Create the app, without deploying.** In the Ringside folder: `fly launch --no-deploy --copy-config`. Pick a unique app name, region `fra`, and say **no** to any database or Redis. *You should see `fly.toml` updated with your app name.*
3. **Create the disk once.** `fly volumes create ringside_data --size 5 --region fra`. *`fly volumes list` shows exactly one row.*
4. **Set your public settings.** `fly secrets set SITE_URL=https://YOURAPP.fly.dev SITE_CONTACT=you@example.com`. *`fly secrets list` shows the names, never the values.* The vendor API key does not go here in chat or on a command line: it is entered through the hidden prompt of `npm run vendor:fetch -- --setup` (see [go-live.md](go-live.md)).
5. **Deploy exactly one machine.** `fly deploy --ha=false`. The first build takes several minutes. *You should see the machine start.*
6. **Make sure it is one.** `fly scale count 1`, then `fly status`. *Exactly one machine and one volume. If you see two of either, stop and ask.*
7. **Check it is alive.** Open `https://YOURAPP.fly.dev/api/health`. *You should see `"status":"ok"`. The first start can take up to two minutes.*
8. **Check the setup.** `fly ssh console`, then `npm run doctor -- --production`. *No failure lines.* If it says the data folder is not writable, run `chown -R node:node /data` in that console, exit, and run `fly machine restart`.
9. **Visitor-address rule (check before real visitors).** `fly.toml` sets `CLIENT_IP_HEADER=Fly-Client-IP`, so per-visitor limits use the address Fly sets, not one a visitor can type. Fly's docs say they set that header but not that they overwrite a copy sent by the visitor, so test it: `sh scripts/fly-ip-test.sh https://YOURAPP.fly.dev` (25 sign-in attempts for users that do not exist, each claiming a different address; read the script's header first). *You should see `GOOD`: the 21st attempt is refused.* On `BAD`, per-visitor limits can be bypassed: stop and ask Claude. Your own address then cannot sign in for up to 15 minutes. (The public API cannot serve as the test: it is off for licensed data.) **Result on the owner's app (ringsidedb, 2026-10-09): GOOD** (20 attempts answered 401, the next 5 refused with 429): Fly overwrites a visitor-written `Fly-Client-IP`, so the per-visitor limits use the real address.
10. **Load real data and turn on the nightly job.** First put the finished database on the disk: [ship-database.md](ship-database.md). Then follow [go-live.md](go-live.md) / [load-day.md](load-day.md). Then uncomment `NIGHTLY_SCHEDULE = "03:30"` in `fly.toml` and run `fly deploy --ha=false` again; run `npm run nightly` once by hand in `fly ssh console` to watch the first night ([nightly.md](nightly.md)).
11. **Your own domain** (later): follow Fly's custom-domain page, then change `SITE_URL` with `fly secrets set`.
12. **Monitor and backups.** Point an uptime monitor at `/api/health` and alert on `"stale":true`. Fly's snapshots are not enough on their own (their docs say the latest data may be missing); copy the newest folder of `/data/backups` somewhere off Fly regularly ([nightly.md](nightly.md)). By hand, from your own computer (not yet tried; flyctl's `ssh sftp` options are from its help text): `fly ssh console -a YOURAPP -C "ls -1 /data/backups"` shows the folder names (the newest is last); then `fly ssh sftp get -R /data/backups/NEWEST ~/ringside-backups/NEWEST -a YOURAPP`, and check the copy with `npm run backup -- verify ~/ringside-backups/NEWEST`. *You should see the verify line say the checksums and integrity checks pass.* Do the same weekly until it is a habit; a scheduled copy from your computer (a calendar reminder is enough) beats none.

**Rolling back code:** deploy the earlier commit again. The disk is not rolled back by a code deploy; use `npm run backup -- restore`.

## Deploy on every push

`.github/workflows/deploy.yml` deploys the code to Fly whenever CI has passed on `main`: what you push to GitHub reaches the live site a few minutes later. It deploys code only; the database on Fly's volume is not touched (shipping data stays a separate step: [ship-database.md](ship-database.md)).

**One-time setup (you, in your own terminal; I cannot run Fly commands):**

1. Make a deploy token for the app: `fly tokens create deploy -a ringsidedb` (it prints a long string starting `FlyV1`; copy it).
2. Store it as a GitHub secret, pasting the token when asked: `gh secret set FLY_API_TOKEN --repo Arahmed001/ringside`
3. Done. Check **Actions → Deploy to Fly** after the next push to `main`.

**What it will not do:** deploy a red `main`; deploy a change to Markdown and `docs/` only; deploy while the nightly update is running (it says so in the run and stops; **Run workflow** on the Actions page deploys later); run two deploys at once. Without the secret it does nothing. To switch it off, delete the secret or the workflow file.

**Undo a bad deploy:** deploy the earlier commit again (`fly deploy --ha=false -a ringsidedb` from that commit, or revert on `main` and push). The disk is not rolled back.
