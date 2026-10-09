# Knowing when something is wrong

Two free, independent checks. Together they catch a down site, stale data, a failed night, and a night that never happened.

## 1. Is the site up and the data fresh? (`/api/health?strict=1`)

`https://<your site>/api/health` answers 200 with the counts and the age of the data. Add **`?strict=1`** and it answers **503** (`"status":"degraded"` and a `reasons` list) while a licensed feed is stale (no good update for 48 hours) or the last nightly job failed, and 200 otherwise. Point a free monitor at it:

- **UptimeRobot** or **Better Stack**: a monitor of type "HTTP(s)", URL `https://<your site>/api/health?strict=1`, every 5 minutes, alert by email or phone. Anything that is not a 200, or no answer, alerts you.
- Do **not** use the `?strict=1` form for Fly's own health check (`fly.toml` keeps the plain `/api/health`): a stale feed is a reason to look at the cron, not to restart the machine.

## 2. Did the night happen? (`NIGHTLY_PING_URL`)

A dead machine, a stopped scheduler and a hung update all look the same from outside: nothing happens. A "heartbeat" monitor turns that silence into an alert. Make a check on **Healthchecks.io** (free) with a period of 1 day and a grace time of 4 hours, and copy its ping address. Then:

```
read -rs "K?Ping address (hidden): "; printf 'NIGHTLY_PING_URL=%s\n' "$K" | fly secrets import -a ringsidedb; unset K
```

When a night ends the job asks that address once: plain for a night that finished (ok or with warnings), with `/fail` added for a failed one. A night interrupted by a restart or deploy sends nothing (the monitor's grace time covers that). The address is a secret: anyone who has it can send a ping. It is never printed or logged; the log says only `heartbeat: heartbeat sent (success)`.

## What each alert means

| Alert | Look at |
|---|---|
| `/api/health?strict=1` says `the data is stale` | `fly ssh console ... "tail -30 /data/nightly-manual.log"` or `/api/health` `data.nightly`; the vendor update (key, plan limit) |
| `... says the last nightly job failed` | the same; `docs/nightly.md` section 3 says what each exit code means |
| the heartbeat monitor says no ping arrived | the machine (`fly status`), then the scheduler (`NIGHTLY_SCHEDULE` set?) |
| the monitor says the site is down | `fly status`, `fly logs` |
