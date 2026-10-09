import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { parseFeed, imageOf, cleanImageUrl } from "../lib/news/parse";
import { saveEntries, prune } from "../lib/news/store";
import { refreshImages, imageSources, readNewsImage, hasNewsImage, sniff } from "../lib/news/images";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ringside-newsimg-"));
const mk = () => { const d = new DatabaseSync(":memory:"); d.exec("CREATE TABLE news_items (id INTEGER PRIMARY KEY, source TEXT NOT NULL, guid TEXT NOT NULL, title TEXT NOT NULL, url TEXT NOT NULL, published TEXT, snippet TEXT, fetched_at TEXT NOT NULL, archive_url TEXT, archive_checked_at TEXT, UNIQUE (source, guid)); CREATE TABLE news_images (source TEXT NOT NULL, guid TEXT NOT NULL, image_url TEXT NOT NULL, PRIMARY KEY (source, guid))"); return d; };
import sharp from "sharp";
let JPEG: Buffer; // a real, decodable picture, made once
test.before(async () => { JPEG = await sharp({ create: { width: 1200, height: 800, channels: 3, background: { r: 200, g: 30, b: 30 } } }).jpeg().toBuffer(); });
const ok = (type = "image/jpeg", body: Buffer = JPEG) => new Response(new Uint8Array(body), { status: 200, headers: { "content-type": type } });
const common = { delayMs: 0, sleep: async () => {}, hostCheck: async () => null as string | null };

test("a feed item's own picture is found: media:content, media:thumbnail, an image enclosure, else the first <img>, even escaped; never a gif, a logo or a non-https address", () => {
  assert.equal(imageOf(`<media:content url="https://cdn.example/a.jpg" medium="image" width="800"/>`), "https://cdn.example/a.jpg");
  assert.equal(imageOf(`<media:thumbnail url="https://cdn.example/t.png"/>`), "https://cdn.example/t.png");
  assert.equal(imageOf(`<enclosure url="https://cdn.example/e.webp" type="image/webp" length="1"/>`), "https://cdn.example/e.webp");
  assert.equal(imageOf(`<content:encoded><![CDATA[<p>x</p><img src="https://cdn.example/c.jpg" style="a"/>]]></content:encoded>`), "https://cdn.example/c.jpg");
  assert.equal(imageOf(`<description>&lt;img src=&quot;http://cdn.example/d.jpg&quot; /&gt;</description>`), "https://cdn.example/d.jpg", "escaped markup is read, and http is asked for as https");
  for (const bad of ["https://cdn.example/spinner.gif", "https://cdn.example/site-logo.png", "data:image/png;base64,AAAA", "https://u:p@cdn.example/a.jpg", "javascript:alert(1)", "ftp://x/a.jpg", "https://cdn.example/" + "a".repeat(600) + ".jpg"]) assert.equal(cleanImageUrl(bad), null, bad.slice(0, 40));
  const e = parseFeed(`<rss><channel><item><title>T</title><link>https://example.org/1</link><media:content url="https://cdn.example/a.jpg" medium="image"/></item><item><title>U</title><link>https://example.org/2</link></item></channel></rss>`);
  assert.equal(e[0].image, "https://cdn.example/a.jpg"); assert.equal("image" in e[1], false, "an item with no picture has no image key");
});

test("saving keeps the address beside the headline, once, and a pruned headline takes its address with it", () => {
  const db = mk(), now = new Date().toISOString();
  saveEntries(db, "boxing-news-24", [{ guid: "g1", title: "T", url: "https://example.org/1", published: now, snippet: "", image: "https://cdn.example/a.jpg" }], now);
  saveEntries(db, "boxing-news-24", [{ guid: "g1", title: "T", url: "https://example.org/1", published: now, snippet: "", image: "https://cdn.example/b.jpg" }], now);
  assert.deepEqual(db.prepare("SELECT image_url u FROM news_images").all().map((r) => (r as { u: string }).u), ["https://cdn.example/b.jpg"]);
  prune(db, Date.now() + 200 * 86400_000);
  assert.equal((db.prepare("SELECT COUNT(*) c FROM news_images").get() as { c: number }).c, 0);
});

