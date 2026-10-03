import { NextResponse } from "next/server";
import { getWorld } from "@/lib/world";

/**
 * Readiness probe for a load balancer or container orchestrator: GET /api/health.
 * 200 once the database is open and the in-memory world is built (instrumentation.ts builds it before the server accepts
 * traffic in production, so this is a cache hit); 503 with the reason if either fails, so a bad deploy is never marked healthy.
 * Reports counts only: nothing here is private, and nothing that could leak a path or a key.
 */
export async function GET() {
  const headers = { "Cache-Control": "no-store" };
  try {
    const w = await getWorld();
    return NextResponse.json({ status: "ok", fighters: w.boxers.length, bouts: w.bouts.length }, { headers });
  } catch (e) {
    console.error("[ringside] health check failed:", e instanceof Error ? e.message : e);
    return NextResponse.json({ status: "unavailable" }, { status: 503, headers });
  }
}
