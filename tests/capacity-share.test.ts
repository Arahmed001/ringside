import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { gunzipSync } from "node:zlib";
import { tempDb } from "./helpers";

/**
 * docs/capacity.md: a share image cost 220 to 380 ms of the one thread and was never kept; a sitemap file is 8.6 MB of XML that was written out again on every
 * request. Both are now kept, in caches bounded by bytes, and what is sent must be the same bytes the old code sent.
 */
process.env.INDEXABLE = "1";
process.env.SITE_URL = "https://ringside.example"; // a public address, so the sitemaps are served
process.env.BOXING_PROVIDER = "demo";
const cleanup = tempDb("capacity-share");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
before(async () => { w = await (await import("../lib/world")).getWorld(); });

test("ByteLru is bounded by bytes, forgets the least recently used, and keeps nothing bigger than itself", async () => {
  const { ByteLru } = await import("../lib/byte-lru");
  const c = new ByteLru<string, Buffer>(100);
  c.set("a", Buffer.alloc(40)); c.set("b", Buffer.alloc(40));
  assert.equal(c.bytes, 80);
  c.get("a"); // a is now the most recent
  c.set("c", Buffer.alloc(40)); // 120 > 100: b (the least recently used) goes
  assert.equal(c.get("b"), undefined);
  assert.ok(c.get("a") && c.get("c"));
  assert.equal(c.bytes, 80);
  c.set("huge", Buffer.alloc(101));
  assert.equal(c.get("huge"), undefined, "an entry bigger than the whole budget is not kept");
  assert.equal(c.bytes, 80);
  c.set("a", Buffer.alloc(10)); // replacing counts the new size only
  assert.equal(c.bytes, 50);
  for (let i = 0; i < 1000; i++) c.set(`k${i}`, Buffer.alloc(30));
  assert.ok(c.bytes <= 100 && c.size <= 3, `bounded after 1,000 inserts (${c.bytes} bytes, ${c.size} entries)`);
  c.clear();
  assert.equal(c.bytes, 0);
});

test("a share image is the same bytes drawn or kept, English and Arabic, and the second one is not drawn again", async () => {
  const { ogCard, renderCard } = await import("../lib/og");
  const { tEn } = await import("../lib/i18n/t");
  const cards = [
    { locale: "en" as const, accent: "red" as const, kicker: "LIGHTWEIGHT · MEXICO", title: "José Ramírez", subtitle: "“Camaron”", stats: [{ label: "record", value: "20-1" }, { label: "Elo rating", value: "1700" }] },
    { locale: "ar" as const, t: tEn, title: "محمد علي", kicker: "الوزن الثقيل", stats: [{ label: "السجل", value: "56-5" }] },
  ];
  for (const card of cards) {
    const drawn = Buffer.from(await renderCard(card).arrayBuffer());
    const t0 = performance.now();
    const first = await ogCard(card);
    const firstMs = performance.now() - t0;
    const t1 = performance.now();
    const second = await ogCard(card);
    const secondMs = performance.now() - t1;
    const a = Buffer.from(await first.arrayBuffer()), b = Buffer.from(await second.arrayBuffer());
    assert.ok(a.equals(drawn), "the first answer is what the drawing code makes");
    assert.ok(b.equals(drawn), "the kept one is the same bytes");
    assert.ok(drawn.length > 1000 && drawn.subarray(1, 4).toString() === "PNG");
    assert.ok(secondMs < firstMs / 2 + 3, `kept: ${secondMs.toFixed(1)} ms, drawn: ${firstMs.toFixed(1)} ms`);
    for (const r of [first, second]) {
      assert.equal(r.headers.get("content-type"), "image/png");
      assert.match(r.headers.get("cache-control") ?? "", /^public, max-age=\d+, stale-while-revalidate=\d+$/);
    }
  }
});

