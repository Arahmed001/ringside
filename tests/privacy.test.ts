import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { tempDb } from "./helpers";

/**
 * What the privacy page (/privacy) says about the data held, and what the code does about it. The page's claims are only worth having if they
 * stay true, so each one that can be checked is: deleting an account removes the person from every table (not only the ones with a user_id),
 * the export holds everything held about them, and nothing is stored that the page does not declare.
 */
const cleanup = tempDb("privacy");
const accFile = path.join(os.tmpdir(), `ringside-test-privacy-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

let db: DatabaseSync;
let U: typeof import("../lib/accounts/users");
let S: typeof import("../lib/accounts/store");
const PW = "correct horse battery";

before(async () => { S = await import("../lib/accounts/store"); U = await import("../lib/accounts/users"); db = S.accountsDb(); });

/** Every cell of every table, as one lower-case string: where a name could be hiding. */
function dump(d: DatabaseSync): string {
  const tables = (d.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
  return tables.map((t) => JSON.stringify(d.prepare(`SELECT * FROM "${t}"`).all())).join("\n").toLowerCase();
}

/** A person with something in every place the app keeps anything about a person. */
async function populate(name: string, contact: string) {
  const made = await U.createUser(name, PW, db);
  assert.ok("user" in made, JSON.stringify(made));
  const id = made.user.id;
  U.createSession(id, db, Date.now(), "Mozilla/5.0 (Macintosh) Chrome/120");
  db.prepare("INSERT INTO picks (user_id, bout_ext, boxer_ext, picked_at) VALUES (?,?,?,?)").run(id, `B-${name}`, "X1", "2026-10-01T00:00:00Z");
  db.prepare("INSERT INTO contributions (user_id, boxer_ext, role, person_name, start_date, source_url, quote, note, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)").run(id, "X1", "head_trainer", "Some Trainer", "2020-01-01", "https://example.org/a", "quote", "a note", "pending", "2026-10-01T00:00:00Z");
  db.prepare("INSERT INTO reports (user_id, kind, target_type, target_ext, field, shown_value, proposed_value, source_url, quote, note, contact, status, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(id, "error", "boxer", "X1", "reach", "180", "182", "https://example.org/b", "q", "n", contact, "open", "2026-10-01T00:00:00Z");
  db.prepare("INSERT INTO boxer_owners (user_id, boxer_ext, verified_by, verified_at, official_urls) VALUES (?,?,?,?,?)").run(id, "X1", "admin1", "2026-10-01T00:00:00Z", "[]");
  S.audit(db, name, "contribution_approved", "#9", `X1 head_trainer by ${name}`);   // this person acting as a reviewer
  S.audit(db, "admin1", "owner_linked", `${name} -> X1`, "https://example.org/official");  // someone acting on this person
  S.audit(db, "operator", "disable", name);
  return id;
}

test("deleting an account removes the person from every table, including the activity log and the contact left on a report", async () => {
  const id = await populate("alice_x", "alice.private@example.com");
  const bobId = await populate("bobby", "bob.private@example.com");
  assert.ok(dump(db).includes("alice_x") && dump(db).includes("alice.private@example.com"), "the test data is there to begin with");

  assert.equal(await U.deleteUser(id, PW, db), true);
  const after = dump(db);
  assert.ok(!after.includes("alice_x"), "the username is in no table, whatever the column");
  assert.ok(!after.includes("alice.private@example.com"), "and neither is the contact she gave");
  // the editorial record stays, without her: the report and the proposal are still there, no longer hers
  assert.equal((db.prepare("SELECT COUNT(*) c FROM reports WHERE user_id IS NULL AND target_ext = 'X1' AND field = 'reach'").get() as { c: number }).c, 1);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM contributions WHERE user_id IS NULL AND person_name = 'Some Trainer'").get() as { c: number }).c, 1);
  assert.ok(after.includes("account_deleted"), "that an account was deleted is still recorded, without the name");
  // and nobody else lost anything
  assert.ok(after.includes("bobby") && after.includes("bob.private@example.com"));
  assert.equal((db.prepare("SELECT COUNT(*) c FROM audit WHERE actor = 'bobby' OR target LIKE 'bobby%'").get() as { c: number }).c, 4, "his sign-up and the three entries made in populate(): untouched");
  assert.equal((db.prepare("SELECT COUNT(*) c FROM picks WHERE user_id = ?").get(bobId) as { c: number }).c, 1);
});

test("a short name does not take other people's words with it: only whole words are replaced in the log", async () => {
  const id = await populate("ned", "ned@example.com");
  S.audit(db, "someone_else", "report_accepted", "#4", "banned by ned, then planned");
  assert.equal(await U.deleteUser(id, PW, db), true);
  const rows = db.prepare("SELECT actor, target, detail FROM audit WHERE detail LIKE '%banned%'").all() as { actor: string; detail: string }[];
  assert.equal(rows.length, 1);
  assert.equal(rows[0].detail, "banned by deleted account, then planned", "'banned' and 'planned' keep their 'ned'; only the word 'ned' is gone");
});

test("a name with an underscore or a different case is found in the log, and the wrong password deletes nothing", async () => {
  const id = await populate("Mia_Q_9", "mia@example.com");
  S.audit(db, "operator", "reset_issued", "mia_q_9");
  assert.equal(await U.deleteUser(id, "not the password at all", db), false);
  assert.ok(dump(db).includes("mia_q_9"), "a wrong password changes nothing");
  assert.equal(await U.deleteUser(id, PW, db), true);
  assert.ok(!dump(db).includes("mia_q_9"), "found whatever the case");
});

test("the export holds everything held about the person, and neither their password hash nor a session token", async () => {
  const { exportFor } = await import("../lib/accounts/export");
  const id = await populate("carla_9", "carla.private@example.com");
  const user = U.userForToken(U.createSession(id, db, Date.now(), "Mozilla/5.0 (Windows NT 10.0) Firefox/121").token, db)!;
  const out = exportFor(user, db, new Date("2026-10-04T10:00:00Z"));
  assert.equal(out.exportedAt, "2026-10-04T10:00:00.000Z");
  assert.equal(out.user.username, "carla_9");
  assert.equal(out.picks.length, 1);
  assert.equal(out.contributions.length, 1);
  assert.equal(out.reports.length, 1);
  assert.equal((out.reports[0] as { contact: string }).contact, "carla.private@example.com", "the contact she gave with a report is hers to see");
  assert.equal(out.linkedFighters.length, 1);
  assert.ok(out.sessions.length >= 2 && out.sessions.every((s) => "device" in s && "signedInAt" in s), "devices with a label and dates");
  assert.ok(out.activity.some((a) => a.action === "contribution_approved" && a.by === "carla_9"), "a thing she did");
  assert.ok(out.activity.some((a) => a.action === "owner_linked" && /carla_9/.test(a.about ?? "")), "a thing done about her");
  assert.ok(out.activity.some((a) => a.action === "signup"), "her own sign-up");
  // nothing secret, and nothing about anyone else
  const text = JSON.stringify(out).toLowerCase();
  const row = db.prepare("SELECT pw_hash FROM users WHERE id = ?").get(id) as { pw_hash: string };
  assert.ok(!text.includes(row.pw_hash.toLowerCase()), "no password hash");
  for (const s of db.prepare("SELECT token_hash FROM sessions").all() as { token_hash: string }[]) assert.ok(!text.includes(s.token_hash), "no session token hash");
  assert.ok(!text.includes("bobby") && !text.includes("alice_x") && !text.includes("bob.private"), "nobody else's details");
});

test("every table that holds something about a person is exported or excused, so adding one is a decision about the export and the privacy page", async () => {
  const { EXPORTED_TABLES, NOT_EXPORTED } = await import("../lib/accounts/export");
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name);
  const personal = tables.filter((t) => (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).some((c) => c.name === "user_id"));
  assert.ok(personal.length >= 5, personal.join(","));
  const undecided = personal.filter((t) => !(t in EXPORTED_TABLES) && !(t in NOT_EXPORTED));
  assert.deepEqual(undecided, [], "a table with a user_id that is neither exported (lib/accounts/export.ts) nor given a reason there");
  for (const t of Object.keys(NOT_EXPORTED)) assert.ok(NOT_EXPORTED[t].length > 20, `${t} needs a real reason`);
  for (const t of Object.keys(EXPORTED_TABLES)) assert.ok(tables.includes(t), `${t} is exported but is not a table`);
});

test("the export route returns it as a download for the signed-in person only", async () => {
  const { GET } = await import("../app/api/account/export/route");
  const res0 = await GET(new Request("http://localhost/api/account/export"));
  assert.equal(res0.status, 401);
  const id = await populate("dana_q", "dana@example.com");
  const { token } = U.createSession(id, db, Date.now(), "Mozilla/5.0 (Macintosh) Safari/17");
  const res = await GET(new Request("http://localhost/api/account/export", { headers: { cookie: `${U.SESSION_COOKIE}=${token}` } }));
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-disposition") ?? "", /attachment; filename="ringside-my-data\.json"/);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.user.username, "dana_q");
  assert.equal(body.reports.length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------------------
// The page's claims against the code. Each of these fails when someone adds something that the page would then have to say.
// ---------------------------------------------------------------------------------------------------------------------------------
const ROOT = process.cwd();
const walk = (dir: string): string[] => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === ".next" ? [] : walk(path.join(dir, e.name))) : /\.(ts|tsx)$/.test(e.name) ? [path.join(dir, e.name)] : []));
const SITE = ["app", "components", "lib", "proxy.ts", "instrumentation.ts"].flatMap((p) => (fs.statSync(path.join(ROOT, p)).isDirectory() ? walk(p) : [p]));
const src = (f: string) => fs.readFileSync(path.join(ROOT, f), "utf8");

test("the browser's own storage holds only what the page says, and everything it says is really there", async () => {
  const { STORAGE_KEYS } = await import("../lib/privacy");
  // files that touch browser storage: the hooks, the two components, the layout's first-paint script, and the offline review sheet (a separate file for a translator, not part of the site)
  const ALLOWED = ["lib/useLocal.ts", "lib/usePicks.ts", "lib/useWatchlist.ts", "components/AccountPanel.tsx", "components/RailControls.tsx", "app/[locale]/layout.tsx", "lib/i18n/review-sheet.ts", "lib/nav.ts"];
  const users = SITE.filter((f) => /\b(localStorage|sessionStorage|indexedDB|caches\.open)\b/.test(src(f).replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  assert.deepEqual(users.filter((f) => !ALLOWED.includes(f)), [], "a new place that stores things in the browser: declare what it stores in lib/privacy.ts (STORAGE_KEYS) and allow the file here");
  // every key-looking string in the site's code is declared
  const declared = new Set(STORAGE_KEYS.map((k) => k.key));
  const seen = new Set<string>();
  for (const f of SITE.filter((x) => x !== "lib/privacy.ts" && x !== "lib/i18n/review-sheet.ts")) for (const m of src(f).matchAll(/["'`](ringside[:\-][a-z]+)["'`]/g)) seen.add(m[1]);
  assert.deepEqual([...seen].filter((k) => !declared.has(k)), [], "a storage key the privacy page does not mention");
  assert.deepEqual([...declared].filter((k) => !seen.has(k)), [], "a key the page mentions that no code uses any more");
});

