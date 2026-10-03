import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { configLine, diagnose, distance, envFindings, fileFindings, problemLines, worst, type DbFacts, type Finding, type Probe } from "../lib/doctor";

const NOW = new Date("2026-10-03T12:00:00Z");
const goodDb = (rows: Record<string, number> = { boxers: 968, events: 100, bouts: 7755 }): DbFacts => ({ exists: true, quickCheck: "ok", tables: ["boxers", "events", "bouts", "users", "sessions", "picks"], rows: { users: 31, ...rows }, mode: 0o600 });
const probe = (o: Partial<{ dirOk: boolean; dirExists: boolean; sports: DbFacts; accounts: DbFacts; backup: Date | null; free: number | null; file: boolean }> = {}): Probe => ({
  dir: () => ({ exists: o.dirExists ?? true, writable: o.dirOk ?? true }),
  db: (p) => (p.endsWith("accounts.db") ? o.accounts ?? goodDb() : o.sports ?? goodDb()),
  file: () => o.file ?? true,
  newestBackup: () => (o.backup === undefined ? new Date("2026-10-03T03:00:00Z") : o.backup),
  freeBytes: () => (o.free === undefined ? 50 * 1024 ** 3 : o.free),
});
const by = (fs: Finding[], id: string) => fs.filter((x) => x.id === id);
const levels = (fs: Finding[], id: string) => by(fs, id).map((x) => x.level);
const run = (env: Record<string, string>, p: Probe = probe(), production = true) => diagnose(env, p, { cwd: "/srv/app", now: NOW, production, nodeVersion: "22.23.2" });

test("a sound production setup has nothing to fail or warn about", () => {
  const fs = run({ NODE_ENV: "production", SITE_URL: "https://ringside.example", BOXING_PROVIDER: "licensed", BOXING_API_KEY: "k".repeat(50), BOXING_API_STORAGE_CONFIRMED: "1", ANTHROPIC_API_KEY: "sk-ant-secret", RESEARCH_CONTACT: "https://github.com/x/y", DATABASE_PATH: "/data/ringside.db" });
  assert.deepEqual(fs.filter((x) => x.level === "fail" || x.level === "warn"), []);
  assert.equal(worst(fs), "info"); // storage is confirmed, but the provider line is an info
});

test("node too old fails; the boundary 22.5 passes, 22.4 and 20 fail", () => {
  const lv = (v: string) => levels(envFindings({}, v, false), "node")[0];
  assert.deepEqual(["20.11.0", "22.4.9", "22.5.0", "22.23.2", "24.0.0"].map(lv), ["fail", "fail", "ok", "ok", "ok"]);
});

test("provider and licensed-feed settings", () => {
  assert.deepEqual(levels(envFindings({ BOXING_PROVIDER: "licenced" }), "provider"), ["fail"]);
  assert.deepEqual(levels(envFindings({ BOXING_PROVIDER: "file" }), "file-feed"), ["fail"]);
  assert.deepEqual(levels(envFindings({ BOXING_PROVIDER: "licensed" }), "api-key"), ["fail"], "missing key");
  assert.deepEqual(levels(envFindings({ BOXING_PROVIDER: "licensed", BOXING_API_KEY: "your-key…" }), "api-key"), ["fail"], "a pasted placeholder");
  assert.deepEqual(levels(envFindings({ BOXING_PROVIDER: "licensed", BOXING_API_KEY: "short" }), "api-key"), ["fail"], "too short");
  assert.deepEqual(levels(envFindings({ BOXING_PROVIDER: "licensed", BOXING_API_KEY: "a".repeat(40) }), "api-key"), ["ok"]);
  const st = (v?: string) => levels(envFindings({ BOXING_PROVIDER: "licensed", BOXING_API_KEY: "a".repeat(40), ...(v === undefined ? {} : { BOXING_API_STORAGE_CONFIRMED: v }) }), "storage")[0];
  assert.deepEqual([st("0"), st(), st("1")], ["warn", "info", "ok"]);
  // the key only matters for the licensed provider
  assert.deepEqual(by(envFindings({}), "api-key"), []);
});

test("SITE_URL: unset in production, wrong scheme, a path, localhost, not a URL", () => {
  const site = (v: string | undefined, production = true) => levels(envFindings({ ...(v === undefined ? {} : { SITE_URL: v }) }, "22.23.2", production), "site-url");
  assert.deepEqual(site(undefined), ["warn"]);
  assert.deepEqual(site(undefined, false), [], "not needed while developing");
  assert.deepEqual(site("https://ringside.example"), []);
  assert.deepEqual(site("http://ringside.example"), ["warn"]);
  assert.deepEqual(site("https://ringside.example/en"), ["warn"]);
  assert.deepEqual(site("https://ringside.example/"), [], "a bare trailing slash is the origin");
  assert.deepEqual(site("http://localhost:3000"), ["warn", "warn"], "not https and not public");
  assert.deepEqual(site("ringside.example"), ["fail"], "no scheme");
  assert.deepEqual(site("ftp://ringside.example"), ["fail"]);
  assert.match(by(envFindings({ SITE_URL: "https://r.example/x" }, "22.23.2", true), "site-url")[0].fix ?? "", /https:\/\/r\.example$/);
});

