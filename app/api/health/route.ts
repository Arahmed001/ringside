import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";
import { getDb } from "@/lib/db";
import { dataAge, latestUpdate } from "@/lib/freshness";
import { nowMs } from "@/lib/clock";

/**
 * Readiness probe for a load balancer or container orchestrator: GET /api/health.
 * 200 once the database is open and the in-memory world is built (instrumentation.ts builds it before the server accepts
 * traffic in production, so this is a cache hit); 503 with the reason if either fails, so a bad deploy is never marked healthy.
 * Reports counts and the age of the data only: nothing here is private, and nothing that could leak a path or a key.
 *
 * `data.stale` is true when a licensed feed's daily update has not run for more than two days (the site would otherwise keep serving old
 * results without a word). It never turns the answer into a 503: a stale feed is a reason to look at the cron, not to restart the container.
 * It is null for the demo league and for a file feed, which nobody updates daily.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const w = await getWorld();
    const last = latestUpdate(await getDb());
    const age = last ? dataAge(last.at, nowMs()) : null;
    const daily = process.env.BOXING_PROVIDER === "licensed";
    const data = { updatedAt: last?.at ?? null, ageHours: age?.ageHours ?? null, stale: daily ? (age ? age.stale : true) : null };
    return NextResponse.json({ status: "ok", fighters: w.boxers.length, bouts: w.bouts.length, data }, { headers });
  } catch (e) {
    console.error("[ringside] health check failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
}
