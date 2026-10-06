import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { OFF_NAV } from "../lib/nav";

/**
 * The owner's decision (2026-10-06): the terms of use, and the line about corrections and removal, are not on the pages people read. They sit in small type on
 * the Terms page only. These tests keep it that way: a later change that copies the removal wording onto another page fails here.
 */
const root = process.cwd();
const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name.startsWith(".") ? [] : walk(path.join(d, e.name))) : [path.join(d, e.name)]));
const SRC = ["app", "components", "lib"].flatMap((d) => walk(path.join(root, d))).filter((f) => /\.(tsx?|ts)$/.test(f));
const TERMS = path.join("app", "[locale]", "terms", "page.tsx");
const rel = (f: string) => path.relative(root, f);

test("the removal wording is on the Terms page and nowhere else", () => {
  const phrases = ["reviewed for removal", "taken down on request", "request for removal", "remove my page", "removal request"];
  const hits = SRC.filter((f) => phrases.some((p) => fs.readFileSync(f, "utf8").toLowerCase().includes(p))).map(rel);
  assert.deepEqual(hits, [TERMS], "the line about removal belongs on the Terms page only");
});

test("the Terms page is small print: its text is extra small and muted, and it has the contact line", () => {
  const src = fs.readFileSync(path.join(root, TERMS), "utf8");
  assert.match(src, /text-xs[^"]*text-muted/, "small, muted text");
  assert.ok(!/text-(lg|xl|2xl|base)\b/.test(src.replace(/font-display text-3xl[^"]*/, "")), "no larger body text");
  assert.match(src, /siteContact\(\)/, "the site's own contact address is used, nothing personal is written into the page");
  assert.match(src, /No contact address has been set for this site\./, "and with none set the page says so, as the privacy page does");
});

test("the footer links to it, the sitemap lists it, and it is a known page outside the navigation", () => {
  assert.match(fs.readFileSync(path.join(root, "app", "[locale]", "layout.tsx"), "utf8"), /href="\/terms"/);
  assert.match(fs.readFileSync(path.join(root, "lib", "sitemap.ts"), "utf8"), /"\/terms"/);
  assert.ok(OFF_NAV.includes("/terms"));
});
