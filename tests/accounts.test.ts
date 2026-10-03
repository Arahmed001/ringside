import test, { after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";
import { hashPassword, needsRehash, passwordProblems, verifyPassword } from "../lib/accounts/password";
import { RateLimiter, sameOrigin, limits } from "../lib/accounts/guard";
import { isPrivateAddress, publicHostOnly } from "../lib/research/netguard";
import { PoliteFetcher } from "../lib/research/fetcher";

const cleanup = tempDb("accounts");
const accFile = path.join(os.tmpdir(), `ringside-test-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

const HOST = "http://localhost:3100";
type Handler = (req: Request, ctx?: never) => Promise<Response>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;
async function call(h: Handler, method: string, body?: unknown, o: { cookie?: string; origin?: string | null; ip?: string } = {}, url = `${HOST}/api/x`): Promise<{ status: number; json: Json; cookie?: string; headers: Headers }> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": o.ip ?? "10.0.0.1" };
  if (o.cookie) headers.cookie = o.cookie;
  if (o.origin !== null) headers.origin = o.origin ?? HOST;
  const res = await h(new Request(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }));
  const sc = res.headers.get("set-cookie");
  return { status: res.status, json: await res.json().catch(() => ({})), cookie: sc?.split(";")[0], headers: res.headers };
}
const routes = async () => ({
  signup: (await import("../app/api/account/signup/route")).POST, login: (await import("../app/api/account/login/route")).POST,
  logout: (await import("../app/api/account/logout/route")).POST, me: (await import("../app/api/account/me/route")).GET,
  password: (await import("../app/api/account/password/route")).POST, del: (await import("../app/api/account/delete/route")).POST,
  reset: (await import("../app/api/account/reset/route")).POST, settings: (await import("../app/api/account/settings/route")).POST,
  exportData: (await import("../app/api/account/export/route")).GET,
  picks: await import("../app/api/account/picks/route"), importPicks: (await import("../app/api/account/picks/import/route")).POST,
  contribute: await import("../app/api/contribute/route"), review: await import("../app/api/review/route"), reviewId: await import("../app/api/review/[id]/route"),
});
const PW = "correct horse battery";
beforeEach(() => { for (const l of Object.values(limits())) l.reset(); });

test("passwords: salted scrypt, verifiable, never stored readable, with a sensible policy", async () => {
  const a = await hashPassword(PW), b = await hashPassword(PW);
  assert.notEqual(a, b, "a fresh salt each time");
  assert.ok(a.startsWith("scrypt$") && !a.includes(PW));
  assert.ok(await verifyPassword(PW, a));
  assert.ok(!(await verifyPassword(PW + "x", a)));
  assert.ok(!(await verifyPassword(PW, "plain-text")), "an unknown format never verifies");
  assert.ok(await verifyPassword("Passwörd ١٢٣ عربي!", await hashPassword("Passwörd ١٢٣ عربي!")), "any script");
  assert.equal(needsRehash(a), false);
  assert.equal(needsRehash(a.replace("scrypt$32768", "scrypt$16384")), true);
  assert.deepEqual(passwordProblems(PW, "bob"), []);
  assert.deepEqual(passwordProblems("short"), ["short"]);
  assert.ok(passwordProblems("1234567890").includes("common"));
  assert.ok(passwordProblems("xxxxxxxxxxxx").includes("same_char"));
  assert.ok(passwordProblems("my-bobby-secret", "bobby").includes("username"));
  assert.ok(passwordProblems("a".repeat(201)).includes("long"));
  assert.deepEqual(passwordProblems("كلمة مرور طويلة جدا"), [], "ten Arabic characters count as ten, not as their bytes");
});

test("same-origin check refuses other sites' forms; rate limiter slides", () => {
  const req = (h: Record<string, string>) => ({ url: "http://localhost:3100/api/x", headers: new Headers(h) });
  assert.ok(sameOrigin(req({ origin: "http://localhost:3100", host: "localhost:3100" })));
  assert.ok(!sameOrigin(req({ origin: "https://evil.example", host: "localhost:3100" })));
  assert.ok(!sameOrigin(req({ origin: "null", host: "localhost:3100" })));
  assert.ok(!sameOrigin(req({ "sec-fetch-site": "cross-site" })), "no Origin but a cross-site fetch");
  assert.ok(sameOrigin(req({ "sec-fetch-site": "same-origin" })));
  assert.ok(sameOrigin(req({})), "a non-browser client sends neither, and CSRF does not apply to it");
  assert.ok(sameOrigin(req({ origin: "https://ringside.example", host: "10.0.0.5:3000" }), "https://ringside.example"), "the public address behind a proxy");
  const rl = new RateLimiter(3, 1000);
  assert.deepEqual([0, 1, 2, 3].map((i) => rl.take("k", i)), [true, true, true, false]);
  assert.ok(rl.take("k", 1500), "the window slides");
  assert.equal(rl.left("other"), 3);
});

test("sign up, sign in, sign out: cookie flags, case-insensitive names, generic failures", async () => {
  const r = await routes();
  const fresh = () => limits().signup.reset();
  const bad = await call(r.signup, "POST", { username: "a b", password: PW });
  assert.deepEqual([bad.status, bad.json.error], [400, "username_invalid"]);
  assert.equal((await call(r.signup, "POST", { username: "Admin", password: PW })).json.error, "username_reserved");
  assert.equal((await call(r.signup, "POST", { username: "carol", password: "short" })).json.error, "password_short");
  fresh();
  const up = await call(r.signup, "POST", { username: "Carol_1", password: PW });
  assert.equal(up.status, 201);
  assert.equal(up.json.user.username, "Carol_1"); assert.equal(up.json.user.role, "user");
  const setCookie = up.headers.get("set-cookie")!;
  assert.match(setCookie, /HttpOnly/); assert.match(setCookie, /SameSite=Lax/); assert.match(setCookie, /Path=\//);
  assert.ok(!/Secure/.test(setCookie), "plain http on localhost");
  assert.match((await call(r.signup, "POST", { username: "x", password: PW }, { origin: HOST })).json.error, /username_invalid/);
  fresh();
  assert.equal((await call(r.signup, "POST", { username: "carol_1", password: PW })).json.error, "username_taken", "names are unique ignoring case");
  const me = await call(r.me, "GET", undefined, { cookie: up.cookie });
  assert.equal(me.json.user.username, "Carol_1");
  assert.ok(!JSON.stringify(me.json).includes("pw_hash") && !JSON.stringify(me.json).includes("scrypt"));
  assert.equal((await call(r.me, "GET")).json.user, null);

  const wrongPw = await call(r.login, "POST", { username: "carol_1", password: "nope nope nope" });
  const noUser = await call(r.login, "POST", { username: "nobody_here", password: "nope nope nope" });
  assert.deepEqual([wrongPw.status, noUser.status], [401, 401]);
  assert.deepEqual(wrongPw.json, noUser.json, "the same answer for a wrong password and an unknown name");
  const login = await call(r.login, "POST", { username: "CAROL_1", password: PW });
  assert.equal(login.status, 200);
  const out = await call(r.logout, "POST", {}, { cookie: login.cookie });
  assert.match(out.headers.get("set-cookie")!, /Max-Age=0/);
  assert.equal((await call(r.me, "GET", undefined, { cookie: login.cookie })).json.user, null, "the session is dead on the server, not just forgotten by the browser");
  const secure = await (await import("../app/api/account/login/route")).POST(new Request(`${HOST}/api/x`, { method: "POST", headers: { origin: HOST, "x-forwarded-proto": "https", "x-forwarded-for": "10.0.0.9" }, body: JSON.stringify({ username: "carol_1", password: PW }) }));
  assert.match(secure.headers.get("set-cookie")!, /; Secure/, "Secure behind an https proxy");
});

test("CSRF: a cross-site POST changes nothing; bodies are capped; garbage is refused", async () => {
  const r = await routes();
  const evil = await call(r.signup, "POST", { username: "mallory", password: PW }, { origin: "https://evil.example" });
  assert.equal(evil.status, 403);
  assert.equal((await call(r.login, "POST", { username: "mallory", password: PW })).status, 401, "the account was not created");
  const big = await call(r.signup, "POST", { username: "bigbody", password: "x".repeat(20_000) });
  assert.equal(big.status, 413);
  const res = await r.signup(new Request(`${HOST}/api/x`, { method: "POST", headers: { origin: HOST }, body: "{not json" }));
  assert.equal(res.status, 400);
  const arr = await call(r.signup, "POST", [1, 2]);
  assert.equal(arr.status, 400);
});

test("repeated wrong passwords are locked out, per name and per address, and a success forgives", async () => {
  const r = await routes();
  await call(r.signup, "POST", { username: "dave_dd", password: PW }, { ip: "10.1.1.1" });
  let last = 0;
  for (let i = 0; i < 6; i++) last = (await call(r.login, "POST", { username: "dave_dd", password: "wrong wrong wrong" }, { ip: `10.2.2.${i}` })).status;
  assert.equal(last, 401);
  const locked = await call(r.login, "POST", { username: "dave_dd", password: PW }, { ip: "10.2.2.99" });
  assert.equal(locked.status, 429, "six failures against one name lock it, whatever the address, even for the right password");
  assert.ok(locked.headers.get("retry-after"));
  limits().loginName.reset();
  assert.equal((await call(r.login, "POST", { username: "dave_dd", password: PW }, { ip: "10.3.3.3" })).status, 200);
  limits().loginIp.reset(); limits().loginName.reset();
  let s = 0;
  for (let i = 0; i < 25; i++) s = (await call(r.login, "POST", { username: `ghost_${i}`, password: "wrong wrong wrong" }, { ip: "10.4.4.4" })).status;
  assert.equal(s, 429, "one address trying many names is stopped too");
  limits().signup.reset();
  let n = 0;
  for (let i = 0; i < 7; i++) n = (await call(r.signup, "POST", { username: `bulk_user_${i}`, password: PW }, { ip: "10.5.5.5" })).status;
  assert.equal(n, 429, "bulk sign-ups from one address are limited");
});

test("changing the password signs the other devices out; deleting removes the person and their picks but not what they contributed", async () => {
  const r = await routes();
  const a = await call(r.signup, "POST", { username: "erin_ee", password: PW });
  const other = await call(r.login, "POST", { username: "erin_ee", password: PW });
  const wrong = await call(r.password, "POST", { current: "not it not it", next: "a brand new passphrase" }, { cookie: a.cookie });
  assert.equal(wrong.json.error, "wrong_password");
  const weak = await call(r.password, "POST", { current: PW, next: "short" }, { cookie: a.cookie });
  assert.equal(weak.json.error, "password_short");
  const ok = await call(r.password, "POST", { current: PW, next: "a brand new passphrase" }, { cookie: a.cookie });
  assert.equal(ok.status, 200);
  assert.equal((await call(r.me, "GET", undefined, { cookie: other.cookie })).json.user, null, "the old sessions are gone");
  assert.equal((await call(r.me, "GET", undefined, { cookie: a.cookie })).json.user, null);
  assert.equal((await call(r.me, "GET", undefined, { cookie: ok.cookie })).json.user.username, "erin_ee", "the device that changed it continues");
  assert.equal((await call(r.login, "POST", { username: "erin_ee", password: PW })).status, 401);

  const { accountsDb } = await import("../lib/accounts/store");
  const id = (accountsDb().prepare("SELECT id FROM users WHERE username = 'erin_ee'").get() as { id: number }).id;
  accountsDb().prepare("INSERT INTO picks (user_id, bout_ext, boxer_ext, picked_at) VALUES (?,?,?,?)").run(id, "B1", "X1", "2026-01-01T00:00:00Z");
  accountsDb().prepare("INSERT INTO contributions (user_id, boxer_ext, role, person_name, start_date, source_url, quote, created_at) VALUES (?,?,?,?,?,?,?,?)").run(id, "X1", "head_trainer", "Some Coach", "2020-01-01", "https://example.com/a", "Some Coach trained him", "2026-01-01T00:00:00Z");
  assert.equal((await call(r.del, "POST", { password: "wrong wrong wrong" }, { cookie: ok.cookie })).json.error, "wrong_password");
  const ex = await r.exportData(new Request(`${HOST}/api/account/export`, { headers: { cookie: ok.cookie! } }));
  const exported = await ex.text();
  assert.ok(exported.includes("B1") && exported.includes("Some Coach") && !exported.includes("scrypt") && !exported.includes("pw_hash"), "the export has their data and no secrets");
  const del = await call(r.del, "POST", { password: "a brand new passphrase" }, { cookie: ok.cookie });
  assert.equal(del.status, 200);
  assert.equal(accountsDb().prepare("SELECT COUNT(*) c FROM users WHERE username = 'erin_ee'").get()!.c, 0);
  assert.equal(accountsDb().prepare("SELECT COUNT(*) c FROM picks WHERE user_id = ?").get(id)!.c, 0);
  assert.equal(accountsDb().prepare("SELECT COUNT(*) c FROM sessions WHERE user_id = ?").get(id)!.c, 0);
  const kept = accountsDb().prepare("SELECT user_id u FROM contributions WHERE person_name = 'Some Coach'").get() as { u: number | null };
  assert.equal(kept.u, null, "the contribution stays, with no name on it");
});

test("a forgotten password: the operator issues a one-time code, which works once and expires", async () => {
  const r = await routes();
  const { issueResetCode, setDisabled } = await import("../lib/accounts/users");
  await call(r.signup, "POST", { username: "fran_ff", password: PW });
  assert.equal(issueResetCode("nobody_at_all"), null);
  const code = issueResetCode("fran_ff")!;
  assert.equal((await call(r.reset, "POST", { username: "fran_ff", code: "wrong", password: "another long passphrase" })).json.error, "invalid");
  assert.equal((await call(r.reset, "POST", { username: "fran_ff", code, password: "short" })).json.error, "password_short");
  const ok = await call(r.reset, "POST", { username: "fran_ff", code, password: "another long passphrase" });
  assert.equal(ok.status, 200);
  assert.equal((await call(r.reset, "POST", { username: "fran_ff", code, password: "yet another passphrase" })).json.error, "invalid", "one use only");
  assert.equal((await call(r.login, "POST", { username: "fran_ff", password: "another long passphrase" })).status, 200);
  const late = issueResetCode("fran_ff", undefined, Date.now() - 2 * 3600_000)!;
  assert.equal((await call(r.reset, "POST", { username: "fran_ff", code: late, password: "yet another passphrase" })).json.error, "invalid", "expired after an hour");
  const s = await call(r.login, "POST", { username: "fran_ff", password: "another long passphrase" });
  setDisabled("fran_ff", true);
  assert.equal((await call(r.me, "GET", undefined, { cookie: s.cookie })).json.user, null, "disabling signs them out");
  assert.equal((await call(r.login, "POST", { username: "fran_ff", password: "another long passphrase" })).status, 401);
});

// ---------- picks ----------
async function world() {
  const { getDb } = await import("../lib/db");
  const db = await getDb();
  const open = db.prepare(`SELECT b.id, b.red_id r, b.blue_id u, b.external_id ext FROM bouts b JOIN events e ON e.id=b.event_id WHERE e.date > '2026-10-03' AND b.status IS NOT 'cancelled' AND b.method IS NULL ORDER BY e.date LIMIT 3`).all() as { id: number; r: number; u: number; ext: string }[];
  const past = db.prepare(`SELECT b.id, b.red_id r, b.blue_id u FROM bouts b JOIN events e ON e.id=b.event_id WHERE e.date < '2026-09-01' AND b.method = 'UD' LIMIT 1`).get() as { id: number; r: number; u: number };
  const cancelled = db.prepare(`SELECT b.id, b.red_id r FROM bouts b WHERE b.status = 'cancelled' LIMIT 1`).get() as { id: number; r: number } | undefined;
  return { db, open, past, cancelled };
}
const asUser = async (name: string, ip: string) => { const r = await routes(); const u = await call(r.signup, "POST", { username: name, password: PW }, { ip }); assert.equal(u.status, 201, name); return u.cookie!; };

test("picks: stored on the account, open bouts only, frozen once fight day begins", async () => {
  const r = await routes(); const { open, past, cancelled, db } = await world();
  assert.ok(open.length >= 2 && past);
  const c = await asUser("gina_gg", "10.6.0.1");
  assert.equal((await call(r.picks.GET, "GET")).status, 401);
  assert.equal((await call(r.picks.POST, "POST", { boutId: open[0].id, boxerId: open[0].r })).status, 401, "signed in only");
  assert.equal((await call(r.picks.POST, "POST", { boutId: open[0].id, boxerId: open[0].r }, { cookie: c })).status, 200);
  assert.equal((await call(r.picks.POST, "POST", { boutId: open[0].id, boxerId: open[0].u }, { cookie: c })).status, 200, "a pick can be changed while the bout is open");
  assert.deepEqual((await call(r.picks.GET, "GET", undefined, { cookie: c })).json.picks, { [open[0].id]: open[0].u });
  const bad = await call(r.picks.POST, "POST", { boutId: open[0].id, boxerId: 999999 }, { cookie: c });
  assert.deepEqual([bad.status, bad.json.error], [400, "not_in_bout"]);
  assert.equal((await call(r.picks.POST, "POST", { boutId: 99999999, boxerId: 1 }, { cookie: c })).json.error, "no_such_bout");
  assert.equal((await call(r.picks.POST, "POST", { boutId: "x", boxerId: 1 }, { cookie: c })).json.error, "no_such_bout");
  const late = await call(r.picks.POST, "POST", { boutId: past.id, boxerId: past.r }, { cookie: c });
  assert.deepEqual([late.status, late.json.error], [409, "locked"], "no picking a fight that already happened");
  if (cancelled) assert.equal((await call(r.picks.POST, "POST", { boutId: cancelled.id, boxerId: cancelled.r }, { cookie: c })).json.error, "locked");

  // freeze: once the bout's day begins the pick can be neither changed nor deleted
  db.prepare("UPDATE events SET date = '2026-10-03' WHERE id = (SELECT event_id FROM bouts WHERE id = ?)").run(open[0].id);
  const frozenChange = await call(r.picks.POST, "POST", { boutId: open[0].id, boxerId: open[0].r }, { cookie: c });
  const frozenDelete = await call(r.picks.DELETE, "DELETE", { boutId: open[0].id }, { cookie: c });
  assert.deepEqual([frozenChange.json.error, frozenDelete.json.error], ["locked", "locked"], "a losing pick cannot be quietly dropped");
  assert.deepEqual((await call(r.picks.GET, "GET", undefined, { cookie: c })).json.picks, { [open[0].id]: open[0].u });
  db.prepare("UPDATE events SET date = '2026-12-01' WHERE id = (SELECT event_id FROM bouts WHERE id = ?)").run(open[0].id);
  assert.equal((await call(r.picks.DELETE, "DELETE", { boutId: open[0].id }, { cookie: c })).status, 200);
  assert.deepEqual((await call(r.picks.GET, "GET", undefined, { cookie: c })).json.picks, {});
});

test("importing the picks made before signing in: open bouts only, never overwrites, junk ignored", async () => {
  const r = await routes(); const { open, past } = await world();
  const c = await asUser("hank_hh", "10.6.0.2");
  await call(r.picks.POST, "POST", { boutId: open[1].id, boxerId: open[1].u }, { cookie: c });
  const res = await call(r.importPicks, "POST", { picks: { [open[0].id]: open[0].r, [open[1].id]: open[1].r, [past.id]: past.r, abc: 1, [open[2].id]: 123456789 } }, { cookie: c });
  assert.deepEqual(res.json, { added: 1, kept: 1, locked: 1, invalid: 2 });
  const mine = (await call(r.picks.GET, "GET", undefined, { cookie: c })).json.picks;
  assert.equal(mine[open[1].id], open[1].u, "the pick already on the account won");
  assert.equal(mine[open[0].id], open[0].r);
  assert.equal(mine[past.id], undefined, "a 'pick' for a finished fight proves nothing");
  assert.equal((await call(r.importPicks, "POST", { picks: [1] }, { cookie: c })).status, 400);
});

test("picks are kept by external id, so a rebuilt database does not orphan them", async () => {
  const { open, db } = await world();
  const { setPick, listPicks } = await import("../lib/accounts/picks");
  const { accountsDb } = await import("../lib/accounts/store");
  const uid = (accountsDb().prepare("SELECT id FROM users WHERE username = 'gina_gg'").get() as { id: number }).id;
  assert.ok(setPick(uid, open[2].id, open[2].r, db).ok);
  const stored = accountsDb().prepare("SELECT bout_ext, boxer_ext FROM picks WHERE user_id = ?").all(uid) as { bout_ext: string; boxer_ext: string }[];
  assert.ok(stored.every((p) => !/^\d+$/.test(p.bout_ext)), "stored against external ids, not row numbers");
  const { DatabaseSync } = await import("node:sqlite");
  const other = new DatabaseSync(":memory:");
  other.exec("CREATE TABLE bouts (id INTEGER PRIMARY KEY, external_id TEXT); CREATE TABLE boxers (id INTEGER PRIMARY KEY, external_id TEXT)");
  other.prepare("INSERT INTO bouts (id, external_id) VALUES (777, ?)").run(open[2].ext);
  const ext = (db.prepare("SELECT external_id e FROM boxers WHERE id = ?").get(open[2].r) as { e: string }).e;
  other.prepare("INSERT INTO boxers (id, external_id) VALUES (888, ?)").run(ext);
  assert.deepEqual(listPicks(uid, other as never), { 777: 888 }, "the same pick resolves in a database with different row numbers");
});

// ---------- the leaderboard ----------
test("scoring: right = 1 + the model's doubt; wrong = 0; the favourite is always the better bet", async () => {
  const { pickPoints, MIN_RANKED } = await import("../lib/accounts/leaderboard");
  const g = (pickRed: boolean, pRed: number | null, state: "right" | "wrong") => ({ info: { red: { id: 1, name: "R" }, blue: { id: 2, name: "B" }, modelPRed: pRed } as never, pickId: pickRed ? 1 : 2, state, modelPickId: null, model: null }) as never;
  assert.equal(pickPoints(g(true, 0.8, "right")), 1.2, "calling the favourite right");
  assert.ok(Math.abs(pickPoints(g(false, 0.8, "right")) - 1.8) < 1e-9, "calling the underdog right");
  assert.equal(pickPoints(g(true, 0.8, "wrong")), 0);
  assert.equal(pickPoints(g(true, null, "right")), 1.5, "no prediction on file: treated as 50/50");
  for (let p = 0.5; p < 1; p += 0.05) {
    const expect = (q: number) => q * (1 + (1 - q)); // chance of being right times the points if right, for a side with true chance q
    assert.ok(expect(p) > expect(1 - p) - 1e-12, `at ${p.toFixed(2)} the likelier side has the better expected score`);
  }
  assert.ok(MIN_RANKED >= 5);
});

test("the leaderboard ranks graded picks, hides private and unranked players, and scores the model on the same fights", async () => {
  const { db } = await world();
  const { getWorld } = await import("../lib/world");
  const { leaderboard, MIN_RANKED } = await import("../lib/accounts/leaderboard");
  const { accountsDb } = await import("../lib/accounts/store");
  const acc = accountsDb();
  const w = await getWorld();
  // decided past bouts the model had a call on (snapshots exist for them in the ledger when the world has run); fall back to any decided bout
  const decided = db.prepare(`SELECT b.id, b.external_id be, b.red_id r, b.blue_id u, b.winner_id win FROM bouts b JOIN events e ON e.id=b.event_id WHERE e.date < '2026-09-01' AND b.winner_id IS NOT NULL AND b.method IN ('UD','KO','TKO','SD','MD') LIMIT ${MIN_RANKED + 4}`).all() as { id: number; be: string; r: number; u: number; win: number }[];
  assert.ok(decided.length >= MIN_RANKED + 2);
  const ext = (id: number) => (db.prepare("SELECT external_id e FROM boxers WHERE id = ?").get(id) as { e: string }).e;
  const mk = async (name: string, ip: string) => { await asUser(name, ip); return (acc.prepare("SELECT id FROM users WHERE username = ?").get(name) as { id: number }).id; };
  const ins = acc.prepare("INSERT INTO picks (user_id, bout_ext, boxer_ext, picked_at) VALUES (?,?,?,?)");
  const sharp = await mk("sharp_ss", "10.7.0.1"), poor = await mk("poor_pp", "10.7.0.2"), shy = await mk("shy_hh", "10.7.0.3"), newbie = await mk("newbie_nn", "10.7.0.4");
  for (const d of decided.slice(0, MIN_RANKED + 2)) {
    ins.run(sharp, d.be, ext(d.win), "2026-01-01T00:00:00Z");                          // always right
    ins.run(poor, d.be, ext(d.win === d.r ? d.u : d.r), "2026-01-01T00:00:00Z");       // always wrong
    ins.run(shy, d.be, ext(d.win), "2026-01-01T00:00:00Z");                            // right, but private
  }
  for (const d of decided.slice(0, 3)) ins.run(newbie, d.be, ext(d.win), "2026-01-01T00:00:00Z"); // too few to rank
  acc.prepare("UPDATE users SET picks_public = 0 WHERE id = ?").run(shy);
  const { tEn } = await import("../lib/i18n/t");
  const lb = leaderboard(db, w, tEn);
  const names = lb.standings.map((s) => s.username);
  assert.deepEqual(names.filter((n) => ["sharp_ss", "poor_pp", "shy_hh", "newbie_nn"].includes(n)), ["sharp_ss", "poor_pp"], "ranked in order; private and too-few players are not listed");
  const sharpRow = lb.standings.find((s) => s.username === "sharp_ss")!, poorRow = lb.standings.find((s) => s.username === "poor_pp")!;
  assert.equal(sharpRow.right, MIN_RANKED + 2); assert.equal(poorRow.right, 0);
  assert.ok(sharpRow.points >= MIN_RANKED + 2 && sharpRow.points <= 2 * (MIN_RANKED + 2), "between 1 and 2 points a right pick");
  assert.equal(poorRow.points, 0);
  assert.ok(sharpRow.rank < poorRow.rank);
  assert.ok(lb.unranked >= 1);
  assert.equal(lb.minRanked, MIN_RANKED);
  if (lb.model) assert.ok(lb.model.accuracy >= 0 && lb.model.accuracy <= 1 && lb.model.perPick >= 0);
  // a disabled player disappears
  const { setDisabled } = await import("../lib/accounts/users");
  setDisabled("sharp_ss", true);
  assert.ok(!leaderboard(db, w, tEn).standings.some((s) => s.username === "sharp_ss"));
});

// ---------- community edits ----------
const stintBody = (boxerExt: string, over: Record<string, unknown> = {}) => ({ boxerExt, role: "head_trainer", personName: "Marco Test-Coach", start: "2021-03-01", end: null, sourceUrl: "https://example.org/profile", quote: "Marco Test-Coach has trained him since March 2021", ...over });

test("proposing an edit: a source and a quote are required, and bad input is refused with a reason", async () => {
  const r = await routes(); const { db } = await world();
  const boxer = db.prepare("SELECT external_id e FROM boxers WHERE active = 1 LIMIT 1").get() as { e: string };
  const c = await asUser("ivy_ii", "10.8.0.1");
  assert.equal((await call(r.contribute.POST, "POST", stintBody(boxer.e))).status, 401);
  const cases: [Record<string, unknown>, string][] = [
    [{ boxerExt: "nope" }, "boxer_unknown"], [{ role: "promoter" }, "role_invalid"], [{ personName: "http://spam.example" }, "person_invalid"], [{ personName: "x" }, "person_invalid"],
    [{ start: "2021-02-30" }, "start_invalid"], [{ start: "March 2021" }, "start_invalid"], [{ end: "2020-01-01" }, "dates_order"], [{ start: "2999-01-01" }, "future"],
    [{ sourceUrl: "javascript:alert(1)" }, "url_invalid"], [{ sourceUrl: "ftp://example.org/file" }, "url_invalid"], [{ sourceUrl: "file:///etc/passwd" }, "url_invalid"], [{ sourceUrl: "https://user:pw@example.org/" }, "url_invalid"], [{ sourceUrl: "not a url" }, "url_invalid"], [{ sourceUrl: "http://localhost/x" }, "url_invalid"],
    [{ quote: "" }, "quote_short"], [{ quote: "short" }, "quote_short"], [{ quote: "q".repeat(301) }, "quote_long"],
  ];
  for (const [over, code] of cases) { const res = await call(r.contribute.POST, "POST", stintBody(boxer.e, over), { cookie: c }); assert.equal(res.json.error, code, JSON.stringify(over)); }
  const ok = await call(r.contribute.POST, "POST", stintBody(boxer.e), { cookie: c });
  assert.equal(ok.status, 201);
  assert.equal((await call(r.contribute.POST, "POST", stintBody(boxer.e, { personName: "marco test-coach" }), { cookie: c })).json.error, "duplicate_pending", "the same edit twice");
  const list = await call(r.contribute.GET, "GET", undefined, { cookie: c });
  assert.equal(list.json.items.length, 1); assert.equal(list.json.items[0].status, "pending");
  assert.equal(list.json.items[0].sourceCheck, null, "the proposer never sees the source-check result");
  assert.equal((await call(r.contribute.DELETE, "DELETE", { id: ok.json.id }, { cookie: c })).status, 200);
  assert.equal((await call(r.contribute.DELETE, "DELETE", { id: ok.json.id }, { cookie: c })).status, 404, "withdrawn once");
  limits().contribute.reset();
  let n = 0;
  for (let i = 0; i < 12; i++) n = (await call(r.contribute.POST, "POST", stintBody(boxer.e, { personName: `Coach Number${"abcdefghijkl"[i]}`, start: `2015-0${(i % 9) + 1}-01` }), { cookie: c })).status;
  assert.equal(n, 429, "ten proposals a day");
});

test("review: only editors, never your own, rejection needs a reason, approval writes the edit and survives a rebuild", async () => {
  const r = await routes(); const { db } = await world();
  const { accountsDb } = await import("../lib/accounts/store");
  const { setRole } = await import("../lib/accounts/users");
  const { applyContributions, EDIT_SOURCE } = await import("../lib/accounts/contributions");
  const box = db.prepare("SELECT id, external_id e, slug FROM boxers WHERE active = 1 ORDER BY id LIMIT 1 OFFSET 7").get() as { id: number; e: string; slug: string };
  const prop = await asUser("jack_jj", "10.9.0.1"), ed = await asUser("kate_kk", "10.9.0.2"), plain = await asUser("liam_ll", "10.9.0.3");
  setRole("kate_kk", "editor");
  const made = await call(r.contribute.POST, "POST", stintBody(box.e, { personName: "Zed Nobody-Known", start: "2022-05-01", quote: "Zed Nobody-Known took over the corner in May 2022" }), { cookie: prop });
  assert.equal(made.status, 201);
  const id = String(made.json.id);
  const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
  const review = (cookie: string | undefined, body: unknown) => r.reviewId.POST(new Request(`${HOST}/api/review/${id}`, { method: "POST", headers: { "content-type": "application/json", origin: HOST, "x-forwarded-for": "10.9.9.9", ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) }), ctx(id));
  assert.equal((await call(r.review.GET, "GET")).status, 401);
  assert.equal((await call(r.review.GET, "GET", undefined, { cookie: plain })).status, 403, "an ordinary account cannot read the queue");
  assert.equal((await review(plain, { decision: "approved" })).status, 403);
  assert.equal((await review(undefined, { decision: "approved" })).status, 401);
  const q = await call(r.review.GET, "GET", undefined, { cookie: ed });
  assert.equal(q.json.items.length >= 1, true);
  const item = q.json.items.find((i: { id: number }) => String(i.id) === id);
  assert.ok(item.flags.includes("new_person"), "a person we have not heard of is flagged for the reviewer");
  assert.equal(item.proposer, "jack_jj");

  // an editor may not approve their own proposal
  const own = await call(r.contribute.POST, "POST", stintBody(box.e, { personName: "Own Goal-Coach", start: "2019-01-01", quote: "Own Goal-Coach trained him from 2019" }), { cookie: ed });
  const ownRes = await r.reviewId.POST(new Request(`${HOST}/api/review/x`, { method: "POST", headers: { "content-type": "application/json", origin: HOST, cookie: ed }, body: JSON.stringify({ decision: "approved" }) }), ctx(String(own.json.id)));
  assert.equal(ownRes.status, 403);
  assert.equal((await review(ed, { decision: "rejected", note: "no" })).status, 400, "rejecting needs a real reason");
  assert.equal((await review(ed, { decision: "maybe" })).status, 400);

  assert.equal(db.prepare("SELECT COUNT(*) c FROM team_stints WHERE source = ?").get(EDIT_SOURCE)!.c, 0, "nothing reaches the database before approval");
  assert.equal((await review(ed, { decision: "approved", note: "source confirms" })).status, 200);
  assert.equal((await review(ed, { decision: "approved" })).status, 409, "decided once");
  const row = db.prepare(`SELECT s.role, s.start_date, s.end_date, s.source_url, s.note, p.name, p.slug FROM team_stints s JOIN people p ON p.id = s.person_id WHERE s.boxer_id = ? AND s.source = ?`).get(box.id, EDIT_SOURCE) as Record<string, string | null>;
  assert.deepEqual([row.role, row.start_date, row.end_date, row.name, row.source_url], ["head_trainer", "2022-05-01", null, "Zed Nobody-Known", "https://example.org/profile"]);
  assert.match(String(row.note), /took over the corner/);
  assert.ok(db.prepare("SELECT 1 x FROM people WHERE slug = ?").get(row.slug!), "the person has a page");
  assert.equal((await call(r.contribute.GET, "GET", undefined, { cookie: prop })).json.items.find((i: { id: number }) => String(i.id) === id).status, "approved");

  // idempotent, and replayed into a database that was rebuilt from scratch
  assert.deepEqual(applyContributions(db, accountsDb()), { written: 1, skipped: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM team_stints WHERE source = ?").get(EDIT_SOURCE)!.c, 1);
  db.prepare("DELETE FROM team_stints WHERE source = ?").run(EDIT_SOURCE); db.prepare("DELETE FROM people WHERE external_id LIKE 'community:%'").run();
  assert.deepEqual(applyContributions(db, accountsDb()), { written: 1, skipped: 0 });
  assert.equal(db.prepare("SELECT COUNT(*) c FROM people WHERE name = 'Zed Nobody-Known'").get()!.c, 1, "no duplicate person");
  const { DatabaseSync } = await import("node:sqlite");
  const empty = new DatabaseSync(":memory:");
  empty.exec("CREATE TABLE boxers (id INTEGER PRIMARY KEY, external_id TEXT); CREATE TABLE people (id INTEGER PRIMARY KEY, external_id TEXT UNIQUE, slug TEXT UNIQUE, name TEXT); CREATE TABLE team_stints (id INTEGER PRIMARY KEY, boxer_id INT, role TEXT, person_id INT, org_id INT, start_date TEXT, end_date TEXT, source TEXT, source_url TEXT, note TEXT)");
  assert.deepEqual(applyContributions(empty as never, accountsDb()), { written: 0, skipped: 1 }, "an edit about a fighter this database lacks is skipped, not lost");

  // a vendor re-ingest replaces vendor stints per source and leaves the community rows alone
  const { ingest } = await import("../lib/ingest");
  const before = db.prepare("SELECT COUNT(*) c FROM team_stints WHERE source = ?").get(EDIT_SOURCE)!.c;
  await ingest(db);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM team_stints WHERE source = ?").get(EDIT_SOURCE)!.c, before, "a re-ingest does not touch community rows");

  // rejection is recorded and nothing is written
  const rej = await call(r.contribute.POST, "POST", stintBody(box.e, { personName: "Rae Ject-Coach", start: "2018-02-01", quote: "Rae Ject-Coach was his manager in 2018" , role: "manager" }), { cookie: prop });
  const rid = String(rej.json.id);
  const res = await r.reviewId.POST(new Request(`${HOST}/api/review/${rid}`, { method: "POST", headers: { "content-type": "application/json", origin: HOST, cookie: ed }, body: JSON.stringify({ decision: "rejected", note: "page does not say that" }) }), ctx(rid));
  assert.equal(res.status, 200);
  assert.equal(db.prepare("SELECT COUNT(*) c FROM team_stints WHERE source = ? AND role = 'manager'").get(EDIT_SOURCE)!.c, 0);
  const mineAfter = (await call(r.contribute.GET, "GET", undefined, { cookie: prop })).json.items.find((i: { id: number }) => String(i.id) === rid);
  assert.deepEqual([mineAfter.status, mineAfter.reviewNote], ["rejected", "page does not say that"]);
  assert.ok((accountsDb().prepare("SELECT COUNT(*) c FROM audit WHERE action LIKE 'contribution_%'").get() as { c: number }).c >= 2, "decisions are in the audit log");
});

test("an admin may review their own proposal; flags warn about overlaps and quotes that do not name the person", async () => {
  const { db } = await world();
  const { flagsFor } = await import("../lib/accounts/contributions");
  const stint = db.prepare(`SELECT b.external_id e, s.start_date sd, s.end_date ed, p.name n FROM team_stints s JOIN boxers b ON b.id = s.boxer_id JOIN people p ON p.id = s.person_id WHERE s.role = 'head_trainer' AND s.source != 'Community edit' AND s.start_date IS NOT NULL LIMIT 1`).get() as { e: string; sd: string; ed: string | null; n: string };
  const clash = flagsFor({ boxerExt: stint.e, role: "head_trainer", personName: "Someone Else", start: stint.sd, end: stint.ed, quote: "Someone Else was in the corner" }, db);
  assert.ok(clash.includes("overlaps_other"), "a second head trainer in the same period is flagged");
  assert.ok(flagsFor({ boxerExt: stint.e, role: "cutman", personName: "Someone Else", start: stint.sd, end: null, quote: "he works with a good cutman" }, db).includes("quote_lacks_name"));
  assert.ok(!flagsFor({ boxerExt: stint.e, role: "cutman", personName: "Someone Else", start: stint.sd, end: null, quote: "Someone Else is his cutman" }, db).includes("quote_lacks_name"));
  assert.ok(flagsFor({ boxerExt: stint.e, role: "cutman", personName: "Someone Else", start: "1900-01-01", end: null, quote: "Someone Else is his cutman" }, db).includes("before_career"));

  // an admin may decide their own proposal (an editor may not); an ordinary user cannot decide anything
  const { submit, review } = await import("../lib/accounts/contributions");
  const { createUser, setRole } = await import("../lib/accounts/users");
  const made = await createUser("root_admin", PW) as { user: import("../lib/accounts/users").User };
  setRole("root_admin", "admin");
  const admin = { ...made.user, role: "admin" as const };
  const sub = submit(admin, { boxerExt: stint.e, role: "cutman", personName: "Ann Admin-Cut", start: "2020-01-01", sourceUrl: "https://example.org/a", quote: "Ann Admin-Cut is his cutman" }, db);
  assert.ok(sub.ok);
  assert.deepEqual(review({ ...admin, role: "editor" }, (sub as { id: number }).id, "approved", "", db), { ok: false, error: "own" });
  assert.deepEqual(review({ ...admin, role: "user" }, (sub as { id: number }).id, "approved", "", db), { ok: false, error: "forbidden" });
  assert.deepEqual(review(admin, (sub as { id: number }).id, "approved", "checked the page myself", db), { ok: true });
});

// ---------- the source check and the network guard ----------
test("a link cannot be used to reach this server's own network", async () => {
  for (const a of ["127.0.0.1", "10.2.3.4", "172.16.0.1", "172.32.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "224.0.0.1", "::1", "fe80::1", "fd00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip"]) {
    assert.equal(isPrivateAddress(a), a === "172.32.0.1" ? false : true, a);
  }
  for (const a of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) assert.equal(isPrivateAddress(a), false, a);
  assert.match((await publicHostOnly("internal.example", async () => [{ address: "10.0.0.5" }]))!, /private/);
  assert.match((await publicHostOnly("mixed.example", async () => [{ address: "8.8.8.8" }, { address: "169.254.169.254" }]))!, /private/, "one private answer is enough to refuse");
  assert.equal(await publicHostOnly("ok.example", async () => [{ address: "93.184.216.34" }]), null);
  assert.match((await publicHostOnly("gone.example", async () => { throw new Error("ENOTFOUND"); }))!, /resolve/);
  assert.match((await publicHostOnly("169.254.169.254"))!, /not public/);
  assert.equal(await publicHostOnly("93.184.216.34"), null);
});

test("strict redirects: same site only, a few hops, every hop checked", async () => {
  const log: string[] = [];
  const pages: Record<string, () => Response> = {
    "https://a.example/robots.txt": () => new Response("", { status: 404 }),
    "https://a.example/ok": () => new Response("<p>hello there</p>", { headers: { "content-type": "text/html" } }),
    "https://a.example/same": () => new Response("", { status: 301, headers: { location: "/ok" } }),
    "https://a.example/other": () => new Response("", { status: 302, headers: { location: "https://b.example/x" } }),
    "https://a.example/metadata": () => new Response("", { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" } }),
    "https://a.example/loop": () => new Response("", { status: 302, headers: { location: "/loop" } }),
  };
  const fetchImpl = (async (u: RequestInfo | URL, init?: RequestInit) => { log.push(`${init?.redirect}:${String(u)}`); const p = pages[String(u)]; return p ? p() : new Response("", { status: 404 }); }) as typeof fetch;
  const mk = (strict: boolean, hostCheck?: (h: string) => Promise<string | null>) => new PoliteFetcher({ contact: "https://example.org/contact", fetchImpl, delayMs: 0, sleep: async () => {}, strictRedirects: strict, hostCheck });
  const f = mk(true);
  assert.ok((await f.get("https://a.example/same")).ok, "a redirect within the site is followed");
  for (const p of ["other", "metadata", "loop"]) { const res = await f.get(`https://a.example/${p}`); assert.ok(!res.ok && res.reason === "blocked", p); }
  assert.ok(!log.some((l) => l.includes("169.254")) && !log.some((l) => l.includes("b.example/x")), "the other site and the metadata address were never requested");
  assert.ok(log.filter((l) => l.includes("a.example/ok")).every((l) => l.startsWith("manual:")), "redirects are followed by hand");
  const checked: string[] = [];
  const g = mk(true, async (h) => { checked.push(h); return h === "a.example" ? "refused for the test" : null; });
  const res = await g.get("https://a.example/ok");
  assert.ok(!res.ok && /refused for the test/.test(res.detail) && checked.includes("a.example"));
});