test("a card with different words is a different card, never the kept one", async () => {
  const { ogCard } = await import("../lib/og");
  const base = { locale: "en" as const, title: "Fighter One", stats: [{ label: "record", value: "10-0" }] };
  const a = Buffer.from(await (await ogCard(base)).arrayBuffer());
  const b = Buffer.from(await (await ogCard({ ...base, stats: [{ label: "record", value: "11-0" }] })).arrayBuffer());
  const c = Buffer.from(await (await ogCard({ ...base, locale: "ar" })).arrayBuffer());
  assert.ok(!a.equals(b) && !a.equals(c) && !b.equals(c));
  assert.ok(a.equals(Buffer.from(await (await ogCard(base)).arrayBuffer())), "and the first is still itself");
});

test("two requests for one card at the same moment draw it once", async () => {
  const { ogCard } = await import("../lib/og");
  const card = { locale: "en" as const, title: "Simultaneous Fighter", stats: [] };
  const [x, y] = await Promise.all([ogCard(card), ogCard(card)]);
  assert.ok(Buffer.from(await x.arrayBuffer()).equals(Buffer.from(await y.arrayBuffer())));
});

test("the sitemap files kept compressed unpack to exactly the XML the old code wrote, and there is no file past the last", async () => {
  const S = await import("../lib/sitemap");
  const n = S.sitemapCount(w);
  for (let i = 0; i < n; i++) {
    const gz = await S.sitemapGzip(w, i);
    assert.ok(gz);
    assert.equal(gunzipSync(gz).toString("utf8"), S.sitemapXml(w, i), `file ${i}`);
    assert.equal(await S.sitemapGzip(w, i), gz, "the second ask is the kept file");
  }
  assert.equal(await S.sitemapGzip(w, n), null);
  assert.equal(await S.sitemapGzip(w, n + 40), null);
  assert.equal(S.PATHS_PER_FILE, 10000, "PLAN 208: ten thousand paths a file, twice as many URLs (two languages), under 50,000");
});

test("the sitemap route sends gzip to a client that accepts it and plain XML to one that does not, with the same cache headers", async () => {
  const { GET } = await import("../app/sitemaps/[id]/route");
  const ask = (id: string, enc?: string) => GET(new Request(`http://localhost/sitemaps/${id}`, { headers: enc ? { "accept-encoding": enc } : {} }), { params: Promise.resolve({ id }) });
  const S = await import("../lib/sitemap");
  const xml = S.sitemapXml(w, 0)!;
  const gz = await ask("0.xml", "gzip, deflate, br");
  assert.equal(gz.status, 200);
  assert.equal(gz.headers.get("content-encoding"), "gzip");
  assert.equal(gz.headers.get("vary"), "Accept-Encoding");
  assert.equal(gz.headers.get("cache-control"), "public, max-age=3600");
  assert.match(gz.headers.get("content-type") ?? "", /^application\/xml/);
  assert.equal(gunzipSync(Buffer.from(await gz.arrayBuffer())).toString("utf8"), xml);
  const plain = await ask("0.xml");
  assert.equal(plain.headers.get("content-encoding"), null);
  assert.equal(plain.headers.get("vary"), "Accept-Encoding");
  assert.equal(plain.headers.get("cache-control"), "public, max-age=3600");
  assert.equal(await plain.text(), xml);
  for (const bad of ["9999.xml", "x.xml", "-1.xml"]) assert.equal((await ask(bad, "gzip")).status, 404, bad);
});

test("a rebuilt world gets its own sitemap files (the kept ones are per world)", async () => {
  const W = await import("../lib/world");
  const S = await import("../lib/sitemap");
  const before = await S.sitemapGzip(w, 0);
  W.invalidateWorld();
  const w2 = await W.getWorld();
  assert.notEqual(w2, w);
  const after = await S.sitemapGzip(w2, 0);
  assert.notEqual(after, before, "a different world is a different key");
  assert.ok(after!.equals(before!), "(and the same data gives the same file)");
});
