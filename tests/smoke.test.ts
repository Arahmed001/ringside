import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cleanupIsolatedDb } from "./db-isolation"; // FIRST of the imports that reach lib/db: see that file
import { NAV_GROUPS } from "../lib/nav";
import { DYNAMIC_PAGES, crawlRoutes, problemsIn, smokeRoutes, visibleText, type SmokeRoute } from "../lib/smoke";

/**
 * The smoke check (npm run smoke, run in CI against a production server) is only as good as what it inspects and what
 * it covers. These tests pin down both: every slip it looks for is caught, healthy pages pass, and no page kind escapes.
 */
after(cleanupIsolatedDb);

const page: SmokeRoute = { path: "/x", kind: "page", label: "x" };
const html = (body: string, lang = "en", dir = "ltr") => `<!doctype html><html lang="${lang}" dir="${dir}"><head><title>t</title><style>.a{color:red}</style></head><body><h1>Title</h1>${body}<script>self.__next_f.push(["undefined NaN {name}"])</script></body></html>`;
const bad = (body: string, lang: "en" | "ar" = "en", status = 200, type = "text/html; charset=utf-8", route = page) => problemsIn(route, lang, status, type, body);

test("a healthy page passes, and scripts and styles are not read as page text", () => {
  assert.deepEqual(bad(html("<p>Rated 1500, 12-1-0, born in Reno.</p>")), []);
  assert.deepEqual(bad(html("<p>مرحبا</p>", "ar", "rtl"), "ar"), []);
  assert.ok(!visibleText(html("<p>hi</p>")).includes("undefined"), "the payload script is ignored");
});

test("each rendering slip is caught: undefined, NaN, [object Object], Infinity, an unfilled placeholder, null, an error page", () => {
  const cases: [string, RegExp][] = [
    ["<p>Reach: undefined cm</p>", /undefined/], ["<p>Win rate NaN%</p>", /NaN/], ["<p>[object Object]</p>", /object Object/], ["<p>Odds Infinity</p>", /Infinity/],
    ["<p>Beat {name} by KO</p>", /placeholder/], ["<p>Age: null</p>", /null/], ["<p>Application error: a server-side exception has occurred</p>", /error page/],
  ];
  for (const [body, re] of cases) assert.ok(bad(html(body)).some((m) => re.test(m)), `not caught: ${body}`);
  for (const ok of ["<p>An undefeated champion</p>", "<p>Nan Okafor lost</p>", "<p>Rated 1,500 (null of ...)</p>".replace("null of", "one of")]) assert.deepEqual(bad(html(ok)), [], ok);
});

test("the home page must keep one heading and a question box that goes to /ask, in either language", () => {
  const home: SmokeRoute = { path: "/", kind: "page", label: "home" };
  const good = (lang: "en" | "ar") => html(`<h2 id="ask">Ask</h2><form class="x" action="${lang === "ar" ? "/ar" : ""}/ask"><input name="q"></form>`, lang, lang === "ar" ? "rtl" : "ltr").replace("<h1>Title</h1>", "<h1>One</h1>");
  assert.deepEqual(bad(good("en"), "en", 200, "text/html", home), []);
  assert.deepEqual(bad(good("ar"), "ar", 200, "text/html", home), []);
  assert.ok(bad(good("en").replace("<h1>One</h1>", "<h1>One</h1><h1>Two</h1>"), "en", 200, "text/html", home).some((m) => /exactly one/.test(m)), "two headings");
  assert.ok(bad(good("en").replace('id="ask"', 'id="other"'), "en", 200, "text/html", home).some((m) => /ask-the-data section/.test(m)), "no ask section");
  assert.ok(bad(good("en").replace('action="/ask"', 'action="/boxers"'), "en", 200, "text/html", home).some((m) => /does not go to \/ask/.test(m)), "the old search form");
  assert.ok(bad(good("ar").replace('action="/ar/ask"', 'action="/ask"'), "ar", 200, "text/html", home).some((m) => /does not go to/.test(m)), "an Arabic page whose form drops the /ar prefix");
  assert.deepEqual(bad(good("en").replace('id="ask"', 'id="other"'), "en", 200, "text/html", page), [], "other pages are not held to this");
});

