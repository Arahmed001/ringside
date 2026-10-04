import test from "node:test";
import assert from "node:assert/strict";
import { flippedRecords } from "../lib/smoke";
import { isolateNumeric, makeT } from "../lib/i18n/t";

const page = (body: string) => `<html lang="ar" dir="rtl"><head><title>x</title></head><body>${body}</body></html>`;

test("a record put into an Arabic sentence is isolated, so it reads as written (round 55)", () => {
  const ar = makeT("ar", { "{name} ({record}) is the underdog": "{name} ({record}) هو الأقل ترجيحًا" });
  const s = ar("{name} ({record}) is the underdog", { name: "ديونيسيو لاكسون", record: "5-1-0" });
  assert.ok(s.includes("⁦5-1-0⁩"), "the record sits inside a left-to-right isolate");
  assert.deepEqual(flippedRecords(page(`<p>${s}</p>`)), [], "and the page check accepts it");
  assert.equal(makeT("en")("{name} ({record})", { name: "A", record: "5-1-0" }), "A (5-1-0)", "English is left as it is");
});

test("a record in the other ways a translated sentence is built is isolated too", async () => {
  const ar = makeT("ar", { "{name} ({record}) is the underdog": "{name} ({record}) هو الأقل ترجيحًا" });
  const rich = ar.rich("{name} ({record}) is the underdog", { name: "ديونيسيو", record: "5-1-0" });
  assert.ok(JSON.stringify(rich).includes("\u2066"), "t.rich isolates it");
  const plain = makeT("ar").n(2, "{n} fights ({record})", "{n} fights ({record})", { record: "5-1-0" });
  assert.ok(plain.includes("\u20665-1-0\u2069"), "and so does the plural form when the dictionary has no entry");
});

test("only a run of digits and separators is isolated, only in Arabic", () => {
  assert.equal(isolateNumeric("23-4-1", "ar"), "⁦23-4-1⁩");
  assert.equal(isolateNumeric("2026-07-04", "ar"), "⁦2026-07-04⁩");
  assert.equal(isolateNumeric("23-4-1", "en"), "23-4-1");
  assert.equal(isolateNumeric("1,234", "ar"), "1,234", "a count with a thousands separator is not a record");
  assert.equal(isolateNumeric("ديونيسيو 5-1-0", "ar"), "ديونيسيو 5-1-0", "a name or a sentence is not wrapped");
  assert.equal(isolateNumeric("42", "ar"), "42");
  const n = makeT("ar", { "{n} fighters": "{n} ملاكمين" });
  assert.equal(n.n(1234, "{n} fighter", "{n} fighters"), "1,234 ملاكمين", "plural counts pass through untouched");
});

test("the page check finds a record shown backwards and only that", () => {
  assert.equal(flippedRecords(page("<p>الأقل ترجيحًا: ديونيسيو لاكسون (5-1-0)، بفرصة فوز 40%</p>")).length, 1, "after Arabic words in one run of text");
  assert.equal(flippedRecords(page('<div>🇺🇸<!-- --> <!-- -->الولايات المتحدة<!-- --> · <!-- -->20-4-1<!-- --> · 10</div>')).length, 1, "across comments and symbols");
  assert.equal(flippedRecords(page("<p>ضد <span>لوكاس</span> (25-4-0)</p>")).length, 1, "across an inline element");
  assert.equal(flippedRecords(page('<p>ضد لوكاس (<bdi dir="ltr">25-4-0</bdi>)</p>')).length, 0, "<bdi dir=ltr> is the cure");
  assert.equal(flippedRecords(page('<p>ضد لوكاس <span dir="ltr">25-4-0</span></p>')).length, 0, "dir=ltr is too");
  assert.equal(flippedRecords(page('<p>ضد لوكاس <span class="ltr-fixed">25-4-0</span></p>')).length, 0, "and the ltr-fixed class");
  assert.equal(flippedRecords(page("<tr><td>سيغون بالوغون </td><td> 20-4-1</td></tr>")).length, 0, "a table's cells are separate blocks");
  assert.equal(flippedRecords(page("<p>عرض 1-48</p>")).length, 0, "two numbers are a range, not a record");
  assert.equal(flippedRecords(page("<p>ضد لوكاس (<bdi>25-4-0</bdi>)</p>")).length, 0, "a bare <bdi> isolates too");
  assert.equal(flippedRecords(page("<td>20-4-1</td>")).length, 0, "a record on its own in a cell reads correctly");
  assert.equal(flippedRecords(page("<p>25-4-0 · 1617</p>")).length, 0, "no Arabic letter before it");
  assert.equal(flippedRecords(page("<div><span>سيغون بالوغون</span><span>17-2-0</span></div>")).length, 0, "two boxes of a row, nothing between them in the text");
  assert.equal(flippedRecords(page("<p>عرض 1–48</p>")).length, 0, "a range is not a record");
  assert.equal(flippedRecords(page("<p>الإجمالي</p><p>23-4-1</p>")).length, 0, "another block");
  assert.equal(flippedRecords(page('<p lang="en">Larkin (23-4-1)</p>')).length, 0, "text marked English");
});

