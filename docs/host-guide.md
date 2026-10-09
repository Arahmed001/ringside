# Choosing a host: a guide for the owner

You have not chosen a host yet. This page helps you choose one and then deploy to it. It is the "which host" companion to [go-live.md](go-live.md) (the plain steps once you have one) and [deploy.md](deploy.md) (the technical detail). It covers four options: Fly.io, Render, Railway, and a plain rented server (a VPS) at Hetzner or DigitalOcean.
> Fly.io chosen: see [fly-deploy.md](fly-deploy.md) and `fly.toml` (they supersede the Fly section's "needs an image change" notes).

**Two updates since this page was written.** (1) The nightly job can now run **inside the one container**: see [nightly.md](nightly.md) (`NIGHTLY_SCHEDULE='HH:MM'` starts it beside the site, with a verified backup first). So where this guide says the nightly job "needs an image change that is not built" (Fly, Render, Railway), that change now exists; it is untested on a real host, so run `npm run nightly` by hand on the first night. (2) A parallel price-and-regions comparison is in [hosting-options.md](hosting-options.md); where the two differ on a price or a plan, the provider's own page wins. That page also names `npm run data:ingest` as the nightly job; for the real vendor data it is the update in [nightly.md](nightly.md) and [load-day.md](load-day.md) step 8.

**How to trust this page.** The provider facts below were read on the providers' own documentation pages on **2026-10-07** (the page is named each time). Anything I could not read there is marked **unverified: check the provider's page**. Prices change; check the provider's page before you pay. No command here was run against a real account: every first deployment below is a plan to follow with care, and the project has never been deployed to any host yet (deploy.md, "Not covered yet").

Words: a **volume** or **disk** is the permanent disk the data lives on. A **vCPU** is one virtual processor. A **reverse proxy** is the front door that takes visitors' requests and passes them to the site.

## 1. What Ringside needs from any host

These come from the project's own docs ([deploy.md](deploy.md), [capacity.md](capacity.md), [real-data-runbook.md](real-data-runbook.md), [go-live.md](go-live.md), `Dockerfile`, `lib/doctor.ts`). They are not negotiable; a host that cannot meet one is the wrong host.

| # | Requirement | Why |
|---|---|---|
| 1 | **Exactly one running copy.** | One Node process, one SQLite file. A second copy has its own database, prediction ledger and AI counters, and they drift apart. Scaling out is "a design change, not a setting" (deploy.md). |
| 2 | **A permanent disk mounted at `/data`** holding `ringside.db`, `accounts.db` (and their `-wal`/`-shm` files) and `model-fit.json`. | The ledger and the accounts cannot be rebuilt. No volume means every restart loses them. |
| 3 | **Runs the Docker container** built from the repo's `Dockerfile` (Node 22, runs as the unprivileged `node` user, port 3000). | The container is the unit of deployment. |
| 4 | **2 GB RAM minimum, no heap cap.** | After the memory diet (capacity.md): about 0.71 GB at start, 1.1 to 1.2 GB under load, **about 1.4 GB at the worst moment** (a data update rebuilding the in-memory world; peak 1.38 to 1.42 GB in three runs). That leaves **0.6 GB of margin** on 2 GB. 1 GB is not enough. 3 GB is better if the host has it. |
| 5 | **2 vCPU.** | One thread does the work; the second core adds about 35 to 40% (about 15 requests a second on one core, 21 on two). More than 2 is wasted on one copy. One vCPU works at about 70% of the speed. |
| 6 | **A reverse proxy or CDN that OVERWRITES `X-Forwarded-For`, and the container's own port is not published to the internet.** | The per-visitor AI limit, the sign-in and sign-up limits and the public-API limit (60 a minute per address) are keyed on that header (first entry, or `X-Real-IP`). If a visitor can reach the container directly or the proxy only appends, they can pick any address they like. Without the header every visitor shares one bucket. |
| 7 | **https** in front, with `X-Forwarded-Proto: https` (or `SITE_URL=https://...`) and the public name kept in `Host`/`X-Forwarded-Host`. | Session cookies are marked `Secure` and state-changing requests are checked against the public `Origin` (CSRF). |
| 8 | **A place to run the nightly update** (`vendor:fetch -- --update`) **that can write the database**: the same machine and volume. The host must allow a scheduled job, or a cron inside or beside the container. | The real league goes stale without it, and the site shows no warning on the page. |
| 9 | **Backups copied off the host** (`npm run backup`, and `npm run backup -- restore` to put one back). | A backup on the disk that dies is not a backup. |
| 10 | **An uptime monitor on `/api/health`** that alerts on the text `"stale":true` and on no answer. | A stopped nightly job never turns the site into an error; this is the only alarm. |

Two things worth knowing before you compare plans:

- **The nightly job needs memory too.** The update is a separate process (the runbook measured one at about 340 MB, on a 19,000-fighter test league; the real figure is unknown). If it runs inside the same 2 GB container while the site is at its 1.4 GB peak, the total is roughly 1.75 GB (my calculation, not a measurement), which shrinks the 0.6 GB margin to about 0.25 GB. Run it in a quiet hour, and prefer 3 GB or 4 GB where the price difference is small. Ask Claude to measure this on the real host once you have one.
- **The command in a container.** [load-day.md](load-day.md) shows the nightly job as `npm run vendor:fetch -- --update`, which reads the vendor key from a file in the machine's home directory. [real-data-runbook.md](real-data-runbook.md) section 5 shows the in-container form, `npm run vendor:backfill -- --update --cache-dir /data/vendor-cache`, which reads the key from the container's environment (`BOXING_API_KEY`, `BOXING_API_STORAGE_CONFIRMED`, `DATABASE_PATH`). In a container use the second; `vendor:fetch` is a wrapper around it. The "nightly job" below means that command.

## 2. The options at a glance

Legend: **yes** = met as the provider's docs describe it; **workaround** = met only with extra work (listed below); **unverified** = I could not confirm it from the provider's own pages.

| Requirement | Fly.io | Render | Railway | VPS (Hetzner / DigitalOcean) |
|---|---|---|---|---|
| 1. One copy | yes (you must keep it at one; see Fly section) | yes (a disk forbids more than one) | yes (replicas cannot be used with volumes) | yes (one server, one container) |
| 2. Volume at `/data` | yes | yes (paid service) | yes | yes (a folder or volume on the server's own disk) |
| 3. Docker | yes | yes | unverified (Dockerfile page not readable) | yes (you install Docker) |
| 4. 2 GB, no heap cap | yes | yes | yes (you pay for what you use) | yes |
| 5. 2 vCPU | **workaround**: shared CPUs are throttled; dedicated is dearer | yes (larger plan) | yes (you pay per vCPU) | yes |
| 6. Proxy overwrites `X-Forwarded-For`, port not public | **unverified**; likely workaround | **unverified** | **unverified**, sources disagree | yes if you use Caddy and publish no port (you set it up) |
| 7. https | yes (`force_https` setting) | yes (managed certificates) | yes (listed under public networking) | yes with Caddy (you set it up) |
| 8. Nightly job writes the database | **workaround**: must run inside the one machine | **workaround**: cron jobs cannot see the disk | **unverified**; assume workaround | yes (host cron plus `docker exec`) |
| 9. Backups off the host | workaround (you do it) | workaround (you do it) | workaround (you do it) | workaround (you do it) |
| 10. Monitor on `/api/health` | external service (any host) | external service | external service | external service |

Backups and the monitor are on you with every option: the host's own snapshots live in the same company's storage, and none of them is a copy "off the host" in the sense that protects you if the account is lost.

## 3. Option A: Fly.io (managed containers with volumes)

Sources read 2026-10-07: Fly docs pages "Pricing" (docs.fly.io/about/pricing), "Volumes overview", "CPU performance", "Request headers", "Scale count", "Task scheduling", "App configuration (fly.toml)" and "Manage volumes".

**Fit.** Container with a volume: yes. One copy: yes, but Fly's docs say that on a first deploy of an app with volumes it creates **two machines** by default (redundancy), and that "fly deploy --ha=false" and "fly scale count 1" control that (the page does not describe the flag in detail). Each volume is attached to only one machine, and "Fly.io does not automatically replicate data among the volumes", so a second machine would be a second, empty, drifting database. You must end up with exactly one machine and one volume, and check it (step 7 below).

**Smallest plan.** Fly sells machine "presets". The page lists: `shared-cpu-2x` with 2GB RAM at **$13.39/month**, `performance-1x` with 2GB at **$33.00/month**, `performance-2x` with 4GB at **$66.00/month**. The catch is in the "CPU performance" page: `shared` CPUs have a **6.25% baseline** each ("5ms per 80ms period"), quotas are pooled across a machine's vCPUs, and a shared machine is "throttled" when it runs out of burst balance; `performance` CPUs are not restricted. Ringside is one busy thread, so on shared CPUs a sustained burst (a busy evening, the nightly update, a restart that builds the world) can be throttled. I have not measured Ringside on a shared Fly CPU. Reading: `shared-cpu-2x` 2 GB is the cheap way to try it; `performance-2x` (the page shows it at 4GB only, $66.00) is the way to be sure; `performance-1x` has only one vCPU (about 70% of the speed). Whether `performance-2x` is sold with 2 GB: **unverified: check the provider's page.** Volumes: **$0.15/GB/month**; snapshots **$0.08/GB/month, first 10 GB free each month**; dedicated IPv4 **$2/month**; outbound data **$0.02/GB** in North America and Europe.

**Volume.** Local NVMe on one server in one region. The docs state plainly that if that drive fails, "that instance of your app goes down", and that "Daily automatic snapshots may not have your latest data." Snapshots are kept 5 days by default, configurable 1 to 60 (`snapshot_retention` in `[mounts]`). Volumes can grow (`fly volumes extend <volume id> -s <new size in GB>`), not shrink. Restore from a snapshot: `fly volumes create <volume name> --snapshot-id <snapshot id> -s <size in GB>` (it makes a new volume; it does not overwrite).

**Permissions (a likely first stumble).** The `Dockerfile` runs as user `node`. The Fly community forum (not the official docs, so **unverified**) reports that a mounted volume can end up owned by root when an image drops privileges, and the container then cannot write to it. `npm run doctor` fails with "The data folder ... is not writable by this user" if so. The community fix is to `chown` the folder as root from a console on the machine; Ringside's `node` user id is 1000 on the `node:22-slim` image (check with `id node`: **unverified here**).

**Nightly job.** Fly's "Task scheduling" blueprint lists: Cron Manager (a separate small app that starts a temporary machine per job), **Supercronic** inside your container (`cron = "supercronic /app/crontab"` in `fly.toml`, "Only run one copy of the cron process"), and Scheduled Machines (hourly, daily, weekly buckets, "not for precise timing"). Because a volume can attach to only one machine (verified above), a separate temporary machine **cannot mount the database volume**, so Cron Manager and Scheduled Machines cannot write the live database. That leaves **Supercronic inside the same container**. The `Dockerfile` does not install it today, so this needs a small image change (a docs-only task here; ask Claude to make and test it). Whether `fly ssh console -C "<command>"` run from some outside scheduler works: **unverified: check the provider's page** (the ssh pages I tried were not readable).

**https and the header rule.** `force_https` in `[http_service]` redirects http to https (verified in the configuration reference); certificate handling was not on a page I read: **unverified**. The "Request headers" page says Fly sets `Fly-Client-IP` and that the rightmost `X-Forwarded-For` entry is an address assigned to your app, which means `X-Forwarded-For` is a **list that accumulates**; it does not say whether a client-supplied value is overwritten. Ringside trusts the **first** entry. So on Fly the safe reading is: **not proven to meet requirement 6**. A fix that has not been tested: a tiny Caddy inside the same container, listening on 3000 and sending to the app on another port, setting `X-Forwarded-For` from `Fly-Client-IP`. Also, only the app's public service ports are reachable on Fly (the app is not reachable "by its own port" except through Fly's proxy), but I did not read a page that says so: **unverified**.

**Backups off the host.** Fly's snapshots do not count. Run `npm run backup` in the container on a schedule (the same Supercronic file) and pull the newest `/data/backups/<folder>` out with a console file copy: the exact Fly command is **unverified**. Ask Claude to add a pull script once you have chosen.

**Rollback.** Code: redeploy the previous commit (`fly deploy` from the old git commit builds it again); a "previous release" command exists in Fly but I did not read it: **unverified**. Data: the volume is not rolled back by a code deploy; use `npm run backup -- restore` or a snapshot restore as above. Downgrading the image against a newer database is not supported (deploy.md).

**First deployment** (an untested plan; the `fly` commands are only those the pages I read name, the rest you must confirm in Fly's own `fly launch` prompts):

1. Create a Fly account and install `flyctl` from Fly's own install page (**unverified here**). You should be able to run `fly version` and `fly auth login`.
2. In a copy of the repo, run `fly launch` and answer: do not deploy yet; region near your readers; do **not** accept a database or Redis. You should see a new `fly.toml`. Open it and set: `internal_port = 3000`, `force_https = true`, `auto_stop_machines = "off"`, `min_machines_running = 1`, a `[mounts]` block with `source = "ringside_data"` and `destination = "/data"`, and a `[[vm]]` block (for example `size = "shared-cpu-2x"`, `memory = "2gb"`, or `cpu_kind = "performance"`, `cpus = 2`, `memory = "4gb"` for the sure option). You should see these lines when you reopen the file. (Do not commit secrets into it.)
3. Create the volume once: `fly volumes create ringside_data` (add the size option for 5 GB or more; see the sizing note in capacity.md). You should see it with `fly volumes list`, one row, in your region.
4. Put your settings in Fly's secrets store, never in `fly.toml`: `SITE_URL`, `SITE_CONTACT`, optionally `ANTHROPIC_API_KEY`. The command for secrets is **unverified here**: use `fly secrets --help`. You should see the names (never the values) listed.
5. Deploy with one machine only: `fly deploy --ha=false`. You should see the build, then the machine start; the first start takes 11 to 16 seconds before it answers.
6. Make it one machine: `fly scale count 1`, then `fly status`. You should see exactly **one** machine and `fly volumes list` exactly **one** volume. If you see two of either, stop and ask before going on.
7. Open `https://<app>.fly.dev/api/health`. You should see `"status":"ok"`. Then open a console (`fly ssh console`) and run `npm run doctor -- --production`. You should see no failure lines (a failure about the data folder not being writable is the permission issue above).
8. Point your own domain at the app (Fly's custom-domain steps: **unverified here**), set `SITE_URL` to it, and run section 4 of [go-live.md](go-live.md). Add the monitor (section 9 below).
9. **Test the header rule before real visitors:** this is the unverified part. Ask Claude to add a one-line check, and do not turn on real data until it passes.

## 4. Option B: Render (a platform-as-a-service with persistent disks)

Sources read 2026-10-07: Render docs "Persistent Disks", "Compute plans", "Cron jobs", "Rollbacks", "SSH / Shell access", "Web services". The pricing page itself was **not readable** for me (the page text had no figures).

**Fit.** Docker and a disk: yes (the web-services page shows Docker image and Git deploys; "Render's load balancer terminates SSL for inbound HTTPS requests, then forwards those requests to your web service over HTTP"). One copy: yes by rule: "You can't scale a service to multiple instances if it has a disk attached." Two costs of a disk: "Adding a disk to a service prevents zero-downtime deploys" (each deploy has a short outage while the old copy stops), and disks "cannot be accessed from other services, during build/pre-deploy commands, or via one-off jobs".

**Smallest plan.** The Compute plans page lists web-service plan IDs: `1c-2g` (1 CPU, 2 GB, legacy name Standard), `2c-4g` (2 CPU, 4 GB, legacy name Pro), then 2 CPU at 8 GB and 16 GB. **There is no 2 CPU / 2 GB plan.** The smallest that meets 2 GB and 2 vCPU is therefore **`2c-4g`**; `1c-2g` meets 2 GB but gives one CPU (about 70% of the speed). A search summary of render.com pages reported `1c-2g` at $25/month and disks at $0.25/GB/month; I could not read either on the page itself, so treat them as **unverified: check the provider's page**. The price of `2c-4g` and any workspace-plan fee: **unverified: check the provider's page.** The disk feature needs a **paid** service (verified).

**Volume.** One disk per service, mounted at a path you choose (use `/data`); only that path persists, the rest of the filesystem is wiped on every deploy. You can grow it without downtime but never shrink it. Snapshots: "once every 24 hours", kept at least 7 days; restores replace the **whole disk** only. Do not mount a disk on the running user's `$HOME`.

**Nightly job.** Render's Cron Jobs are a separate service type and **"can't provision or access a persistent disk"**, with a $1 a month minimum. So a Render cron job can never open Ringside's database. The job has to run **inside the web service's container** (a cron or a small scheduler started beside the site, which needs a change to the image: ask Claude) . Shell access is by the dashboard's Shell page or SSH (paid services only), which you can use for manual runs.

**https and the header rule.** https: yes, managed certificates. The header: Render's own pages I read do not say what happens to a client-supplied `X-Forwarded-For`. A search result for Render's articles said the traffic passes through Cloudflare and Render's load balancers, that Cloudflare **appends** to `X-Forwarded-For`, and that `CF-Connecting-IP` is the value a caller cannot forge. I did not read that on a docs page, so it is **unverified**, but if true then Ringside's "first entry" rule is spoofable on Render, and requirement 6 needs a fix (a small proxy in the container that rewrites the header from `CF-Connecting-IP`; ask Claude, not yet built or tested). Whether the service's own port is reachable another way: **unverified**.

**Backups off the host.** Snapshots are Render's and whole-disk. Run `npm run backup` from inside the service on a schedule, and pull the folder with SSH (`scp` over Render's SSH after you set up keys; the exact host form is on Render's SSH page: **unverified here**).

**Rollback.** "Instant rollbacks" are verified, but: "Disks retain state between all deploys and cannot be rolled back. Separately from rolling back, you can restore a disk snapshot." You can only roll back to a deploy whose build artifact is still retained. So a rollback changes the code only; to undo data use `npm run backup -- restore`.

**First deployment** (untested plan):

1. Create a Render account and connect your GitHub repo (or push a built image). You should see the repo in the New Web Service screen.
2. New Web Service: runtime **Docker**, plan **`2c-4g`** (or `1c-2g` to start smaller). Under Disks add a disk with mount path `/data` (at least 5 GB; the plan page for sizes: **unverified**). You should see the disk listed on the service's page.
3. Environment: add `SITE_URL`, `SITE_CONTACT`, optionally `ANTHROPIC_API_KEY`, as environment variables or secrets. If the build asks for a port, it is `3000`. You should see no value shown after saving a secret.
4. Make sure the instance count is **1** (it cannot be more with a disk) and deploy. You should see the build, then "Live"; the first start takes up to 16 seconds to answer.
5. Open `https://<service>.onrender.com/api/health`. You should see `"status":"ok"`. In the Shell page run `npm run doctor -- --production`. You should see no failures. (If it says the data folder is not writable, stop; Render's volume permission behaviour for the `node` user was not on a page I read: **unverified**.)
6. Add your domain and set `SITE_URL` to it. Run [go-live.md](go-live.md) section 4.
7. The nightly job and the header rule both need image changes before real data goes on this host. Do not load real data until Claude has built and tested both.

## 5. Option C: Railway (usage-billed containers with volumes)

Sources read 2026-10-07: Railway docs "Volumes", "Volume backups", "Cron jobs", "Plans and pricing". The Dockerfile, rollback and header pages were not readable (404 or off-topic).

**Fit.** Volume: yes, mounted at the path you set. One copy: yes: "Replicas cannot be used with volumes", "Each service can only have a single volume". A redeploy has a "small amount of downtime" because two copies are never mounted at once. Docker: **unverified** (a Dockerfile in the repo is the normal route, but I could not read the page).

**Smallest plan and cost.** Plans: Hobby **$5/month** (includes $5 of usage), Pro **$20/month** (includes $20). Per-unit prices: RAM **$10/GB/month**, CPU **$20/vCPU/month**, volume **$0.15/GB/month**, egress **$0.05/GB**. Limits per service: 48 GB RAM and 48 vCPU on Hobby. Volume sizes: 0.5 GB on Free and Trial, **5 GB on Hobby**, 50 GB on Pro. My calculation: 2 GB and 2 vCPU running all month would be 2 x $10 + 2 x $20 = **$60** of usage, plus the 5 GB volume ($0.75) and the plan fee, less the included credit; Railway bills what the process actually uses, so a mostly idle site costs less, but Ringside holds about 0.7 to 1.2 GB in memory all the time, so the memory part is close to fixed. Per-minute billing details: **unverified: check the provider's page.** This is the dearest of the four at a steady load.

**Volume.** Billed "per GB / minutely". Deleted volumes can be restored for 48 hours. Backups: Daily (kept 6 days), Weekly (27 days), Monthly (89 days) are the options; **whether Hobby has backups is not stated**; restore mounts a new volume and keeps the old one unmounted; the page lists known issues including "volume wiping deleting all backups". Manual backups are limited to 50% of the volume's size. **Permissions:** for images that run as a non-root user (this one does, as `node`), the volumes page says there "will be permissions issues" and tells you to set the variable **`RAILWAY_RUN_UID=0`** (which runs the container as root: a security trade-off, so ask before accepting it). Files can be handled with `railway volume browse` or `railway volume files`, and over `sftp`/`scp` through the service (`railway ssh`).

**Nightly job.** Railway cron services run on a schedule ("at least 5 minutes apart in UTC") and must **exit when done**. The pages I read do not say whether a cron service can mount the same volume as the web service; each service has its own single volume, so assume **no** until proven (**unverified**). The safe route is a cron inside the web service's container (an image change), or an external scheduler that runs a command through `railway ssh` (not verified).

**https and the header rule.** Public networking with managed certificates is listed on a page I could not use for details. For the header, the search results were **in conflict**: Railway's own community forum threads (not docs pages) said both that Railway appends the client address to `X-Forwarded-For` and does not strip client values (rightmost is trusted), and that it controls the header so the first entry is the real address; a rollout of a CDN layer reportedly sets `X-Real-Ip` to the CDN's address for now. That is **unverified and contradictory**: do not rely on it. Until a test proves that a forged `X-Forwarded-For` sent by you is replaced, treat requirement 6 as a **workaround needed**.

**Backups off the host.** Railway's backups do not count as off-host. Run `npm run backup` inside the service, and pull the newest folder with `railway ssh` plus `scp`/`sftp` (the file-copy route the volumes page names).

**Rollback.** Railway rollbacks: **unverified** (page not readable). Redeploy the previous commit; data is restored with `npm run backup -- restore` or a Railway backup restore.

**First deployment** (untested plan):

1. Create a Railway account, choose the Hobby plan or higher, and create a project from your GitHub repo. You should see a service building from the `Dockerfile`.
2. In the service, add a **Volume** with mount path `/data`. You should see it listed under the service. Set `RAILWAY_RUN_UID=0` only if `npm run doctor` says the data folder is not writable.
3. Variables: `SITE_URL`, `SITE_CONTACT`, optionally `ANTHROPIC_API_KEY`. Set the service's resources so it can use 2 GB and 2 vCPU (where this setting lives: **unverified**). You should see the variables listed with values hidden.
4. Generate a public domain, set `SITE_URL` to it, and redeploy. You should see the deployment go live after a short gap.
5. Open `<domain>/api/health`. You should see `"status":"ok"`. Run `npm run doctor -- --production` through `railway ssh`. You should see no failures.
6. Do not load real data until the nightly job route and the header test are settled (see above).

## 6. Option D: a plain VPS with Docker (Hetzner or DigitalOcean)

Sources read 2026-10-07: DigitalOcean "Droplet pricing" (digitalocean.com/pricing/droplets); Hetzner "Cloud" and "Regular performance" pages (hetzner.com/cloud) and the Hetzner docs "Backups and snapshots"; Caddy docs "reverse_proxy"; Docker docs "Packet filtering and firewalls". Hetzner's pages showed plan sizes but **no prices** to me.

This is the option with the most control and the fewest "platform rules" in the way. The price is that **you run a server**: updates to the operating system, the firewall, Docker, and the reverse proxy are your job.

**Fit.** Everything is yes because you decide: one container, a folder or Docker volume on the server's own disk for `/data`, host cron for the nightly job (`docker exec`), and your own proxy. Requirement 6 is met by Caddy: its docs say "for these `X-Forwarded-*` headers, by default, the proxy will ignore their values from incoming requests, to prevent spoofing", which is exactly the overwrite rule Ringside needs, and `reverse_proxy localhost:8080` is the minimal form. (Do not add Caddy's `trusted_proxies` unless you put another proxy in front of Caddy.)

**One trap, from Docker's own docs:** "When you publish a container's ports using Docker, traffic to and from that container gets diverted before it goes through the ufw firewall settings." So **do not publish Ringside's port** (do not use `-p 3000:3000`); put Ringside and Caddy on one Docker network and publish only Caddy's 80 and 443. Then there is no direct path to the app to forge headers through.

**Smallest plan.**
- **DigitalOcean:** the pricing page lists **2 GiB / 2 vCPUs / 60 GiB SSD / 3,000 GiB transfer at $18.00/month** ($0.02679/hour). Whether the CPU is shared or dedicated at that size was not stated on what I read: **unverified**. Backups: "20% (Weekly) or 30% (Daily) of Droplet cost", or usage-based "start at $0.01/GiB per month" with retention of 3 days to 6 months.
- **Hetzner:** plan names and sizes read on the "Regular performance" page: `CPX12` is 1 vCPU / 2 GB / 40 GB, **`CPX22` is 2 vCPU / 4 GB / 80 GB**, with 20 TB of traffic in the EU. A search result (not the provider's page, so **unverified**) gave `CX23` (2 vCPU / 4 GB, cost-optimised, EU only) at about 3.99 EUR/month and `CPX22` at about 7.99 EUR/month, with prices adjusted from 1 April 2026. **Check the price on hetzner.com/cloud.** Hetzner has no 2 vCPU / 2 GB size on what I read; the 4 GB size is the smallest with 2 vCPUs and gives better headroom for the nightly job. Hetzner docs: up to 7 backup slots per server; the backup price is on their page, not read.

**Disk and the volume.** The server's own disk is enough (the database is 62 MB at the real size; 5 GB of space is plenty, capacity.md). Use a Docker named volume or a host folder owned by the `node` user (user id 1000 on the Node image: check with `docker run --rm node:22-slim id node`). A server disk failing loses everything on it: the host's snapshot or backup add-on is a safety net, not your off-host copy.

**Nightly job.** Host cron, the form the runbook already describes: `docker exec ringside npm run vendor:backfill -- --update --cache-dir /data/vendor-cache >> /data/vendor-update.log 2>&1`, with the key and `BOXING_API_STORAGE_CONFIRMED` in the container's environment. Same machine, same volume, nothing to work around.

**Backups off the host.** Host cron: `docker exec ringside npm run backup`, then copy the newest folder with `rsync`, `scp` or `rclone` to another provider's storage or your own computer. (Hetzner's and DigitalOcean's storage products are other options; I did not read their pages.) Verify and rehearse restores as in go-live.md section 5.

**Rollback.** `git checkout` the previous commit, rebuild the image, and recreate the container on the same volume; restore data with `npm run backup -- restore` (go-live.md section 5). Taking a server snapshot before an update gives a second way back.

**First deployment** (untested plan; I give no operating-system commands because I did not read a page for them: follow each vendor's own install page):

1. Create the server (Ubuntu LTS is a safe choice: **unverified recommendation**), choose the size above, add your SSH key. You should be able to log in with `ssh root@<ip>`.
2. Install Docker following docs.docker.com's install page for your operating system. You should see `docker run --rm hello-world` print its greeting.
3. Create a firewall that allows only SSH, 80 and 443 (the vendor's cloud firewall is the safe place for it, because Docker bypasses `ufw`). You should see other ports closed from outside (try from your computer).
4. Get the code (`git clone`) and build: `docker build -t ringside .`. You should see "Successfully tagged" or the build finishing without error.
5. Write a `docker-compose.yml` (a sketch for Claude to commit and test; **not in the repo today**): two services, `ringside` (the built image, `restart: unless-stopped`, a named volume at `/data`, the environment settings, **no `ports:`**) and `caddy` (publishes 80 and 443, a Caddyfile `ringside.example { reverse_proxy ringside:3000 }`). Caddy's automatic https was not on the page I read: **unverified**; point your domain's DNS at the server first. You should see `docker compose up -d` start both, and `docker compose ps` show `ringside` as healthy after about two minutes.
6. Open `https://your-domain/api/health`. You should see `"status":"ok"`. Run `docker compose exec ringside npm run doctor -- --production`. You should see no failures.
7. Prove the header rule: from your computer run `curl -sI https://your-domain/ -H 'X-Forwarded-For: 1.2.3.4'` and `curl -s http://<server-ip>:3000/api/health` (the second should **not** connect). You should see the second fail to connect.
8. Add the host cron lines (nightly update, nightly backup, copy off the host) and the monitor (section 9). Run [go-live.md](go-live.md) section 4.

## 7. What is the same on every option

- **Backups off the host, always.** Daily `npm run backup`, then `npm run backup -- verify <folder>`, then copy the folder somewhere that is not the host, and once do a `--dry-run` of `npm run backup -- restore <folder>` (go-live.md sections 2 and 5). The accounts file is personal data: private storage only.
- **Secrets** in the host's secrets screen, never in the repo or `fly.toml`-style files that are committed.
- **Settings:** `SITE_URL` (https public address), `SITE_CONTACT`, optionally `ANTHROPIC_API_KEY`; real-data keys only when you load real data (`.env.example`).
- **After every first deploy,** run `npm run doctor -- --production` inside the container. It checks the data folder is writable, both databases open, `SITE_URL` is a real https origin, a recent backup exists and free disk is enough.

## 8. Recommendation

| If you are... | Pick | Why, and the catch |
|---|---|---|
| **Lowest effort**, willing to pay more | **Render** with the `2c-4g` plan, once the nightly job and the header proxy are added to the image | Dashboard-driven; managed https; instant rollbacks. Catches: no cron on the disk (job runs inside the container), header rule unproven, short outage per deploy, price **unverified**. |
| **Lowest cost** | **Hetzner** (`CPX22` or `CX23`) or **DigitalOcean** ($18/month for 2 GiB / 2 vCPU) | Cheapest by a wide margin on what I read, and every requirement is easy to meet. Catch: you run the server (updates, firewall, backups); Hetzner's price is **unverified**. |
| **Most control** | **Hetzner or DigitalOcean VPS** | Your own proxy, your own cron, your own backups, no platform rule between you and the database. Catch: it is all yours to keep patched. |
| Comfortable with a command line, want a managed platform | **Fly.io** | Real volumes, snapshots, fine scaling controls. Catches: two machines by default (must be one), shared CPUs throttle (the sure plan is $66/month), header rule unproven, nightly job needs Supercronic in the image. |
| **Railway** | Only if you already use it | Dearest at steady load (about $60/month of usage at 2 GB and 2 vCPU, by my calculation), several answers **unverified**, and it asks you to run as root to write the volume. |

My own reading: for an owner who does not want to run a server, **Render** or **Fly.io** after the two small image changes; for the lowest bill and the cleanest fit to the requirements, a **VPS with Caddy** in front. I have not tried any of them with Ringside.

## 9. The uptime monitor (every option)

Any monitor that can alert when a page **contains text** will do (several have a free plan; I have not tried any against your host): point it at `https://your-address/api/health`, alert on the text `"stale":true` and on no answer, and send alerts to an address you read daily. What to do when it fires: [go-live.md](go-live.md) section 6.

## 10. The five decisions you must make

1. **Which option?** (Lowest effort, lowest cost, or most control; the table above.) Write down the name and login.
2. **Which size, and how much margin?** 2 GB / 2 vCPU is the minimum; 3 to 4 GB is safer for the nightly update. What monthly price are you willing to pay (check the provider's page for today's price)?
3. **Which public address?** The domain name (it becomes `SITE_URL`), who owns the DNS, and the mailbox for `SITE_CONTACT`.
4. **Where do backups go?** A second company or your own computer, and who copies them daily (and who checks a restore works).
5. **Who gets the alerts, and who runs the host?** The monitor's email address, and whether you will do the server or platform upkeep yourself (a VPS asks the most).

## 11. What Claude can do once you choose

- Make the changes the chosen host needs, with tests: a `docker-compose.yml` and `Caddyfile` (VPS); the nightly-job scheduler inside the image (Fly, Render, Railway); a small step that rewrites `X-Forwarded-For` from the host's trusted header; a script that pulls the newest backup off the host.
- Write the exact settings file for that host (`fly.toml`, a Render blueprint or a Railway config) after reading that provider's docs again, and measure the real memory, including the nightly update inside the same container.
- Add a check that proves a forged `X-Forwarded-For` is ignored, and a deploy check list based on [go-live.md](go-live.md) sections 4 and 6.
- Walk you through each step and read what you paste back.

I cannot log in to your host, and I will not guess at it. You do the clicking and typing, and tell me what you see after each step.
