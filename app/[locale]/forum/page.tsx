import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { fmtDate } from "@/lib/format";
import { accountsDbIfAny } from "@/lib/accounts/store";
import { listThreads } from "@/lib/forum/posts";
import { Pager } from "@/components/ui";
import { StartThread } from "@/components/StartThread";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/forum", title: t("Forum"), description: t("Talk boxing with other fans: any topic, on the general board; and under every fighter and every fight."), noindex: true, // what people write is not for search engines
}));

export default async function Forum({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const t = await getT();
  const sp = await searchParams;
  const acc = accountsDbIfAny();
  const list = acc ? listThreads(Number(sp.page) || 1, acc) : { threads: [], total: 0, pages: 1, page: 1 };
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Community")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Forum")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Talk boxing with other fans. This is the general board. Every fighter and every fight also has its own discussion at the bottom of its page.")}</p>
        <p className="mt-3 text-sm"><Link href="/forum/rules" className="underline decoration-dotted hover:text-ink">{t("Forum rules")}</Link></p>
      </div>
      <StartThread />
      <section>
        <h2 className="eyebrow mb-3">{t("Threads")}</h2>
        {list.threads.length === 0 ? <p className="text-sm text-muted">{t("No threads yet. Start the first one.")}</p> : (
          <ul className="card divide-y divide-line/60">
            {list.threads.map((th) => (
              <li key={th.id} className="flex flex-wrap items-baseline justify-between gap-2 p-4">
                <div className="min-w-0"><Link href={`/forum/${th.id}`} className="font-semibold hover:text-gold" dir="auto">{th.title ?? t("[removed]")}</Link>
                  <div className="text-xs text-muted">{th.author ?? t("deleted account")} · {fmtDate(th.createdAt.slice(0, 10), { month: "short", day: "numeric", year: "numeric" }, t.locale)}{th.locked ? ` · ${t("locked")}` : ""}</div></div>
                <div className="text-xs text-muted tabular">{t.n(th.postCount, "{n} post", "{n} posts")}</div>
              </li>
            ))}
          </ul>
        )}
        <Pager page={list.page} pages={list.pages} href={(n) => `/forum${n > 1 ? `?page=${n}` : ""}`} />
      </section>
    </div>
  );
}
