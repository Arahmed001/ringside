import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDb } from "./helpers";
import { NAV_GROUPS, OFF_NAV } from "../lib/nav";

/** The forum's pages and the discussion boxes (round 126): what people write stays out of the pages search engines read, nothing is ever shown as markup, every refusal has words in both languages. */
const cleanup = tempDb("forumpages");
after(cleanup);
const root = path.resolve(__dirname, "..");
const read = (f: string) => fs.readFileSync(path.join(root, f), "utf8");

test("the forum's pages are not for search engines, and are not in the sitemap or the menu", () => {
  for (const f of ["app/[locale]/forum/page.tsx", "app/[locale]/forum/[id]/page.tsx"]) assert.match(read(f), /noindex: true/, `${f} is marked noindex`);
  assert.ok(!/forum/.test(read("lib/sitemap.ts")), "the sitemap lists no forum page");
  assert.ok(OFF_NAV.includes("/forum"), "kept out of the menu until the rules page and the editors' queue are ready (round 127)");
  assert.ok(!NAV_GROUPS.some((g) => g.items.some((i) => i.href === "/forum")));
});

test("what people write is loaded by the browser after the page opens: no page that search engines index imports the forum's posts", () => {
  for (const f of ["app/[locale]/boxers/[slug]/page.tsx", "app/[locale]/bouts/[id]/page.tsx"]) {
    const s = read(f);
    assert.ok(!/@\/lib\/forum/.test(s), `${f} reads no forum data on the server`);
    assert.match(s, /<Discussion target=\{\{ kind: "(boxer|bout)"/, `${f} has the discussion box`);
    assert.match(s, /<section id="discussion" className="scroll-mt-32">/);
  }
  assert.match(read("components/Discussion.tsx"), /^"use client";/, "the discussion is a client component: its text is not part of the page's HTML");
});

test("nothing a person writes is ever shown as markup", () => {
  for (const f of ["components/Discussion.tsx", "components/StartThread.tsx", "app/[locale]/forum/page.tsx", "app/[locale]/forum/[id]/page.tsx"]) {
    const s = read(f);
    assert.ok(!/dangerouslySetInnerHTML|innerHTML|insertAdjacentHTML/.test(s), `${f}: no raw HTML`);
  }
  const d = read("components/Discussion.tsx");
  assert.match(d, /whitespace-pre-wrap break-words text-sm" dir="auto">\{p\.body\}</, "the words go in as text, keeping their line breaks and their own direction");
  assert.match(d, /checkText\(text\)/, "the rules are checked as you type");
  assert.match(read("app/[locale]/forum/[id]/page.tsx"), /th\.kind === "general"/, "the thread page is for general threads only: a fighter's thread is read on the fighter's page");
});

test("every refusal the forum can make has words, in English and in Arabic, and they differ", async () => {
  const { forumExplain } = await import("../lib/forum/text"), { getTFor } = await import("../lib/i18n/dicts");
  const en = await getTFor("en"), ar = await getTFor("ar");
  const codes = ["has_link", "has_number", "too_short", "empty", "too_long", "repetitive", "unauthorized", "forbidden", "too_new", "rate_limited", "duplicate", "locked", "title_invalid", "not_found", "no_such_subject", "edit_window_over", "own_post", "already_reported", "network"];
  const fallback = forumExplain(en, "no-such-code");
  const seen = new Set<string>();
  for (const c of codes) {
    const e = forumExplain(en, c), a = forumExplain(ar, c);
    assert.notEqual(e, fallback, `${c} has its own words`); assert.notEqual(a, e, `${c} is translated`); assert.match(a, /[؀-ۿ]/, `${c}: Arabic`);
    if (c !== "not_found" && c !== "no_such_subject") assert.ok(!seen.has(e), `${c} reuses another message`); seen.add(e);
  }
  assert.match(forumExplain(en, "too_long"), /2000/);
  // and every error the server can return is one of those
  const posts = read("lib/forum/posts.ts"), union = /export type ForumError =([^;]+);/.exec(posts)![1];
  const all = [...union.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).filter((c) => c !== "bad_reason");
  for (const c of all) assert.ok(codes.includes(c), `${c} can be returned by the server but the page has no words for it`);
});
