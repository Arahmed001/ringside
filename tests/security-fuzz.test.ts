import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { tempDb } from "./helpers";

/**
 * A fuzz pass over this week's endpoints (task 7 of the overnight list): hostile and malformed input at every parameter of every new route, in process. What must hold for
 * every answer: it is not a server error, it shows nothing of the server's insides (a stack, a file path, an exception's text), it sets no cookie, and a state-changing call
 * from another site or without a sign-in changes nothing. The inputs come from a seeded generator, so a failure repeats.
 */
const cleanup = tempDb("securityfuzz");
const accFile = path.join(os.tmpdir(), `ringside-test-fuzz-accounts-${process.pid}.db`);
process.env.ACCOUNTS_DB_PATH = accFile;
const wipe = () => { for (const e of ["", "-wal", "-shm"]) fs.rmSync(accFile + e, { force: true }); };
wipe();
after(async () => { (await import("../lib/accounts/store")).closeAccountsDb(); wipe(); cleanup(); });

const ORIGIN = "http://localhost:3000";
let slug = "", boutId = "", userCookie = "";
before(async () => {
  const { getDb } = await import("../lib/db"), users = await import("../lib/accounts/users"), store = await import("../lib/accounts/store");
  const main = await getDb(), acc = store.accountsDb();
  slug = (main.prepare("SELECT slug FROM boxers ORDER BY id LIMIT 1").get() as { slug: string }).slug;
  boutId = String((main.prepare("SELECT id FROM bouts ORDER BY id LIMIT 1").get() as { id: number }).id);
  const r = await users.createUser("fuzz_user", "a-long-passphrase-for-tests-1", acc); if ("error" in r) throw new Error(r.error);
  acc.prepare("UPDATE users SET created_at = ? WHERE id = ?").run(new Date(Date.now() - 3 * 86400_000).toISOString(), r.user.id);
  userCookie = `rs_session=${encodeURIComponent(users.createSession(r.user.id, acc).token)}`;
});