test("the source check finds the quote on the page, says when it cannot, and keeps the answer from the proposer", async () => {
  const { runSourceCheck, checkQuote } = await import("../lib/accounts/source-check");
  const { accountsDb } = await import("../lib/accounts/store");
  const acc = accountsDb();
  assert.ok(checkQuote("Story.  Marco   Test-Coach has trained him — since March 2021.", "marco test-coach has trained him - since march 2021"));
  assert.ok(!checkQuote("Story.", "Marco Test-Coach has trained him"));
  assert.ok(checkQuote("Boxing [ b ] is a combat sport and martial art . [ 1 ] Taking place in a ring", "Boxing is a combat sport and martial art. Taking place in a ring"), "footnote markers on the page do not break a copied quote");
  assert.ok(!checkQuote("Boxing [ b ] is a combat sport", "Boxing is a combat sport and martial art"), "but the words still have to be there");
  const ins = acc.prepare("INSERT INTO contributions (boxer_ext, role, person_name, start_date, source_url, quote, created_at) VALUES ('X','head_trainer','Marco Test-Coach','2021-03-01','https://example.org/p','Marco Test-Coach has trained him since March 2021','2026-01-01T00:00:00Z') RETURNING id");
  const id = (ins.get() as { id: number }).id;
  const page = (text: string) => async (url: string) => ({ ok: true as const, url, text, fromCache: false, status: 200 });
  assert.equal(await runSourceCheck(id, "kate_kk", acc, page("<p>Marco Test-Coach has trained him since March 2021</p>")), "quote_found");
  assert.equal(await runSourceCheck(id, "kate_kk", acc, page("nothing relevant")), "quote_missing");
  assert.equal(await runSourceCheck(id, "kate_kk", acc, async (url) => ({ ok: false as const, url, reason: "blocked" as const, detail: "HTTP 403" })), "unreadable");
  assert.equal(await runSourceCheck(id, "kate_kk", acc, async () => { throw new Error("boom"); }), "unreadable");
  assert.equal(await runSourceCheck(99999, "kate_kk", acc, page("x")), "not_found");
  const prev = process.env.RESEARCH_CONTACT; delete process.env.RESEARCH_CONTACT;
  assert.equal(await runSourceCheck(id, "kate_kk", acc), "unavailable", "without a RESEARCH_CONTACT the check does not run (the User-Agent must say who is asking)");
  if (prev) process.env.RESEARCH_CONTACT = prev;
  const stored = acc.prepare("SELECT source_check FROM contributions WHERE id = ?").get(id) as { source_check: string };
  assert.equal(stored.source_check, "unavailable");
});

