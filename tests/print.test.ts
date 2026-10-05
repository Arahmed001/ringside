import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("printing hides the menus and switches to white paper, and the screen theme is untouched", () => {
  const css = read("app/globals.css");
  const print = css.slice(css.indexOf("@media print"));
  assert.match(print, /\.no-print[^{]*\{\s*display:\s*none\s*!important/);
  assert.match(print, /--bg:\s*#fff/);
  assert.match(css.slice(0, css.indexOf("@media print")), /--bg:\s*#09090b/, "the dark screen palette stays");
  const layout = read("app/[locale]/layout.tsx");
  assert.match(layout, /<header className="no-print /);
  assert.match(layout, /className="rail /, "the side menu is the .rail the print rule hides");
});

test("the fighter and bout pages carry the print button", () => {
  for (const p of ["app/[locale]/boxers/[slug]/page.tsx", "app/[locale]/bouts/[id]/page.tsx"]) assert.match(read(p), /<PrintButton \/>/, p);
});