test("a picture is fetched from the host the feed named, after robots.txt, as a real image only, and read back with its type", async () => {
  const db = mk(), dir = tmp(), now = new Date().toISOString(), seen: string[] = [];
  const add = (g: string, img: string, src = "boxing-news-24") => saveEntries(db, src, [{ guid: g, title: g, url: `https://example.org/${g}`, published: now, snippet: "", image: img }], now);
  add("ok", "https://cdn.example/ok.jpg"); add("html", "https://cdn.example/html.jpg"); add("big", "https://cdn.example/big.jpg"); add("blocked", "https://cdn.example/private/x.jpg"); add("lie", "https://cdn.example/lie.jpg");
  const f = (async (url: string) => {
    seen.push(url);
    if (url.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /private/\n");
    if (url.endsWith("html.jpg")) return ok("text/html", Buffer.from("<html>hi</html>"));
    if (url.endsWith("big.jpg")) return ok("image/jpeg", Buffer.concat([JPEG, Buffer.alloc(700_000)]));
    if (url.endsWith("lie.jpg")) return ok("image/jpeg", Buffer.from("this is not a picture at all, just words".repeat(100)));
    return ok();
  }) as unknown as typeof fetch;
  const r = await refreshImages(db, { dir, fetchImpl: f, ...common });
  assert.deepEqual({ saved: r.saved, failed: r.failed }, { saved: 1, failed: 4 });
  assert.equal(seen[0], "https://cdn.example/robots.txt");
  assert.ok(!seen.some((u) => u.includes("/private/x.jpg")), "what robots.txt forbids is never asked for");
  const id = (db.prepare("SELECT id FROM news_items WHERE guid = 'ok'").get() as { id: number }).id;
  const saved = readNewsImage(id, dir);
  assert.equal(saved?.type, "image/webp", "saved as a small WebP"); assert.equal(hasNewsImage(id, dir), true);
  const meta = await sharp(saved!.bytes).metadata(); assert.equal(meta.width, 480, "no wider than a card needs");
  await refreshImages(db, { dir, fetchImpl: f, ...common });
  assert.equal(seen.filter((u) => u.endsWith("/ok.jpg")).length, 1, "a saved picture is never fetched again");
});

test("a private host, a redirect and a non-https address are refused; a switched-off outlet's pictures are deleted; broadcasters are never asked", async () => {
  const db = mk(), dir = tmp(), now = new Date().toISOString(), seen: string[] = [];
  const add = (src: string, g: string, img: string) => saveEntries(db, src, [{ guid: g, title: g, url: `https://example.org/${g}`, published: now, snippet: "", image: img }], now);
  add("boxing-news-24", "a", "https://cdn.example/a.jpg"); add("world-boxing-news", "b", "https://cdn2.example/b.jpg"); add("bbc-sport", "c", "https://cdn.example/c.jpg"); add("boxing-news-24", "d", "https://internal.example/d.jpg"); add("boxing-news-24", "e", "http://cdn.example/e.jpg");
  const f = (async (url: string, init?: RequestInit) => { seen.push(url); if (url.endsWith("/robots.txt")) return new Response("", { status: 404 }); if (url.endsWith("a.jpg") && init?.redirect === "error") return ok(); return ok(); }) as unknown as typeof fetch;
  const hostCheck = async (h: string) => (h === "internal.example" ? "private address" : null);
  const r = await refreshImages(db, { dir, fetchImpl: f, delayMs: 0, sleep: async () => {}, hostCheck });
  assert.equal(r.saved, 2, "a and b are saved"); assert.ok(!seen.some((u) => u.includes("c.jpg") || u.includes("d.jpg")), "no broadcaster, no private host");
  assert.equal(sniff(JPEG), "image/jpeg"); assert.equal(sniff(Buffer.from("not a picture at all")), null);
  // switch World Boxing News off: its saved picture goes
  const only = imageSources("boxing-news-24"); assert.deepEqual([...only], ["boxing-news-24"]);
  const r2 = await refreshImages(db, { dir, fetchImpl: f, allowed: only, ...common });
  assert.equal(r2.removed, 1);
  assert.equal(imageSources("none").size, 0); assert.ok(!imageSources(undefined).has("bbc-sport"), "unset means the open outlets, never the broadcasters");
});

test("only a plain number names a saved picture, and the route's folder read never leaves its folder", () => {
  const dir = tmp();
  assert.equal(readNewsImage(0, dir), null); assert.equal(readNewsImage(-1, dir), null); assert.equal(readNewsImage(1.5, dir), null);
  assert.equal(readNewsImage(Number("../../etc/passwd"), dir), null);
});
