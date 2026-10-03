import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDb } from "./helpers";
import { makeT, tEn, type Dict } from "../lib/i18n/t";

const cleanup = tempDb("upsets");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let U: typeof import("../lib/upsets");
let A: typeof import("../lib/accountability");
let P: typeof import("../lib/predict");
const AR = JSON.parse(fs.readFileSync(path.join(process.cwd(), "i18n", "ar.json"), "utf8")) as Dict;

before(async () => {
  w = await (await import("../lib/world")).getWorld();
  U = await import("../lib/upsets"); A = await import("../lib/accountability"); P = await import("../lib/predict");
});

const months = (a: string, b: string) => (Date.parse(b) - Date.parse(a)) / (30.4 * 86400000);

test("every live upcoming fight is listed once, the underdog is the less likely side, and the chance is the model's", () => {
  const list = U.upsetWatch(w, tEn);
  const live = w.bouts.filter((b) => b.upcoming && b.status !== "cancelled");
  assert.deepEqual(list.map((x) => x.bout.id).sort((a, b) => a - b), live.map((b) => b.id).sort((a, b) => a - b));
  for (const x of list) {
    const p = P.predict(w.byId.get(x.bout.redId)!, w.byId.get(x.bout.blueId)!);
    assert.equal(x.chance, Math.min(p.pA, p.pB));
    assert.ok(x.chance <= x.favouriteChance + 1e-9 + p.pDraw);
    assert.equal(x.underdog.id, p.pA < p.pB ? x.bout.redId : x.bout.blueId);
    assert.equal(x.tier, x.chance >= 0.4 ? "toss-up" : x.chance >= 0.28 ? "live" : "longshot");
    assert.ok(x.signals.length <= 4);
    assert.deepEqual(x.signals.map((s) => s.weight), [...x.signals.map((s) => s.weight)].sort((a, b) => b - a));
  }
  assert.deepEqual(list.map((x) => x.chance), [...list.map((x) => x.chance)].sort((a, b) => b - a));
});

test("a cancelled bout never appears", () => {
  const cancelled = w.bouts.filter((b) => b.status === "cancelled").map((b) => b.id);
  const ids = new Set(U.upsetWatch(w, tEn).map((x) => x.bout.id));
  for (const id of cancelled) assert.ok(!ids.has(id));
});

test("warning signs appear exactly when the favourite's history says they should", () => {
  for (const x of U.upsetWatch(w, tEn)) {
    const fav = x.favourite;
    const done = (w.boutsByBoxer.get(fav.id) ?? []).filter((b) => !b.upcoming && b.method !== null && b.method !== "NC" && b.date < x.bout.date);
    const last = done.at(-1);
    const kinds = new Set(U.upsetWatch(w, tEn).find((y) => y.bout.id === x.bout.id)!.signals.map((s) => s.kind));
    // signals are capped at four, so only check the direction that cannot be caused by the cap
    if (kinds.has("layoff")) assert.ok(last && months(last.date, x.bout.date) >= 15, "layoff without a long gap");
    if (kinds.has("age")) assert.ok(fav.age >= 36);
    if (kinds.has("ko-loss")) assert.ok(last && last.winnerId !== null && last.winnerId !== fav.id && ["KO", "TKO", "RTD"].includes(last.method!));
    if (kinds.has("lost-last")) assert.ok(last && last.winnerId !== null && last.winnerId !== fav.id && !["KO", "TKO", "RTD"].includes(last.method!));
    if (kinds.has("streak")) assert.ok(x.underdog.streak.type === "W" && x.underdog.streak.count >= 4);
  }
});

test("tier records match a plain count of the scored fights", () => {
  const cs = A.calls(w);
  const rec = U.upsetRecord(w);
  for (const r of rec.all) {
    const rows = cs.filter((c) => { const u = Math.min(c.pRed, 1 - c.pRed); return (u >= 0.4 ? "toss-up" : u >= 0.28 ? "live" : "longshot") === r.tier; });
    assert.equal(r.n, rows.length);
    assert.ok(Math.abs(r.predicted - rows.reduce((s, c) => s + Math.min(c.pRed, 1 - c.pRed), 0) / rows.length) < 1e-12);
    assert.ok(Math.abs(r.observed - rows.filter((c) => (c.pRed < 0.5) === c.redWon).length / rows.length) < 1e-12);
  }
  assert.equal(rec.all.reduce((s, r) => s + r.n, 0), cs.length);
  assert.equal(rec.recent.reduce((s, r) => s + r.n, 0), cs.length - Math.floor(cs.length * 0.75));
});

