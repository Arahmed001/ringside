import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { isVideoSource, videoIdOf } from "./sources";

/**
 * Thumbnails of the official videos, saved by THIS server and shown from its own address, so that merely opening a page tells YouTube and Google nothing about the
 * visitor (the page still contacts them only when play is pressed). `news:refresh` fetches each picture once from YouTube's image host and keeps it in a folder beside
 * the database (`video-thumbs/<id>.jpg`). Two limits keep this to what YouTube's developer terms allow for data got through its API: a picture is never kept
 * longer than 30 days without being fetched again, and one whose video has left the list is deleted. Nothing is fetched while a visitor waits: the route that serves
 * a picture reads only what is already in the folder, so it cannot be used to make this server fetch anything.
 */
export const THUMB_HOST = "https://i.ytimg.com/vi/";
export const MAX_AGE_DAYS = 30, REFETCH_DAYS = 25, MAX_BYTES = 400_000, MAX_PER_RUN = 80;
const ID = /^[A-Za-z0-9_-]{11}$/;
/** Best picture first (16:9, no black bars); the smaller 16:9 one is the fallback. */
const SIZES = ["maxresdefault.jpg", "mqdefault.jpg"];

export const thumbsDir = () => path.join(path.dirname(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db")), "video-thumbs");
export const validId = (id: string) => ID.test(id);
const fileOf = (id: string, dir: string) => path.join(dir, `${id}.jpg`);
/** The saved picture's bytes, or null. A file past its 30 days is not served. */
export function readThumb(id: string, dir = thumbsDir(), now = Date.now()): Buffer | null {
  if (!ID.test(id)) return null;
  try {
    const f = fileOf(id, dir), st = fs.statSync(f);
    return now - st.mtimeMs > MAX_AGE_DAYS * 86400_000 ? null : fs.readFileSync(f);
  } catch { return null; }
}
export const hasThumb = (id: string, dir = thumbsDir(), now = Date.now()): boolean => {
  if (!ID.test(id)) return false;
  try { return now - fs.statSync(fileOf(id, dir)).mtimeMs <= MAX_AGE_DAYS * 86400_000; } catch { return false; }
};

const isJpeg = (b: Buffer) => b.length > 1000 && b.length <= MAX_BYTES && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;

export interface ThumbResult { wanted: number; fetched: number; failed: number; removed: number }

export async function refreshThumbs(db: DatabaseSync, o: { dir?: string; fetchImpl?: typeof fetch; now?: number; delayMs?: number; sleep?: (ms: number) => Promise<void>; contact?: string; log?: (l: string) => void } = {}): Promise<ThumbResult> {
  const dir = o.dir ?? thumbsDir(), f = o.fetchImpl ?? fetch, now = o.now ?? Date.now(), log = o.log ?? (() => {});
  const sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let rows: { source: string; url: string }[] = [];
  try { rows = db.prepare("SELECT source, url FROM news_items ORDER BY COALESCE(published, fetched_at) DESC, id DESC").all() as typeof rows; } catch { /* no news table: nothing to do */ }
  const ids = [...new Set(rows.filter((r) => isVideoSource(r.source)).map((r) => videoIdOf(r.url)).filter((x): x is string => !!x))];
  fs.mkdirSync(dir, { recursive: true });
  const res: ThumbResult = { wanted: ids.length, fetched: 0, failed: 0, removed: 0 };
  // a picture whose video has left the list, or that has been kept more than 30 days, goes
  const keep = new Set(ids);
  for (const n of fs.readdirSync(dir)) {
    const id = n.replace(/\.jpg$/, "");
    let st: fs.Stats | null = null; try { st = fs.statSync(path.join(dir, n)); } catch { /* gone already */ }
    if (!n.endsWith(".jpg") || !ID.test(id) || !keep.has(id) || (st && now - st.mtimeMs > MAX_AGE_DAYS * 86400_000)) { fs.rmSync(path.join(dir, n), { force: true }); res.removed++; }
  }
  const need = ids.filter((id) => { try { return now - fs.statSync(fileOf(id, dir)).mtimeMs > REFETCH_DAYS * 86400_000; } catch { return true; } }).slice(0, MAX_PER_RUN);
  for (const id of need) {
    let got: Buffer | null = null;
    for (const size of SIZES) {
      try {
        const r = await f(`${THUMB_HOST}${id}/${size}`, { redirect: "error", signal: AbortSignal.timeout(15_000), headers: { "user-agent": `RingsideNews/1.0${o.contact ? ` (+${o.contact})` : ""}`, accept: "image/jpeg" } });
        if (!r.ok || !/^image\/jpeg\b/i.test(r.headers.get("content-type") ?? "")) continue;
        const b = Buffer.from(await r.arrayBuffer());
        if (isJpeg(b)) { got = b; break; }
      } catch { /* try the next size, then count it as failed */ }
    }
    if (got) { const tmp = `${fileOf(id, dir)}.tmp`; fs.writeFileSync(tmp, got); fs.renameSync(tmp, fileOf(id, dir)); fs.utimesSync(fileOf(id, dir), new Date(now), new Date(now)); res.fetched++; } else res.failed++;
    await sleep(o.delayMs ?? 250);
  }
  log(`video pictures: ${res.fetched} saved, ${res.failed} not available, ${res.removed} removed (${ids.length} videos listed)`);
  return res;
}
