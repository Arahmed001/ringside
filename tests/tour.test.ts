import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, statSync } from "node:fs";
import { OFF_NAV } from "../lib/nav";
import { contentSecurityPolicy } from "../lib/security";

const root = new URL("../", import.meta.url);
const read = (p: string) => readFileSync(new URL(p, root), "utf8");

test("the tour page's video files exist for both languages, in both formats, with a poster", () => {
  for (const l of ["en", "ar"]) {
    for (const f of [`tour-${l}.mp4`, `tour-${l}.webm`, `poster-${l}.jpg`]) {
      const p = new URL(`public/media/${f}`, root);
      assert.ok(existsSync(p), f);
      const size = statSync(p).size;
      assert.ok(size > 10_000, `${f} is not empty`);
      assert.ok(size < 6_000_000, `${f} stays small enough to load on a phone (${size} bytes)`);
    }
  }
  const mp4 = readFileSync(new URL("public/media/tour-en.mp4", root));
  assert.equal(mp4.subarray(4, 8).toString("latin1"), "ftyp", "a real MP4, not a renamed file");
  const webm = readFileSync(new URL("public/media/tour-ar.webm", root));
  assert.deepEqual([...webm.subarray(0, 4)], [0x1a, 0x45, 0xdf, 0xa3], "a real WebM, not a renamed file");
});

test("the page picks the video for its own language, never starts it by itself, and offers a text version", () => {
  const page = read("app/[locale]/tour/page.tsx");
  assert.match(page, /tour-\$\{ar \? "ar" : "en"\}\.mp4/);
  assert.match(page, /tour-\$\{ar \? "ar" : "en"\}\.webm/);
  assert.match(page, /poster-\$\{ar \? "ar" : "en"\}\.jpg/);
  assert.ok(!/autoPlay|autoplay/i.test(page), "no autoplay");
  assert.match(page, /<video\b[^>]*\bcontrols\b/);
  assert.match(page, /aria-label=\{t\("Ringside tour video, with captions"\)\}/);
  assert.match(page, /<ol\b/, "the list of what the tour shows");
});

test("the tour is reachable from Boxing, explained, search and the sitemap, and is deliberately not in the side menu or on the home page", () => {
  assert.match(read("app/[locale]/learn/page.tsx"), /href="\/tour"/);
  assert.match(read("lib/search.ts"), /href: "\/tour"/);
  assert.match(read("lib/sitemap.ts"), /"\/tour"/);
  assert.ok(OFF_NAV.includes("/tour"));
  assert.ok(!/\/tour/.test(read("app/[locale]/page.tsx")), "not on the home page");
});

test("the security policy lets the page play the site's own video and nothing else", () => {
  const csp = contentSecurityPolicy({ nonce: "x" }).split("; ");
  assert.ok(csp.includes("media-src 'self'"));
  assert.ok(csp.includes("default-src 'self'"));
});
