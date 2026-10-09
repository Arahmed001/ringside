import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { ReviewQueue } from "@/components/ReviewQueue";
import { EditorTools } from "@/components/EditorTools";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/review", title: t("Review queue"), description: t("Editors check suggested team-history edits against their sources."), noindex: true,
}));

export default async function Review() {
  const t = await getT();
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Editors")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Review queue")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Read the source, have the quote checked on the live page, then approve or reject. Approving publishes the edit at once, marked as a community edit with its link. You cannot decide your own proposal.")}</p>
        <p className="mt-3 flex gap-4 text-sm"><Link href="/review/reports" className="underline decoration-dotted hover:text-ink">{t("Reports of mistakes")}</Link><Link href="/review/updates" className="underline decoration-dotted hover:text-ink">{t("Source updates")}</Link></p>
      </div>
      <EditorTools />
      <ReviewQueue />
    </div>
  );
}