test("language, direction, heading, status and content type are all enforced", () => {
  assert.ok(bad(html("<p>x</p>", "en", "ltr"), "ar").some((m) => /lang/.test(m)), "an English page served for an Arabic URL");
  assert.ok(bad(html("<p>x</p>", "ar", "ltr"), "ar").some((m) => /dir/.test(m)), "Arabic that is not right-to-left");
  assert.ok(bad(html("<p>x</p>", "en", "rtl"), "en").some((m) => /dir/.test(m)));
  assert.ok(bad("<html lang=\"en\" dir=\"ltr\"><body><p>no heading</p></body></html>").some((m) => /h1/.test(m)));
  assert.deepEqual(bad(html("x"), "en", 500), ["status 500"]);
  assert.ok(bad(html("x"), "en", 200, "application/json").some((m) => /not HTML/.test(m)));
});

test("API, image and unknown-page routes have their own rules", () => {
  const api: SmokeRoute = { path: "/api/x", kind: "api", label: "api" }, svg: SmokeRoute = { path: "/a.svg", kind: "svg", label: "svg" }, missing: SmokeRoute = { path: "/nope", kind: "missing", label: "404" };
  assert.deepEqual(bad("[]", "en", 200, "application/json", api), []);
  assert.ok(bad("not json", "en", 200, "application/json", api).some((m) => /invalid JSON/.test(m)));
  assert.ok(bad("[]", "en", 200, "text/html", api).some((m) => /not JSON/.test(m)));
  assert.deepEqual(bad("<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>", "en", 200, "image/svg+xml; charset=utf-8", svg), []);
  assert.ok(bad("<html></html>", "en", 200, "text/html", svg).length >= 1);
  // a real 404 with noindex and a heading somewhere in the response (markup or the streamed payload) is fine
  assert.deepEqual(bad("<meta name=\"robots\" content=\"noindex\"/>…\\\"h1\\\",null,{className…", "en", 404, "text/html", missing), []);
  assert.ok(bad("<meta name=\"robots\" content=\"noindex\"/><h1>Not here</h1>", "en", 200, "text/html", missing).some((m) => /expected 404/.test(m)), "a soft 404 is a bug");
  assert.ok(bad("<h1>Not here</h1>", "en", 404, "text/html", missing).some((m) => /noindex/.test(m)));
  assert.ok(bad("<meta content=\"noindex\"/>", "en", 404, "text/html", missing).some((m) => /heading/.test(m)));
});

test("every parameterised page in the app has a sample route, so a new page cannot escape the check", async () => {
  const root = path.join(process.cwd(), "app", "[locale]");
  const found: string[] = [];
  const walk = (dir: string, rel: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!e.isDirectory()) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.name.startsWith("[") && !e.name.startsWith("[...")) { if (fs.existsSync(path.join(dir, e.name, "page.tsx"))) found.push(r); }
      walk(path.join(dir, e.name), r);
    }
  };
  walk(root, "");
  assert.deepEqual([...found].sort(), [...DYNAMIC_PAGES].sort(), "add a sampler in lib/smoke.ts and list the page in DYNAMIC_PAGES");
});

let w: Awaited<ReturnType<typeof import("../lib/world").getWorld>>;
before(async () => { w = await (await import("../lib/world")).getWorld(); });

test("the route list covers every navigation entry and one page of every dynamic kind, without duplicates", () => {
  const routes = smokeRoutes(w), paths = routes.map((r) => r.path);
  assert.equal(new Set(paths).size, paths.length, "no path twice");
  for (const g of NAV_GROUPS) for (const i of g.items) assert.ok(paths.includes(i.href), `${i.href} is in the navigation but not in the smoke list`);
  for (const kind of ["/boxers/", "/bouts/", "/events/", "/people/", "/orgs/", "/titles/", "/rankings/", "/all-time/", "/fight-of-the-year/", "/previews/"]) {
    assert.ok(paths.some((p) => p.startsWith(kind) && p.length > kind.length), `no sample for ${kind}`);
  }
  for (const k of ["page", "api", "svg", "missing"] as const) assert.ok(routes.some((r) => r.kind === k), k);
  assert.ok(routes.filter((r) => r.path.startsWith("/events/")).length >= 3, "completed, upcoming and a special-status card");
  assert.ok(routes.some((r) => r.label === "bout: draw") && routes.some((r) => r.label === "bout: upcoming") && routes.some((r) => r.label === "bout: title fight"));
  assert.ok(paths.some((p) => p.includes("sex=female")), "women's pages are sampled");
});

