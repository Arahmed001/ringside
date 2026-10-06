import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { AUTO_HIDE_REPORTS, EDIT_WINDOW_MS, NEW_ACCOUNT_DAILY, NEW_ACCOUNT_WAIT_MS, POST_MAX, POSTS_PER_USER, THREADS_PER_USER } from "@/lib/forum/rules";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/forum/rules", title: t("Forum rules"), description: t("What you can write in the Ringside forum, how often, and what happens when a post is reported."), noindex: true,
}));

/** The rules, in words, with every number read from lib/forum/rules.ts so the page cannot drift from what the server enforces. */
export default async function ForumRules() {
  const t = await getT();
  const min = (ms: number) => Math.round(ms / 60_000);
  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <Link href="/forum" className="text-sm text-muted underline decoration-dotted hover:text-ink">{t("← The forum")}</Link>
        <h1 className="mt-3 font-display text-5xl font-extrabold uppercase">{t("Forum rules")}</h1>
        <p className="mt-2 text-muted">{t("Short, so they can be kept. The forum is for talking about boxing, fighters and fights.")}</p>
      </div>
      <section className="card space-y-3 p-5 text-sm">
        <h2 className="eyebrow">{t("What you can write")}</h2>
        <ul className="list-disc space-y-1.5 ps-5">
          <li>{t("Plain text, up to {n} characters. No formatting.", { n: POST_MAX })}</li>
          <li>{t("No links, and no long numbers such as phone numbers. Most unwanted posts are links, so none are allowed for now.")}</li>
          <li>{t("Be decent. Argue about the fight, not the person. No harassment, hate, threats, or other people’s private details.")}</li>
          <li>{t("Stay on boxing. Do not advertise, and do not post the same thing twice.")}</li>
        </ul>
      </section>
      <section className="card space-y-3 p-5 text-sm">
        <h2 className="eyebrow">{t("Who can write, and how often")}</h2>
        <ul className="list-disc space-y-1.5 ps-5">
          <li>{t("You need an account. A new account can post after {n} minutes.", { n: min(NEW_ACCOUNT_WAIT_MS) })}</li>
          <li>{t("An account under a day old can post {n} times a day.", { n: NEW_ACCOUNT_DAILY })}</li>
          <li>{t("At most {posts} posts in {minutes} minutes, and {threads} new threads a day.", { posts: POSTS_PER_USER.max, minutes: min(POSTS_PER_USER.windowMs), threads: THREADS_PER_USER.max })}</li>
        </ul>
      </section>
      <section className="card space-y-3 p-5 text-sm">
        <h2 className="eyebrow">{t("Reports, hiding and your own posts")}</h2>
        <ul className="list-disc space-y-1.5 ps-5">
          <li>{t("Anyone with an account can report a post. When {n} different people report one, it is hidden until an editor looks at it.", { n: AUTO_HIDE_REPORTS })}</li>
          <li>{t("Editors can hide or restore a post and lock or hide a thread. A hidden post keeps its place, but its words and its author are not shown. Every action is logged.")}</li>
          <li>{t("You can edit your own post for {n} minutes, and delete it at any time. Deleting wipes the words.", { n: min(EDIT_WINDOW_MS) })}</li>
          <li>{t("Deleting your account wipes everything you wrote here. The privacy page says what is kept until then.")}</li>
        </ul>
      </section>
      <p className="text-sm text-muted">{t("Posts are not shown to search engines.")} <Link href="/privacy" className="underline decoration-dotted hover:text-ink">{t("Privacy")}</Link></p>
    </div>
  );
}
