import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { livePid } from "../lib/vendor-fetch";
import { portInUse, siteHealth, sitePlan } from "../lib/vendor-site";

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), "ringside-site-"));
const run = (args: string[], env: Record<string, string> = {}) => new Promise<{ code: number | null; out: string }>((resolve) => {
  const c = spawn(process.execPath, ["--import", "tsx", path.join(process.cwd(), "scripts", "vendor-site.ts"), ...args], { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
  c.on("close", (code) => resolve({ code, out }));
});
const listen = (server: net.Server | http.Server): Promise<number> => new Promise((res) => server.listen(0, "127.0.0.1", () => res((server.address() as net.AddressInfo).port)));

test("the plan: the real database and port 3480 by default, files beside the database, the vendor key and storage statement never set (round 103)", () => {
  const p = sitePlan({}, {});
  assert.equal(p.port, 3480); assert.match(p.database, /ringside-real[\\/]real\.db$/);
  assert.equal(path.dirname(p.log), path.dirname(p.database)); assert.equal(path.basename(p.log), "site.log"); assert.equal(path.basename(p.pid), "site.pid");
  assert.equal(p.env.BOXING_PROVIDER, "licensed"); assert.equal(p.env.PORT, "3480"); assert.equal(p.env.DATABASE_PATH, p.database);
  assert.ok(!("BOXING_API_KEY" in p.env) && !("BOXING_API_STORAGE_CONFIRMED" in p.env), "serving a database needs neither");
  const q = sitePlan({ port: "3490", database: "/tmp/x/other.db" }, { DATABASE_PATH: "/tmp/ignored.db" });
  assert.equal(q.port, 3490); assert.equal(q.database, "/tmp/x/other.db"); assert.equal(q.log, "/tmp/x/site-3490.log"); assert.equal(q.pid, "/tmp/x/site-3490.pid", "a second site in the same folder has files of its own: a preview must not take over the real site's pid file (round 117)");
  assert.equal(sitePlan({ port: "3480", database: "/tmp/x/other.db" }, {}).pid, "/tmp/x/site.pid", "the default port keeps the old names");
  assert.equal(sitePlan({}, { DATABASE_PATH: "/tmp/env.db" }).database, "/tmp/env.db");
  for (const bad of ["80", "abc", "70000", "3480.5"]) assert.throws(() => sitePlan({ port: bad }, {}), /not a port number/, bad);
});

test("a port is in use when something accepts connections on it; the health answer is read, and nothing answering is null", async () => {
  const srv = http.createServer((req, res) => { res.setHeader("content-type", "application/json"); res.end(req.url === "/api/health" ? JSON.stringify({ status: "ok", fighters: 12, bouts: 34, data: { updatedAt: "2026-10-06T00:00:00Z" } }) : "{}"); });
  const port = await listen(srv);
  try {
    assert.equal(await portInUse(port), true);
    assert.deepEqual(await siteHealth(port), { fighters: 12, bouts: 34, updatedAt: "2026-10-06T00:00:00Z" });
  } finally { await new Promise((r) => srv.close(r)); }
  assert.equal(await portInUse(port), false); assert.equal(await siteHealth(port), null);
  const bad = http.createServer((_q, res) => { res.statusCode = 503; res.end("{}"); }); const bp = await listen(bad);
  try { assert.equal(await siteHealth(bp), null, "a 503 is not a healthy site"); } finally { await new Promise((r) => bad.close(r)); }
});

test("the command: says what is (not) running, refuses a missing database and a held port, and stops nothing it did not start (round 103)", async () => {
  const d = dir(), db = path.join(d, "real.db");
  const idle = await run(["--database", db, "--port", "3497"]);
  assert.equal(idle.code, 0); assert.match(idle.out, /The site is not running\. Start it:  npm run vendor:site -- --start/);
  const stop = await run(["--stop", "--database", db, "--port", "3497"]);
  assert.equal(stop.code, 0); assert.match(stop.out, /No site started by this command is running/);
  const nodb = await run(["--start", "--database", db, "--port", "3497"]);
  assert.equal(nodb.code, 1); assert.match(nodb.out, /There is no database at .*real\.db/);
  fs.writeFileSync(db, "x");
  const held = net.createServer((s) => s.destroy()); const port = await listen(held);
  try {
    const r = await run(["--start", "--database", db, "--port", String(port)]);
    assert.equal(r.code, 1); assert.match(r.out, new RegExp(`Port ${port} is held by something this command did not start`));
    const status = await run(["--database", db, "--port", String(port)]);
    assert.match(status.out, new RegExp(`Port ${port} is held by something this command did not start`));
    // a process id in the file that is not a Next server (this test process) is never signalled
    fs.writeFileSync(path.join(d, "site.pid"), `${process.pid}\n`);
    const s2 = await run(["--stop", "--database", db, "--port", String(port)]);
    assert.match(s2.out, /No site started by this command is running/); assert.doesNotThrow(() => process.kill(process.pid, 0));
  } finally { await new Promise((r) => held.close(r)); }
  assert.equal(livePid(path.join(d, "site.pid"), /next/), undefined);
});
