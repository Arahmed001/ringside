/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright's types are not available here, see harness.ts */
import { ALL4, PASSWORD, check, eq, uniqueName, type Flow, type Harness } from "../harness";

const API = /\/api\/(account|report|forum)\//;

/** The account page's sign-in / create-account form, in whichever tab. Returns the form's status line. */
async function tab(h: Harness, page: any, key: "Sign in" | "Create account" | "Forgot password") {
  await h.click(page.getByRole("tab", { name: h.tr(key) }));
  await page.getByRole("tab", { name: h.tr(key), selected: true }).waitFor();
}
const status = (page: any) => page.locator("form[aria-label] [role=status]").first();
const fillCredentials = async (page: any, name: string, pass: string, again?: string) => {
  await page.locator("#acc-user").fill(name);
  await page.locator("#acc-pass").fill(pass);
  if (again !== undefined) await page.locator("#acc-again").fill(again);
};

export const accounts: Flow[] = [
  {
    // sign up -> sign out -> sign in -> the wrong-password message (and the other things that can go wrong on the form)
    name: "sign up, sign out, sign in, wrong password", variants: ALL4,
    async run(h) {
      h.allow(API);
      const ctx = await h.context(), page = await h.page(ctx);
      const name = uniqueName("auth");
      await h.open(page, "/account");
      await h.signedOut(page);

      // the two passwords must match (said before the server is asked)
      await tab(h, page, "Create account");
      await fillCredentials(page, name, PASSWORD, PASSWORD + "x");
      await page.locator("#acc-again").press("Enter"); // a form submits with Enter
      await status(page).filter({ hasText: h.tr("The two passwords are not the same.") }).waitFor();
      // a password the server finds too easy to guess
      await fillCredentials(page, name, "letmein123", "letmein123");
      await page.locator("#acc-again").press("Enter");
      await status(page).filter({ hasText: h.tr("That password is too easy to guess.") }).waitFor();
      // and the real thing
      await fillCredentials(page, name, PASSWORD, PASSWORD);
      await page.locator("#acc-again").press("Enter");
      await h.signedInAs(page, name);
      await page.locator("main .eyebrow", { hasText: h.tr("Signed in") }).waitFor();
      await page.locator("main", { hasText: name }).first().waitFor();
      // the session cookie is not readable by scripts, and it lasts: a reload is still signed in
      const cookie = (await ctx.cookies()).find((c: any) => c.name === "rs_session");
      check(cookie && cookie.httpOnly && cookie.sameSite === "Lax", `the session cookie: ${JSON.stringify(cookie)}`);
      check(!(await page.evaluate(() => document.cookie)).includes("rs_session"), "the session cookie is visible to scripts");
      await page.reload();
      await h.signedInAs(page, name);

      // sign out
      await h.click(page.getByRole("button", { name: h.label("Sign out") }));
      await h.signedOut(page);
      await page.getByRole("tablist").waitFor();
      eq((await ctx.cookies()).filter((c: any) => c.name === "rs_session" && c.value).length, 0, "the session cookie is gone after signing out");

      // the name is taken now
      await tab(h, page, "Create account");
      await fillCredentials(page, name, PASSWORD, PASSWORD);
      await page.locator("#acc-again").press("Enter");
      await status(page).filter({ hasText: h.tr("That name is taken.") }).waitFor();

      // wrong password: the message, still signed out
      await tab(h, page, "Sign in");
      await fillCredentials(page, name, PASSWORD + "-wrong");
      await page.locator("#acc-pass").press("Enter");
      await status(page).filter({ hasText: h.tr("That name and password do not match.") }).waitFor();
      await h.signedOut(page);
      // an unknown name gets the same words (nothing says which half was wrong)
      await fillCredentials(page, uniqueName("nobody"), PASSWORD);
      await page.locator("#acc-pass").press("Enter");
      await status(page).filter({ hasText: h.tr("That name and password do not match.") }).waitFor();

      // the right one
      await fillCredentials(page, name, PASSWORD);
      await page.locator("#acc-pass").press("Enter");
      await h.signedInAs(page, name);
      await page.locator("main .eyebrow", { hasText: h.tr("Signed in") }).waitFor();
    },
  },
  {
    name: "change password", variants: ALL4,
    async run(h) {
      h.allow(API);
      const ctxA = await h.context(), a = await h.page(ctxA);
      const acc = await h.signUp(ctxA, "pw");
      const ctxB = await h.context(), b = await h.page(ctxB); // the same person on another device
      await h.signIn(ctxB, acc);
      await h.open(b, "/account"); await h.signedInAs(b, acc.username);

      await h.open(a, "/account"); await h.signedInAs(a, acc.username);
      const form = a.locator(`form[aria-label="${h.tr("Change password")}"]`);
      const st = form.locator("[role=status]");
      const fill = async (cur: string, next: string, again: string) => { await form.locator("#pw-cur").fill(cur); await form.locator("#pw-new").fill(next); await form.locator("#pw-again").fill(again); await form.locator("#pw-again").press("Enter"); };
      await fill(acc.password, "Another-long-passphrase-2", "Another-long-passphrase-3");
      await st.filter({ hasText: h.tr("The two passwords are not the same.") }).waitFor();
      await fill(acc.password + "x", "Another-long-passphrase-2", "Another-long-passphrase-2");
      await st.filter({ hasText: h.tr("That password is not right.") }).waitFor();
      const next = "Another-long-passphrase-2";
      await fill(acc.password, next, next);
      await st.filter({ hasText: h.tr("Password changed. Your other devices were signed out.") }).waitFor();
      eq(await form.locator("#pw-cur").inputValue(), "", "the form is cleared after the change");

      // this device stays signed in, the other is signed out
      await a.reload(); await h.signedInAs(a, acc.username);
      await b.reload(); await h.signedOut(b);

      // the old password no longer works, the new one does
      await h.click(a.getByRole("button", { name: h.label("Sign out") })); await h.signedOut(a);
      await tab(h, a, "Sign in");
      await fillCredentials(a, acc.username, acc.password); await a.locator("#acc-pass").press("Enter");
      await status(a).filter({ hasText: h.tr("That name and password do not match.") }).waitFor();
      await fillCredentials(a, acc.username, next); await a.locator("#acc-pass").press("Enter");
      await h.signedInAs(a, acc.username);
    },
  },
  {
    // star a fighter, see it on the watchlist, keep it across a reload, then across sessions once there is an account
    name: "star a fighter: the watchlist persists", variants: ALL4,
    async run(h) {
      h.allow(API);
      const f1 = h.fighter(0), f2 = h.fighter(3);
      const ctx = await h.context(), page = await h.page(ctx);
      const star = (p: any) => p.locator("main button[aria-pressed]", { hasText: /★|☆/ }).first();

      // not signed in: the list is kept in this browser
      await h.open(page, `/boxers/${f1.slug}`);
      await h.signedOut(page);
      eq(await star(page).getAttribute("aria-pressed"), "false", "not starred at first");
      await h.click(star(page));
      await page.locator(`main button[aria-pressed="true"]`, { hasText: h.tr("★ Watching") }).waitFor();
      await page.reload(); await h.ready(page);
      await page.locator(`main button[aria-pressed="true"]`, { hasText: h.tr("★ Watching") }).waitFor();
      await h.open(page, "/watchlist");
      await page.locator(`main a[href$="/boxers/${f1.slug}"]`).waitFor();
      await page.locator("main dd a[href*='/bouts/']").first().waitFor(); // the last fight, with its date
      eq(/Invalid Date|NaN|undefined/.test(await page.locator("main").innerText()), false, "the watchlist has no broken text (it once printed Invalid Date for every last fight)");

      // add another from the watchlist page's own search, in its language (a typed name, not a link)
      const search = page.getByRole("searchbox", { name: h.tr("Search for a fighter to watch") });
      await search.fill(f2.name.split(" ")[0]);
      const row = page.locator("section", { has: search }).locator("li", { hasText: h.name(f2.name) }).first();
      await row.waitFor();
      await h.click(row.locator("button[aria-pressed]"));
      await page.locator(`main a[href$="/boxers/${f2.slug}"]`).waitFor();

      // an account takes the browser's list with it: signing up here and signing in on another device shows the same two
      const acc = await h.signUp(ctx, "watch");
      await page.reload(); await h.signedInAs(page, acc.username);
      await page.locator(`main a[href$="/boxers/${f1.slug}"]`).waitFor();
      const ctx2 = await h.context(), other = await h.page(ctx2);
      await h.signIn(ctx2, acc);
      await h.open(other, "/watchlist"); await h.signedInAs(other, acc.username);
      await other.locator(`main a[href$="/boxers/${f1.slug}"]`).waitFor();
      await other.locator(`main a[href$="/boxers/${f2.slug}"]`).waitFor();
      // un-star on the second device: the first sees it gone after a reload
      await h.open(other, `/boxers/${f1.slug}`); await h.signedInAs(other, acc.username);
      await other.locator(`main button[aria-pressed="true"]`, { hasText: h.tr("★ Watching") }).waitFor();
      await h.click(star(other));
      await other.locator(`main button[aria-pressed="false"]`, { hasText: h.tr("☆ Watch") }).waitFor();
      await page.reload(); await h.signedInAs(page, acc.username);
      await page.locator(`main a[href$="/boxers/${f2.slug}"]`).waitFor();
      eq(await page.locator(`main a[href$="/boxers/${f1.slug}"]`).count(), 0, "the fighter un-starred on the other device is gone here");
    },
  },
  {
    // make a pick on the home page's pick'em, see it recorded; before sign-in it lives in the browser and moves to the account when there is one
    name: "pick'em: a pick is recorded", variants: ALL4,
    async run(h) {
      h.allow(API);
      const ctx = await h.context(), page = await h.page(ctx);
      await h.open(page, "/"); await h.signedOut(page);
      const pickem = page.locator("div.card", { has: page.locator(`.eyebrow:text-is("${h.tr("Fight night pick’em")}")`) }).first();
      const buttons = pickem.locator("button[aria-pressed]");
      const total = await buttons.count();
      check(total >= 4, `the pick'em has fights to pick on (${total} buttons)`);
      const first = buttons.nth(0);
      const made = pickem.locator(".tabular", { hasText: /^\d+\/\d+$/ }).first();
      eq((await made.innerText()).split("/")[0], "0", "no picks made yet");
      await h.click(first);
      await page.waitForFunction((el: Element) => el.getAttribute("aria-pressed") === "true", await first.elementHandle());
      eq((await made.innerText()).split("/")[0], "1", "one pick made");
      // a second click on the other fighter of the same fight changes the pick, it does not add one
      const second = buttons.nth(1);
      await h.click(second);
      await page.waitForFunction((el: Element) => el.getAttribute("aria-pressed") === "true", await second.elementHandle());
      eq(await first.getAttribute("aria-pressed"), "false", "the first side is no longer picked");
      eq((await made.innerText()).split("/")[0], "1", "still one pick");
      await page.reload(); await h.ready(page);
      await pickem.locator("button[aria-pressed=true]").first().waitFor();
      eq(await pickem.locator("button[aria-pressed=true]").count(), 1, "the pick survives a reload (kept in this browser)");

      // making an account moves the browser's pick onto it
      await h.open(page, "/account"); await h.signedOut(page);
      await tab(h, page, "Create account");
      const name = uniqueName("pick");
      await fillCredentials(page, name, PASSWORD, PASSWORD); await page.locator("#acc-again").press("Enter");
      await h.signedInAs(page, name);
      await page.locator("main [role=status]", { hasText: h.tr("{n} of the picks saved in this browser were added to your account.", { n: 1 }) }).waitFor(); // said on the page that replaces the form
      // ... and it is on the picks page
      await h.open(page, "/picks"); await h.signedInAs(page, name);
      await page.locator("main h2", { hasText: h.label("Your picks") }).waitFor();
      eq(await page.locator("main li", { hasText: h.tr("Still to come") }).count(), 1, "one pick listed on the picks page");

      // a second device signed in as the same person sees it, and a new pick made there is on the account
      const ctx2 = await h.context(), other = await h.page(ctx2);
      await h.signIn(ctx2, { username: name, password: PASSWORD });
      await h.open(other, "/"); await h.signedInAs(other, name);
      const pickem2 = other.locator("div.card", { has: other.locator(`.eyebrow:text-is("${h.tr("Fight night pick’em")}")`) }).first();
      await pickem2.locator("button[aria-pressed=true]").first().waitFor();
      const third = pickem2.locator("button[aria-pressed]").nth(6); // a side of a different fight
      eq(await third.getAttribute("aria-pressed"), "false", "not picked yet");
      await h.click(third);
      await other.waitForFunction((el: Element) => el.getAttribute("aria-pressed") === "true", await third.elementHandle());
      const picks = await h.until("two picks on the account", async () => { const r = await ctx2.request.get(`${h.server.base}/api/account/picks`); const j = await r.json(); return Object.keys(j.picks ?? {}).length === 2 ? j.picks : false; });
      eq(Object.keys(picks).length, 2, "two picks recorded on the account");
      await h.open(page, "/picks"); await page.locator("main li", { hasText: h.tr("Still to come") }).nth(1).waitFor();
    },
  },
];
