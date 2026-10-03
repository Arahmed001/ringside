import test from "node:test";
import assert from "node:assert/strict";
import { countryCode, countryName, flag } from "../lib/format";

/**
 * Real fighters come from everywhere. The flag and the Arabic country name used to work for about 80 hand-listed countries
 * (and the flag for ten); they now work for any country by name, through the platform's own region names plus a short alias list.
 */
const emoji = (code: string) => String.fromCodePoint(...[...code].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

test("the flags that worked before still do, exactly", () => {
  const before: Record<string, string> = { "United States": "🇺🇸", Mexico: "🇲🇽", "United Kingdom": "🇬🇧", Japan: "🇯🇵", Ukraine: "🇺🇦", Philippines: "🇵🇭", Nigeria: "🇳🇬", Argentina: "🇦🇷", "Saudi Arabia": "🇸🇦", Germany: "🇩🇪" };
  for (const [name, f] of Object.entries(before)) assert.equal(flag(name), f, name);
});

test("any country by name has a flag: the ones the feed sent on the first real sample, and the awkward spellings", () => {
  assert.equal(flag("Denmark"), "🇩🇰");
  for (const [name, code] of Object.entries({
    Canada: "CA", Russia: "RU", Cuba: "CU", Kazakhstan: "KZ", "New Zealand": "NZ", Türkiye: "TR", Turkey: "TR", "Czech Republic": "CZ", Czechia: "CZ",
    "Côte d’Ivoire": "CI", "Ivory Coast": "CI", USA: "US", "United States of America": "US", UK: "GB", "Great Britain": "GB", "Northern Ireland": "GB", "Republic of Ireland": "IE",
    "South Korea": "KR", "North Korea": "KP", Vietnam: "VN", "Viet Nam": "VN", Myanmar: "MM", Burma: "MM", "Bosnia and Herzegovina": "BA", "Bosnia & Herzegovina": "BA",
    "Trinidad and Tobago": "TT", "Trinidad & Tobago": "TT", "Cape Verde": "CV", "Hong Kong": "HK", "Puerto Rico": "PR", Kosovo: "XK", "The Netherlands": "NL", Holland: "NL",
  })) assert.equal(flag(name), emoji(code), name);
  assert.equal(countryCode("Congo"), "CG"); assert.equal(countryCode("DR Congo"), "CD"); assert.notEqual(countryCode("Congo"), countryCode("DR Congo"), "the two Congos stay apart");
});

test("case, accents, spacing and ISO codes do not matter", () => {
  for (const v of ["denmark", "  DENMARK ", "dk", "DK"]) assert.equal(flag(v), "🇩🇰", JSON.stringify(v));
  assert.equal(flag("Türkiye"), flag("Turkiye"), "accents");
  assert.equal(flag("Côte d’Ivoire"), flag("Cote d'Ivoire"), "curly and straight apostrophes, and a missing accent");
  assert.equal(flag("Côte d’Ivoire"), "🇨🇮");
});

test("England, Scotland and Wales have their own flag; Northern Ireland uses the UK's; names that are not countries get the white flag", () => {
  const tag = (s: string) => String.fromCodePoint(0x1f3f4, ...[...s].map((c) => 0xe0000 + c.charCodeAt(0)), 0xe007f);
  assert.equal(flag("England"), tag("gbeng")); assert.equal(flag("Scotland"), tag("gbsct")); assert.equal(flag("Wales"), tag("gbwls"));
  assert.equal(flag("Northern Ireland"), "🇬🇧");
  for (const v of ["Atlantis", "Unknown", "", "Quebec", "ZZ", "XX"]) assert.equal(flag(v), "🏳️", JSON.stringify(v));
});

test("round trip over every region the platform names: each name finds its own code (two names that normalise alike would collide here)", () => {
  const dn = new Intl.DisplayNames(["en"], { type: "region" });
  let checked = 0;
  for (let a = 65; a <= 90; a++) for (let b = 65; b <= 90; b++) {
    const code = String.fromCharCode(a, b), name = dn.of(code);
    if (!name || name === code || name === "Unknown Region") continue;
    const found = countryCode(name);
    assert.ok(found, `${name} (${code}) should resolve`);
    assert.equal(dn.of(found!), name, `${name} resolved to ${found}, which is a different country`); // a retired code that shares a name (AN and CW are both "Curaçao") may resolve to the current one
    checked++;
  }
  assert.ok(checked > 240, `${checked} regions checked`);
});

test("Arabic country names work for any country, and unknown names still pass through", () => {
  assert.equal(countryName("Saudi Arabia", "ar"), "المملكة العربية السعودية");
  assert.equal(countryName("Denmark", "ar"), new Intl.DisplayNames(["ar"], { type: "region" }).of("DK"));
  assert.notEqual(countryName("Denmark", "ar"), "Denmark");
  assert.equal(countryName("Turkey", "ar"), new Intl.DisplayNames(["ar"], { type: "region" }).of("TR"));
  assert.equal(countryName("Atlantis", "ar"), "Atlantis"); assert.equal(countryName("England", "ar"), "England", "no region code: unchanged");
  assert.equal(countryName("Denmark", "en"), "Denmark", "English is the name as written");
});
