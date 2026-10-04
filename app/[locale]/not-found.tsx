import { headers } from "next/headers";
import Link from "@/components/L";
import { localePath } from "@/lib/i18n/config";
import { getT } from "@/lib/i18n/server";
import { getWorld } from "@/lib/world";
import { getNames } from "@/lib/i18n/names";
import { searchFighters } from "@/lib/fighter-search";
import { nameFromPath } from "@/lib/not-found";
import { BoxerCard } from "@/components/ui";

export default async function NotFound() {
  const t = await getT();
  // an address that looked like a fighter's: offer the nearest names (the search forgives a slip, a missing letter, a changed slug)
  const guess = nameFromPath((await headers()).get("x-pathname") ?? "");
  const near = guess ? searchFighters(await getWorld(), guess, { limit: 4, minBouts: 1, names: await getNames(t.locale) }) : [];
  return (
    <div className="py-16 text-center">
      <div className="eyebrow mb-2">404</div>
      <h1 className="font-display text-5xl font-extrabold uppercase">{t("Not on the card")}</h1>
      <p className="mx-auto mt-3 max-w-md text-muted">{t("That page doesn’t exist, or the fighter or event was removed.")}</p>
      {near.length > 0 && (
        <section className="mx-auto mt-8 max-w-3xl text-start">
          <h2 className="eyebrow mb-3">{t("Did you mean one of these fighters?")}</h2>
          <div className="grid gap-3 sm:grid-cols-2">{near.map((b) => <BoxerCard key={b.id} b={b} />)}</div>
        </section>
      )}
      <form action={localePath(t.locale, "/boxers")} className="mx-auto mt-8 flex max-w-md gap-2">
        <input name="q" aria-label={t("Search fighters")} defaultValue={guess ?? ""} placeholder={t("Search fighters")} className="min-w-0 flex-1 rounded-2xl border border-line bg-panel px-4 py-3 outline-none transition placeholder:text-muted focus:border-gold/60" />
        <button className="rounded-2xl border border-line bg-panel-2 px-5 font-semibold transition hover:text-gold">{t("Search")}</button>
      </form>
      <Link href="/" className="mt-6 inline-block rounded-xl bg-red-btn px-6 text-white py-2.5 font-display text-lg font-bold uppercase transition hover:brightness-90">{t("Back to the ring")}</Link>
    </div>
  );
}