test("INDEXABLE with the demo league warns; with real data it does not", () => {
  assert.deepEqual(levels(envFindings({ INDEXABLE: "1" }), "indexable"), ["warn"]);
  assert.deepEqual(levels(envFindings({ INDEXABLE: "1", BOXING_PROVIDER: "licensed" }), "indexable"), []);
  assert.deepEqual(levels(envFindings({ NODE_ENV: "production" }), "indexable"), ["info"]);
});

test("numbers, dates, ports and contacts", () => {
  const e = (env: Record<string, string>) => envFindings(env).filter((x) => x.level === "fail" || x.level === "warn").map((x) => x.id);
  assert.deepEqual(e({ AI_DAILY_BUDGET: "lots" }), ["number-AI_DAILY_BUDGET"]);
  assert.deepEqual(e({ AI_DAILY_BUDGET: "0", AI_CLIENT_LIMIT: "20", RESEARCH_DELAY_MS: "3000" }), []);
  assert.deepEqual(e({ AI_CLIENT_LIMIT: "-1" }), ["number-AI_CLIENT_LIMIT"]);
  assert.deepEqual(e({ BOXING_API_SINCE: "2000" }), ["since"]);
  assert.deepEqual(e({ BOXING_API_SINCE: "2000-01-01" }), []);
  assert.deepEqual(e({ PORT: "99999" }), ["port"]);
  assert.deepEqual(e({ PORT: "3000" }), []);
  assert.deepEqual(e({ MEDIA_RESOLVER: "wikimedia" }), ["wikimedia-contact"]);
  assert.deepEqual(e({ MEDIA_RESOLVER: "wikimedia", WIKIMEDIA_CONTACT: "nobody" }), ["wikimedia-contact"]);
  assert.deepEqual(e({ MEDIA_RESOLVER: "wikimedia", WIKIMEDIA_CONTACT: "https://github.com/x/y" }), []);
  assert.deepEqual(e({ RESEARCH_CONTACT: "me" }), ["research-contact"]);
  assert.deepEqual(levels(envFindings({}), "research-contact"), ["info"]);
});

test("a misspelt setting is caught; other tools' variables and platform ones are left alone", () => {
  const unknown = (env: Record<string, string>) => envFindings(env).filter((x) => x.id.startsWith("unknown-")).map((x) => x.message);
  assert.equal(unknown({ SITE_URLL: "x" }).length, 1);
  assert.match(unknown({ SITE_URLL: "x" })[0], /Did you mean SITE_URL\?/);
  assert.match(unknown({ INDEXABEL: "1" })[0], /INDEXABLE/);
  assert.match(unknown({ anthropic_api_key: "x" })[0], /ANTHROPIC_API_KEY.*case-sensitive/);
  assert.match(unknown({ BOXING_API_KY: "x" })[0], /BOXING_API_KEY/);
  assert.deepEqual(unknown({ ANTHROPIC_BASE_URL: "x", AI_AGENT: "1", PATH: "/bin", HOME: "/h", NODE_ENV: "production", PORT: "3000", HOSTNAME: "0.0.0.0", NODE_OPTIONS: "", I18N_DIR: "x", REVIEW_OUT: "x", RINGSIDE_NO_SEED: "1", AI_DAILY_BUDGET: "5" }), []);
  assert.equal(distance("kitten", "sitting"), 3);
  assert.equal(distance("", "abc"), 3);
  assert.equal(distance("same", "same"), 0);
});

test("the data folder: missing, unwritable, fine", () => {
  const d = (p: Probe) => levels(fileFindings({ DATABASE_PATH: "/data/ringside.db" }, p, { now: NOW }), "data-dir");
  assert.deepEqual([d(probe({ dirExists: false })), d(probe({ dirOk: false })), d(probe())], [["warn"], ["fail"], ["ok"]]);
});

