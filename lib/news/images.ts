import fs from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type SharpFn from "sharp";
import { parseRobots, robotsAllows } from "../research/fetcher";
import { publicHostOnly } from "../research/netguard";
import { NEWS_SOURCES } from "./sources";

/**
 * The picture an outlet's own feed offers for a headline, saved by THIS server and shown from its own address, so a visitor's browser never contacts the outlet's
 * image host (the same plan as the official videos' pictures, lib/news/thumbs.ts). The pictures belong to the outlets: the owner chose to show them, with the outlet named
 * under each and the picture linking to the original story. Each outlet can be switched off (NEWS_IMAGE_SOURCES, which also deletes what was saved from it).
 * Only outlets listed as open are ever asked (never the public broadcasters and newspapers whose feeds are for non-commercial sites). What is fetched: an https address the
 * feed gave, at a public host, after that host's robots.txt allows it, with no redirect, as a real JPEG, PNG or WebP of at most 600 KB. Nothing is fetched while a visitor
 * waits: the route that serves a picture reads this folder only.
 */
export const IMAGE_MAX_BYTES = 600_000, MAX_PER_RUN = 60, SOURCE_LIMIT_PER_RUN = 25;
export const newsImagesDir = () => path.join(path.dirname(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "ringside.db")), "news-images");

/** Which outlets' pictures are kept. NEWS_IMAGE_SOURCES unset: every open outlet; `none`: no outlet; a comma list of outlet ids: those. */
export function imageSources(raw: string | undefined = process.env.NEWS_IMAGE_SOURCES): Set<string> {
  const open = NEWS_SOURCES.filter((s) => s.use === "open").map((s) => s.id);
  const v = (raw ?? "").trim().toLowerCase();
  if (!v) return new Set(open);
  if (v === "none" || v === "0" || v === "off") return new Set();
  return new Set(v.split(",").map((x) => x.trim()).filter((x) => open.includes(x)));
}

