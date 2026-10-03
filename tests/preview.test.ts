import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { tempDb } from "./helpers";
import { tEn } from "../lib/i18n/t";

const cleanup = tempDb("preview");
after(cleanup);

type World = Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
let w: World;
let P: typeof import("../lib/preview");

before(async () => { w = await (await import("../lib/world")).getWorld(); P = await import("../lib/preview"); });

const upcoming = () => w.bouts.filter((b) => b.upcoming && b.status !== "cancelled");

test("a preview has every section, built from the data, with numbers that add up", () => {
  const bouts = upcoming();
  assert.ok(bouts.length > 10);
  for (const b of bouts.slice(0, 25)) {
    const pv = P.buildPreview(w, b);
    assert.equal(pv.red.id, b.redId); assert.equal(pv.blue.id, b.blueId);
    assert.match(pv.headline, new RegExp(`${pv.red.name}.*vs.*${pv.blue.name}`));
    assert.ok(pv.standfirst.includes(pv.red.name) && pv.standfirst.includes(pv.blue.name) && pv.standfirst.includes(String(b.rounds)));
    assert.equal(pv.prose.length, 3); assert.ok(pv.prose.every((p) => p.length > 40));
    assert.ok(pv.tape.length >= 9 && pv.tape.every((r) => r.red && r.blue));
    assert.equal(pv.tape[0].red, `${pv.red.wins}-${pv.red.losses}-${pv.red.draws}`);
    // the endings are a probability distribution over the fight
    assert.equal(pv.pick.endings.length, 5);
    assert.ok(pv.pick.endings.every((e) => e.pct >= 0));
    assert.ok(Math.abs(pv.pick.endings.reduce((s, e) => s + e.pct, 0) - 1) < 1e-9, "endings sum to 1");
    assert.ok(Math.abs(pv.pick.endings.filter((e) => e.label.includes("stoppage") || /by stoppage/.test(e.label)).reduce((s, e) => s + e.pct, 0) - pv.pick.koProb) < 0.03 || pv.pick.koProb > 0.8, "stoppage endings follow the model's stoppage chance");
    assert.equal(pv.pick.favourite.id, pv.pick.pA >= pv.pick.pB ? pv.red.id : pv.blue.id);
    assert.equal(pv.pick.pct, Math.round(Math.max(pv.pick.pA, pv.pick.pB) * 100));
    assert.equal(pv.form.length, 2); for (const f of pv.form) assert.ok(f.results.length <= 5 && f.results.every((r) => "WLD".includes(r)));
    assert.ok(pv.factors.length >= 1 && pv.factors.length <= 3);
    assert.ok(pv.score >= 0 && pv.score <= 100);
    for (const text of [pv.headline, pv.standfirst, pv.style, pv.head2head, ...pv.prose, ...pv.stakes, ...pv.watch, ...pv.cases.red, ...pv.cases.blue]) assert.doesNotMatch(text, /\{\w+\}/, `unfilled placeholder in: ${text}`);
    JSON.stringify(pv.facts); // the AI gets plain data
  }
});

test("tape edges point at the better fighter, and the form line matches the record", () => {
  const b = upcoming().find((x) => { const r = w.byId.get(x.redId)!, u = w.byId.get(x.blueId)!; return Math.abs(r.rating - u.rating) > 50; })!;
  const pv = P.buildPreview(w, b);
  const elo = pv.tape.find((r) => r.label === "Elo rating")!;
  assert.equal(elo.edge, pv.red.rating > pv.blue.rating ? "red" : "blue");
  const age = pv.tape.find((r) => r.label === "Age")!;
  if (pv.red.age !== pv.blue.age) assert.equal(age.edge, pv.red.age < pv.blue.age ? "red" : "blue", "younger is the edge");
  for (const f of pv.form) {
    const last = (w.boutsByBoxer.get(f.boxer.id) ?? []).filter((x) => !x.upcoming && x.method && x.method !== "NC").slice(-5);
    assert.equal(f.results.length, last.length);
    assert.equal(f.results.filter((r) => r === "W").length, last.filter((x) => x.winnerId === f.boxer.id).length);
  }
});

test("a title fight says what is at stake and who is defending", () => {
  const b = upcoming().find((x) => x.title)!;
  assert.ok(b, "the demo calendar has upcoming title fights");
  const pv = P.buildPreview(w, b);
  assert.ok(pv.stakes.length >= 1);
  assert.match(pv.stakes[0], /on the line|defends the/);
  assert.match(pv.standfirst, /for the /);
  const plain = upcoming().find((x) => !x.title)!;
  assert.doesNotMatch(P.buildPreview(w, plain).standfirst, / for the /);
});

