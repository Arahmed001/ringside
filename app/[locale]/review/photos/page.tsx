import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";
import { PhotoQueue } from "@/components/PhotoQueue";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/review/photos", title: t("Recorded pictures"), description: t("Editors record a fighter's picture together with the licence or permission that lets the site show it."), noindex: true,
}));

export default async function ReviewPhotos() {
  const t = await getT();
  return (
    <div className="space-y-8">
      <div>
        <div className="eyebrow mb-2">{t("Editors")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Recorded pictures")}</h1>
        <p className="mt-2 max-w-2xl text-muted">{t("Record a fighter's picture only with the right to show it: a free licence, or the rights-holder's permission and how you know. The credit is shown beside the picture. A picture that came with the supplier's data is never replaced. Never use a picture from BoxRec or one you do not have the right to use.")}</p>
        <p className="mt-3 flex gap-4 text-sm"><Link href="/review" className="underline decoration-dotted hover:text-ink">{t("Team-history edits")}</Link><Link href="/review/social" className="underline decoration-dotted hover:text-ink">{t("Chosen posts")}</Link></p>
      </div>
      <PhotoQueue />
    </div>
  );
}
