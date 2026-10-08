import { DatabaseSync } from "node:sqlite";
import { NAV_GROUPS, OFF_NAV } from "../../lib/nav";
import { ALL4, TWO, check, eq, type Flow } from "../harness";
import { describeFocus } from "../keys";

/** One of each kind of page that has an id in its address (the same samples the accessibility sweep uses). */
function samples(mainDb: string): string[] {
  const d = new DatabaseSync(mainDb, { readOnly: true });
  const one = (sql: string) => d.prepare(sql).get() as Record<string, string | number> | undefined;
  const slug = one("SELECT slug FROM boxers ORDER BY rating DESC LIMIT 1")?.slug;
  const other = one("SELECT slug FROM boxers ORDER BY rating DESC LIMIT 1 OFFSET 1")?.slug;
  const ev = one("SELECT id FROM events WHERE date <= '2026-10-03' ORDER BY date DESC LIMIT 1")?.id;
  const bout = one("SELECT id FROM bouts WHERE method IS NOT NULL ORDER BY id DESC LIMIT 1")?.id;
  const up = one("SELECT b.id FROM bouts b JOIN events e ON e.id = b.event_id WHERE e.date > '2026-10-03' AND b.method IS NULL ORDER BY e.date LIMIT 1")?.id;
  d.close();
  return [`/boxers/${slug}`, `/events/${ev}`, `/bouts/${bout}`, ...(up ? [`/previews/${up}`] : []), `/compare?a=${slug}&b=${other}`, "/forum", "/forum/rules"];
}

