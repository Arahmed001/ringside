import test from "node:test";
import assert from "node:assert/strict";
import { arabicLeaks, withoutEnglishIslands } from "../lib/smoke";

const page = (body: string, head = "<title>تصنيفات الملاكمين · Ringside</title>") => `<html lang="ar" dir="rtl"><head>${head}</head><body>${body}</body></html>`;

test("English left on an Arabic page is found, one block of text at a time", () => {
  assert.deepEqual(arabicLeaks(page("<h1>التصنيفات</h1><p>Longest title reigns</p>")), ['text: "Longest title reigns"']);
  assert.deepEqual(arabicLeaks(page("<p>تم التحميل: 968 boxers · 618 events</p>")).length, 1, "English words among digits and Arabic are still English");
  assert.deepEqual(arabicLeaks(page("<button>Try again</button><button>حاول مرة أخرى</button>")), ['text: "Try again"']);
  assert.equal(arabicLeaks(page("<p>Go</p>")).length, 0, "words of one or two letters are not flagged");
  assert.deepEqual(arabicLeaks(page("<p>Hello</p>")), ['text: "Hello"'], "a single English word counts");
});

test("attributes a screen reader announces are checked, in the title and description too", () => {
  assert.deepEqual(arabicLeaks(page('<a href="/x" aria-label="Open the menu">ق</a>')), ['aria-label: "Open the menu"']);
  assert.deepEqual(arabicLeaks(page('<input placeholder="Search fighters"><img alt="Portrait of someone" src="/x.svg">')).sort(), ['alt: "Portrait of someone"', 'placeholder: "Search fighters"']);
  assert.deepEqual(arabicLeaks(page('<a title="القائمة" aria-label="القائمة">ق</a>')), []);
  assert.deepEqual(arabicLeaks(page("<h1>ع</h1>", "<title>Rankings</title>")), ['head: "Rankings"']);
  assert.deepEqual(arabicLeaks(page("<h1>ع</h1>", '<title>ع</title><meta name="description" content="Every fighter, every number">')), ['head: "Every fighter, every number"']);
});

test("what is allowed: the brand, units and abbreviations, other organisations' names, scripts and styles, and anything marked lang=\"en\"", () => {
  assert.deepEqual(arabicLeaks(page("<p>رينغسايد · Ringside · Elo 1650 · 12 lb · KO · TKO · PPV</p>")), [], "lb is two letters, KO and PPV are short capitals, Ringside and Elo are listed");
  assert.deepEqual(arabicLeaks(page("<p>log-loss · 68.0% صحيح · Brier 0.213</p>")), [], "the two statistics terms the Data page keeps in Latin");
  assert.equal(arabicLeaks(page("<p>log-loss · 68.0% صحيح · Brier score is poor</p>")).length, 1, "only the terms are allowed, not the English around them");
  assert.deepEqual(arabicLeaks(page("<p>معرّف BoxRec وكذلك Wikidata و CompuBox</p>")), []);
  assert.deepEqual(arabicLeaks(page("<p>ويُعلَّم بأنه آمن حين يُقدَّم الموقع عبر https أو http</p>")), [], "a protocol name is written as it is in Arabic prose");
  assert.equal(arabicLeaks(page("<p>عبر https secure connection</p>")).length, 1, "but not the English around it");
  assert.deepEqual(arabicLeaks(page("<script>window.x = 'This is a long English sentence';</script><style>.a{content:'Some English words'}</style><p>نص</p>")), []);
  assert.deepEqual(arabicLeaks(page('<p>مثال: <span lang="en" dir="ltr">earning rows have no source URL</span></p>')), [], "text marked as English on purpose is not a leak");
  assert.deepEqual(arabicLeaks(page('<a href="/" aria-label="Ringside"><span lang="en">Ring<span>side</span></span></a>')), [], "a marked island with a nested element of the same name");
  assert.deepEqual(arabicLeaks(page('<a lang="en" href="/x" aria-label="Open the English menu">x</a><span lang="en"><img alt="A portrait in English" src="/p.svg"></span>')), [], "an English element's own attributes, and those of what is inside it, are English on purpose");
  assert.deepEqual(arabicLeaks(page("<p>English</p>")), [], "the language switch names the other language in itself");
  assert.deepEqual(arabicLeaks(page('<p>Demo earnings list (simulated)</p><a title="Demo earnings list (simulated)">ع</a>')), [], "the demo provider's own source label");
});

test("the same word is not forgiven when it sits next to unmarked English", () => {
  assert.equal(arabicLeaks(page('<p><span lang="en">fine</span> but this is not</p>')).length, 1);
  assert.equal(arabicLeaks(page('<p lang="ar">Not marked English at all</p>')).length, 1, "only lang=en islands are skipped");
});

test("English islands are removed whole: nested, repeated, self-closing and unclosed", () => {
  assert.equal(withoutEnglishIslands('<p>a<span lang="en">x<span>y</span>z</span>b</p>').replace(/\s+/g, ""), "<p>ab</p>");
  assert.equal(withoutEnglishIslands('<i lang="en">1</i><i lang="en">2</i><i>3</i>').replace(/\s+/g, ""), "<i>3</i>");
  assert.equal(withoutEnglishIslands('<p>keep<img lang="en" alt="x"/>keep</p>').includes("keep"), true);
  assert.equal(withoutEnglishIslands('<p>a<span lang="en">never closed</p>').includes("never closed"), false, "an unclosed island takes the rest with it rather than leaking");
  assert.equal(withoutEnglishIslands("<p>no islands</p>"), "<p>no islands</p>");
});
