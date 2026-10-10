import test from "node:test";
import assert from "node:assert/strict";
import { classify, extractAnchors, isAsset, isNamedPage, localeProblem, looksLikeControl, looksLikeName, nameMismatch, pageInfo, routePattern, sharesWord } from "../lib/link-check";

const BASE = "https://site.test";

test("anchors: text, picture alt text, label, and what is hidden on purpose", () => {
  const a = extractAnchors(`<a href="/boxers/x" class="c">Jo <b>Bloggs</b></a><a href="/e" aria-label="Events"><svg></svg></a><a href="/t" title="A reign bar"></a><a tabindex="-1" aria-hidden="true" href="/boxers/y"><circle/></a><a href="/p"><img alt="Poster" src="/p.png"></a><a name="x">no href</a>`);
  assert.deepEqual(a.map((x) => [x.href, x.text, x.label, x.hidden]), [["/boxers/x", "Jo Bloggs", "", false], ["/e", "", "Events", false], ["/t", "", "A reign bar", false], ["/boxers/y", "", "", true], ["/p", "Poster", "", false]]);
});

test("page info: title, first heading, and the ids a #section link can land on", () => {
  const p = pageInfo(`<title>Rankings · Ringside</title><h1 class="a">Current <span>rankings</span></h1><section id="top"></section><a name="old"></a>`);
  assert.equal(p.title, "Rankings · Ringside");
  assert.equal(p.h1, "Current rankings");
  assert.ok(p.ids.has("top") && p.ids.has("old") && !p.ids.has("nope"));
});

test("classify: ours, outside, or not a page at all", () => {
  assert.deepEqual(classify("/boxers?sex=male#top", BASE, "/"), { kind: "internal", path: "/boxers?sex=male", frag: "top" });
  assert.deepEqual(classify("https://site.test/ar/events", BASE, "/"), { kind: "internal", path: "/ar/events", frag: "" });
  assert.deepEqual(classify("#pick-em", BASE, "/rankings"), { kind: "internal", path: "/rankings", frag: "pick-em" });
  assert.deepEqual(classify("detail", BASE, "/events/"), { kind: "internal", path: "/events/detail", frag: "" });
  assert.equal(classify("https://www.wbcboxing.com/", BASE, "/").kind, "external");
  for (const h of ["mailto:a@b.c", "tel:1", "javascript:void(0)", ""]) assert.equal(classify(h, BASE, "/").kind, "skip");
});

test("assets and service routes are not pages; route patterns group the pages of one kind in both languages", () => {
  assert.ok(isAsset("/_next/static/x.js") && isAsset("/api/health") && isAsset("/feeds/upset-watch.xml") && isAsset("/og.png?v=1"));
  assert.ok(!isAsset("/boxers/x") && !isAsset("/ar/events/12"));
  assert.equal(routePattern("/boxers/some-name?x=1"), "boxers/*");
  assert.equal(routePattern("/ar/boxers/another"), "boxers/*");
  assert.equal(routePattern("/"), "/");
  assert.equal(routePattern("/ar"), "/");
  assert.equal(routePattern("/rankings"), "rankings");
});

test("language: a page links to its own language; only the switch may cross", () => {
  assert.equal(localeProblem("/boxers", "/events", "Events"), null);
  assert.equal(localeProblem("/ar/boxers", "/ar/events", "الفعاليات"), null);
  assert.match(localeProblem("/ar/boxers", "/events", "Events")!, /ar page links to a en page/);
  assert.match(localeProblem("/boxers", "/ar/privacy", "الخصوصية")!, /en page links to a ar page/);
  assert.equal(localeProblem("/ar/boxers", "/boxers", "English"), null);
  assert.equal(localeProblem("/boxers", "/ar/boxers", "العربية"), null);
  assert.equal(localeProblem("/ar/upset-watch", "/feeds/upset-watch.xml?lang=ar", "تابع"), null, "a feed is not a page in a language");
});

test("review hint: a link's words and the page's heading", () => {
  assert.ok(sharesWord("Fight previews", "Fight previews · Ringside"));
  assert.ok(sharesWord("Rankings", "Current rankings"));
  assert.ok(sharesWord("Titles", "Title lineages") && sharesWord("Countries", "Boxing by country"), "plural and singular match");
  assert.ok(sharesWord("→", "Anything"), "no words, nothing to compare");
  assert.ok(!sharesWord("Call the card", "Morishita vs Hartmann"));
  assert.ok(looksLikeControl("/boxers", "/boxers?sex=male") && !looksLikeControl("/", "/boxers"));
});

test("a name must open the page of that name", () => {
  assert.ok(isNamedPage("/boxers/jo-bloggs") && isNamedPage("/ar/people/x") && isNamedPage("/orgs/blueprint-boxing"));
  assert.ok(!isNamedPage("/boxers") && !isNamedPage("/boxers/x/compare") && !isNamedPage("/events/12"));
  assert.ok(looksLikeName("Andriy P. Moroz") && looksLikeName("Tomás Villalba"));
  for (const t of ["Draw", "27-2-1 +214 Elo", "Full bout details →", "Jul 12, 2025 , TKO R12", "One two three four five six seven"]) assert.ok(!looksLikeName(t), t);
  assert.equal(nameMismatch("Tomás Villalba", "Tomas Villalba · Ringside"), false, "accents and case do not matter");
  assert.equal(nameMismatch("Villalba", "Tomás Villalba"), false, "a single word is not a name to check");
  assert.equal(nameMismatch("Jo Bloggs", "Jo Smith · Ringside"), false, "one shared word is enough");
  assert.equal(nameMismatch("Rakan Al-Qahtani", "Tomás Villalba · Ringside"), true, "a different fighter's page");
  assert.equal(nameMismatch("ريوتا موريشيتا", "ريوتا موريشيتا · Ringside"), false);
});
