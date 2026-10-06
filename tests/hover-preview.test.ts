import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDb } from "./helpers";
import { fighterSlugFromHref } from "../lib/fighter-link";

const cleanup = tempDb("hoverpreview");
after(cleanup);
const root = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");
let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
before(async () => { w = await (await import("../lib/world")).getWorld(); });

test("which links get a preview: a fighter's own page in either language, nothing else (round 122)", () => {
  const o = "https://ringside.test";
  assert.equal(fighterSlugFromHref("/boxers/jo-ruiz", o), "jo-ruiz");
  assert.equal(fighterSlugFromHref("/ar/boxers/jo-ruiz", o), "jo-ruiz");
  assert.equal(fighterSlugFromHref("https://ringside.test/boxers/jo-ruiz/", o), "jo-ruiz");
  assert.equal(fighterSlugFromHref("/boxers/jo-ruiz?x=1#top", o), "jo-ruiz");
  for (const no of ["/boxers", "/boxers/", "/boxers/jo-ruiz/extra", "/rankings/heavyweight", "/people/jo-ruiz", "/en/boxers/jo-ruiz", "https://evil.test/boxers/jo-ruiz", "//evil.test/boxers/jo-ruiz", "/boxers/a b", "mailto:x@y.z", "javascript:alert(1)", ""]) assert.equal(fighterSlugFromHref(no, o), null, no);
});

test("the card of a fighter: the few facts the page itself carries, in the reader's language", async () => {
  const { fighterCard } = await import("../lib/fighter-card");
  const { getTFor } = await import("../lib/i18n/dicts");
  const b = [...w.boxers].sort((a, c) => c.rating - a.rating)[0];
  const en = fighterCard(w, b, await getTFor("en")), ar = fighterCard(w, b, await getTFor("ar"));
  assert.equal(en.slug, b.slug); assert.equal(en.rating, Math.round(b.rating)); assert.match(en.record, /^\d+-\d+-\d+$/);
  assert.ok(en.rank === null || en.rank >= 1); assert.ok(en.koPercent >= 0 && en.koPercent <= 100);
  assert.ok(["Active", "Retired"].includes(en.status)); assert.ok(en.status !== ar.status, "the status is in Arabic in the Arabic card");
  assert.notEqual(en.country, ar.country, "the country too"); assert.equal(ar.record, en.record, "a record is the same figures in both");
  const none = [...w.boxers].find((x) => !x.lastFight);
  if (none) assert.equal(fighterCard(w, none, await getTFor("en")).lastFight, null);
});

test("the preview is only where a pointer can hover, is a tooltip the visitor can dismiss, and never pulls server code into the browser", () => {
  const c = read("components/HoverPreview.tsx");
  assert.match(c, /\(hover: hover\) and \(pointer: fine\)/, "no preview on a phone");
  assert.match(c, /e\.key === "Escape"/); assert.match(c, /role="tooltip"/); assert.match(c, /aria-describedby/);
  assert.match(c, /window\.addEventListener\("scroll", hide/); assert.match(c, /e\.pointerType === "touch"/);
  assert.match(c, /\[data-no-preview\], \.drawer, \[role=dialog\], nav/, "not in the menu, a dialog or the navigation");
  assert.match(c, /onPointerEnter=\{\(\) => \{ overCard\.current = true/, "the card stays while the pointer is on it (WCAG 1.4.13)");
  assert.ok(!/from "@\/lib\/(world|fighter-card|rankings|career)"/.test(c.replace(/import type[^\n]*\n/g, "")), "only types and the pure link helper come from lib");
  assert.ok(!/from "node:|sqlite/.test(read("lib/fighter-link.ts")));
  assert.match(read("app/[locale]/layout.tsx"), /<HoverPreview \/>/);
  assert.ok(!/<HoverPreview/.test(read("app/embed/[locale]/layout.tsx")), "not inside an embed");
  assert.match(read("app/api/fighter-card/[slug]/route.ts"), /status: 404/);
});
