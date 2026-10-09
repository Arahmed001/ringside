import Link from "@/components/L";
import { NewsList } from "@/components/NewsList";
import { SectionTitle } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { recentNews, recentVideos } from "@/lib/news/read";
import { Videos } from "@/components/Videos";
import { Social } from "@/components/Social";
import { postsFor } from "@/lib/social/store";
import { NEWS_SOURCES } from "@/lib/news/sources";

// Other outlets' headlines: a page of links to their work, not content of ours, so it is kept out of search results.
export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/news", title: t("Boxing news"), noindex: true,
  description: t("The latest headlines from boxing outlets, each linking to the original story."),
}));

export default async function News({ searchParams }: { searchParams: Promise<{ source?: string; tab?: string }> }) {
  const t = await getT();
  const { source, tab: asked } = await searchParams;
  const all = await recentNews();
  const held = [...new Set(all.map((n) => n.source))];
  const only = source && held.includes(source) ? source : undefined;
  const videos = (await recentVideos()).slice(0, 24);
  const posts = postsFor("general", null);
  // two tabs, as plain links (no script needed): videos first, unless there are none or the visitor asked for the news
  const tab: "videos" | "news" = asked === "news" || (asked !== "videos" && !videos.length) ? "news" : "videos";
  const items = (only ? all.filter((n) => n.source === only) : all).slice(0, 60);
  return (
    <div className="space-y-8">
      <div className="rise">
        <div className="eyebrow mb-2">{t("In the news")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase leading-[.95] sm:text-6xl">{t("Boxing news")}</h1>
        <p className="mt-3 max-w-2xl text-muted">{t("Headlines from boxing outlets. Each one links to the original story on the outlet's own site; we show only the headline and the short excerpt the outlet itself publishes.")}</p>
      </div>
      <nav aria-label={t("News sections")} className="flex flex-wrap gap-2">
        <Link href="/news?tab=videos" aria-current={tab === "videos" ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${tab === "videos" ? "border-gold/60 text-ink" : "border-line text-muted hover:text-ink"}`}>{t("Videos to watch")}</Link>
        <Link href="/news?tab=news" aria-current={tab === "news" ? "page" : undefined} className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm ${tab === "news" ? "border-gold/60 text-ink" : "border-line text-muted hover:text-ink"}`}>{t("News to read")}</Link>
      </nav>
      {tab === "videos" ? (
        videos.length > 0 ? <section><SectionTitle eyebrow={t("Official videos")} title={t("From the promoters' and networks' own channels")} /><Videos items={videos} t={t} /></section>
          : <div className="card p-6 text-muted">{t("No official videos yet. They appear once the site's news refresh has run with a YouTube key.")}</div>
      ) : (
        <>
          {held.length > 1 && (
            <nav aria-label={t("Outlets")} className="flex flex-wrap gap-2">
              <Link href="/news?tab=news" aria-current={only ? undefined : "page"} className={`chip ${only ? "" : "text-ink"}`}>{t("All outlets")}</Link>
              {held.map((id) => <Link key={id} href={`/news?tab=news&source=${id}`} aria-current={only === id ? "page" : undefined} className={`chip ${only === id ? "text-ink" : ""}`}><span lang="en" dir="ltr">{NEWS_SOURCES.find((s) => s.id === id)?.name ?? id}</span></Link>)}
            </nav>
          )}
          {posts.length > 0 && <section><SectionTitle eyebrow={t("Posts")} title={t("Chosen from official accounts")} /><Social items={posts} t={t} /></section>}
          {items.length ? <section><SectionTitle eyebrow={t("Latest")} title={t.n(items.length, "{n} headline", "{n} headlines")} /><NewsList items={items} t={t} /></section>
            : <div className="card p-6 text-muted">{t("No headlines yet. They appear once the site's news refresh has run.")}</div>}
        </>
      )}
    </div>
  );
}