test("the preview is available in Arabic with no English sentences or placeholders left", async () => {
  const { getTFor } = await import("../lib/i18n/dicts");
  const ar = await getTFor("ar");
  for (const b of upcoming().slice(0, 12)) {
    const pv = P.buildPreview(w, b, ar);
    for (const text of [pv.headline, pv.standfirst, pv.style, pv.head2head, ...pv.prose, ...pv.stakes, ...pv.watch, ...pv.cases.red, ...pv.cases.blue, ...pv.form.map((f) => f.line), ...pv.pick.endings.map((e) => e.label)]) {
      assert.match(text, /[؀-ۿ]/, `no Arabic in: ${text}`);
      assert.doesNotMatch(text, /\{\w+\}/);
      assert.doesNotMatch(text, /\b(the|and|against|has|have|fight|model)\b/i, `English leaked into: ${text}`);
    }
  }
});

test("the article: plain prose without a key, Claude's text with one, cached, and a failure falls back", async () => {
  const bouts = upcoming();
  const savedKey = process.env.ANTHROPIC_API_KEY, realFetch = globalThis.fetch;
  try {
    delete process.env.ANTHROPIC_API_KEY;
    const plain = await P.previewArticle(w, bouts[0], tEn);
    assert.equal(plain.source, "rules"); assert.deepEqual(plain.paragraphs, P.buildPreview(w, bouts[0]).prose);

    process.env.ANTHROPIC_API_KEY = "test-key";
    const calls: { body: { system: string; messages: { content: string }[] } }[] = [];
    globalThis.fetch = (async (_u: unknown, init?: { body?: string }) => {
      calls.push({ body: JSON.parse(init!.body!) });
      return new Response(JSON.stringify({ content: [{ type: "text", text: "First paragraph.\n\nSecond paragraph.\n\nThird paragraph." }] }), { status: 200 });
    }) as typeof fetch;
    const ai = await P.previewArticle(w, bouts[1], tEn);
    assert.equal(ai.source, "ai"); assert.equal(ai.paragraphs.length, 3);
    const sent = calls[0].body;
    assert.match(sent.system, /ONLY the facts/); assert.doesNotMatch(sent.system, /Arabic/);
    const facts = JSON.parse(sent.messages[0].content);
    assert.equal(facts.fight.red, w.byId.get(bouts[1].redId)!.name);
    assert.ok(facts.pick.percent >= 50);
    await P.previewArticle(w, bouts[1], tEn);
    assert.equal(calls.length, 1, "the second request is served from the cache");

    const { getTFor } = await import("../lib/i18n/dicts");
    await P.previewArticle(w, bouts[2], await getTFor("ar"));
    assert.match(calls[1].body.system, /Modern Standard Arabic/);

    globalThis.fetch = (async () => new Response("nope", { status: 500 })) as typeof fetch;
    const fallback = await P.previewArticle(w, bouts[3], tEn);
    assert.equal(fallback.source, "rules", "an API error leaves the plain preview");
    globalThis.fetch = (async () => new Response(JSON.stringify({ content: [{ type: "text", text: "one lonely paragraph" }] }), { status: 200 })) as typeof fetch;
    assert.equal((await P.previewArticle(w, bouts[4], tEn)).source, "rules", "a reply too thin to be an article is not used");
  } finally {
    globalThis.fetch = realFetch;
    if (savedKey === undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY = savedKey;
  }
});

test("/api/preview answers for upcoming bouts only; the sitemap lists their previews", async () => {
  const route = await import("../app/api/preview/[id]/route");
  const up = upcoming()[0], done = w.bouts.find((b) => !b.upcoming && b.method)!;
  const ok = await route.GET(new Request(`http://x/api/preview/${up.id}?lang=ar`), { params: Promise.resolve({ id: String(up.id) }) });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.ok(Array.isArray(body.paragraphs) && body.paragraphs.length >= 2 && /[؀-ۿ]/.test(body.paragraphs[0]));
  assert.equal((await route.GET(new Request("http://x"), { params: Promise.resolve({ id: String(done.id) }) })).status, 404);
  assert.equal((await route.GET(new Request("http://x"), { params: Promise.resolve({ id: "999999999" }) })).status, 404);
  const { sitemapPaths } = await import("../lib/sitemap");
  const paths = sitemapPaths(w).map((p) => p.path);
  assert.ok(paths.includes("/previews") && paths.includes(`/previews/${(w.boutsByEvent.get(up.eventId) ?? []).filter((x) => x.status !== "cancelled")[0].id}`));
  assert.ok(!paths.includes(`/previews/${done.id}`), "finished fights have no preview URL");
});