test("cookies: only the sign-in routes set one, so a visitor who has not signed in never gets one", async () => {
  const setters = SITE.filter((f) => /set-cookie|document\.cookie|cookies\(\)\.set|cookies\(\)\.delete/i.test(src(f).replace(/\/\*[\s\S]*?\*\/|^\s*\/\/.*$/gm, "")));
  // lib/security.ts only mentions the header to check that pages do not set it
  assert.deepEqual(setters.filter((f) => f !== "lib/accounts/api.ts" && f !== "lib/security.ts" && !f.startsWith("app/api/account/")), [], "something other than the account routes sets a cookie: the privacy page says there is only the sign-in cookie");
  assert.ok(setters.some((f) => f.startsWith("app/api/account/")), "the account routes do set it (this scan can see them)");
  // the header itself, from the function that builds it: what the page promises about the cookie
  const { sessionCookie } = await import("../lib/accounts/api");
  const plain = sessionCookie({ headers: new Headers() }, "tok", new Date("2026-11-01T00:00:00Z"));
  assert.match(plain, /^rs_session=tok;/);
  assert.match(plain, /; HttpOnly(;|$)/, "scripts on the page cannot read it");
  assert.match(plain, /; SameSite=Lax(;|$)/, "it is not sent along with requests from other websites");
  assert.match(plain, new RegExp(`Max-Age=${30 * 86400}`), "thirty days");
  assert.ok(!/; Secure/.test(plain), "not marked secure over plain http (it could never be sent)");
  assert.match(sessionCookie({ headers: new Headers({ "x-forwarded-proto": "https" }) }, "tok", new Date()), /; Secure/, "marked secure when served over https");
  const gone = (await import("../lib/accounts/api")).clearCookie({ headers: new Headers() });
  assert.match(gone, /HttpOnly/);
  assert.match(gone, /Max-Age=0/);
});

