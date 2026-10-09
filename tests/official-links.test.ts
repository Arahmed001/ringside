import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { BODY_PAGES, bodyPage } from "../lib/official-links";

test("each sanctioning body has a plain https link for men's and women's lists, on the body's own site, and the division page links to them without reading anything", () => {
  assert.deepEqual(BODY_PAGES.map((b) => b.body), ["WBC", "WBA", "IBF", "WBO"]);
  const hosts: Record<string, RegExp> = { WBC: /^wbcboxing\.com$/, WBA: /^(www\.)?wbaboxing\.com$/, IBF: /^(www\.)?ibf-usba-boxing\.com$/, WBO: /^wboboxing\.com$/ };
  for (const b of BODY_PAGES) for (const sex of ["male", "female"] as const) {
    const u = new URL(bodyPage(b, sex));
    assert.equal(u.protocol, "https:"); assert.match(u.hostname, hosts[b.body], `${b.body} ${sex}`); assert.ok(!u.username && !u.search, "no credentials, no tracking");
  }
  const page = fs.readFileSync("app/[locale]/rankings/[division]/page.tsx", "utf8");
  assert.match(page, /target="_blank" rel="noopener noreferrer"/); assert.ok(!/fetch\(|official-links.*fetch/.test(page), "the page only links");
  assert.ok(!/title=\{b\.name\}/.test(page), "the body's English name is not put in an attribute on an Arabic page (the smoke check reads it as English left on the page)");
  assert.match(fs.readFileSync("lib/official-links.ts", "utf8"), /docs\/official-bodies\.md/, "the reason is written beside the list");
});
