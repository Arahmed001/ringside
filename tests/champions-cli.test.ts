import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { DatabaseSync } from "node:sqlite";

/** The command, end to end, against a local server that plays Wikipedia with the saved WBO and IBF excerpts. */
const root = fs.mkdtempSync(path.join(os.tmpdir(), "champions-cli-"));
after(() => fs.rmSync(root, { recursive: true, force: true }));
const fx = (n: string) => fs.readFileSync(path.join(process.cwd(), "tests", "fixtures", "wikipedia", n), "utf8");
const pages: Record<string, string> = { List_of_WBO_world_champions: fx("wbo-excerpt.wikitext"), List_of_IBF_world_champions: fx("ibf-excerpt.wikitext") };
const requests: string[] = [];
let server: http.Server, url = "";
before(async () => {
  server = http.createServer((req, res) => {
    const u = new URL(req.url!, "http://x"), p = u.searchParams;
    requests.push(`${p.get("action")}:${p.get("page") ?? ""}`);
    res.writeHead(200, { "content-type": "application/json" });
    if (p.get("action") === "parse") return void res.end(JSON.stringify({ parse: { title: p.get("page")!.replace(/_/g, " "), revid: 77, wikitext: pages[p.get("page")!] } }));
    res.end(JSON.stringify({ query: { pages: (p.get("titles") ?? "").split("|").map((t) => (t === "Larry Holmes" ? { title: t, pageprops: { wikibase_item: "Q3" } } : { title: t, missing: true })) } }));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  url = `http://127.0.0.1:${(server.address() as { port: number }).port}/w/api.php`;
});
after(() => server.close());

function run(args: string[], env: Record<string, string | undefined> = {}) {
  return new Promise<{ code: number | null; out: string }>((resolve) => {
    const c = spawn(process.execPath, ["--import", "tsx", "scripts/import-champions.ts", "--gap-ms", "0", "--cache-dir", path.join(root, "cache"), ...args], {
      env: { ...process.env, RINGSIDE_NO_SEED: "1", DATABASE_PATH: path.join(root, "r.db"), WIKIPEDIA_API_URL: url, WIKIMEDIA_CONTACT: "tests@example.invalid", RINGSIDE_NOW: "2026-10-03", ...env }, cwd: process.cwd(),
    });
    let out = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => resolve({ code, out }));
  });
}

test("without a contact it refuses before any request", async () => {
  const n = requests.length;
  const r = await run([], { WIKIMEDIA_CONTACT: "" });
  assert.equal(r.code, 1); assert.match(r.out, /Set WIKIMEDIA_CONTACT/); assert.equal(requests.length, n);
});

test("it stores the reigns, says how many were linked and what to do when none were, and a re-run is the same", async () => {
  const r = await run(["--org", "WBO,IBF"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /WBO: 77 reigns from revision 77/); assert.match(r.out, /IBF: 52 reigns/);
  assert.match(r.out, /129 reigns from 2 page\(s\); 1 Wikidata IDs resolved; 0 reigns linked/);
  assert.match(r.out, /None linked: run `npm run wikidata:import`/);
  const db = new DatabaseSync(path.join(root, "r.db"), { readOnly: true });
  assert.equal((db.prepare("SELECT COUNT(*) c FROM title_reigns").get() as { c: number }).c, 129);
  assert.equal((db.prepare("SELECT wikidata_id w FROM title_reigns WHERE name = 'Larry Holmes' AND org = 'IBF'").get() as { w: string }).w, "Q3");
  db.close();
  const n = requests.filter((q) => q.startsWith("parse")).length;
  const again = await run(["--org", "WBO,IBF"]);
  assert.equal(again.code, 0, again.out);
  assert.equal(requests.filter((q) => q.startsWith("parse")).length, n, "the pages came from the cache");
  assert.match(again.out, /129 reigns/);
});

test("--link-only needs no network, and an unknown body is refused", async () => {
  const n = requests.length;
  const r = await run(["--link-only"]);
  assert.equal(r.code, 0, r.out); assert.match(r.out, /linked 0 reigns/); assert.equal(requests.length, n);
  const bad = await run(["--org", "XYZ"]);
  assert.equal(bad.code, 1); assert.match(bad.out, /No such body: XYZ/);
});
