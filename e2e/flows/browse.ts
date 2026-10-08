/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright's types are not available here, see harness.ts */
import { getTFor } from "../../lib/i18n/dicts";
import { ALL4, TWO, check, eq, escapeRe, type Flow, type Harness } from "../harness";

const dialogOf = (h: Harness, page: any) => page.locator(`[role=dialog][aria-label="${h.tr("Search everything")}"]`);

/** Opens the palette with its shortcut and waits until the box has focus. */
async function openPalette(h: Harness, page: any) {
  await page.keyboard.press("Control+k");
  const d = dialogOf(h, page);
  await d.waitFor();
  await page.waitForFunction(() => document.activeElement?.getAttribute("role") === "combobox");
  return d;
}
/** Types into the palette and waits until the answer for exactly those words has arrived (the "Searching…" line is gone and options are listed or "nothing matches"). */
async function ask(h: Harness, page: any, d: any, text: string) {
  const box = d.getByRole("combobox");
  await box.fill(text);
  await d.locator("[role=status]").filter({ hasText: /\S/ }).first().waitFor();
  await page.waitForFunction(() => !document.querySelector("[role=dialog] p.text-center")?.textContent?.includes("…") || !!document.querySelector("[role=dialog] [role=option]"));
}
const optionFor = (d: any, name: string) => d.locator("[role=option]", { hasText: name }).first();

/** Moves the highlight with ArrowDown until it is on `option`, then presses Enter: the way someone without a mouse chooses. */
async function chooseByKeyboard(page: any, d: any, option: any) {
  const id = await option.getAttribute("id");
  const box = d.getByRole("combobox");
  for (let i = 0; i < 12; i++) {
    if ((await box.getAttribute("aria-activedescendant")) === id) break;
    await box.press("ArrowDown");
  }
  eq(await box.getAttribute("aria-activedescendant"), id, "the highlight reached the option");
  await box.press("Enter");
}

