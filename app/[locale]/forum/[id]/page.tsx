import { notFound } from "next/navigation";
import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { fmtDate } from "@/lib/format";
import { accountsDbIfAny } from "@/lib/accounts/store";
import { getThread } from "@/lib/forum/posts";
import { Discussion } from "@/components/Discussion";

const threadOf = (id: string) => { const acc = accountsDbIfAny(); const n = /^\d{1,9}$/.test(id) ? Number(id) : 0; const th = acc && n ? getThread(n, acc) : null; return th && th.kind === "general" ? th : null; };

export const generateMetadata = ({ params }: { params: Promise<{ locale: string; id: string }> }) => metaFor(params, (p, t) => {
  const th = threadOf(p.id);
  if (!th) notFound();
  return { path: `/forum/${p.id}`, title: th.title ?? t("Forum"), description: t("A thread on the Ringside forum."), noindex: true };
});

export default async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const t = await getT();
  const { id } = await params;
  const th = threadOf(id);
  if (!th) notFound();
  return (
    <div className="space-y-6">
      <div>
        <Link href="/forum" className="text-sm text-muted underline decoration-dotted hover:text-ink">{t("← All threads")}</Link>
        <h1 className="mt-3 font-display text-4xl font-extrabold uppercase" dir="auto">{th.title ?? t("[removed]")}</h1>
        <p className="mt-1 text-sm text-muted">{th.author ?? t("deleted account")} · {fmtDate(th.createdAt.slice(0, 10), { month: "short", day: "numeric", year: "numeric" }, t.locale)}</p>
      </div>
      <Discussion target={{ threadId: th.id }} />
    </div>
  );
}