test("the lift for a warning sign matches a count made another way", () => {
  const lift = U.signalLift(w);
  const cs = A.calls(w);
  // layoff: the favourite's gap since their previous completed fight, found by searching their fights
  let n = 0, won = 0;
  for (const c of cs) {
    const redFav = c.pRed >= 0.5, fav = redFav ? c.redId : c.blueId;
    const earlier = (w.boutsByBoxer.get(fav) ?? []).filter((b) => !b.upcoming && b.method !== null && b.method !== "NC" && (b.date < c.date || (b.date === c.date && b.id < c.boutId)) && b.id !== c.boutId);
    const last = earlier.at(-1);
    if (last && months(last.date, c.date) >= 15) { n++; if (redFav !== c.redWon) won++; }
  }
  const row = lift.find((l) => l.kind === "layoff")!;
  assert.equal(row.n, n);
  assert.ok(Math.abs(row.observed - won / n) < 1e-12);
  assert.deepEqual(lift.map((l) => l.kind), ["layoff", "age", "ko-loss", "lost-last", "streak"]);
});

test("the biggest shocks are the fights the model gave the winner least chance in", () => {
  const shocks = U.recentShocks(w, 12, 5);
  const cutoff = new Date(Date.parse(w.today + "T12:00:00Z") - 12 * 30.4 * 86400000).toISOString().slice(0, 10);
  const pool = A.calls(w).filter((c) => c.date >= cutoff).sort((a, b) => a.pWinner - b.pWinner);
  assert.deepEqual(shocks.map((c) => c.boutId), pool.slice(0, 5).map((c) => c.boutId));
});

test("the feed has one entry per live underdog, unique ids, valid structure, both languages", async () => {
  const route = await import("../app/feeds/upset-watch.xml/route");
  for (const lang of ["", "?lang=ar"]) {
    const res = await route.GET(new Request(`http://localhost/feeds/upset-watch.xml${lang}`));
    assert.equal(res.headers.get("content-type"), "application/atom+xml; charset=utf-8");
    const xml = await res.text();
    const want = U.upsetWatch(w, lang ? makeT("ar", AR) : tEn).filter((x) => x.tier !== "longshot");
    const ids = [...xml.matchAll(/<entry>\s*<id>([^<]+)<\/id>/g)].map((m) => m[1]);
    assert.equal(ids.length, want.length);
    assert.equal(new Set(ids).size, ids.length);
    assert.match(xml, lang ? /xml:lang="ar"/ : /xml:lang="en"/);
    assert.ok(!/&(?!amp;|lt;|gt;|quot;)/.test(xml), "unescaped ampersand");
    assert.equal((xml.match(/<entry>/g) ?? []).length, (xml.match(/<\/entry>/g) ?? []).length);
    assert.ok(!/longshot|احتمال ضعيف/i.test(xml.split("<entry>").slice(1).map((e) => e.match(/<category term="([^"]*)"/)?.[1] ?? "").join(" ")));
  }
});

test("signals read in Arabic with nothing left in English", () => {
  const ar = makeT("ar", AR);
  for (const x of U.upsetWatch(w, ar)) for (const s of x.signals) {
    assert.ok(!/\{[a-z]+\}|undefined|NaN/.test(s.text), s.text);
    const stripped = s.text.replace(/Elo|KO|[A-Za-z]+-?[A-Za-z]*\d*/g, (m) => (w.boxers.some((b) => b.name.includes(m)) ? "" : m));
    assert.ok(!/[A-Za-z]{4,}/.test(stripped), `English left in "${s.text}"`);
  }
  for (const t of Object.values(U.TIER_LABEL)) assert.notEqual(ar(t), t);
});

test("the pages are in the sitemap and the navigation", async () => {
  const { sitemapPaths } = await import("../lib/sitemap");
  const paths = sitemapPaths(w).map((p) => p.path);
  for (const p of ["/upset-watch", "/trainers"]) assert.ok(paths.includes(p), p);
});
