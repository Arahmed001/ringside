/* eslint-disable @typescript-eslint/no-explicit-any -- Playwright's types are not available here, see harness.ts */
import { ALL4, PASSWORD, check, eq, escapeRe, uniqueName, type Account, type Flow, type Harness, type Variant } from "../harness";

const API = /\/api\/(account|report|forum|review)\//;

/** Words for a post that no other account will have written (the forum refuses the same words from two accounts, and counts letters only). */
const words = (v: Variant, who: string, what: string) => (v.lang === "ar" ? `رأيي في هذا النزال من ${who} في ${what}` : `My honest view on this fight from ${who} about ${what}`);
/** A fighter's name in either spelling: some answers of the API carry the English name on the Arabic page. */
const nameRe = (h: Harness, english: string) => new RegExp(`${escapeRe(english)}|${escapeRe(h.name(english))}`);
const post = (page: any, text: string) => page.locator("li[id^=post-]", { hasText: text });

/** A signed-in browser context for a person whose account is old enough to post. */
async function member(h: Harness, prefix: string, ageDays = 3): Promise<{ ctx: any; page: any; acc: Account }> {
  const ctx = await h.context(), page = await h.page(ctx);
  const acc = await h.signUp(ctx, prefix);
  h.ageAccount(acc.username, ageDays);
  return { ctx, page, acc };
}
async function openDiscussion(h: Harness, page: any, slug: string, who: string) {
  await h.open(page, `/boxers/${slug}`);
  await h.signedInAs(page, who);
  await page.locator("#discussion").scrollIntoViewIfNeeded();
  await page.locator("#discussion").waitFor();
}
/** Writes a post through the real form and waits until it is on the page. */
async function write(h: Harness, page: any, text: string) {
  const box = page.locator("#forum-text");
  await box.waitFor();
  await box.fill(text);
  await h.click(page.getByRole("button", { name: h.label("Post") }));
  await page.locator("#discussion [role=status]", { hasText: h.tr("Posted.") }).waitFor();
  await post(page, text).waitFor();
}
/** The id of the post with these words (read from the thread's own answer). */
async function postId(h: Harness, ctx: any, slug: string, text: string): Promise<number> {
  const r = await ctx.request.get(`${h.server.base}/api/forum/thread?kind=boxer&subject=${slug}`);
  const found = ((await r.json()).posts as { id: number; body: string | null }[]).find((p) => p.body === text);
  check(found, `post "${text}" is in the thread`);
  return found.id;
}
/** An established reporter: a week old, with three posts of its own still standing (elsewhere). */
async function established(h: Harness, prefix: string, v: Variant, elsewhere: string) {
  const m = await member(h, prefix, 8);
  for (let i = 1; i <= 3; i++) {
    const r = await m.ctx.request.post(`${h.server.base}/api/forum/post`, { data: { kind: "boxer", subject: elsewhere, body: words(v, m.acc.username, `round ${"abc"[i - 1]} of the card number ${["one", "two", "three"][i - 1]}`) } });
    check(r.status() === 201, `an established reporter's post ${i}: ${r.status()} ${await r.text()}`);
  }
  return m;
}
const report = (h: Harness, ctx: any, id: number) => ctx.request.post(`${h.server.base}/api/forum/posts/${id}/report`, { data: { reason: "spam" } });