export const pages: Flow[] = [
  {
    // every page: exactly one rendered h1, a skip link as the first stop that really moves focus to <main>, a title, the right language and direction, nothing in the console
    name: "every page has one h1 and a skip link", variants: TWO,
    async run(h, v) {
      const ctx = await h.context(), page = await h.page(ctx);
      const paths = [...new Set(["/", ...NAV_GROUPS.flatMap((g) => g.items.map((i) => i.href)), ...OFF_NAV, ...samples(h.server.mainDb)])];
      for (const p of paths) {
        const res = await h.open(page, p);
        check(res && res.status() < 400, `${p}: HTTP ${res?.status()}`);
        const info = await page.evaluate(() => ({
          h1: [...document.querySelectorAll("h1")].filter((e) => e.getClientRects().length > 0).map((e) => e.textContent?.trim()),
          lang: document.documentElement.lang, dir: document.documentElement.dir, title: document.title.trim(), main: !!document.querySelector("main#main"),
          skip: document.querySelector("a[href='#main']")?.textContent?.trim() ?? null,
        }));
        eq(info.h1.length, 1, `${p} (${v.lang}): the number of visible h1 headings (${info.h1.join(" | ")})`);
        eq([info.lang, info.dir], [v.lang, v.lang === "ar" ? "rtl" : "ltr"], `${p}: language and direction`);
        check(info.title.length > 3 && info.main && info.skip, `${p}: title "${info.title}", main ${info.main}, skip link "${info.skip}"`);
        // nothing that is built in the browser after the page opens may print a broken value either (the server's pages are checked by the smoke run; the watchlist once said Invalid Date)
        await page.waitForLoadState("networkidle");
        const text = await page.locator("body").innerText();
        const broken = text.match(/Invalid Date|\bNaN\b|\bundefined\b|\[object Object\]|\{[a-z]+\}/);
        check(!broken, `${p} (${v.lang}): the page says "${broken?.[0]}"`);
        // the skip link is the first thing Tab reaches, and following it puts focus in <main>
        await page.keyboard.press("Tab");
        let first = await describeFocus(page);
        check(first?.href === "#main", `${p}: the first Tab stop is ${first?.desc}, not the skip link`);
        await page.waitForFunction(() => { const r = document.activeElement?.getBoundingClientRect(); return !!r && r.top >= 0 && r.bottom > 0; }); // it slides in when it takes focus
        first = await describeFocus(page);
        check(first!.inViewport && first!.ring, `${p}: the skip link is not visible when focused`);
        await page.keyboard.press("Enter");
        await page.waitForFunction(() => document.activeElement?.id === "main" || !!document.getElementById("main")?.contains(document.activeElement));
        await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
      }
    },
  },
  {
    name: "404 page with suggestions", variants: ALL4,
    async run(h, v) {
      const ctx = await h.context(), page = await h.page(ctx);
      h.allow(/\/(boxers|nothing-here)\//, 404);
      const fighter = h.fighter(2);
      const typo = fighter.slug.slice(0, -1) + (fighter.slug.endsWith("z") ? "y" : "z"); // a slip in the last letter of a real fighter's address
      const res = await h.open(page, `/boxers/${typo}`);
      eq(res?.status(), 404, "a wrong fighter address answers 404");
      eq(await page.locator("h1:visible").count(), 1, "one h1 on the 404 page");
      eq((await page.locator("h1").first().textContent()).trim(), h.tr("Not on the card"), "the 404 heading is in the page's language");
      // "did you mean": the real fighter is offered as a link
      const suggestion = page.locator(`main a[href$="/boxers/${fighter.slug}"]`).first();
      await suggestion.waitFor();
      const robots = await page.locator('meta[name="robots"]').evaluateAll((els: Element[]) => els.map((e) => e.getAttribute("content")));
      check(robots.length > 0 && robots.every((r: string) => /noindex/.test(r)), `404 page robots: ${robots.join(" | ")}`);
      // the search box on it works (and keeps the guess)
      const box = page.locator('main form input[name="q"]');
      check((await box.inputValue()).length > 2, "the 404 search box is filled with the guess");
      await box.fill(fighter.name.split(" ")[0]);
      await box.press("Enter");
      await page.waitForURL(/\/boxers\?q=/);
      check(await page.locator('main a[href*="/boxers/"]').first().isVisible(), "searching from the 404 page lists fighters");
      // an address that looks like nothing: still a proper 404, no suggestions, the way home
      const res2 = await h.open(page, "/nothing-here/at-all");
      eq(res2?.status(), 404, "an unknown page answers 404");
      eq(await page.locator("main h2").count(), 0, "no suggestions for an address that names nobody");
      await h.click(page.locator("main a", { hasText: h.tr("Back to the ring") }));
      await page.waitForURL(v.lang === "ar" ? /\/ar\/?$/ : /\/$/);
    },
  },
  {
    name: "language switch keeps the page", variants: ALL4,
    async run(h, v) {
      const ctx = await h.context(), page = await h.page(ctx);
      const f = h.fighter(1);
      const start = `/boxers?wc=Heavyweight&sort=wins`;
      for (const p of [start, `/boxers/${f.slug}`, "/rankings?sex=female"]) {
        await h.open(page, p);
        const sw = page.locator("header a[hreflang]");
        await sw.waitFor();
        const target = v.lang === "en" ? "ar" : "en";
        await h.click(sw);
        await page.waitForURL((u: URL) => u.pathname === h.path(p.split("?")[0], target) || (target === "ar" ? u.pathname === `/ar${p.split("?")[0]}` : false));
        await page.waitForFunction((lang: string) => document.documentElement.lang === lang, target);
        const u = new URL(page.url());
        eq(u.pathname + u.search, h.path(p.split("?")[0], target) + (p.includes("?") ? "?" + p.split("?")[1] : ""), "the other language's address of the same page, filters kept");
        eq(await page.evaluate(() => document.documentElement.dir), target === "ar" ? "rtl" : "ltr", "direction follows the language");
        // and back
        await h.click(page.locator("header a[hreflang]"));
        await page.waitForFunction((lang: string) => document.documentElement.lang === lang, v.lang);
        const b = new URL(page.url());
        eq(b.pathname + b.search, h.path(p.split("?")[0], v.lang) + (p.includes("?") ? "?" + p.split("?")[1] : ""), "back to the first language, same page");
      }
    },
  },
];
