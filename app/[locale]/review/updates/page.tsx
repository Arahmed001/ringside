import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { UpdateQueue } from "@/components/UpdateQueue";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/review/updates", title: t("Source updates"), description: t("Administrators decide on changes that public sources seem to have made to data we hold."), noindex: true,
}));

export default async function ReviewUpdates() {
  const t = await getT();
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Administrators")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Source updates")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("A check of a public source found these differences from what we hold. Nothing is applied until you approve it, and approving writes it to the live data at once. A rejected change is not raised again unless the source says something different.")}</p>
        <p className="mt-3 flex gap-4 text-sm"><Link href="/review" className="underline decoration-dotted hover:text-ink">{t("Team-history edits")}</Link><Link href="/review/reports" className="underline decoration-dotted hover:text-ink">{t("Reports of mistakes")}</Link></p>
      </div>
      <UpdateQueue />
    </div>
  );
}
