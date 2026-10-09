/**
 * A "dead man's switch" for the nightly job. When NIGHTLY_PING_URL is set (the address a free monitor such as Healthchecks.io, Better Stack or UptimeRobot gives you for a
 * heartbeat), the job asks that address once when the night ends: plain for a night that finished (ok or warning), with `/fail` added for a night that failed. A night that never
 * ends or never starts sends nothing, which is exactly what the monitor is set to notice ("alert me if no ping arrives within 26 hours"), so a dead container, a stopped scheduler
 * and a hung update are all caught by the same rule. The address is a secret of its own (anyone who has it can send a ping): it is never printed, logged or put in the status file.
 * An interrupted night (stopped by a restart or deploy) sends nothing. A ping that cannot be sent is a log line, never a failed night.
 */
export type PingResult = "sent" | "skipped" | "failed";
export async function pingMonitor(url: string | null, result: string, fetchImpl: typeof fetch = fetch): Promise<{ outcome: PingResult; note: string }> {
  if (!url) return { outcome: "skipped", note: "NIGHTLY_PING_URL is not set: no heartbeat is sent" };
  if (result === "interrupted" || result === "running") return { outcome: "skipped", note: "the night was interrupted: no heartbeat sent (the monitor will notice the silence)" };
  let u: URL;
  try { u = new URL(url); } catch { return { outcome: "failed", note: "NIGHTLY_PING_URL is not a web address" }; }
  if (u.protocol !== "https:" && !/^(127\.0\.0\.1|localhost)$/.test(u.hostname)) return { outcome: "failed", note: "NIGHTLY_PING_URL must be an https address" };
  if (result === "failed") u.pathname = u.pathname.replace(/\/+$/, "") + "/fail";
  try {
    const r = await fetchImpl(u, { method: "GET", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "RingsideNightly/1.0" } });
    return r.ok ? { outcome: "sent", note: `heartbeat sent (${result === "failed" ? "failure" : "success"})` } : { outcome: "failed", note: `the monitor answered ${r.status}` };
  } catch (e) { return { outcome: "failed", note: `the monitor could not be reached (${(e as Error).name})` }; }
}