let seed = 20261006;
const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };
const NASTY = [
  "", " ", "   ", "../../etc/passwd", "..%2f..%2fetc%2fpasswd", "%2e%2e%2f", "\u0000", "%00", "a".repeat(5000), "'; DROP TABLE boxers;--", "\" OR 1=1 --", "<script>alert(1)</script>", "{{7*7}}", "${7*7}",
  "\r\nSet-Cookie: pwned=1", "%0d%0aSet-Cookie:%20pwned=1", "😀😀😀", "‮‮gnp.exe", "NaN", "Infinity", "-1", "0", "1.5", "1e308", "9999999999999999999999", "0x10", "__proto__", "constructor", "toString", "[object Object]",
  "null", "undefined", "true", ",,,", "a,b,c,d,e", Array.from({ length: 400 }, (_, i) => `x${i}`).join(","), "*", "%", "%%%", "\\", "/", "?", "#", "&=&=", "ar", "en", "fr", "AR", "../", "..\\",
];
const pick = () => NASTY[Math.floor(rnd() * NASTY.length)];
const ADDR = () => `203.0.113.${Math.floor(rnd() * 250)}`;
const CLEAN = (r: { status: number; text: string; cookie: string | null }, what: string) => {
  assert.ok(r.status < 500, `${what}: a server error (${r.status}): ${r.text.slice(0, 160)}`);
  assert.ok(!/\bat\s+(?:async\s+)?[\w.<>$]+\s+\(|node_modules|\/Users\/|\/private\/|scratchpad|\.ts:\d+|\bError:|SQLITE_|TypeError|ReferenceError/.test(r.text), `${what}: the answer shows the server's insides: ${r.text.slice(0, 160)}`);
  assert.equal(r.cookie, null, `${what}: sets a cookie`);
};
type Handler = (req: Request, ctx: never) => Promise<Response> | Response;
const call = async (h: Handler, url: string, ctx?: unknown, init: RequestInit = {}) => {
  const res = await h(new Request(`${ORIGIN}${url}`, { ...init, headers: { "x-forwarded-for": ADDR(), host: "localhost:3000", ...(init.headers ?? {}) } }), ctx as never);
  return { status: res.status, text: await res.text(), cookie: res.headers.get("set-cookie"), headers: res.headers };
};
const enc = encodeURIComponent;

test("the public API, the fighter card, the watch endpoints and the calendar answer every hostile parameter without a server error or a leak (round 127, overnight)", async () => {
  const [{ GET: card }, { GET: fighters }, { GET: fighter }, { GET: rankings }, { GET: events }, { GET: event }, { GET: divisions }, { GET: watch }, { GET: digest }, { GET: ics }] = await Promise.all([
    import("../app/api/fighter-card/[slug]/route"), import("../app/api/v1/fighters/route"), import("../app/api/v1/fighters/[slug]/route"), import("../app/api/v1/rankings/[division]/route"),
    import("../app/api/v1/events/route"), import("../app/api/v1/events/[id]/route"), import("../app/api/v1/divisions/route"), import("../app/api/watch/route"), import("../app/api/watch/digest/route"), import("../app/feeds/calendar.ics/route"),
  ]);
  let calls = 0;
  const run = async (h: Handler, url: string, ctx?: unknown) => { calls++; CLEAN(await call(h, url, ctx), `${url.slice(0, 90)}`); };
  for (let i = 0; i < 40; i++) {
    const a = pick(), b = pick(), c = pick();
    await run(card, `/api/fighter-card/${enc(a)}?lang=${enc(b)}`, { params: Promise.resolve({ slug: a }) });
    await run(fighters, `/api/v1/fighters?q=${enc(a)}&limit=${enc(b)}&offset=${enc(c)}&division=${enc(c)}&country=${enc(a)}&sex=${enc(b)}&active=${enc(c)}&lang=${enc(a)}`);
    await run(fighter, `/api/v1/fighters/${enc(a)}?lang=${enc(b)}`, { params: Promise.resolve({ slug: a }) });
    await run(rankings, `/api/v1/rankings/${enc(a)}?sex=${enc(b)}&limit=${enc(c)}&lang=${enc(c)}`, { params: Promise.resolve({ division: a }) });
    await run(events, `/api/v1/events?when=${enc(a)}&limit=${enc(b)}&offset=${enc(c)}&lang=${enc(b)}`);
    await run(event, `/api/v1/events/${enc(a)}?lang=${enc(b)}`, { params: Promise.resolve({ id: a }) });
    await run(divisions, `/api/v1/divisions?lang=${enc(a)}`);
    await run(watch, `/api/watch?slugs=${enc(a)}&lang=${enc(b)}`);
    await run(digest, `/api/watch/digest?slugs=${enc(a)},${enc(b)}&since=${enc(c)}&lang=${enc(b)}`);
    await run(ics, `/feeds/calendar.ics?lang=${enc(a)}&event=${enc(b)}&bout=${enc(c)}&days=${enc(a)}&slugs=${enc(b)}`);
  }
  assert.ok(calls >= 400, `calls made: ${calls}`);
});

test("the calendar file cannot be made to carry extra lines: whatever is in a name, a place, an address or an id stays inside its own property (found overnight: semicolons were never escaped)", async () => {
  const { icsText } = await import("../lib/ics");
  const evil = ["\r\nBEGIN:VEVENT\r\nSUMMARY:pwned", "x\nORGANIZER:mailto:evil@example.org", "a;b,c\\d", "\rATTACH:http://evil.example", "%0d%0aATTACH:http://evil.example", "\u2028ATTACH:x", "\u0085ATTACH:y"];
  for (const e of evil) {
    const out = icsText({ name: e, description: e, lang: "en", stamp: "2026-10-06T12:00:00Z", events: [{ uid: `u-${e}`, date: "2026-10-10", summary: e, description: e, location: e, url: `https://example.org/${e}`, status: "CONFIRMED" }] });
    const lines = out.split("\r\n").filter(Boolean);
    const unfolded: string[] = []; for (const l of lines) { if (l.startsWith(" ") && unfolded.length) unfolded[unfolded.length - 1] += l.slice(1); else unfolded.push(l); }
    for (const l of unfolded) assert.match(l, /^(BEGIN|END|VERSION|PRODID|CALSCALE|METHOD|X-WR-CALNAME|X-WR-CALDESC|REFRESH-INTERVAL|X-PUBLISHED-TTL|UID|DTSTAMP|DTSTART|DTEND|SUMMARY|DESCRIPTION|LOCATION|URL|STATUS|TRANSP)[:;]/, `a line that is none of the properties we write: ${JSON.stringify(l.slice(0, 60))}`);
    assert.equal(unfolded.filter((l) => l === "BEGIN:VEVENT").length, 1, "one event in, one event out");
    assert.equal(unfolded.filter((l) => /^(ATTACH|ORGANIZER)/.test(l)).length, 0);
    assert.ok(!/[\r\n](?![ ]|\n)/.test(out.replace(/\r\n/g, "")), "no bare line break inside a line");
  }
});

test("the forum's endpoints take malformed bodies, wrong types and hostile ids without a server error, and a body that is too large is refused", async () => {
  const [{ POST: post }, { POST: start }, { PATCH, DELETE }, { POST: report }, { POST: moderate }, { GET: thread }, { GET: list }] = await Promise.all([
    import("../app/api/forum/post/route"), import("../app/api/forum/threads/route"), import("../app/api/forum/posts/[id]/route"), import("../app/api/forum/posts/[id]/report/route"),
    import("../app/api/forum/posts/[id]/moderate/route"), import("../app/api/forum/thread/route"), import("../app/api/forum/threads/route"),
  ]);
  const json = (b: unknown) => ({ method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: userCookie }, body: typeof b === "string" ? b : JSON.stringify(b) });
  const bodies: unknown[] = [{}, [], "[1,2]", "not json", "null", "\"str\"", 42, { body: 42 }, { body: ["a"] }, { body: { toString: 1 } }, { __proto__: { admin: true }, body: "A fine post for the fuzz test." }, JSON.parse('{"__proto__": {"role": "admin"}, "constructor": {"prototype": {"x": 1}}, "body": "A fine post for the fuzz test too."}'),
    { kind: "boxer", subject: ["x"], body: "A fine post here." }, { kind: "boxer", subject: slug, body: "x".repeat(20_000) }, { threadId: "1; DROP TABLE forum_posts", body: "A fine post here." }, { threadId: 1.5, body: "A fine post here." }, { threadId: -1, body: "Another fine post here." },
    { title: ["t"], body: "A fine post here." }, { title: "A real title here", body: { a: 1 } }, { reason: { $ne: 1 } }, { action: ["hide"] }, { action: "hide", reason: "r".repeat(10_000) }];
  let calls = 0;
  for (const b of bodies) for (const [h, u, c] of [[post, "/api/forum/post", undefined], [start, "/api/forum/threads", undefined], [PATCH, "/api/forum/posts/1", { params: Promise.resolve({ id: "1" }) }], [report, "/api/forum/posts/1/report", { params: Promise.resolve({ id: "1" }) }], [moderate, "/api/forum/posts/1/moderate", { params: Promise.resolve({ id: "1" }) }]] as const) {
    calls++; CLEAN(await call(h as never, u, c, { ...json(b), method: h === PATCH ? "PATCH" : "POST" }), `${u} with ${JSON.stringify(b)?.slice(0, 50)}`);
  }
  for (let i = 0; i < 60; i++) {
    const a = pick(), b = pick();
    for (const [h, u, c] of [[PATCH, `/api/forum/posts/${enc(a)}`, { params: Promise.resolve({ id: a }) }], [DELETE, `/api/forum/posts/${enc(a)}`, { params: Promise.resolve({ id: a }) }], [report, `/api/forum/posts/${enc(a)}/report`, { params: Promise.resolve({ id: a }) }], [moderate, `/api/forum/posts/${enc(a)}/moderate`, { params: Promise.resolve({ id: a }) }]] as const) {
      calls++; CLEAN(await call(h as never, u, c, { ...json({ body: b, reason: b, action: b }), method: h === PATCH ? "PATCH" : h === DELETE ? "DELETE" : "POST" }), `${u}`);
    }
    calls++; CLEAN(await call(thread as never, `/api/forum/thread?kind=${enc(a)}&subject=${enc(b)}&id=${enc(b)}&after=${enc(a)}`, undefined, { headers: { cookie: userCookie } }), "thread read");
    calls++; CLEAN(await call(list as never, `/api/forum/threads?page=${enc(a)}`), "board read");
  }
  assert.ok(calls >= 300, `calls made: ${calls}`);
  const big = await call(post as never, "/api/forum/post", undefined, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN, cookie: userCookie }, body: JSON.stringify({ kind: "boxer", subject: slug, body: "z".repeat(40_000) }) });
  assert.equal(big.status, 413, "a body over 16 KB is refused before it is read into a post");
});