test("a route can require text on the page: a search with a slip in the name must show the fighter, in English", () => {
  const route: SmokeRoute = { path: "/boxers?q=x", kind: "page", label: "fighter search with a letter missing", mustShow: "Tomás Villalba" };
  assert.deepEqual(bad(html("<p>Tomás Villalba</p>"), "en", 200, "text/html", route), []);
  assert.ok(bad(html("<p>Nobody matches that.</p>"), "en", 200, "text/html", route).some((m) => /does not show "Tomás Villalba"/.test(m)));
  assert.deepEqual(bad(html("<p>لا أحد</p>", "ar", "rtl"), "ar", 200, "text/html", route), [], "the name is in Arabic on the Arabic page, so the English text is not demanded there");
});

test("the search-with-a-slip route is in the list, English only (its query is English the page echoes), and asks for the fighter by name", () => {
  const route = smokeRoutes(w).find((r) => r.label === "fighter search with a letter missing")!;
  assert.ok(route, "the route exists");
  assert.equal(route.englishOnly, true);
  assert.ok(route.mustShow && route.path.startsWith("/boxers?q="));
  assert.ok(decodeURIComponent(route.path).toLowerCase().includes(route.mustShow.split(" ")[0].toLowerCase()), "the query is built from the fighter's name");
  assert.ok(!decodeURIComponent(route.path).toLowerCase().includes(route.mustShow.split(" ").slice(-1)[0].toLowerCase()), "but with a letter missing from the surname");
});

test("the crawl samples every kind of page with a parameter, the same pages every time, with the extreme fighters first and none twice", () => {
  const a = crawlRoutes(w, 20), b = crawlRoutes(w, 20);
  assert.deepEqual(a.map((r) => r.path), b.map((r) => r.path), "the same league and seed give the same pages");
  assert.notDeepEqual(crawlRoutes(w, 20, 6).map((r) => r.path), a.map((r) => r.path), "another seed gives other pages");
  const paths = a.map((r) => r.path);
  assert.equal(new Set(paths).size, paths.length, "no page twice");
  assert.ok(a.every((r) => r.kind === "page"));
  for (const kind of ["/boxers/", "/bouts/", "/compare?", "/previews/", "/events/", "/people/", "/orgs/", "/titles/", "/rankings/", "/all-time/", "/fight-of-the-year/"]) assert.ok(paths.some((p) => p.startsWith(kind)), `no crawl of ${kind}`);
  // each directory with a parameter is crawled (the list in lib/smoke.ts says which exist)
  for (const dir of DYNAMIC_PAGES) { const head = dir.split("/")[0]; if (head === "forum") continue; /* a thread lives in the accounts database, not in the league: the smoke test samples forum/[id] with its 404, and a real thread was checked in the browser (round 126) */ assert.ok(paths.some((p) => p.startsWith(`/${head}/`) || p.startsWith(`/${head}?`)), `${dir} is not crawled`); }
  const most = [...w.boxers].sort((x, y) => y.bouts - x.bouts || x.id - y.id)[0], fewest = [...w.boxers].sort((x, y) => x.bouts - y.bouts || y.id - x.id)[0];
  assert.ok(paths.includes(`/boxers/${most.slug}`) && paths.includes(`/boxers/${fewest.slug}`), "the fighters with the most and the fewest fights are always crawled");
  const everyone = crawlRoutes(w, 1e9).map((r) => r.path);
  for (const bx of w.boxers) assert.ok(everyone.includes(`/boxers/${bx.slug}`), `${bx.name} is crawled when everyone is asked for`);
  assert.ok(everyone.length > a.length, "asking for more gives more");
  assert.equal(new Set(everyone).size, everyone.length, "no page twice even when every bout is crawled (two bouts between the same pair give one head to head)");
  assert.ok(everyone.some((p) => p.includes("sex=female")), "women's divisions");
});

