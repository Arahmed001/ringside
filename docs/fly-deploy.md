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
9. **Visitor-address rule (check before real visitors).** `fly.toml` sets `CLIENT_IP_HEADER=Fly-Client-IP`, so per-visitor limits use the address Fly sets, not one a visitor can type. Fly's docs say they set that header but not that they overwrite a copy sent by the visitor, so this is unproven. Ask Claude for the exact test once the site is up; until then, treat per-visitor limits as unproven.
10. **Load real data and turn on the nightly job.** First put the finished database on the disk: [ship-database.md](ship-database.md). Then follow [go-live.md](go-live.md) / [load-day.md](load-day.md). Then uncomment `NIGHTLY_SCHEDULE = "03:30"` in `fly.toml` and run `fly deploy --ha=false` again; run `npm run nightly` once by hand in `fly ssh console` to watch the first night ([nightly.md](nightly.md)).
11. **Your own domain** (later): follow Fly's custom-domain page, then change `SITE_URL` with `fly secrets set`.
12. **Monitor and backups.** Point an uptime monitor at `/api/health` and alert on `"stale":true`. Fly's snapshots are not enough on their own (their docs say the latest data may be missing); copy the newest folder of `/data/backups` somewhere off Fly regularly ([nightly.md](nightly.md)).

**Rolling back code:** deploy the earlier commit again. The disk is not rolled back by a code deploy; use `npm run backup -- restore`.
