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
  assert.deepEqual(Object.keys(body).sort(), ["bouts", "fighters", "status"], "counts only: nothing that could leak a path or a key");
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