test("the sports database, by provider", () => {
  const sports = (env: Record<string, string>, db: DbFacts) => fileFindings(env, probe({ sports: db }), { now: NOW });
  const none: DbFacts = { exists: false };
  assert.deepEqual([levels(sports({}, none), "sports-db"), levels(sports({ BOXING_PROVIDER: "file", BOXING_FILE: "f" }, none), "sports-db"), levels(sports({ BOXING_PROVIDER: "licensed" }, none), "sports-db")], [["info"], ["info"], ["fail"]]);
  assert.deepEqual(levels(sports({}, { ...goodDb(), quickCheck: "database disk image is malformed" }), "sports-db"), ["fail"]);
  assert.deepEqual(levels(sports({}, { exists: true, error: "file is not a database" }), "sports-db"), ["fail"]);
  assert.deepEqual(levels(sports({}, { ...goodDb(), tables: ["users"] }), "sports-db"), ["fail"], "someone else's database");
  assert.deepEqual(levels(sports({}, goodDb({ boxers: 5, events: 1, bouts: 0 })), "sports-db"), ["warn"], "empty league");
  assert.deepEqual(levels(sports({ BOXING_PROVIDER: "licensed" }, goodDb({ boxers: 5, events: 1, bouts: 0 })), "sports-db"), ["fail"], "licensed and empty: the app refuses to start");
  assert.match(sports({}, goodDb())[1].message, /968 boxers, 7755 fights/);
});

test("accounts database: missing is fine, loose permissions warn, corruption fails; path follows ACCOUNTS_DB_PATH", () => {
  const acc = (db: DbFacts, env: Record<string, string> = {}) => fileFindings(env, probe({ accounts: db }), { now: NOW, cwd: "/srv/app" });
  assert.deepEqual(levels(acc({ exists: false }), "accounts-db"), ["info"]);
  assert.deepEqual(levels(acc(goodDb()), "accounts-perms"), []);
  assert.deepEqual(levels(acc({ ...goodDb(), mode: 0o644 }), "accounts-perms"), ["warn"]);
  assert.deepEqual(levels(acc({ ...goodDb(), mode: 0o640 }), "accounts-perms"), ["warn"], "group-readable counts");
  assert.deepEqual(levels(acc({ ...goodDb(), mode: 0o700 }), "accounts-perms"), [], "owner-only is fine");
  assert.match(by(acc({ ...goodDb(), mode: 0o644 }), "accounts-perms")[0].fix ?? "", /chmod 600 \/srv\/app\/data\/accounts\.db/);
  assert.deepEqual(levels(acc({ ...goodDb(), quickCheck: "row 3 missing" }), "accounts-db"), ["fail"]);
  const seen: string[] = [];
  fileFindings({ DATABASE_PATH: "/vol/ringside.db", ACCOUNTS_DB_PATH: "/elsewhere/a.db" }, { ...probe(), db: (p) => { seen.push(p); return goodDb(); } }, { now: NOW });
  assert.deepEqual(seen, ["/vol/ringside.db", "/elsewhere/a.db"]);
  const seen2: string[] = [];
  fileFindings({ DATABASE_PATH: "/vol/ringside.db" }, { ...probe(), db: (p) => { seen2.push(p); return goodDb(); } }, { now: NOW });
  assert.deepEqual(seen2, ["/vol/ringside.db", "/vol/accounts.db"], "beside the sports database by default, as the server does");
});

test("backups: none (warn only in production), stale, fresh; the boundary is two days", () => {
  const b = (backup: Date | null, production = true) => levels(fileFindings({}, probe({ backup }), { now: NOW, production }), "backup");
  assert.deepEqual([b(null), b(null, false)], [["warn"], ["info"]]);
  assert.deepEqual(b(new Date("2026-10-01T13:00:00Z")), ["ok"], "47 hours");
  assert.deepEqual(b(new Date("2026-10-01T11:00:00Z")), ["warn"], "49 hours");
  assert.deepEqual(b(new Date("2026-09-20T00:00:00Z")), ["warn"]);
  assert.match(by(fileFindings({}, probe({ backup: new Date("2026-09-20T00:00:00Z") }), { now: NOW }), "backup")[0].message, /13 days old \(2026-09-20\)/);
});

test("free disk thresholds and an unreadable one", () => {
  const MB = 1024 * 1024;
  const d = (free: number | null) => levels(fileFindings({}, probe({ free }), { now: NOW }), "disk");
  assert.deepEqual([d(50 * MB), d(99 * MB), d(100 * MB), d(499 * MB), d(500 * MB), d(null)], [["fail"], ["fail"], ["warn"], ["warn"], ["ok"], []]);
});

test("the file feed path must exist", () => {
  assert.deepEqual(levels(fileFindings({ BOXING_PROVIDER: "file", BOXING_FILE: "/x.json" }, probe({ file: false }), { now: NOW }), "file-feed"), ["fail"]);
  assert.deepEqual(levels(fileFindings({ BOXING_PROVIDER: "file", BOXING_FILE: "/x.json" }, probe({ file: true }), { now: NOW }), "file-feed"), []);
});

