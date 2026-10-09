import test, { after } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";

const cleanup = tempDb("health");
after(cleanup);

test("the health check reports a ready world and is never cached", async () => {
  const { GET } = await import("../app/api/health/route");
  const res = await GET();
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.ok(body.fighters > 0 && body.bouts > 0);
  assert.deepEqual(Object.keys(body).sort(), ["bouts", "data", "fighters", "status"], "counts and the age of the data only: nothing that could leak a path or a key");
  assert.deepEqual(Object.keys(body.data).sort(), ["ageHours", "stale", "updatedAt"]);
  assert.equal(body.data.stale, null, "the demo league has no daily update, so staleness is not asked of it");
});

test("a licensed feed's health says how old the data is, and turns stale after two days without ever becoming a 503", async () => {
  const { getDb } = await import("../lib/db");
  const { GET } = await import("../app/api/health/route");
  const db = await getDb();
  const saved = process.env.BOXING_PROVIDER;
  const set = (iso: string) => { db.exec("DELETE FROM ingest_runs WHERE provider = 'boxing-data-api'"); db.prepare("INSERT INTO ingest_runs (at, provider, errors, warnings, infos, counts, dropped) VALUES (?, 'boxing-data-api', 0, 0, 0, '{}', '{}')").run(iso); };
  try {
    process.env.BOXING_PROVIDER = "licensed";
    set("2026-10-03T00:00:00.000Z"); // RINGSIDE_NOW is 2026-10-03 (midnight UTC)
    let r = await GET(); assert.equal(r.status, 200);
    assert.deepEqual((await r.json()).data, { updatedAt: "2026-10-03T00:00:00.000Z", ageHours: 0, stale: false });
    set("2026-10-01T05:00:00.000Z");
    r = await GET(); const old = await r.json();
    assert.equal(r.status, 200, "a stale feed is a reason to look at the cron, not to restart the container");
    assert.deepEqual([old.status, old.data.ageHours, old.data.stale], ["ok", 43, false]);
    set("2026-09-30T23:00:00.000Z");
    r = await GET(); const stale = await r.json();
    assert.deepEqual([r.status, stale.status, stale.data.stale], [200, "ok", true]);
    db.exec("DELETE FROM ingest_runs WHERE provider = 'boxing-data-api'");
    // the money pipeline's runs are not updates of the fights
    db.prepare("INSERT INTO ingest_runs (at, provider, errors, warnings, infos, counts, dropped) VALUES ('2026-10-03T00:00:00.000Z', 'money', 0, 0, 0, '{}', '{}')").run();
    db.exec("DELETE FROM ingest_runs WHERE provider = 'demo'");
    r = await GET(); const none = await r.json();
    assert.deepEqual(none.data, { updatedAt: null, ageHours: null, stale: true }, "no update of the fights on record counts as stale for a licensed feed");
  } finally { if (saved === undefined) delete process.env.BOXING_PROVIDER; else process.env.BOXING_PROVIDER = saved; }
});

test("a world that cannot be built is a 503 that names no path or message", async () => {
  const { invalidateWorld } = await import("../lib/world");
  const { GET } = await import("../app/api/health/route");
  const g = globalThis as unknown as { __ringsideReady?: Promise<void> };
  const error = console.error;
  const logged: unknown[][] = [];
  console.error = (...a: unknown[]) => { logged.push(a); };
  try {
    invalidateWorld();
    g.__ringsideReady = Promise.reject(new Error("unable to open /secret/place/ringside.db"));
    const res = await GET();
    assert.equal(res.status, 503);
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.deepEqual(await res.json(), { status: "unavailable" });
    assert.equal(logged.length, 1, "the reason goes to the server log, not the response");
    assert.match(String(logged[0]), /secret/);
  } finally {
    console.error = error;
  }
  // a failed seed is not cached: the next probe recovers
  const again = await GET();
  assert.equal(again.status, 200);
});

test("?strict=1 is for a monitor that reads only the status code: 503 while a licensed feed is stale, 200 otherwise, and the plain answer never changes", async () => {
  const { getDb } = await import("../lib/db");
  const { GET } = await import("../app/api/health/route");
  const db = await getDb(), saved = process.env.BOXING_PROVIDER;
  const set = (iso: string) => { db.exec("DELETE FROM ingest_runs WHERE provider = 'boxing-data-api'"); db.prepare("INSERT INTO ingest_runs (at, provider, errors, warnings, infos, counts, dropped) VALUES (?, 'boxing-data-api', 0, 0, 0, '{}', 0)").run(iso); };
  const strict = () => GET(new Request("http://localhost/api/health?strict=1"));
  try {
    process.env.BOXING_PROVIDER = "licensed";
    set("2026-10-03T00:00:00.000Z");
    assert.equal((await strict()).status, 200);
    set("2026-09-30T23:00:00.000Z");
    const r = await strict(), body = await r.json();
    assert.equal(r.status, 503); assert.equal(body.status, "degraded"); assert.deepEqual(body.reasons, ["the data is stale"]);
    assert.equal((await GET()).status, 200, "without ?strict=1 a stale feed is still a 200");
    assert.equal((await GET(new Request("http://localhost/api/health"))).status, 200);
  } finally { if (saved === undefined) delete process.env.BOXING_PROVIDER; else process.env.BOXING_PROVIDER = saved; db.exec("DELETE FROM ingest_runs WHERE provider = 'boxing-data-api'"); }
});