test("nothing is loaded from another website that runs or styles the page, and there is no tracker in the code", async () => {
  const { contentSecurityPolicy, securityProblems } = await import("../lib/security");
  const csp = contentSecurityPolicy({ nonce: "abc", https: true });
  for (const d of csp.split("; ")) {
    const [name, ...vals] = d.split(" ");
    if (name === "img-src") continue; // pictures may come from https hosts: the page says which
    if (name === "frame-src") { const { CLICK_TO_LOAD } = await import("../lib/privacy"); const { EMBED_HOSTS } = await import("../lib/social/post"); assert.deepEqual(vals.map((v) => v.replace("https://", "")).sort(), Object.values(EMBED_HOSTS).sort(), "one host per platform"); assert.deepEqual(Object.values(EMBED_HOSTS).filter((h) => !CLICK_TO_LOAD.some((c) => c.host === h)), [], "each is declared on the privacy page as opened only by a press"); continue; }
    assert.ok(!vals.some((v) => /^(https?:|\*|[a-z0-9-]+\.[a-z]{2,})/i.test(v) && !v.startsWith("'")), `${name} allows another origin: ${vals.join(" ")}`);
  }
  assert.match(csp, /img-src [^;]*https:/, "the one allowance, which the page explains");
  assert.match(csp, /frame-ancestors 'none'/);
  // the checks the smoke run applies to every page
  const ok = { get: (k: string) => ({ "content-security-policy": csp, "x-content-type-options": "nosniff", "referrer-policy": "strict-origin-when-cross-origin", "x-frame-options": "DENY", "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()", "cross-origin-opener-policy": "same-origin" } as Record<string, string>)[k.toLowerCase()] ?? null };
  assert.deepEqual(securityProblems(ok, "<p>hi</p>"), []);
  assert.ok(securityProblems({ get: (k) => (k.toLowerCase() === "set-cookie" ? "a=b" : ok.get(k)) }, "").includes("the page sets a cookie for an anonymous visitor"));
  assert.ok(securityProblems(ok, '<script src="https://cdn.example.com/x.js"></script>').includes("a script from another website"));
  assert.ok(securityProblems(ok, '<script src="//cdn.example.com/x.js"></script>').includes("a script from another website"));
  assert.ok(!securityProblems(ok, '<script src="/_next/static/a.js"></script>').includes("a script from another website"), "this site's own scripts are fine");
  assert.ok(securityProblems(ok, '<link rel="stylesheet" href="https://fonts.example.com/css">').includes("a stylesheet from another website"));
  assert.ok(!securityProblems(ok, '<link rel="stylesheet" href="/_next/static/a.css">').includes("a stylesheet from another website"));
  // and no analytics or advertising in the code
  const TRACKERS = /google-analytics|googletagmanager|gtag\(|plausible\.io|segment\.(com|io)|hotjar|mixpanel|facebook\.net|fbq\(|doubleclick|clarity\.ms|matomo|posthog|amplitude\.com|sentry\.io|datadoghq|newrelic|fullstory/i;
  assert.deepEqual(SITE.filter((f) => f !== "lib/privacy.ts" && TRACKERS.test(src(f))), [], "something that looks like an analytics or tracking service: the privacy page says there is none");
});

test("the accounts database holds exactly the tables and columns the page declares", async () => {
  const { HELD } = await import("../lib/privacy");
  const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as { name: string }[]).map((t) => t.name).sort();
  assert.deepEqual(tables, Object.keys(HELD).sort(), "a table that is not in HELD (or a declared one that is gone): the page describes what is kept per table");
  for (const t of tables) {
    const cols = (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((c) => c.name).sort();
    assert.deepEqual(cols, [...HELD[t].columns].sort(), `${t}: columns differ from lib/privacy.ts`);
    assert.ok(HELD[t].what.length > 30, `${t} needs a sentence the page can show`);
  }
});

test("text goes to the model provider from exactly the places the page lists", async () => {
  const { AI_USES } = await import("../lib/privacy");
  const listed = new Set(AI_USES.flatMap((u) => u.files));
  const called = new Set(SITE.filter((f) => /\bclaude\(/.test(src(f)) && f !== "lib/privacy.ts"));
  assert.deepEqual([...called].filter((f) => !listed.has(f)).sort(), [], "a place that sends text to the model and is not on the privacy page (lib/privacy.ts, AI_USES)");
  assert.deepEqual([...listed].filter((f) => !called.has(f)).sort(), [], "a place the page lists that no longer calls the model");
  // lib/i18n/translate.ts is the operator's own tool (`npm run i18n:translate`): it sends the site's interface strings, never anything a visitor typed
  assert.deepEqual(SITE.filter((f) => /api\.anthropic\.com/.test(src(f))).sort(), ["lib/ai.ts", "lib/i18n/translate.ts"], "the provider is contacted from these two places only: the visitor-facing function and the operator's translation tool");
  const sends = src("lib/ai.ts").match(/headers: \{[^}]*\}/)?.[0] ?? "";
  assert.ok(!/x-forwarded|ip|cookie|authorization.*user/i.test(sends.replace(/x-api-key[^,]*,/, "")), `the request carries only the key and the version: ${sends}`);
});

test("the page reads the code's own numbers and lists rather than repeating them", async () => {
  const page = src("app/[locale]/privacy/page.tsx");
  for (const used of ["SESSION_DAYS", "RESET_MINUTES", "SESSION_COOKIE", "DEFAULT_BACKUPS_KEPT", "STORAGE_KEYS", "HELD", "AI_USES", "CLICK_TO_LOAD", "pictureHosts", "hasKey()", "siteContact()"]) assert.ok(page.includes(used), `the page does not use ${used}`);
  assert.ok(!/\b(30|60|14)\b days|\b(30|60) minutes/.test(page), "a number written into the page that the code owns");
  // and the numbers reach the sentences through the constants, not through a copy
  assert.match(page, /days: SESSION_DAYS/);
  assert.match(page, /n: RESET_MINUTES/);
  assert.match(page, /n: DEFAULT_BACKUPS_KEPT/);
  assert.match(page, /name: SESSION_COOKIE/);
  assert.deepEqual([U.SESSION_DAYS, U.RESET_MINUTES, U.SESSION_COOKIE], [30, 60, "rs_session"]);
});

test("the page is where people will look: linked from the account page, in the sitemap and the palette, and in both languages", () => {
  assert.match(src("components/AccountPanel.tsx"), /href="\/privacy"/);
  assert.match(src("lib/sitemap.ts"), /"\/privacy"/);
  assert.match(src("lib/search.ts"), /href: "\/privacy"/);
  const ar = JSON.parse(src("i18n/ar.json")) as Record<string, string>;
  for (const k of ["If you only read", "If you create an account", "What deleting removes, and what stays", "What is sent to other services", "Your data"]) assert.ok(typeof ar[k] === "string" && ar[k] !== k, k);
});