export const forum: Flow[] = [
  {
    name: "report a mistake reaches an editor's queue", variants: ALL4,
    async run(h) {
      h.allow(API);
      const f = h.fighter(4);
      const note = `The nickname on this page looks wrong to me, reported by ${uniqueName("rep")}`;
      const { page, acc } = await member(h, "reporter", 0);
      // signed out, the form says to sign in first (and offers the way)
      const anon = await h.context(), visitor = await h.page(anon);
      await h.open(visitor, `/report?boxer=${f.slug}`); await h.signedOut(visitor);
      await visitor.locator("main a[href$='/account']").first().waitFor();
      eq(await visitor.locator("main form").count(), 0, "no form for a visitor who is not signed in");

      await h.open(page, `/report?boxer=${f.slug}`); await h.signedInAs(page, acc.username);
      const form = page.locator(`form[aria-label="${h.tr("Report a mistake")}"]`);
      await form.waitFor();
      eq(await form.locator("input[name=boxer]").inputValue(), f.slug, "the fighter named in the address is chosen");
      await form.locator("#r-field").selectOption("other");
      await form.locator("#r-note").fill(note);
      await h.click(form.getByRole("button", { name: h.label("Send for review") }));
      await form.locator("[role=status]", { hasText: h.tr("Thank you. An editor will check the source. Nothing on the page changes until then.") }).waitFor();
      // it is in the reporter's own list, waiting
      await page.locator("#my-reports ~ ul li, section[aria-labelledby=my-reports] li", { hasText: nameRe(h, f.name) }).first().waitFor();

      // an editor finds it in the queue
      const { page: ed, acc: editor } = await member(h, "editor", 0);
      h.setRole(editor.username, "editor");
      await h.open(ed, "/review/reports"); await h.signedInAs(ed, editor.username);
      const item = ed.locator("main li", { hasText: note }).first();
      await item.waitFor();
      check(await item.innerText().then((x: string) => x.includes(acc.username)), "the queue says who reported it");
      check(nameRe(h, f.name).test(await item.innerText()), "the queue says which fighter it is about");
      await item.locator("input[id^=rn-]").fill("Checked, the page is right as it is.");
      await h.click(item.getByRole("button", { name: h.label("Reject") }));
      await ed.locator("main [role=status]", { hasText: h.tr("Rejected.") }).first().waitFor();
      // and the reporter sees the editor's answer
      await page.reload(); await h.signedInAs(page, acc.username);
      await page.locator("section[aria-labelledby=my-reports] li", { hasText: "Checked, the page is right as it is." }).waitFor();
    },
  },
  {
    // post on a fighter page, reply, report another account's post, the automatic hide, the author's appeal, the editors' queue (keep hidden / restore)
    name: "forum: post, reply, report, hide, appeal, review", variants: ALL4,
    async run(h, v) {
      h.allow(API);
      const f = h.fighter(1), elsewhere = h.fighter(6);
      const A = await member(h, "author"), B = await member(h, "replier"), C = await member(h, "reporter");
      const E = await member(h, "mod", 0); h.setRole(E.acc.username, "editor");
      const p1 = words(v, A.acc.username, "the first post"), p2 = words(v, A.acc.username, "a second post"), p3 = words(v, A.acc.username, "a third post");

      // --- A writes under the fighter. The rules answer as you type: a link is refused before anything is sent.
      await openDiscussion(h, A.page, f.slug, A.acc.username);
      await A.page.locator("#forum-text").fill("Read more at www.example.com please");
      await A.page.locator("#discussion [role=alert]", { hasText: h.tr("Links are not allowed in posts.") }).waitFor();
      check(await A.page.getByRole("button", { name: h.label("Post") }).isDisabled(), "the Post button is off while the text has a link");
      await write(h, A.page, p1);
      check((await A.page.locator("#forum-text").inputValue()) === "", "the box is cleared after posting");
      // a reload shows it again, as the author's own
      await A.page.reload(); await h.ready(A.page);
      const mine = post(A.page, p1); await mine.waitFor();
      check((await mine.innerText()).includes(h.tr("you")), "the author sees it marked as theirs");

      // --- B reads it, and replies
      await openDiscussion(h, B.page, f.slug, B.acc.username);
      await post(B.page, p1).waitFor();
      check((await post(B.page, p1).innerText()).includes(A.acc.username), "the author's name is shown to others");
      const reply = words(v, B.acc.username, "the reply");
      await write(h, B.page, reply);
      await A.page.reload(); await h.ready(A.page);
      await post(A.page, reply).waitFor();

      // --- C reports A's post with the keyboard-friendly form: focus goes into it, Enter sends it, focus comes back
      await openDiscussion(h, C.page, f.slug, C.acc.username);
      const theirs = post(C.page, p1); await theirs.waitFor();
      await h.click(theirs.getByRole("button", { name: h.label("Report") }));
      const reason = theirs.locator("select");
      await reason.waitFor();
      await h.focused(reason, "focus moves into the report form");
      await reason.selectOption("spam");
      await theirs.locator("input").fill("looks like an advert");
      await theirs.locator("input").press("Enter");
      await C.page.locator("#discussion [role=status]", { hasText: h.tr("Reported. Thank you.") }).waitFor();
      await h.focused(theirs.getByRole("button", { name: h.label("Report") }), "focus returns to the Report button");
      // one report from a new account hides nothing
      await A.page.reload(); await h.ready(A.page);
      await post(A.page, p1).waitFor();

      // --- two established reporters (a week old, three posts of their own) from other networks: the post is hidden until an editor looks
      const R1 = await established(h, "veteran", v, elsewhere.slug), R2 = await established(h, "regular", v, elsewhere.slug);
      const id1 = await postId(h, A.ctx, f.slug, p1);
      eq((await report(h, R1.ctx, id1)).status(), 201, "the first established report is taken");
      eq((await report(h, R2.ctx, id1)).status(), 201, "the second established report is taken");
      await B.page.reload(); await h.ready(B.page);
      await B.page.locator("li[id^=post-]", { hasText: h.tr("This post was hidden.") }).first().waitFor();
      eq(await post(B.page, p1).count(), 0, "everyone else no longer sees the words");

      // --- the author is told, and asks for a review
      await A.page.reload(); await h.ready(A.page);
      const hidden = A.page.locator("li[id^=post-]", { hasText: h.tr("Your post was hidden after reports from other members. You can ask the editors to review it.") });
      await hidden.waitFor();
      await h.click(hidden.getByRole("button", { name: h.label("Ask for a review") }));
      await A.page.locator("li[id^=post-]", { hasText: h.tr("Your post is under review by the editors.") }).waitFor();
      eq(await A.page.getByRole("button", { name: h.label("Ask for a review") }).count(), 0, "one appeal per post");

      // --- the editors' queue shows it first, marked as an appeal, with the words; Keep hidden settles it
      await h.open(E.page, "/review/forum"); await h.signedInAs(E.page, E.acc.username);
      const queued = E.page.locator("main ol li", { hasText: p1 });
      await queued.waitFor();
      await queued.getByText(h.tr("appeal: the author asks for a review")).waitFor();
      await h.click(queued.getByRole("button", { name: h.label("Keep hidden") }));
      await E.page.locator("main [role=status]", { hasText: h.tr("Kept hidden.") }).waitFor();
      await A.page.reload(); await h.ready(A.page);
      await A.page.locator("li[id^=post-]", { hasText: h.tr("An editor reviewed your post and it stays hidden.") }).waitFor();
      eq(await A.page.getByRole("button", { name: h.label("Ask for a review") }).count(), 0, "a decided appeal cannot be made again");

      // --- a second post goes the same way, and this time the editor restores it
      await A.page.locator("#forum-text").scrollIntoViewIfNeeded();
      await write(h, A.page, p2);
      const id2 = await postId(h, A.ctx, f.slug, p2);
      await report(h, R1.ctx, id2); await report(h, R2.ctx, id2);
      await A.page.reload(); await h.ready(A.page);
      const hidden2 = A.page.locator("li[id^=post-]", { hasText: h.tr("Your post was hidden after reports from other members. You can ask the editors to review it.") });
      await hidden2.waitFor();
      await h.click(hidden2.getByRole("button", { name: h.label("Ask for a review") }));
      await A.page.locator("li[id^=post-]", { hasText: h.tr("Your post is under review by the editors.") }).waitFor();
      await E.page.reload(); await h.ready(E.page);
      const queued2 = E.page.locator("main ol li", { hasText: p2 });
      await queued2.waitFor();
      await h.click(queued2.getByRole("button", { name: h.label("Restore") }));
      await E.page.locator("main [role=status]", { hasText: h.tr("Restored.") }).waitFor();
      await B.page.reload(); await h.ready(B.page);
      await post(B.page, p2).waitFor(); // back for everyone

      // --- an editor who hides a post by hand: no appeal for the author
      await write(h, A.page, p3);
      await openDiscussion(h, E.page, f.slug, E.acc.username);
      await h.click(post(E.page, p3).getByRole("button", { name: h.label("Hide") }));
      await E.page.locator("#discussion [role=status]", { hasText: h.tr("Hidden.") }).waitFor();
      await A.page.reload(); await h.ready(A.page);
      await A.page.locator("li[id^=post-]", { hasText: h.tr("This post was hidden.") }).first().waitFor();
      eq(await A.page.getByRole("button", { name: h.label("Ask for a review") }).count(), 0, "a post an editor hid by hand has no appeal");
      void C;
    },
  },
  {
    // deleting the account erases the words, not just the name
    name: "deleting an account erases its forum words", variants: ALL4,
    async run(h, v) {
      h.allow(API);
      const f = h.fighter(2);
      const D = await member(h, "leaving"), B = await member(h, "staying");
      const text = words(v, D.acc.username, "the end of an era");
      await openDiscussion(h, D.page, f.slug, D.acc.username);
      await write(h, D.page, text);
      await openDiscussion(h, B.page, f.slug, B.acc.username);
      await post(B.page, text).waitFor();
      const reply = words(v, B.acc.username, "answering the first post");
      await write(h, B.page, reply);
      check(h.accountsFileContains(text).length > 0, "the words are stored while the account exists (the check can find them)");

      await h.open(D.page, "/account"); await h.signedInAs(D.page, D.acc.username);
      await h.click(D.page.getByRole("button", { name: h.label("Delete my account") }));
      const form = D.page.locator(`form[aria-label="${h.tr("Delete my account")}"]`);
      await form.locator("#del-pw").fill("not the password");
      await form.locator("#del-pw").press("Enter");
      await form.locator("[role=status]", { hasText: h.tr("That password is not right.") }).waitFor();
      await form.locator("#del-pw").fill(D.acc.password);
      await h.click(form.getByRole("button", { name: h.label("Delete for good") }));
      await h.signedOut(D.page);
      await D.page.getByRole("tablist").waitFor();

      // gone from what anyone is shown: the place stays (the reply still reads), the words and the name do not
      await B.page.reload(); await h.ready(B.page);
      await post(B.page, reply).waitFor();
      eq(await B.page.locator("#discussion").innerText().then((x: string) => x.includes(text)), false, "the deleted account's words are not on the page");
      eq(await B.page.locator("#discussion").innerText().then((x: string) => x.includes(D.acc.username)), false, "nor its name");
      const thread = await (await B.ctx.request.get(`${h.server.base}/api/forum/thread?kind=boxer&subject=${f.slug}`)).json();
      eq(JSON.stringify(thread).includes(text), false, "the thread's answer has no trace of the words");
      // and not in the file either, in any table
      eq(h.accountsFileContains(text), [], "no table of the accounts file still holds the words");
      eq(h.accountsFileContains(D.acc.username).filter((c) => !/audit|log/i.test(c)), [], "no table but the activity log still holds the name");
      // the name cannot sign in again
      const again = await B.ctx.request.post(`${h.server.base}/api/account/login`, { data: { username: D.acc.username, password: PASSWORD } });
      eq(again.status() >= 400, true, "a deleted account cannot sign in");
    },
  },
];