test("a signed number in Arabic text keeps its sign in front of the digits (round 70)", async () => {
  assert.equal(flippedRecords(page("<p>إعادة الترطيب +12.5 رطل</p>")).length, 1, "after Arabic words the sign is drawn after the digits");
  assert.equal(flippedRecords(page("<p>إعادة الترطيب ‎+12.5 رطل</p>")).length, 0, "a left-to-right mark in front of the sign is the cure");
  assert.equal(flippedRecords(page('<p>إعادة الترطيب <bdi dir="ltr">+12.5</bdi> رطل</p>')).length, 0);
  assert.equal(flippedRecords(page("<p>تغير التصنيف −3 نقاط</p>")).length, 1, "a minus sign too");
  assert.equal(isolateNumeric("+12.5", "ar"), "⁦+12.5⁩", "a signed number put into an Arabic sentence is isolated");
  assert.equal(isolateNumeric("−3", "ar"), "⁦−3⁩");
  assert.equal(isolateNumeric("12.5", "ar"), "12.5", "a plain number is not");
  assert.equal(isolateNumeric("+12.5", "en"), "+12.5");
  const ar = JSON.parse((await import("node:fs")).readFileSync("i18n/ar.json", "utf8")) as Record<string, string>;
  const bad = Object.entries(ar).filter(([, v]) => typeof v === "string" && /[؀-ۿ][^\d]*?[\s(][+−]\d/.test(v)).map(([k]) => k.slice(0, 50));
  assert.deepEqual(bad, [], "no Arabic string has a bare sign in front of a number");
});

test("'20+' in Arabic text keeps its plus after the digits (round 71)", async () => {
  assert.equal(flippedRecords(page("<p>أخف بـ 8+ رطل</p>")).length, 1, "after Arabic words a plus after the digits is drawn before them: '+8'");
  assert.equal(flippedRecords(page("<p>أخف بـ ⁦8+⁩ رطل</p>")).length, 0, "an isolate is the cure");
  assert.equal(flippedRecords(page('<p>أخف بـ <bdi dir="ltr">8+</bdi> رطل</p>')).length, 0);
  assert.equal(flippedRecords(page("<p>سجل 8 فوز</p>")).length, 0, "a number with no plus is fine");
  const ar = JSON.parse((await import("node:fs")).readFileSync("i18n/ar.json", "utf8")) as Record<string, string>;
  const bad = Object.entries(ar).filter(([, v]) => typeof v === "string" && /[؀-ۿ][^\d⁦]*?[\s(](\d[\d.,]*|\{\w+\})\+(?=[\s)،.]|$)/.test(v)).map(([k]) => k.slice(0, 40));
  assert.deepEqual(bad, [], "no Arabic string has '{n}+' or '8+' unisolated after Arabic words");
});