test("no finding, start-up line or problem line ever contains a secret", () => {
  const secrets = ["sk-ant-TOPSECRET123", "RAPIDKEY-TOPSECRET-aaaaaaaaaaaa", "hunter2-pass"];
  const env = { NODE_ENV: "production", ANTHROPIC_API_KEY: secrets[0], BOXING_PROVIDER: "licensed", BOXING_API_KEY: secrets[1], SITE_URL: `https://user:${secrets[2]}@ringside.example/path?token=${secrets[2]}`, ANTHROPIC_API_KEYY: secrets[0], RESEARCH_CONTACT: "x" };
  const all = JSON.stringify(run(env)) + configLine(env) + problemLines(env).join("\n");
  for (const s of secrets) assert.ok(!all.includes(s), `leaked ${s}`);
  assert.equal(JSON.parse(configLine(env)).siteUrl, "https://ringside.example", "only the origin");
});

test("the start-up line says what the server will do, and lists only problem ids", () => {
  const l = JSON.parse(configLine({ NODE_ENV: "production", BOXING_PROVIDER: "demo", ANTHROPIC_API_KEY: "k", AI_DAILY_BUDGET: "0" }, NOW));
  assert.deepEqual([l.event, l.provider, l.indexable, l.ai, l.siteUrl, l.problems], ["config", "demo", false, false, null, ["site-url"]]);
  assert.equal(JSON.parse(configLine({ BOXING_PROVIDER: "licensed", ANTHROPIC_API_KEY: "k" })).indexable, true);
  assert.equal(JSON.parse(configLine({ BOXING_PROVIDER: "licensed", ANTHROPIC_API_KEY: "k" })).ai, true);
  const lines = problemLines({ NODE_ENV: "production", SITE_URL: "http://x.example", BOXING_PROVIDER: "nope" }, NOW).map((x) => JSON.parse(x));
  assert.deepEqual(lines.map((x) => [x.level, x.id]).sort(), [["error", "provider"], ["warn", "site-url"]]);
  assert.deepEqual(problemLines({ SITE_URL: "https://ok.example" }), []);
});

test("npm run doctor on real files: a good setup passes; a loose accounts file, a damaged database and a foreign one are each reported", () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "ringside-doctor-"));
  const make = (file: string, sql: string) => { const db = new DatabaseSync(file); db.exec(sql); db.close(); };
  make(path.join(d, "ringside.db"), "CREATE TABLE boxers(id INTEGER); CREATE TABLE events(id INTEGER); CREATE TABLE bouts(id INTEGER); INSERT INTO boxers VALUES (1); INSERT INTO bouts VALUES (1);");
  make(path.join(d, "accounts.db"), "CREATE TABLE users(id INTEGER); CREATE TABLE sessions(id INTEGER); CREATE TABLE picks(id INTEGER);");
  fs.chmodSync(path.join(d, "accounts.db"), 0o600);
  const stamp = new Date(Date.now() - 3600_000).toISOString().replace(/\.\d+Z$/, "Z").replace(/:/g, "-");
  fs.mkdirSync(path.join(d, "backups", stamp), { recursive: true });
  fs.writeFileSync(path.join(d, "backups", stamp, "ringside.db"), "x");
  const go = (env: Record<string, string> = {}, args: string[] = []) => spawnSync(process.execPath, ["--import", "tsx", "scripts/doctor.ts", ...args], { env: { NODE_ENV: "development", PATH: process.env.PATH ?? "", HOME: d, DATABASE_PATH: path.join(d, "ringside.db"), SITE_URL: "https://r.example", ...env }, encoding: "utf8" });

  const good = go({}, ["--production"]);
  assert.equal(good.status, 0, good.stdout + good.stderr);
  assert.match(good.stdout, /1 boxers, 1 fights, integrity ok/);
  assert.match(good.stdout, /Newest backup is from/);
  assert.doesNotMatch(good.stdout, /WARN|FAIL/);

  fs.chmodSync(path.join(d, "accounts.db"), 0o644);
  const loose = go({}, ["--production"]);
  assert.equal(loose.status, 0, "a warning alone does not fail the run");
  assert.match(loose.stdout, /WARN .*readable by other users/);
  assert.equal(go({}, ["--production", "--strict"]).status, 1, "--strict makes warnings fail");

  fs.writeFileSync(path.join(d, "ringside.db"), "this is not a database at all, just text that is long enough to look like one");
  const broken = go({}, ["--production"]);
  assert.equal(broken.status, 1);
  assert.match(broken.stdout, /FAIL .*cannot be read cleanly/);

  make(path.join(d, "ringside.db.other"), "CREATE TABLE users(id INTEGER)");
  fs.renameSync(path.join(d, "ringside.db.other"), path.join(d, "ringside.db"));
  assert.match(go().stdout, /FAIL .*missing the table\(s\) boxers, events, bouts/);

  const json = JSON.parse(go({}, ["--json"]).stdout) as Finding[];
  assert.ok(json.every((x) => ["fail", "warn", "info", "ok"].includes(x.level)));
});