test("nothing is written without a sign-in or from another site, whatever the body", async () => {
  const { POST: post } = await import("../app/api/forum/post/route"), { POST: start } = await import("../app/api/forum/threads/route");
  const { accountsDb } = await import("../lib/accounts/store");
  const before = (accountsDb().prepare("SELECT (SELECT COUNT(*) FROM forum_posts) + (SELECT COUNT(*) FROM forum_threads) n").get() as { n: number }).n;
  for (const [h, u] of [[post, "/api/forum/post"], [start, "/api/forum/threads"]] as const) for (let i = 0; i < 30; i++) {
    const body = JSON.stringify({ kind: "boxer", subject: slug, threadId: 1, title: "A title that is fine", body: `A perfectly fine sentence number ${i} about the fight.` });
    const signedOut = await call(h as never, u, undefined, { method: "POST", headers: { "content-type": "application/json", origin: ORIGIN }, body });
    const crossSite = await call(h as never, u, undefined, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", cookie: userCookie }, body });
    const noOriginSecFetch = await call(h as never, u, undefined, { method: "POST", headers: { "content-type": "application/json", "sec-fetch-site": "cross-site", cookie: userCookie }, body });
    assert.deepEqual([signedOut.status, crossSite.status, noOriginSecFetch.status], [401, 403, 403], `${u}: signed out, cross-site, and a browser saying cross-site`);
  }
  assert.equal((accountsDb().prepare("SELECT (SELECT COUNT(*) FROM forum_posts) + (SELECT COUNT(*) FROM forum_threads) n").get() as { n: number }).n, before, "not one row was written");
  void boutId;
});
