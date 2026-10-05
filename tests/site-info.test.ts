import test from "node:test";
import assert from "node:assert/strict";
import { httpsUrl, siteContact, vendorCredit } from "../lib/site-info";

/**
 * What a public site owes its readers once it shows real data: a way to report a mistake without an account, and the data supplier's credit. Both come from
 * settings, are checked before they are shown to every visitor, and have no default, so nothing personal is ever written into the code.
 */
test("the contact is an email address or an https page, published as written; anything else, and nothing at all, shows no contact", () => {
  assert.deepEqual(siteContact({ SITE_CONTACT: "corrections@ringside.example" }), { label: "corrections@ringside.example", href: "mailto:corrections@ringside.example" });
  assert.deepEqual(siteContact({ SITE_CONTACT: "  corrections@ringside.example  " }), { label: "corrections@ringside.example", href: "mailto:corrections@ringside.example" }, "surrounding spaces are not part of it");
  assert.deepEqual(siteContact({ SITE_CONTACT: "https://ringside.example/contact/" }), { label: "ringside.example/contact", href: "https://ringside.example/contact/" });
  assert.equal(siteContact({}), null, "no default: unset is no contact");
  assert.equal(siteContact({ SITE_CONTACT: "" }), null);
  for (const bad of ["call me", "http://ringside.example/contact", "javascript:alert(1)", "data:text/html,x", "a b@c.d", "x@y", "<a@b.cd>", "a@b.cd, e@f.gh", "mailto:a@b.cd", "https://user:pw@ringside.example/", "//ringside.example"]) assert.equal(siteContact({ SITE_CONTACT: bad }), null, bad);
});

test("an https address is kept, anything else (plain http, another scheme, credentials in the address, not a URL) is not", () => {
  assert.equal(httpsUrl("https://boxing-data.com/terms"), "https://boxing-data.com/terms");
  assert.equal(httpsUrl(" https://boxing-data.com/terms "), "https://boxing-data.com/terms");
  for (const bad of [undefined, "", "boxing-data.com/terms", "http://boxing-data.com/terms", "ftp://x.example/", "javascript:alert(1)", "https://u:p@boxing-data.com/", "not a url"]) assert.equal(httpsUrl(bad), null, String(bad));
});

test("the vendor is credited only when a real feed is configured, and the terms are linked only when a safe address is given", () => {
  assert.equal(vendorCredit({}), null, "the demo league has no supplier");
  assert.equal(vendorCredit({ BOXING_PROVIDER: "demo" }), null);
  assert.equal(vendorCredit({ BOXING_PROVIDER: "file" }), null, "a file feed is not the vendor's");
  assert.deepEqual(vendorCredit({ BOXING_PROVIDER: "licensed" }), { name: "Boxing Data API", url: "https://boxing-data.com", termsUrl: null });
  assert.equal(vendorCredit({ BOXING_PROVIDER: "licensed", VENDOR_TERMS_URL: "https://boxing-data.com/terms" })!.termsUrl, "https://boxing-data.com/terms");
  assert.equal(vendorCredit({ BOXING_PROVIDER: "licensed", VENDOR_TERMS_URL: "javascript:alert(1)" })!.termsUrl, null);
  assert.equal(vendorCredit({ BOXING_PROVIDER: "licensed", VENDOR_TERMS_URL: "http://boxing-data.com/terms" })!.termsUrl, null);
});

test("the vendor is credited on every page, in the footer, whenever a real feed is configured (round 92)", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const layout = fs.readFileSync(path.resolve(__dirname, "..", "app/[locale]/layout.tsx"), "utf8");
  const footer = layout.slice(layout.indexOf("<footer"), layout.indexOf("</footer>"));
  assert.match(footer, /vendorCredit\(\)/, "the footer asks for the credit (null for the demo league, so the demo footer is unchanged)");
  assert.match(footer, /Fight, fighter and event data: <a>\{name\}<\/a>\./, "with the same sentence the Data page uses, so it is translated once");
  assert.match(footer, /rel="noopener noreferrer"/);
});
