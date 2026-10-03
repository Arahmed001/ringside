import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";

export default async function NotFound() {
  const t = await getT();
  return (
    <div className="py-24 text-center">
      <div className="eyebrow mb-2">404</div>
      <h1 className="font-display text-5xl font-extrabold uppercase">{t("Not on the card")}</h1>
      <p className="mx-auto mt-3 max-w-md text-muted">{t("That page doesn’t exist, or the fighter or event was removed.")}</p>
      <Link href="/" className="mt-6 inline-block rounded-xl bg-red-btn px-6 text-white py-2.5 font-display text-lg font-bold uppercase transition hover:brightness-90">{t("Back to the ring")}</Link>
    </div>
  );
}
