import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { hasThumb, readThumb, refreshThumbs, MAX_AGE_DAYS } from "../lib/news/thumbs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ringside-thumbs-"));
const A = "aaaaaaaaaaa", B = "bbbbbbbbbbb", C = "ccccccccccc";
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000, 1)]);
function world(ids: string[]) {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE news_items (id INTEGER PRIMARY KEY, source TEXT, url TEXT, published TEXT, fetched_at TEXT)");
  ids.forEach((id, i) => db.prepare("INSERT INTO news_items (source, url, published, fetched_at) VALUES ('yt-dazn', ?, ?, ?)").run(`https://www.youtube.com/watch?v=${id}`, `2026-10-0${i + 1}T00:00:00Z`, "2026-10-09T00:00:00Z"));
  db.prepare("INSERT INTO news_items (source, url, published, fetched_at) VALUES ('boxing-news', 'https://example.com/story', '2026-10-01T00:00:00Z', '2026-10-09T00:00:00Z')").run();
  return db;
}
const seen: string[] = [];
const ok = (async (url: string | URL) => { seen.push(String(url)); return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } }); }) as typeof fetch;
const NOW = Date.parse("2026-10-09T12:00:00Z"), nosleep = async () => {};

test("a video's picture is fetched from YouTube's image host, saved beside the database, and read back from there", async () => {
  const dir = tmp(); seen.length = 0;
  const r = await refreshThumbs(world([A, B]), { dir, fetchImpl: ok, now: NOW, sleep: nosleep });
  assert.deepEqual({ wanted: r.wanted, fetched: r.fetched, failed: r.failed }, { wanted: 2, fetched: 2, failed: 0 });
  assert.ok(seen.every((u) => u.startsWith("https://i.ytimg.com/vi/")), "only YouTube's image host is asked");
  assert.ok(seen.every((u) => /\/maxresdefault\.jpg$/.test(u)), "the large picture first");
  assert.equal(readThumb(A, dir, NOW)?.length, JPEG.length);
  assert.equal(hasThumb(B, dir, NOW), true); assert.equal(hasThumb(C, dir, NOW), false);
  seen.length = 0;
  await refreshThumbs(world([A, B]), { dir, fetchImpl: ok, now: NOW, sleep: nosleep });
  assert.deepEqual(seen, [], "a picture saved a day ago is not fetched again");
});

test("the smaller picture is the fallback, and an answer that is not a JPEG is refused", async () => {
  const dir = tmp(); seen.length = 0;
  const f = (async (url: string | URL) => {
    seen.push(String(url));
    if (String(url).endsWith("maxresdefault.jpg")) return new Response("not found", { status: 404 });
    if (String(url).includes(`/${B}/`)) return new Response("<html>hello</html>", { status: 200, headers: { "content-type": "image/jpeg" } });
    return new Response(JPEG, { status: 200, headers: { "content-type": "image/jpeg" } });
  }) as typeof fetch;
  const r = await refreshThumbs(world([A, B]), { dir, fetchImpl: f, now: NOW, sleep: nosleep });
  assert.deepEqual({ fetched: r.fetched, failed: r.failed }, { fetched: 1, failed: 1 });
  assert.equal(hasThumb(A, dir, NOW), true); assert.equal(hasThumb(B, dir, NOW), false, "bytes that are not a JPEG are never saved");
});

test("a picture is refetched at 25 days, never served after 30, and deleted when its video leaves the list", async () => {
  const dir = tmp();
  await refreshThumbs(world([A, B]), { dir, fetchImpl: ok, now: NOW, sleep: nosleep });
  const old = (days: number) => NOW + days * 86400_000;
  seen.length = 0;
  await refreshThumbs(world([A, B]), { dir, fetchImpl: ok, now: old(26), sleep: nosleep });
  assert.equal(seen.length, 2, "both are fetched again after 25 days");
  assert.equal(readThumb(A, dir, old(26 + MAX_AGE_DAYS + 1)), null, "not served past 30 days");
  const r = await refreshThumbs(world([A]), { dir, fetchImpl: ok, now: old(27), sleep: nosleep });
  assert.equal(r.removed, 1); assert.equal(hasThumb(B, dir, old(27)), false);
  // a failed refresh must not extend the life of a stale picture
  const down = (async () => new Response("", { status: 500 })) as typeof fetch;
  await refreshThumbs(world([A]), { dir, fetchImpl: down, now: old(26 + 27 + 5), sleep: nosleep });
  assert.equal(hasThumb(A, dir, old(26 + 27 + 5)), false);
});

test("only an eleven-character video id can name a file, and a path in an id reads nothing", () => {
  const dir = tmp();
  assert.equal(readThumb("../../etc/passwd", dir), null); assert.equal(readThumb("a/b", dir), null); assert.equal(readThumb("short", dir), null);
});
