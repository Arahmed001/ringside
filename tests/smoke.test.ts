import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { tempDb } from "./helpers";
import { NAV_GROUPS } from "../lib/nav";
import { DYNAMIC_PAGES, problemsIn, smokeRoutes, visibleText, type SmokeRoute } from "../lib/smoke";

/**
 * The smoke check (npm run smoke, run in CI against a production server) is only as good as what it inspects and what
 * it covers. These tests pin down both: every slip it looks for is caught, healthy pages pass, and no page kind escapes.
 */
const cleanup = tempDb("smoke");
after(cleanup);

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