// ---------- abuse limits and things that broke in the browser ----------
test("hashing has a site-wide budget on top of the per-address limits, so a faked address header cannot keep every worker busy", async () => {
  const r = await routes();
  limits().hashing.reset();
  for (let i = 0; i < 240; i++) limits().hashing.take("all");
  const res = await call(r.login, "POST", { username: "someone_x", password: "whatever whatever" }, { ip: "10.50.0.1" });
  assert.equal(res.status, 429, "refused before any hashing starts");
  assert.equal((await call(r.signup, "POST", { username: "budget_user", password: PW }, { ip: "10.50.0.2" })).status, 429);
  limits().hashing.reset();
  assert.equal((await call(r.login, "POST", { username: "someone_x", password: "whatever whatever" }, { ip: "10.50.0.3" })).status, 401);
});

test("links from contributions are only ever http(s), wherever they are shown", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  for (const f of ["components/ReviewQueue.tsx", "app/[locale]/boxers/[slug]/page.tsx"]) assert.match(read(f), /\/\^https\?:\\\/\\\//, `${f} must check the scheme before it renders a link`);
  assert.match(read("components/ReviewQueue.tsx"), /noopener noreferrer nofollow ugc/);
});

test("browser regressions: a stable server snapshot, picks that survive two quick clicks, a header that fits a 320 px screen", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  // useSyncExternalStore loops forever if getServerSnapshot returns a fresh object each call (it did, in the first version)
  const acct = read("lib/useAccount.ts");
  assert.match(acct, /const SERVER: State = /);
  assert.ok(!/useSyncExternalStore\([^;]*\(\) => \(\{/.test(acct), "no object literal returned from a snapshot function");
  // two clicks in one tick must not overwrite each other (the second used the first render's picks)
  const picks = read("lib/usePicks.ts");
  assert.match(picks, /mirror\.current/); assert.match(picks, /localStorage\.getItem\(PICKS_KEY\)/);
  // the header at 320 px: the account link is an icon below sm, and the spacing tightens
  assert.match(read("components/AccountMenu.tsx"), /hidden[^"]*sm:inline/);
  assert.match(read("app/[locale]/layout.tsx"), /gap-2 px-3 py-3 sm:gap-3 sm:px-5/);
  assert.match(read("components/LanguageSwitch.tsx"), /px-2 py-1\.5[^"]*sm:px-3/);
});

test("every form field in the account screens is tied to its label", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  const s = read("components/AccountPanel.tsx");
  for (const m of s.matchAll(/<Field id="([\w-]+)"[^>]*>\s*<input id="([\w-]+)"/g)) assert.equal(m[1], m[2], `Field ${m[1]} wraps an input with a different id`);
  assert.ok([...s.matchAll(/<Field id="/g)].length >= 8);
  const c = read("components/ContributeForm.tsx");
  for (const m of c.matchAll(/<label htmlFor="([\w-]+)"/g)) assert.match(c, new RegExp(`id="${m[1]}"`), `label for ${m[1]} has no field`);
});