export type ImageType = "image/jpeg" | "image/png" | "image/webp";
export function sniff(b: Uint8Array): ImageType | null {
  if (b.length > 12 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length > 12 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b.length > 12 && String.fromCharCode(...b.slice(0, 4)) === "RIFF" && String.fromCharCode(...b.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}
const fileOf = (id: number, dir: string) => path.join(dir, String(id));
export function readNewsImage(id: number, dir = newsImagesDir()): { bytes: Buffer; type: ImageType } | null {
  if (!Number.isInteger(id) || id <= 0) return null;
  try { const bytes = fs.readFileSync(fileOf(id, dir)); const type = sniff(bytes); return type ? { bytes, type } : null; } catch { return null; }
}
export const hasNewsImage = (id: number, dir = newsImagesDir()): boolean => { try { return fs.existsSync(fileOf(id, dir)); } catch { return false; } };

/** Shown no wider than a card needs (the original is often 1,200 px and 150 KB): decoded, turned upright, stripped of its metadata and saved as a small WebP. A file that cannot be
 * decoded is not a picture and is refused. Where the image library is not installed the original is kept (it has already passed the size and type checks above). */
export const CARD_WIDTH = 480;
export async function shrink(bytes: Buffer): Promise<{ bytes: Buffer; type: ImageType } | null> {
  let sharp: typeof SharpFn | null = null;
  try { sharp = (await import("sharp")).default; } catch { /* not installed */ }
  if (!sharp) { const type = sniff(bytes); return type ? { bytes, type } : null; }
  try {
    const out = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "error" }).rotate().resize({ width: CARD_WIDTH, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
    return { bytes: out, type: "image/webp" };
  } catch { return null; }
}

async function readBytes(res: Response, max: number): Promise<Buffer | null> {
  const len = Number(res.headers.get("content-length") ?? 0);
  if (len > max) return null;
  if (!res.body) return null;
  const reader = res.body.getReader(), parts: Uint8Array[] = []; let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.byteLength;
    if (n > max) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  return Buffer.concat(parts);
}

export interface ImageResult { saved: number; failed: number; removed: number; skipped: number }

export async function refreshImages(db: DatabaseSync, o: {
  dir?: string; contact?: string; fetchImpl?: typeof fetch; hostCheck?: (host: string) => Promise<string | null>; allowed?: Set<string>;
  delayMs?: number; sleep?: (ms: number) => Promise<void>; log?: (l: string) => void;
} = {}): Promise<ImageResult> {
  const dir = o.dir ?? newsImagesDir(), f = o.fetchImpl ?? fetch, log = o.log ?? (() => {}), allowed = o.allowed ?? imageSources();
  const hostCheck = o.hostCheck ?? publicHostOnly, sleep = o.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const headers = { "user-agent": `RingsideNews/1.0${o.contact ? ` (+${o.contact})` : ""}`, accept: "image/jpeg,image/png,image/webp" };
  const res: ImageResult = { saved: 0, failed: 0, removed: 0, skipped: 0 };
  let rows: { id: number; source: string; image_url: string }[] = [];
  try { rows = db.prepare("SELECT n.id, n.source, i.image_url FROM news_items n JOIN news_images i ON i.source = n.source AND i.guid = n.guid ORDER BY COALESCE(n.published, n.fetched_at) DESC, n.id DESC").all() as typeof rows; } catch { /* no table: no pictures */ }
  rows = rows.filter((r) => allowed.has(r.source));
  fs.mkdirSync(dir, { recursive: true });
  // a picture whose headline is gone, or whose outlet is switched off, is deleted
  const keep = new Set(rows.map((r) => String(r.id)));
  for (const n of fs.readdirSync(dir)) if (!keep.has(n)) { fs.rmSync(path.join(dir, n), { force: true }); res.removed++; }

  const hostOk = new Map<string, string | null>(), robots = new Map<string, ReturnType<typeof parseRobots> | null>(), perSource = new Map<string, number>();
  let tried = 0;
  for (const r of rows) {
    if (fs.existsSync(fileOf(r.id, dir))) continue;
    if (tried >= MAX_PER_RUN || (perSource.get(r.source) ?? 0) >= SOURCE_LIMIT_PER_RUN) { res.skipped++; continue; }
    tried++; perSource.set(r.source, (perSource.get(r.source) ?? 0) + 1);
    let u: URL;
    try { u = new URL(r.image_url); } catch { res.failed++; continue; }
    if (u.protocol !== "https:") { res.failed++; continue; }
    if (!hostOk.has(u.hostname)) hostOk.set(u.hostname, await hostCheck(u.hostname));
    if (hostOk.get(u.hostname)) { res.failed++; continue; }
    if (!robots.has(u.origin)) {
      try {
        const rr = await f(`${u.origin}/robots.txt`, { headers, redirect: "manual", signal: AbortSignal.timeout(15000) });
        robots.set(u.origin, rr.ok ? parseRobots((await rr.text()).slice(0, 100_000), "ringsidenews") : rr.status === 401 || rr.status === 403 ? { allow: [], disallow: ["/"], crawlDelay: undefined } as ReturnType<typeof parseRobots> : null);
      } catch { robots.set(u.origin, null); }
    }
    const rules = robots.get(u.origin);
    if (rules && !robotsAllows(rules, u.pathname + u.search)) { res.failed++; continue; }
    try {
      const rsp = await f(u.href, { headers, redirect: "error", signal: AbortSignal.timeout(20000) });
      if (!rsp.ok || !/^image\/(jpeg|png|webp)\b/i.test(rsp.headers.get("content-type") ?? "")) { res.failed++; continue; }
      const bytes = await readBytes(rsp, IMAGE_MAX_BYTES);
      if (!bytes || !sniff(bytes)) { res.failed++; continue; }
      const small = await shrink(bytes);
      if (!small) { res.failed++; continue; }
      const tmp = `${fileOf(r.id, dir)}.tmp`; fs.writeFileSync(tmp, small.bytes); fs.renameSync(tmp, fileOf(r.id, dir)); res.saved++;
    } catch { res.failed++; }
    await sleep(o.delayMs ?? 500);
  }
  log(`article pictures: ${res.saved} saved, ${res.failed} not available, ${res.removed} removed${res.skipped ? `, ${res.skipped} left for the next run` : ""}`);
  return res;
}