export const browse: Flow[] = [
  {
    name: "search palette finds a fighter and goes there", variants: ALL4,
    async run(h, v) {
      const f = h.fighter(0), g = h.fighter(2);
      const arT = await getTFor("ar");
      const ctx = await h.context(), page = await h.page(ctx);
      await h.open(page, "/");
      const target = (slug: string) => new RegExp(`${escapeRe(h.path(`/boxers/${slug}`))}$`);

      // an exact name, chosen with the keyboard
      let d = await openPalette(h, page);
      eq(await d.locator("[role=option]").count(), 4, "four quick links before anything is typed");
      await ask(h, page, d, f.name);
      await optionFor(d, h.name(f.name)).waitFor();
      await chooseByKeyboard(page, d, optionFor(d, h.name(f.name)));
      await page.waitForURL(target(f.slug));
      await h.ready(page);
      await dialogOf(h, page).waitFor({ state: "detached" });
      eq(await page.locator("h1").first().textContent().then((x: string) => x.trim().toLowerCase()), h.name(f.name).trim().toLowerCase(), "the fighter's page opened");

      // a query in the page's own script: the Arabic spelling finds the fighter on the Arabic site (the English site matches English names, by design), and a last name alone does on both
      await h.open(page, "/");
      d = await openPalette(h, page);
      await ask(h, page, d, v.lang === "ar" ? arT.name(g.name) : g.name.split(" ").slice(1).join(" ").toLowerCase());
      await optionFor(d, h.name(g.name)).waitFor();
      await optionFor(d, h.name(g.name)).click();
      await page.waitForURL(target(g.slug));

      // a typo: a letter changed in the last name still finds the fighter
      const [first, last] = [f.name.split(" ")[0], f.name.split(" ").slice(1).join(" ")];
      const slip = `${first} ${last.slice(0, -1)}${last.endsWith("z") ? "y" : "z"}`;
      await h.open(page, "/");
      d = await openPalette(h, page);
      await ask(h, page, d, slip);
      await optionFor(d, h.name(f.name)).waitFor();
      await page.keyboard.press("Enter"); // the best match is highlighted first
      await page.waitForURL(target(f.slug));

      // words that match nothing say so, in the language of the page
      await h.open(page, "/");
      d = await openPalette(h, page);
      await ask(h, page, d, "qqzzxxjj");
      await d.getByText(h.tr("Nothing matches that.")).first().waitFor();
      eq(await d.locator("[role=option]").count(), 0, "no options for nonsense");
      // a page, not a person: "Rankings" goes to the rankings
      await ask(h, page, d, v.lang === "ar" ? h.tr("Rankings") : "Rankings");
      await optionFor(d, h.tr("Rankings")).waitFor();
      await page.keyboard.press("Enter");
      await page.waitForURL(new RegExp(`${escapeRe(h.path("/rankings"))}/?(\\?.*)?$`));
    },
  },
  {
    name: "fighters list and rankings: filters, sort, tabs", variants: TWO,
    async run(h) {
      const ctx = await h.context(), page = await h.page(ctx);
      const wins = (rec: string) => Number((rec.match(/(\d+)\s*[-–]\s*\d+\s*[-–]\s*\d+/) ?? [])[1] ?? NaN);
      const cards = () => page.locator('main a[href*="/boxers/"]').filter({ has: page.locator("b, .font-display") });
      await h.open(page, "/boxers");
      const everyone = await page.locator("main .text-muted", { hasText: /\d+/ }).first().innerText();

      // filter links keep each other: women, then a division
      await h.click(page.locator("main a", { hasText: h.label("Women") }));
      await page.waitForURL(/sex=female/);
      await h.click(page.locator("main a", { hasText: h.label("Featherweight") }));
      await page.waitForURL((u: URL) => u.searchParams.get("sex") === "female" && u.searchParams.get("wc") === "Featherweight");
      check((await cards().count()) > 0, "the filtered list has fighters");
      const filtered = await page.locator("main .text-muted", { hasText: /\d+/ }).first().innerText();
      check(filtered !== everyone, "the count changed with the filters");
      await page.locator("main a.chip", { hasText: h.label("Women") }).first().waitFor();

      // sort: choose "most wins" in the form and apply; the list is in that order, the choice is kept, and "clear filters" undoes it
      await h.open(page, "/boxers?wc=Heavyweight");
      await page.locator('select[name=sort]').selectOption("wins");
      await h.click(page.getByRole("button", { name: h.label("Apply") }));
      await page.waitForURL(/sort=wins/);
      eq(await page.locator('select[name=sort]').inputValue(), "wins", "the sort choice is kept");
      const first = wins(await cards().nth(0).innerText()), second = wins(await cards().nth(1).innerText()), third = wins(await cards().nth(2).innerText());
      if (!Number.isNaN(first)) check(first >= second && second >= third, `ordered by wins: ${first}, ${second}, ${third}`);
      await h.click(page.locator("main a", { hasText: h.label("Clear filters") }));
      await page.waitForURL((u: URL) => !u.searchParams.has("sort") && u.searchParams.get("wc") === "Heavyweight");
      // the search box: Enter submits
      await page.locator('main input[name=q]').first().fill("southpaw heavyweights");
      await page.locator('main input[name=q]').first().press("Enter");
      await page.waitForURL(/q=southpaw/);
      check((await page.locator("main .chip", { hasText: /\S/ }).count()) > 0, "the question was understood (chips say how)");

      // rankings: the men's and women's tabs, then a division, whose headings sort
      await h.open(page, "/rankings");
      const topMen = await page.locator('main a[href*="/boxers/"]').first().getAttribute("href");
      await h.click(page.locator("main a", { hasText: h.label("Women") }));
      await page.waitForURL(/sex=female/);
      await page.waitForFunction((was: string | null) => document.querySelector('main a[href*="/boxers/"]')?.getAttribute("href") !== was, topMen);
      await h.open(page, "/rankings/heavyweight");
      const headings = page.locator("th[scope=col] a");
      check((await headings.count()) >= 3, "the table has sortable headings");
      const nth = headings.nth(1); // the fighter column: text, so the first click sorts A to Z
      await h.click(nth);
      await page.waitForURL(/sort=/);
      const sortedTh = page.locator("th[aria-sort]");
      eq(await sortedTh.count(), 1, "exactly one heading says it is the sorted one");
      const dir1 = await sortedTh.getAttribute("aria-sort");
      await h.click(page.locator("th[aria-sort] a"));
      await page.waitForFunction((was: string | null) => document.querySelector("th[aria-sort]")?.getAttribute("aria-sort") !== was, dir1);
      check((await page.locator("th[aria-sort]").getAttribute("aria-sort")) !== dir1, "a second click reverses the order");
    },
  },
  {
    name: "fighter page: sections, jump strip, share", variants: ALL4,
    async run(h, v) {
      const f = h.fighter(0);
      const ctx = await h.context(), page = await h.page(ctx);
      await h.open(page, `/boxers/${f.slug}`);
      eq(await page.locator("h1:visible").count(), 1, "one h1");
      const strip = page.locator(`nav[aria-label="${h.tr("On this page")}"]`);
      const links = await strip.locator("a").evaluateAll((as: HTMLAnchorElement[]) => as.map((a) => ({ href: a.getAttribute("href")!, text: a.textContent!.trim() })));
      check(links.length >= 5, `the strip lists the page's sections (${links.length})`);
      for (const l of links) check(await page.locator(l.href).count() === 1, `${l.text}: the section ${l.href} is on the page`);
      // the strip is a row that scrolls sideways on a phone and never makes the page wider
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      eq(overflow, 0, "no sideways scrolling of the page");
      // every jump lands on its section, below the sticky strip, and writes the address
      for (const l of links) {
        const a = strip.locator(`a[href="${l.href}"]`);
        await a.scrollIntoViewIfNeeded();
        await h.click(a);
        await page.waitForURL(new RegExp(`${escapeRe(l.href)}$`));
        await page.waitForFunction((sel: string) => { const el = document.querySelector(sel)!; const r = el.getBoundingClientRect(); const bar = document.querySelector("nav.jump-nav")!.getBoundingClientRect(); return r.top >= bar.bottom - 4 && r.top < innerHeight; }, l.href);
      }
      // the bottom of the page is the discussion, written after the page loads
      await page.locator("#discussion").waitFor();

      // share: the page's address goes to the clipboard and the button says so
      await page.evaluate(() => window.scrollTo(0, 0));
      const share = page.getByRole("button", { name: h.label("Share") });
      await h.click(share);
      await page.getByRole("button", { name: h.label("Link copied") }).waitFor();
      const copied = (await h.copied(page)) ?? "";
      eq(copied, page.url(), "the clipboard holds the address of the page as it is");
      void v;
    },
  },
  {
    name: "compare two fighters", variants: ALL4,
    async run(h) {
      const a = h.fighter(0), b = h.fighter(3);
      const ctx = await h.context(), page = await h.page(ctx);
      await h.open(page, "/compare");
      const pickers = page.locator("main form [role=combobox]");
      eq(await pickers.count(), 2, "two pickers");
      // each one is filled by typing and choosing with the keyboard
      for (const [i, who] of [[0, a], [1, b]] as const) {
        const box = pickers.nth(i);
        await box.fill(who.name.split(" ")[0]);
        const opt = page.locator("main form [role=listbox] [role=option]", { hasText: h.name(who.name) }).first();
        await opt.waitFor();
        const id = await opt.getAttribute("id");
        for (let k = 0; k < 15 && (await box.getAttribute("aria-activedescendant")) !== id; k++) await box.press("ArrowDown");
        await box.press("Enter");
        await page.waitForFunction((n: number) => document.querySelectorAll("main form input[type=hidden]").length >= n, i + 1);
      }
      await h.click(page.getByRole("button", { name: h.label("Predict") }));
      await page.waitForURL((u: URL) => u.searchParams.get("a") === a.slug && u.searchParams.get("b") === b.slug);
      await h.ready(page);
      eq(await page.locator("h1:visible").count(), 1, "one h1 on the result");
      const text = await page.locator("main").innerText();
      check(text.includes(h.name(a.name).toUpperCase()) || text.toLowerCase().includes(h.name(a.name).toLowerCase()), "fighter A is on the page");
      check(text.toLowerCase().includes(h.name(b.name).toLowerCase()), "fighter B is on the page");
      check(/\d+\s*%/.test(text), "a win probability is shown");
      // the matchup lab's sliders answer the keyboard, and the odds are announced
      const slider = page.locator("main input[type=range]").first();
      await slider.waitFor();
      const before = await slider.inputValue();
      await slider.focus();
      await slider.press("ArrowRight");
      check((await slider.inputValue()) !== before, "a slider moves with the arrow keys");
      // the share button shares what is on screen (both fighters)
      await h.click(page.getByRole("button", { name: h.label("Share") }));
      await page.getByRole("button", { name: h.label("Link copied") }).waitFor();
      const copied = (await h.copied(page)) ?? "";
      check(copied.includes(`a=${a.slug}`) && copied.includes(`b=${b.slug}`), `the copied link names both fighters: ${copied}`);
    },
  },
];
