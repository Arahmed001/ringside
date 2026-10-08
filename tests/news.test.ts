import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { parseFeed, cleanUrl, plain, MAX_TITLE, MAX_SNIPPET } from "../lib/news/parse";
import { refreshNews } from "../lib/news/fetch";
import { latest, prune, saveEntries } from "../lib/news/store";
import { fightersIn, newsByFighter } from "../lib/news/match";
import { ALL_SOURCES, NEWS_SOURCES, VIDEO_SOURCES, sourcesFor, videoIdOf, isVideoSource } from "../lib/news/sources";
import type { World } from "../lib/world";

const RSS = `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>
<item><title><![CDATA[Usyk &amp; Fury: the <b>rematch</b> &#8216;set&#8217;]]></title><link>https://example.org/a?utm_source=x&amp;id=7#frag</link><guid>g1</guid><pubDate>Wed, 08 Oct 2026 10:00:00 GMT</pubDate>
<description><![CDATA[<p>A short excerpt <script>alert(1)</script>with &lt;i&gt;markup&lt;/i&gt;.</p><p>The post <a href="https://example.org/a">Usyk and Fury</a> appeared first on Example.</p>]]></description></item>
<item><title>Bad link</title><link>javascript:alert(1)</link><guid>g2</guid></item>
<item><title>Credentials</title><link>https://user:pw@example.org/x</link><guid>g3</guid></item>
<item><title></title><link>https://example.org/empty</link></item>
<item><title>Far future</title><link>https://example.org/future</link><pubDate>Mon, 01 Jan 2040 00:00:00 GMT</pubDate></item>
</channel></rss>`;
const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom headline</title><link rel="self" href="https://example.org/self"/><link rel="alternate" href="https://example.org/atom?fbclid=zzz"/><id>tag:1</id><updated>2026-10-07T09:00:00Z</updated><summary>Atom summary</summary></entry></feed>`;

test("a feed becomes plain text and clean links: markup, scripts, entities, tracking parameters, credentials, bad schemes and far-future dates are all dealt with", () => {
  const e = parseFeed(RSS);
  assert.deepEqual(e.map((x) => x.title), ["Usyk & Fury: the rematch ‘set’", "Far future"], "five items: a bad scheme, credentials and an empty title are skipped");
  const first = e[0];
  assert.equal(first.title, "Usyk & Fury: the rematch ‘set’");
  assert.equal(first.url, "https://example.org/a?id=7", "tracking parameter and fragment removed, ordinary parameter kept");
  assert.equal(first.snippet, "A short excerpt with <i>markup</i>.".replace("<i>markup</i>", "markup"), "script gone, escaped markup gone, the 'appeared first on' line gone");
  assert.equal(first.published, "2026-10-08T10:00:00.000Z");
  assert.ok(!e.some((x) => x.title === "Bad link" || x.title === "Credentials"), "javascript: and credentialed links are skipped");
  assert.equal(e.find((x) => x.title === "Far future")!.published, null, "a date in the far future is not trusted");
  const a = parseFeed(ATOM)[0];
  assert.deepEqual([a.title, a.url, a.snippet, a.published], ["Atom headline", "https://example.org/atom", "Atom summary", "2026-10-07T09:00:00.000Z"], "Atom: the alternate link, not the self link");
});

test("lengths are bounded, and nothing but http(s) is a link", () => {
  assert.ok(plain("word ".repeat(200), MAX_TITLE).length <= MAX_TITLE); assert.ok(plain("x".repeat(1000), MAX_SNIPPET).length <= MAX_SNIPPET);
  for (const bad of ["javascript:alert(1)", "data:text/html,x", "ftp://example.org/x", "//example.org/x", "", "https://" + "a".repeat(700) + ".org/"]) assert.equal(cleanUrl(bad), null, bad);
  assert.equal(cleanUrl("http://example.org/p?ref=1&a=2"), "http://example.org/p?a=2");
  assert.equal(parseFeed("not xml at all").length, 0);
  assert.equal(parseFeed(`<rss><channel>${"<item><title>t</title><link>https://example.org/1</link></item>".repeat(500)}</channel></rss>`).length, 60, "at most 60 items per feed");
});

const mkDb = () => { const d = new DatabaseSync(":memory:"); d.exec("CREATE TABLE news_items (id INTEGER PRIMARY KEY, source TEXT NOT NULL, guid TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, published TEXT, snippet TEXT, fetched_at TEXT NOT NULL, archive_url TEXT, archive_checked_at TEXT, UNIQUE (source, guid)); CREATE TABLE news_feeds (source TEXT PRIMARY KEY, etag TEXT, last_modified TEXT, checked_at TEXT, status TEXT, items INTEGER);"); return d; };
const src = (id = "t1") => ({ id, name: "Test Outlet", feed: "https://example.org/feed", home: "https://example.org/", use: "open" as const, note: "" });
const xmlRes = (body: string, init: ResponseInit = {}) => new Response(body, { status: 200, headers: { "content-type": "application/rss+xml", etag: '"v1"', ...(init.headers as object) }, ...init });
const opts = (fetchImpl: typeof fetch, extra: object = {}) => ({ contact: "me@example.org", fetchImpl, sources: [src()], delayMs: 0, sleep: async () => {}, hostCheck: async () => null, ...extra });

test("the fetcher identifies itself, reads robots.txt first, and keeps new headlines once", async () => {
  const db = mkDb(); const seen: { url: string; ua: string }[] = [];
  const f = (async (url: string, init?: RequestInit) => { seen.push({ url, ua: String((init?.headers as Record<string, string>)["user-agent"]) }); return url.endsWith("/robots.txt") ? new Response("User-agent: *\nDisallow: /private/\n") : xmlRes(RSS); }) as unknown as typeof fetch;
  const r = await refreshNews(db, opts(f));
  assert.equal(r[0].ok, true); assert.equal(r[0].added, 2);
  assert.equal(seen[0].url, "https://example.org/robots.txt"); assert.ok(seen.every((s) => /RingsideNews\/1\.0 \(\+me@example\.org\)/.test(s.ua)));
  const again = await refreshNews(db, opts(f));
  assert.equal(again[0].added, 0, "the same headlines are not stored twice");
  assert.equal(latest(db).length, 2);
});

test("what the fetcher will not do: no contact, robots.txt forbids, a refusal, a redirect to another site, a private address, a page that is not a feed, an oversized feed", async () => {
  await assert.rejects(refreshNews(mkDb(), { ...opts(fetch), contact: "" }), /contact/);
  const robots = (body: string) => (async (url: string) => (url.endsWith("/robots.txt") ? new Response(body) : xmlRes(RSS))) as unknown as typeof fetch;
  assert.match((await refreshNews(mkDb(), opts(robots("User-agent: *\nDisallow: /feed"))))[0].status, /robots/);
  const plainFeed = (status: number, headers: Record<string, string> = {}, body = RSS) => (async (url: string) => (url.endsWith("/robots.txt") ? new Response("") : new Response(body, { status, headers }))) as unknown as typeof fetch;
  for (const code of [403, 429]) assert.match((await refreshNews(mkDb(), opts(plainFeed(code))))[0].status, new RegExp(String(code)));
  assert.match((await refreshNews(mkDb(), opts(plainFeed(301, { location: "https://elsewhere.example.net/feed" }))))[0].status, /another site/);
  assert.match((await refreshNews(mkDb(), opts(plainFeed(200, { "content-type": "text/html" }, "<html>")))) [0].status, /not a feed/);
  assert.match((await refreshNews(mkDb(), opts(robots(""), { hostCheck: async () => "the host resolves to a private address" })))[0].status, /private/);
  const db = mkDb(); await refreshNews(db, opts(plainFeed(200, { "content-type": "application/rss+xml" }, `<rss>${"x".repeat(2_000_000)}</rss>`)));
  assert.equal(latest(db).length, 0, "an oversized body is cut and yields nothing readable");
});

test("a second run asks only for what changed (ETag), and one outlet failing does not stop the next", async () => {
  const db = mkDb(); let sent: Record<string, string> = {};
  const f = (async (url: string, init?: RequestInit) => { if (url.endsWith("/robots.txt")) return new Response(""); sent = init?.headers as Record<string, string>; return sent["if-none-match"] ? new Response(null, { status: 304 }) : xmlRes(RSS); }) as unknown as typeof fetch;
  await refreshNews(db, opts(f)); const r2 = await refreshNews(db, opts(f));
  assert.equal(sent["if-none-match"], '"v1"'); assert.equal(r2[0].status, "unchanged");
  const g = (async (url: string) => { if (url.includes("bad.example")) throw new Error("down"); return url.endsWith("/robots.txt") ? new Response("") : xmlRes(ATOM); }) as unknown as typeof fetch;
  const both = await refreshNews(mkDb(), opts(g, { sources: [{ ...src("bad"), feed: "https://bad.example/feed" }, src("good")] }));
  assert.deepEqual(both.map((o) => o.ok), [false, true]);
});

test("old headlines are dropped, and the list is newest first", () => {
  const db = mkDb(); const t = Date.parse("2026-10-08T00:00:00Z");
  saveEntries(db, "t1", [{ guid: "old", title: "Old", url: "https://example.org/o", published: "2026-04-01T00:00:00Z", snippet: "" }, { guid: "new", title: "New", url: "https://example.org/n", published: "2026-10-07T00:00:00Z", snippet: "" }, { guid: "mid", title: "Mid", url: "https://example.org/m", published: "2026-09-01T00:00:00Z", snippet: "" }], new Date(t).toISOString());
  assert.equal(prune(db, t), 1); assert.deepEqual(latest(db).map((x) => x.title), ["New", "Mid"]);
  assert.deepEqual(latest(new DatabaseSync(":memory:")), [], "no table, no news");
});

test("a headline is credited to a fighter only by a whole name that is one fighter's in the league and a fighter who has fought three times", () => {
  const w = { boxers: [{ id: 1, name: "Oleksandr Usyk", bouts: 24 }, { id: 2, name: "Tyson Fury", bouts: 36 }, { id: 3, name: "Jose Hernandez", bouts: 9 }, { id: 4, name: "Jose Hernandez", bouts: 12 }, { id: 5, name: "Anthony Joshua", bouts: 1 }, { id: 6, name: "Mario", bouts: 20 }] } as unknown as World;
  assert.deepEqual(fightersIn(w, "Oleksandr Usyk and Tyson Fury agree terms"), [1, 2]);
  assert.deepEqual(fightersIn(w, "OLEKSANDR USYK’S next move"), [1], "case and possessives");
  assert.deepEqual(fightersIn(w, "Usyk alone"), [], "a surname alone is nobody");
  assert.deepEqual(fightersIn(w, "Jose Hernandez wins"), [], "two fighters share the name");
  assert.deepEqual(fightersIn(w, "Anthony Joshua returns"), [], "one fight is a stranger who shares a famous name");
  assert.deepEqual(fightersIn(w, "Mario Kart"), [], "one word is never a name");
  const m = newsByFighter(w, [{ id: 1, source: "t", title: "Tyson Fury news", url: "https://example.org/1", published: null, snippet: "", archiveUrl: null }, { id: 2, source: "t", title: "Fury and Oleksandr Usyk", url: "https://example.org/2", published: null, snippet: "with Tyson Fury", archiveUrl: null }]);
  assert.deepEqual(m.get(2)!.map((x) => x.id), [1, 2]); assert.deepEqual(m.get(1)!.map((x) => x.id), [2]);
});

test("the sources: every feed is https, noncommercial feeds are read only when the owner says the site earns nothing", () => {
  for (const s of NEWS_SOURCES) { assert.match(s.feed, /^https:\/\//, s.id); assert.ok(s.note.length > 10, `${s.id} says why it is allowed`); }
  assert.ok(sourcesFor(false).every((s) => s.use === "open")); assert.equal(sourcesFor(true).length, ALL_SOURCES.length);
  assert.ok(NEWS_SOURCES.some((s) => s.use === "noncommercial") && NEWS_SOURCES.some((s) => s.use === "open"));
});

import { findArchives, snapshotUrl } from "../lib/news/archive";
test("a Wayback copy is kept only if the Archive reports one, on archive.org over https, and a headline without one is asked about again after a week", async () => {
  assert.equal(snapshotUrl({ archived_snapshots: { closest: { available: true, url: "http://web.archive.org/web/2026/https://example.org/a" } } }), "https://web.archive.org/web/2026/https://example.org/a");
  for (const bad of [{}, { archived_snapshots: {} }, { archived_snapshots: { closest: { available: false, url: "http://web.archive.org/x" } } }, { archived_snapshots: { closest: { available: true, url: "https://evil.example/x" } } }, { archived_snapshots: { closest: { available: true, url: "javascript:alert(1)" } } }, null]) assert.equal(snapshotUrl(bad), null);
  const db = mkDb(); saveEntries(db, "t1", [{ guid: "a", title: "A", url: "https://example.org/a", published: "2026-10-07T00:00:00Z", snippet: "" }, { guid: "b", title: "B", url: "https://example.org/b", published: "2026-10-06T00:00:00Z", snippet: "" }]);
  let t = Date.parse("2026-10-08T00:00:00Z"); const asked: string[] = [];
  const f = (async (u: string) => { asked.push(decodeURIComponent(u.split("url=")[1])); return Response.json(u.includes("%2Fa") ? { archived_snapshots: { closest: { available: true, url: "http://web.archive.org/web/1/https://example.org/a" } } } : { archived_snapshots: {} }); }) as unknown as typeof fetch;
  const o = { contact: "me@example.org", fetchImpl: f, sleep: async () => {}, now: () => t };
  assert.deepEqual(await findArchives(db, o), { checked: 2, found: 1 });
  assert.deepEqual(latest(db).map((x) => [x.title, x.archiveUrl]), [["A", "https://web.archive.org/web/1/https://example.org/a"], ["B", null]]);
  assert.deepEqual(await findArchives(db, o), { checked: 0, found: 0 }, "B was asked about a moment ago");
  t += 8 * 86400_000; assert.deepEqual(await findArchives(db, o), { checked: 1, found: 0 }, "a week later B is asked about again; A is not");
  const limited = (async () => new Response("", { status: 429 })) as unknown as typeof fetch;
  const d2 = mkDb(); saveEntries(d2, "t1", [{ guid: "z", title: "Z", url: "https://example.org/z", published: null, snippet: "" }]);
  assert.deepEqual(await findArchives(d2, { ...o, fetchImpl: limited }), { checked: 1, found: 0 }); assert.equal((d2.prepare("SELECT archive_checked_at c FROM news_items").get() as { c: string | null }).c, null, "a request to slow down is not recorded as an answer");
});

test("official videos: every channel is a YouTube channel id that says so, a video id is eleven safe characters of a youtube.com watch address, and nothing else is played", () => {
  assert.ok(VIDEO_SOURCES.length >= 8);
  for (const s of VIDEO_SOURCES) { assert.match(s.feed, /^uploads:UC[A-Za-z0-9_-]{22}$/, s.id); assert.equal(s.kind, "video"); assert.ok(isVideoSource(s.id)); assert.equal(s.use, "open"); }
  assert.ok(NEWS_SOURCES.every((s) => !isVideoSource(s.id)) && new Set(ALL_SOURCES.map((s) => s.id)).size === ALL_SOURCES.length, "ids are distinct and news is never a video");
  assert.equal(videoIdOf("https://www.youtube.com/watch?v=OZWT2969oBU"), "OZWT2969oBU");
  for (const bad of ["https://evil.example/watch?v=OZWT2969oBU", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/watch?v=OZWT2969oBU\"onload=1", "javascript:alert(1)", "https://www.youtube.com/watch", ""]) assert.equal(videoIdOf(bad), null, bad);
  const e = parseFeed(`<feed xmlns:yt="x" xmlns="http://www.w3.org/2005/Atom"><entry><id>yt:video:OZWT2969oBU</id><yt:videoId>OZWT2969oBU</yt:videoId><title>An inside look | On The Ground</title><link rel="alternate" href="https://www.youtube.com/watch?v=OZWT2969oBU"/><published>2026-10-08T20:11:00+00:00</published><media:group><media:title>x</media:title><media:description>A long description that is not kept</media:description></media:group></entry></feed>`)[0];
  assert.deepEqual([e.title, e.url, e.snippet, e.guid], ["An inside look | On The Ground", "https://www.youtube.com/watch?v=OZWT2969oBU", "", "yt:video:OZWT2969oBU"], "the channel's own description is not kept");
});

import fs from "node:fs";
import { contentSecurityPolicy } from "../lib/security";
test("the only frame a page may hold is YouTube's privacy-enhanced player, the player loads nothing until play, and the embeds for other sites hold no frame", () => {
  const csp = contentSecurityPolicy({ nonce: "abc" }), emb = contentSecurityPolicy({ nonce: "abc", embed: true });
  assert.match(csp, /frame-src https:\/\/www\.youtube-nocookie\.com(;|$)/); assert.match(emb, /frame-src 'none'/); assert.match(csp, /frame-ancestors 'none'/);
  const c = fs.readFileSync("components/VideoList.tsx", "utf8");
  assert.match(c, /youtube-nocookie\.com\/embed\//); assert.ok(!/youtube\.com\/embed|ytimg|i\.ytimg|<img|<script/.test(c), "no picture, script or ordinary youtube.com frame");
  assert.match(c, /open === v\.videoId \? \(/, "the frame exists only after the visitor opens that video"); assert.match(c, /sandbox=/);
});

import { entriesFrom, refreshVideos } from "../lib/news/youtube";
test("the YouTube list: only a real video's title, date and watch address are kept; without a key nothing is read; the key is never stored, logged or shown", async () => {
  const body = { items: [
    { snippet: { title: "Fundora camp | On The Ground", publishedAt: "2026-10-08T20:11:00Z", resourceId: { videoId: "OZWT2969oBU" }, description: "never kept", thumbnails: { default: { url: "https://i.ytimg.com/x.jpg" } } } },
    { snippet: { title: "Private video", publishedAt: "2026-10-08T20:11:00Z", resourceId: { videoId: "AAAAAAAAAAA" } } },
    { snippet: { title: "Bad id", publishedAt: "2026-10-08T20:11:00Z", resourceId: { videoId: "x\"onload=1" } } },
    { snippet: { title: "<b>Tagged</b> &amp; title", publishedAt: "2099-01-01T00:00:00Z", resourceId: { videoId: "BBBBBBBBBBB" } } }, null, { snippet: {} },
  ] };
  const e = entriesFrom(body);
  assert.deepEqual(e.map((x) => [x.title, x.url, x.published === null]), [["Fundora camp | On The Ground", "https://www.youtube.com/watch?v=OZWT2969oBU", false], ["Tagged & title", "https://www.youtube.com/watch?v=BBBBBBBBBBB", true]], "private videos, bad ids and empty items are dropped; a future date is not trusted");
  assert.ok(e.every((x) => x.snippet === ""), "no description kept");
  const db = mkDb(); const urls: string[] = [];
  const none = await refreshVideos(db, { key: undefined, contact: "me@example.org", sources: VIDEO_SOURCES.slice(0, 2), fetchImpl: (async (u: string) => { urls.push(u); return Response.json(body); }) as unknown as typeof fetch });
  assert.deepEqual(none.map((o) => o.status), ["no YOUTUBE_API_KEY", "no YOUTUBE_API_KEY"]); assert.equal(urls.length, 0, "no key, no request");
  const logs: string[] = [];
  const ok = await refreshVideos(db, { key: "SECRETKEY123", contact: "me@example.org", sources: VIDEO_SOURCES.slice(0, 2), delayMs: 0, sleep: async () => {}, log: (l) => logs.push(l), fetchImpl: (async (u: string) => { urls.push(u); return Response.json(body); }) as unknown as typeof fetch });
  assert.deepEqual(ok.map((o) => o.added), [2, 2]); assert.match(urls[0], /playlistId=UU[A-Za-z0-9_-]{22}&key=SECRETKEY123$/, "the uploads playlist of the channel; the key goes to Google only");
  assert.ok(!JSON.stringify(db.prepare("SELECT * FROM news_items").all()).includes("SECRETKEY123") && !logs.join().includes("SECRETKEY123"), "the key is neither stored nor logged");
  const boom = await refreshVideos(mkDb(), { key: "SECRETKEY123", contact: "me@example.org", sources: VIDEO_SOURCES.slice(0, 1), fetchImpl: (async (u: string) => { throw new Error(`failed ${u}`); }) as unknown as typeof fetch });
  assert.ok(!boom[0].status.includes("SECRETKEY123") && /\[key\]/.test(boom[0].status), "an error message does not carry the key");
  const quota = await refreshVideos(mkDb(), { key: "k", contact: "me@example.org", sources: VIDEO_SOURCES.slice(0, 3), delayMs: 0, sleep: async () => {}, fetchImpl: (async () => new Response("", { status: 403 })) as unknown as typeof fetch });
  assert.equal(quota.length, 1, "a refused key or used-up quota stops the rest");
});
