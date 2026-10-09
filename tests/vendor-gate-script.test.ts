import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { makeLeague, makeTemplate, makeVolume, readStatusFile, serveFaulty, startNightly, tmp } from "./nightly-helpers";
import { nextDay } from "./update-failures-helpers";

/**
 * The vendor update gate through the real nightly job and the real update command (step D2): VENDOR_GATE=hold holds what the policy says must wait and the night is still a
 * success; --accept-all lets one update through unheld, and says so in the audit log; a night over the flood guard is refused whole (exit 3) and writes nothing.
 */
const work = tmp("vendor-gate-script");
let tpl = "";
before(async () => { tpl = await makeTemplate(work); });
after(() => fs.rmSync(work, { recursive: true, force: true }));
const ARGS = "--refetch-all --gap-ms 0 --retries 0 --patience-min 0";

/** the day after the template, with these fighters' country changed (a change to a row we hold) */
const worldWith = (countries: Record<string, string>) => {
  const { world } = nextDay(makeLeague());
  for (const [id, c] of Object.entries(countries)) world.fighters.set(id, { ...world.fighters.get(id)!, country: c });
  return world;
};
const one = <T,>(file: string, sql: string, ...args: (string | number)[]) => { const d = new DatabaseSync(file, { readOnly: true }); try { return d.prepare(sql).get(...args) as T; } finally { d.close(); } };
const all = <T,>(file: string, sql: string) => { const d = new DatabaseSync(file, { readOnly: true }); try { return d.prepare(sql).all() as T[]; } finally { d.close(); } };

async function night(tag: string, world: ReturnType<typeof worldWith>, env: Record<string, string>, o: { priorHold?: boolean } = {}) {
  const v = makeVolume(tpl, tag);
  if (o.priorHold) { // a night of holding has happened here before: the flood guard applies (the first night skips it by itself)
    fs.mkdirSync(path.join(v.dir, "gate-reports"), { recursive: true });
    fs.writeFileSync(path.join(v.dir, "gate-reports", "2026-01-01T00-00-00-000Z.json"), JSON.stringify({ version: 1, mode: "hold" }));
  }
  v.accounts = path.join(v.dir, "accounts-real.db"); // a real accounts database, made by the update itself
  const vendor = await serveFaulty(world);
  try {
    const before = { f0: one<{ country: string }>(v.db, "SELECT country FROM boxers WHERE external_id = 'bda-f-f0'").country, fights: one<{ c: number }>(v.db, "SELECT COUNT(*) c FROM bouts").c };
    const extra = env.EXTRA ?? "";
    const rest = Object.fromEntries(Object.entries(env).filter(([k]) => k !== "EXTRA"));
    const r = await startNightly(v, { url: vendor.url, env: { RINGSIDE_NIGHTLY_UPDATE_ARGS: `${ARGS} ${extra}`.trim(), ...rest } }).wait();
    return { v, r, before };
  } finally { await vendor.close(); }
}

test("VENDOR_GATE=hold: a country changed by the vendor is held, the new card goes in, the night is a success, and the proposal waits in the accounts database", async () => {
  const { v, r, before } = await night("hold", worldWith({ f0: "Ireland" }), { VENDOR_GATE: "hold" });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /vendor gate \(hold\)/);
  assert.match(r.out, /held for an administrator: 1 change\(s\)/);
  assert.match(r.out, /1 change\(s\) held for an administrator \(1 new proposal/);
  assert.equal(readStatusFile(v).result, "ok");
  assert.equal(one<{ country: string }>(v.db, "SELECT country FROM boxers WHERE external_id = 'bda-f-f0'").country, before.f0, "held: the country is still ours");
  assert.equal(one<{ c: number }>(v.db, "SELECT COUNT(*) c FROM bouts").c, before.fights + 1, "the new fight went in");
  const p = all<{ kind: string; target_key: string; status: string; new_json: string }>(v.accounts, "SELECT kind, target_key, status, new_json FROM proposals");
  assert.deepEqual(p.map((x) => [x.kind, x.target_key, x.status]), [["field_change", "boxer|bda-f-f0|country", "pending"]]);
  assert.deepEqual(JSON.parse(p[0].new_json), { country: "Ireland" });
  assert.ok(fs.readdirSync(path.join(v.dir, "gate-reports")).length >= 1, "the report was written");
});

test("--accept-all lets one update through unheld, and the audit log says so", async () => {
  const { v, r } = await night("accept", worldWith({ f0: "Ireland" }), { VENDOR_GATE: "hold", EXTRA: "--accept-all" });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /--accept-all: this update is let through without being held/);
  assert.equal(one<{ country: string }>(v.db, "SELECT country FROM boxers WHERE external_id = 'bda-f-f0'").country, "Ireland");
  assert.equal(all(v.accounts, "SELECT * FROM proposals").length, 0);
  assert.deepEqual(all<{ actor: string; action: string }>(v.accounts, "SELECT actor, action FROM audit WHERE action = 'update.accept_all'").map((x) => ({ ...x })), [{ actor: "operator", action: "update.accept_all" }]);
});

test("a night over the flood guard is refused whole (exit 3) and writes nothing (after the first night of holding); --gate-baseline records it instead", async () => {
  const world = worldWith({ f0: "Ireland", f1: "Ireland", f2: "Ireland" });
  const refused = await night("refused", world, { VENDOR_GATE: "hold", VENDOR_GATE_MAX_NIGHT: "2" }, { priorHold: true });
  assert.equal(refused.r.code, 3, refused.r.out);
  assert.match(refused.r.out, /the vendor update gate refused this night, and nothing was written/);
  assert.equal(one<{ c: number }>(refused.v.db, "SELECT COUNT(*) c FROM bouts").c, refused.before.fights, "not even the new fight");
  assert.equal(readStatusFile(refused.v).result, "failed");
  const base = await night("baseline", world, { VENDOR_GATE: "hold", VENDOR_GATE_MAX_NIGHT: "2", EXTRA: "--gate-baseline" }, { priorHold: true });
  assert.equal(base.r.code, 0, base.r.out);
  assert.equal(all(base.v.accounts, "SELECT * FROM proposals WHERE status = 'pending'").length, 3);
});

test("VENDOR_GATE=observe changes nothing about the night, and the dry run (--gate-report) rolls the update back", async () => {
  const { v, r, before } = await night("observe", worldWith({ f0: "Ireland" }), { VENDOR_GATE: "observe" });
  assert.equal(r.code, 0, r.out); assert.match(r.out, /vendor gate \(observe\)/);
  assert.equal(one<{ country: string }>(v.db, "SELECT country FROM boxers WHERE external_id = 'bda-f-f0'").country, "Ireland", "observing holds nothing");
  void before;
  const dry = await night("dry", worldWith({ f0: "Ireland" }), { EXTRA: "--gate-report" });
  assert.match(dry.r.out, /--gate-report: the update was rolled back; the database was not changed/);
  assert.equal(one<{ country: string }>(dry.v.db, "SELECT country FROM boxers WHERE external_id = 'bda-f-f0'").country, dry.before.f0);
  assert.equal(one<{ c: number }>(dry.v.db, "SELECT COUNT(*) c FROM bouts").c, dry.before.fights);
});
