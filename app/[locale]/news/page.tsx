import Link from "@/components/L";
import { NewsList } from "@/components/NewsList";
import { SectionTitle } from "@/components/ui";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { recentNews, recentVideos } from "@/lib/news/read";
import { Videos } from "@/components/Videos";
import { NEWS_SOURCES } from "@/lib/news/sources";

// Other outlets' headlines: a page of links to their work, not content of ours, so it is kept out of search results.
export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/news", title: t("Boxing news"), noindex: true,
  description: t("The latest headlines from boxing outlets, each linking to the original story."),
}));

export default async function News({ searchParams }: { searchParams: Promise<{ source?: string }> }) {
  const t = await getT();
  const { source } = await searchParams;
  const all = await recentNews();
  const held = [...new Set(all.map((n) => n.source))];
  const only = source && held.includes(source) ? source : undefined;
  const videos = (await recentVideos()).slice(0, 12);
  const items = (only ? all.filter((n) => n.source === only) : all).slice(0, 60);
  return (
    <div className="space-y-8">
      <div className="rise">
        <div className="eyebrow mb-2">{t("In the news")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase leading-[.95] sm:text-6xl">{t("Boxing news")}</h1>
        <p className="mt-3 max-w-2xl text-muted">{t("Headlines from boxing outlets. Each one links to the original story on the outlet's own site; we show only the headline and the short excerpt the outlet itself publishes.")}</p>
      </div>
      {held.length > 1 && (
        <nav aria-label={t("Outlets")} className="flex flex-wrap gap-2">
          <Link href="/news" aria-current={only ? undefined : "page"} className={`chip ${only ? "" : "text-ink"}`}>{t("All outlets")}</Link>
          {held.map((id) => <Link key={id} href={`/news?source=${id}`} aria-current={only === id ? "page" : undefined} className={`chip ${only === id ? "text-ink" : ""}`}><span lang="en" dir="ltr">{NEWS_SOURCES.find((s) => s.id === id)?.name ?? id}</span></Link>)}
        </nav>
      )}
      {videos.length > 0 && <section><SectionTitle eyebrow={t("Official videos")} title={t("From the promoters' and networks' own channels")} /><Videos items={videos} t={t} /></section>}
      {items.length ? <section><SectionTitle eyebrow={t("Latest")} title={t.n(items.length, "{n} headline", "{n} headlines")} /><NewsList items={items} t={t} /></section>
        : <div className="card p-6 text-muted">{t("No headlines yet. They appear once the site's news refresh has run.")}</div>}
    </div>
  );
}