test("two routes to one page each keep what they ask the page to show: the merged route needs both, and names the one that is missing (round: career strip)", async () => {
  const { problemsIn } = await import("../lib/smoke");
  const route = { path: "/boxers/x", kind: "page" as const, label: "x", mustShow: "24-1-2", alsoShow: ["Fights held by year"] };
  const page = (text: string) => `<html lang="en"><head><title>X · Ringside</title></head><body><main><h1>X</h1><p>${text}</p></main></body></html>`;
  assert.ok(!problemsIn(route, "en", 200, "text/html", page("24-1-2 Fights held by year")).some((p) => /does not show/.test(p)));
  assert.match(problemsIn(route, "en", 200, "text/html", page("24-1-2")).join(), /does not show "Fights held by year"/);
  assert.match(problemsIn(route, "en", 200, "text/html", page("Fights held by year")).join(), /does not show "24-1-2"/);
});

test("the names a real league prints in the supplier's spelling: full names, nicknames, events, venues, cities, broadcasters, and the surnames and first names a short page shows alone (round 108)", async () => {
  const { knownNames } = await import("../lib/smoke");
  // a league made by hand, so that a short part of a name (Al, Lee) and a long one (Rahman, Ruiz) are both there
  const fake = {
    boxers: [{ name: "Al Rahman Lee", nickname: "The Bomb" }, { name: "Jo Ruiz", nickname: null }], bouts: [{ title: "WBC World Welterweight Champion" }],
    events: [{ name: "Fury vs. Joshua (Postponed)", venue: "Copper Box Arena", city: "London", broadcaster: "Amazon Prime PPV" }], people: new Map([[1, { name: "Dr. Kwame Boateng" }]]), official: { byDivision: new Map([["male|heavyweight", [{ champions: [{ name: "Unranked Visitor" }], contenders: [{ name: null }, { name: "Second Visitor" }] }]]]) }, orgs: new Map([[1, { name: "Test Gym" }]]),
  } as unknown as Parameters<typeof knownNames>[0];
  const k = knownNames(fake);
  for (const v of ["al rahman lee", "the bomb", "jo ruiz", "fury vs. joshua (postponed)", "copper box arena", "london", "amazon prime ppv", "wbc world welterweight champion", "dr. kwame boateng", "test gym"]) assert.ok(k.has(v), v);
  for (const part of ["rahman", "ruiz"]) assert.ok(k.has(part), `${part}: a part of four letters or more is a name on its own`);
  for (const part of ["al", "lee", "jo"]) assert.ok(!k.has(part), `${part}: a shorter part could be an English word, so it is not`);
  assert.ok(!k.has(""), "no empty name");
  assert.ok(k.has("unranked visitor") && k.has("second visitor"), "a name only a body's list carries (a ranked fighter who is not in the league) is a name too (round 116)");
  assert.ok(knownNames(w).size > 100, "and from a real world: a good many");
});


test("the mistyped-link check never lands on another fighter's real address, and the brands an official list names are not English leaks (round 116)", async () => {
  const { mistypeTarget, arabicLeaks } = await import("../lib/smoke");
  // fighter-1414 is cut from fighter-14144 and is itself a fighter: the next one down is used
  const best = [{ slug: "fighter-14144" }, { slug: "fighter-1414" }, { slug: "fighter-2" }];
  assert.equal(mistypeTarget(best)?.slug, "fighter-1414", "fighter-14144 is skipped (its cut is a real fighter); fighter-1414 cut is fighter-141, nobody's");
  assert.equal(mistypeTarget([{ slug: "a" }, { slug: "fighter-7" }, { slug: "xy" }])?.slug, "xy", "an empty cut and one that ends in a dash (fighter-) are not mistypes anyone makes");
  assert.equal(mistypeTarget([{ slug: "fighter-7" }]), undefined, "none: no check rather than a poor one");
  const arabic = "هذه ترتيبات الهيئة نفسها، تنقلها Boxing Data API عن BoxingScene. وهي ليست تصنيف رينغسايد.";
  assert.deepEqual(arabicLeaks(`<p>${arabic}</p>`).filter((l) => /Boxing/.test(l)), []);
});
