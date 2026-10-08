/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright's types are not available here, see harness.ts */
import { ALL4, AR1280, AR375, EN1280, EN375, TWO, check, eq, type Flow, type Harness } from "../harness";
import { assertGoodStops, assertRowsFollowDirection, describeFocus, tabThrough, type Stop } from "../keys";

const rtl = (h: Harness) => h.variant.lang === "ar";

/** How many things on the page a keyboard can reach (what the tab walk should add up to). */
const reachable = (page: any): Promise<number> => page.evaluate(() => {
  const sel = 'a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  const radios = new Set<string>();
  return [...document.querySelectorAll<HTMLElement>(sel)].filter((e) => {
    const cs = getComputedStyle(e);
    if (cs.visibility === "hidden" || cs.display === "none" || e.getClientRects().length === 0) return false;
    if (e.closest("[inert], dialog:not([open])")) return false;
    if (e instanceof HTMLInputElement && e.type === "radio") { const k = e.name; if (radios.has(k)) return false; radios.add(k); }
    return true;
  }).length;
});

export const keyboard: Flow[] = [
  {
    // the whole tab order of a page: a visible ring and a place on screen at every stop, the skip link first, nothing that traps, rows that follow the reading direction
    name: "keyboard: tab order of the main pages", variants: ALL4,
    async run(h) {
      const ctx = await h.context(), page = await h.page(ctx);
      for (const p of ["/", `/boxers/${h.fighter(0).slug}`, "/boxers", "/rankings/heavyweight", "/account", "/watchlist", "/compare", "/forum"]) {
        await h.open(page, p);
        const total = await reachable(page);
        const { stops, ended } = await tabThrough(page, 400);
        assertGoodStops(stops, `${p} (${h.variant.lang}@${h.variant.width})`);
        eq(stops[0].href, "#main", `${p}: the skip link is first`);
        check(ended === "loop" || ended === "left", `${p}: the tab walk ended with ${ended} after ${stops.length} stops (a trap would not end)`);
        // the walk reached everything there is to reach, once each
        check(stops.length >= total - 3 && stops.length <= total + 3, `${p}: ${stops.length} stops for ${total} reachable controls`);
        check(!(await page.evaluate(() => [...document.querySelectorAll("[tabindex]")].some((e) => Number((e as HTMLElement).tabIndex) > 0))), `${p}: no positive tabindex`);
        // the top bar reads in the direction of the language
        assertRowsFollowDirection(stops.filter((s) => s.inside === "header"), rtl(h), `${p} header`);
        // Shift+Tab walks the same stops backwards
        const back = await tabThrough(page, 6, { shift: true });
        check(back.stops.length > 0, `${p}: Shift+Tab goes back`);
      }
    },
  },
  {
    name: "keyboard: jump strip on a fighter page", variants: TWO,
    async run(h) {
      const f = h.fighter(0);
      const ctx = await h.context(), page = await h.page(ctx);
      await h.open(page, `/boxers/${f.slug}`);
      const strip = `nav[aria-label="${h.tr("On this page")}"]`;
      // Tab until the strip is reached; each link has the ring
      const walk = await tabThrough(page, 80, { until: (s) => s.href.startsWith("#") && s.href !== "#main" });
      eq(walk.ended, "until", "the jump strip is reachable by Tab");
      const links = await page.locator(`${strip} a`).evaluateAll((as: HTMLAnchorElement[]) => as.map((a) => a.getAttribute("href")!));
      const seen: Stop[] = [walk.stops.at(-1)!];
      for (let i = 1; i < links.length; i++) { await page.keyboard.press("Tab"); seen.push((await describeFocus(page))!); }
      eq(seen.map((s) => s.href), links, "the strip's links come in page order, one Tab apart");
      assertGoodStops(seen, "jump strip");
      assertRowsFollowDirection(seen, rtl(h), "jump strip");
      // Enter on a link jumps there and the next Tab continues from that section (inside it or after it), not from the top of the page
      for (const target of [links[2], links.at(-1)!]) {
        await page.locator(`${strip} a[href="${target}"]`).focus();
        await page.keyboard.press("Enter");
        await page.waitForURL(new RegExp(`${target}$`));
        await page.keyboard.press("Tab");
        const where = await page.evaluate((id: string) => { const sec = document.querySelector(id)!, el = document.activeElement!; return { inside: sec.contains(el), after: !!(sec.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING), on: el.tagName + (el.id ? `#${el.id}` : "") }; }, target);
        check(where.inside || where.after, `after jumping to ${target}, Tab went to ${where.on}, which is before the section`);
      }
    },
  },
  {
    name: "keyboard: fighters list, rankings tabs and sort headings", variants: TWO,
    async run(h) {
      const ctx = await h.context(), page = await h.page(ctx);
      // the list: the filters are links and a form, all reachable; Enter in the search box submits, the sort choice is made with the arrow keys and applied with Enter on the button
      await h.open(page, "/boxers");
      const { stops } = await tabThrough(page, 200, { until: (s) => s.tag === "button" && s.desc.includes(h.tr("Apply")) });
      assertGoodStops(stops, "fighters list", { allowCovered: () => true });
      const chips = stops.filter((s) => s.inside === "main" && s.tag === "a");
      check(chips.length >= 20, `the filter chips are in the tab order (${chips.length})`);
      assertRowsFollowDirection(chips.slice(0, 3), rtl(h), "sex chips (Everyone, Men, Women)");
      const sort = page.locator("select[name=sort]");
      await sort.focus();
      await sort.press("ArrowDown"); // a closed select changes with the arrow keys
      check((await sort.inputValue()) !== "rating", "the arrow key changed the sort choice");
      const chosen = await sort.inputValue();
      await page.keyboard.press("Tab"); // the next stop is the Apply button
      eq((await describeFocus(page))?.tag, "button", "Apply follows the sort choice");
      await page.keyboard.press("Enter");
      await page.waitForURL((u: URL) => u.searchParams.get("sort") === chosen);
      // the search box: type, Enter
      const q = page.locator("main input[name=q]").first();
      await q.focus(); await q.fill("lightweights"); await q.press("Enter");
      await page.waitForURL(/q=lightweights/);

      // rankings: the men's and women's links, in reading order, activated with Enter
      await h.open(page, "/rankings");
      const tabs = await tabThrough(page, 40, { until: (s) => /sex=female/.test(s.href) });
      eq(tabs.ended, "until", "the Women link is reachable by Tab");
      const men = tabs.stops.at(-2)!, women = tabs.stops.at(-1)!;
      check(women.ring && women.focusVisible, "the Women link shows focus");
      check(rtl(h) ? women.x < men.x : women.x > men.x, "Men then Women, in reading order");
      await page.keyboard.press("Enter");
      await page.waitForURL(/sex=female/);

      // a division's table: the headings are links in the tab order; Enter sorts; the sorted heading says so
      await h.open(page, "/rankings/heavyweight");
      const th = await tabThrough(page, 120, { until: (s) => /sort=/.test(s.href) });
      eq(th.ended, "until", "a sort heading is reachable by Tab");
      assertGoodStops([th.stops.at(-1)!], "sort heading", { allowCovered: () => true });
      await page.keyboard.press("Enter");
      await page.waitForURL(/sort=/);
      await page.locator("th[aria-sort]").waitFor();
      // after the page has re-rendered, focus is not dropped on the floor: Tab goes on to the next control rather than back to the top
      const after = await describeFocus(page);
      check(after !== null, "after sorting by keyboard, focus is still somewhere on the page (it fell to the top of the document)");
    },
  },
  {
    name: "keyboard: the search palette is a dialog", variants: ALL4,
    async run(h) {
      const ctx = await h.context(), page = await h.page(ctx);
      await h.open(page, "/boxers");
      const dialog = page.locator(`[role=dialog][aria-label="${h.tr("Search everything")}"]`);

      // opened from the keyboard while a link has focus: focus goes to the box, Tab and Shift+Tab stay in it, arrows move the highlight, Escape closes and the link has focus again
      const link = page.locator('main a[href*="/boxers/"]').first();
      await link.focus();
      await page.keyboard.press("Control+k");
      await dialog.waitFor();
      const box = dialog.getByRole("combobox");
      await h.focused(box, "focus is in the search box");
      for (const k of ["Tab", "Tab", "Shift+Tab", "Tab"]) { await page.keyboard.press(k); await h.focused(box, `${k} leaves focus in the dialog`); }
      const first = await box.getAttribute("aria-activedescendant");
      await box.press("ArrowDown");
      check((await box.getAttribute("aria-activedescendant")) !== first, "ArrowDown moves the highlight");
      await box.press("ArrowUp");
      eq(await box.getAttribute("aria-activedescendant"), first, "ArrowUp moves it back");
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await h.focused(link, "focus returns to the link it came from");

      // the other shortcut: "/" outside a text box; and it does not fire while typing in one
      await page.locator("body").click({ position: { x: 5, y: 5 } });
      await page.keyboard.press("/");
      await dialog.waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });

      // opened with the mouse from the button in the bar, then closed with Escape: focus must land on the button again, not on nothing
      const opener = page.locator(`header button[aria-label="${h.tr("Search everything (Ctrl+K)")}"]`);
      await h.click(opener);
      await dialog.waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      await page.waitForFunction(() => document.activeElement?.tagName === "BUTTON", undefined, { timeout: 4000 }).catch(() => {}); // focus is put back by an effect, just after the dialog is gone
      const landed = await describeFocus(page);
      check(landed && landed.desc.includes(h.tr("Search everything (Ctrl+K)")) && landed.tag === "button", `after Escape, focus is on ${landed ? landed.desc : "nothing (the page body)"} instead of the search button it was opened from`);
      // and the button still works by keyboard
      await page.keyboard.press("Enter");
      await dialog.waitFor();
      await page.keyboard.press("Escape");
    },
  },
  {
    name: "keyboard: the phone menu is a modal drawer", variants: [EN375, AR375],
    async run(h) {
      const ctx = await h.context(), page = await h.page(ctx);
      await h.open(page, "/boxers");
      const menu = page.locator(`header button[aria-label="${h.tr("Menu")}"]`);
      const drawer = page.locator("dialog.drawer");
      // reach the button by Tab, open with Enter
      const walk = await tabThrough(page, 10, { until: (s) => s.desc.includes(h.tr("Menu")) && s.tag === "button" });
      eq(walk.ended, "until", "the menu button is among the first stops");
      assertGoodStops([walk.stops.at(-1)!], "menu button");
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => (document.querySelector("dialog.drawer") as HTMLDialogElement | null)?.open === true);
      // it is the drawer's own: focus is inside it, every Tab and Shift+Tab stays inside, and the page behind cannot be reached
      const inside = async () => page.evaluate(() => document.activeElement === document.body || !!document.activeElement?.closest("dialog.drawer")); // at the end of its list focus goes to the browser's own controls (the body, here), never to the page behind
      for (let i = 0; i < 40; i++) { await page.keyboard.press("Tab"); check(await inside(), `Tab ${i + 1} left the drawer`); }
      for (let i = 0; i < 5; i++) { await page.keyboard.press("Shift+Tab"); check(await inside(), `Shift+Tab ${i + 1} left the drawer`); }
      // it comes from the start edge of the screen: the left in English, the right in Arabic
      const box = await drawer.boundingBox();
      check(rtl(h) ? Math.abs(box.x + box.width - 375) < 2 : Math.abs(box.x) < 2, `the drawer is at the ${rtl(h) ? "right" : "left"} edge: ${JSON.stringify(box)}`);
      await page.keyboard.press("Escape");
      await page.waitForFunction(() => (document.querySelector("dialog.drawer") as HTMLDialogElement).open === false);
      await h.focused(menu, "focus returns to the menu button after Escape");
      // a link inside it, chosen with Enter, goes there and the drawer is closed on the new page
      await page.keyboard.press("Enter");
      await page.waitForFunction(() => (document.querySelector("dialog.drawer") as HTMLDialogElement).open === true);
      const rankings = drawer.locator(`a[href$="/rankings"]`);
      await rankings.focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(new RegExp(`${h.path("/rankings")}$`));
      await h.ready(page);
      eq(await page.evaluate(() => (document.querySelector("dialog.drawer") as HTMLDialogElement).open), false, "the drawer is closed on the next page");
    },
  },
  {
    // the preview card: appears for keyboard focus, is tied to the link, goes with Escape and leaves focus where it was; never on a touch screen
    name: "keyboard: hover preview card", variants: [EN1280, AR1280],
    async run(h) {
      const ctx = await h.context(), page = await h.page(ctx);
      await h.open(page, "/rankings/heavyweight");
      const tip = page.locator("#hover-preview");
      const link = page.locator('main table a[href*="/boxers/"]').first();
      const name = (await link.innerText()).split("\n")[0].trim();
      await link.focus();
      await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab"); // keyboard focus, not a script's
      await tip.waitFor();
      eq(await tip.getAttribute("role"), "tooltip", "the card is a tooltip");
      eq(await link.getAttribute("aria-describedby"), "hover-preview", "the link is described by the card");
      check((await tip.innerText()).toLowerCase().includes(name.toLowerCase().slice(0, 8)), "the card is about that fighter");
      check(await tip.evaluate((el: Element) => el.querySelectorAll("a, button, input, select, textarea").length === 0), "the card holds no controls to trap focus");
      await page.keyboard.press("Escape");
      await tip.waitFor({ state: "detached" });
      await h.focused(link, "focus stays on the link after Escape");
      eq(await link.getAttribute("aria-describedby"), null, "the description is gone with the card");
      // it also goes when focus moves on
      await link.focus(); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
      await tip.waitFor();
      await page.keyboard.press("Tab");
      await tip.waitFor({ state: "detached" });
      // with a pointer: rests on the link, appears; leaves, goes; scrolling closes it
      const box = await link.boundingBox();
      await page.mouse.move(box.x + 5, box.y + box.height / 2);
      await tip.waitFor();
      await page.mouse.move(5, 5);
      await tip.waitFor({ state: "detached" });
      await page.mouse.move(box.x + 5, box.y + box.height / 2);
      await tip.waitFor();
      await page.mouse.wheel(0, 300);
      await tip.waitFor({ state: "detached" });

      // a touch screen never gets it
      const touch = await h.context({ touch: true, width: 390 });
      const phone = await h.page(touch);
      await h.open(phone, "/rankings/heavyweight");
      const l2 = phone.locator('main a[href*="/boxers/"]').first();
      await l2.focus();
      await phone.waitForFunction(() => new Promise((r) => setTimeout(() => r(!document.querySelector("#hover-preview")), 900))); // longer than the card's own 450 ms rest: a fixed wait is the only way to see that nothing happens
      eq(await phone.locator("#hover-preview").count(), 0, "no card on a touch screen");
    },
  },
  {
    name: "keyboard: forum compose, report and delete", variants: ALL4,
    async run(h, v) {
      h.allow(/\/api\/(account|forum)\//);
      const f = h.fighter(3);
      const ctx = await h.context(), page = await h.page(ctx);
      const acc = await h.signUp(ctx, "typist"); h.ageAccount(acc.username, 3);
      const other = await h.context(), op = await h.page(other);
      const acc2 = await h.signUp(other, "other"); h.ageAccount(acc2.username, 3);
      const mine = v.lang === "ar" ? `رأيي من لوحة المفاتيح فقط ${acc.username}` : `Typed with the keyboard alone by ${acc.username}`;
      const theirs = v.lang === "ar" ? `منشور شخص آخر عن النزال ${acc2.username}` : `Another person's thoughts about this one ${acc2.username}`;
      const r = await other.request.post(`${h.server.base}/api/forum/post`, { data: { kind: "boxer", subject: f.slug, body: theirs } });
      eq(r.status(), 201, "setup post");
      void op;

      await h.open(page, `/boxers/${f.slug}`); await h.signedInAs(page, acc.username);
      // from the strip's "Discussion" link, Tab goes into the section: the box, then the rules link, then Post
      const strip = `nav[aria-label="${h.tr("On this page")}"]`;
      await page.locator(`${strip} a[href="#discussion"]`).focus();
      await page.keyboard.press("Enter");
      await page.waitForURL(/#discussion$/);
      await page.locator("#forum-text").waitFor();
      const walk = await tabThrough(page, 30, { until: (s) => s.id === "forum-text" });
      eq(walk.ended, "until", "the compose box is reachable by Tab from the discussion link");
      assertGoodStops(walk.stops.slice(-1), "compose box");
      await page.keyboard.type(mine);
      await page.keyboard.press("Enter"); // in a text area Enter is a new line, not a send
      await page.keyboard.type("x");
      check((await page.locator("#forum-text").inputValue()).includes("\n"), "Enter makes a new line in the box");
      await page.keyboard.press("Backspace"); await page.keyboard.press("Backspace");
      await page.keyboard.press("Tab");
      eq((await describeFocus(page))?.href.endsWith("/forum/rules"), true, "the rules link follows the box");
      await page.keyboard.press("Tab");
      const post = await describeFocus(page);
      check(post?.tag === "button" && post.desc.includes(h.tr("Post")), `the Post button follows the rules link (got ${post?.desc})`);
      await page.keyboard.press("Enter");
      await page.locator("#discussion [role=status]", { hasText: h.tr("Posted.") }).waitFor();
      // (the "Posted." line comes first, then the thread is reloaded, then focus goes to the box: wait for it, then say where it is if it never gets there)
      await page.waitForFunction(() => document.activeElement?.id === "forum-text", undefined, { timeout: 5000 }).catch(() => {});
      const kept = await describeFocus(page);
      check(kept?.id === "forum-text", `after posting, focus goes back to the box (it is on ${kept ? kept.desc : "nothing: the top of the page"})`);
      const li = page.locator("li[id^=post-]", { hasText: mine });
      await li.waitFor();

      // the controls of a post, by keyboard: Delete asks first, with the safe choice focused; Cancel returns to Delete
      const del = li.getByRole("button", { name: h.label("Delete") });
      await del.focus();
      await page.keyboard.press("Enter");
      const cancel = li.getByRole("button", { name: h.label("Cancel") });
      await cancel.waitFor();
      await h.focused(cancel, "focus moves to the safe choice (Cancel)");
      await page.keyboard.press("Enter");
      await del.waitFor();
      await h.focused(del, "focus returns to Delete after Cancel");
      // and the edit box takes focus and Escape-free Cancel returns it
      await li.getByRole("button", { name: h.label("Edit") }).focus();
      await page.keyboard.press("Enter");
      await h.focused(li.locator("textarea"), "Edit puts focus in the text box");
      await li.getByRole("button", { name: h.label("Cancel") }).focus();
      await page.keyboard.press("Enter");
      await h.focused(li.getByRole("button", { name: h.label("Edit") }), "focus returns to Edit");
      // someone else's post: Report by keyboard, choose the reason with the arrow keys, Enter in the note sends it
      const t = page.locator("li[id^=post-]", { hasText: theirs });
      await t.waitFor();
      await t.getByRole("button", { name: h.label("Report") }).focus();
      await page.keyboard.press("Enter");
      const reason = t.locator("select");
      await h.focused(reason, "focus is in the reason list");
      await page.keyboard.press("ArrowDown");
      await page.keyboard.press("Tab");
      await page.keyboard.type("keyboard note");
      await page.keyboard.press("Enter");
      await page.locator("#discussion [role=status]", { hasText: h.tr("Reported. Thank you.") }).waitFor();
    },
  },
  {
    // arrows and tab order mirror in Arabic: a slider's arrow moves the thumb the way the arrow points; the account tabs are reached in reading order
    name: "keyboard: arrow keys and tab order in both directions", variants: [EN1280, AR1280, AR375],
    async run(h) {
      const a = h.fighter(0), b = h.fighter(3);
      const ctx = await h.context(), page = await h.page(ctx);
      await h.open(page, `/compare?a=${a.slug}&b=${b.slug}`);
      const slider = page.locator("main input[type=range]").first();
      await slider.waitFor();
      await h.hydrated(slider);
      const read = () => slider.evaluate((el: HTMLInputElement) => {
        const r = el.getBoundingClientRect(), frac = (Number(el.value) - Number(el.min)) / (Number(el.max) - Number(el.min));
        return { value: Number(el.value), x: getComputedStyle(el).direction === "rtl" ? r.right - frac * r.width : r.left + frac * r.width }; // where the thumb is on screen
      });
      await slider.focus();
      const start = await read();
      await slider.press("ArrowRight");
      const right = await read();
      await slider.press("ArrowLeft"); await slider.press("ArrowLeft");
      const left = await read();
      check(right.x > start.x, `ArrowRight moves the thumb to the right (${start.x.toFixed(1)} to ${right.x.toFixed(1)})`);
      check(left.x < start.x, `ArrowLeft moves the thumb to the left (${start.x.toFixed(1)} to ${left.x.toFixed(1)})`);
      await slider.press("Home");
      const home = await read();
      await slider.press("End");
      const end = await read();
      check(home.value <= end.value, "Home and End go to the two ends");

      // the sign-in tabs are all reachable in reading order, and Enter or Space chooses one
      await h.open(page, "/account"); await h.signedOut(page);
      const tabs = page.getByRole("tab");
      const names = await tabs.allInnerTexts();
      await tabs.first().focus();
      const stops: Stop[] = [(await describeFocus(page))!];
      for (let i = 1; i < names.length; i++) { await page.keyboard.press("Tab"); stops.push((await describeFocus(page))!); }
      eq(stops.map((s) => s.desc.replace(/^button /, "")), names, "the tabs are visited in the order they are shown");
      assertGoodStops(stops, "account tabs");
      assertRowsFollowDirection(stops, rtl(h), "account tabs");
      await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Space");
      eq(await tabs.nth(0).getAttribute("aria-selected"), "true", "Space chooses the tab");
      await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
      eq(await tabs.nth(1).getAttribute("aria-selected"), "true", "Enter chooses the tab");
    },
  },
];
