import Link from "@/components/L";
import { getWorld } from "@/lib/world";
import { belts, beltLabel } from "@/lib/lineage";
import { DIVISIONS_HEAVIEST_FIRST, divisionLabel, slugifyDivision } from "@/lib/divisions";
import { Headshot } from "@/components/Portrait";
import { SectionTitle, Stat } from "@/components/ui";
import { fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { metaFor } from "@/lib/seo-server";

export const generateMetadata = ({ params }: { params: Promise<{ locale: string }> }) => metaFor(params, (p, t) => ({
  path: "/titles", title: t("Title lineages"),
  description: t("Who holds every belt in every division, and the full line of champions behind it: reigns, title defences, who beat whom for the belt, and how long each champion lasted."),
}));

export default async function Titles({ searchParams }: { searchParams: Promise<{ sex?: string }> }) {
  const t = await getT();
  const sex = (await searchParams).sex === "female" ? "female" : "male";
  const w = await getWorld();
  const all = belts(w);
  const mine = all.filter((b) => b.sex === sex);
  const holders = new Map<number, number>();
  for (const b of mine) if (b.current && !b.stale) holders.set(b.current.boxerId, (holders.get(b.current.boxerId) ?? 0) + 1);
  const multi = [...holders].filter(([, n]) => n > 1);
  const totalDefenses = mine.reduce((s, b) => s + b.reigns.reduce((x, r) => x + r.defenses.length, 0), 0);
  const q = sex === "female" ? "?sex=female" : "";

  return (
    <div className="space-y-12">
      <div>
        <div className="eyebrow mb-2">{t("Every belt, every champion")}</div>
        <h1 className="font-display text-5xl font-extrabold uppercase">{t("Title lineages")}</h1>
        <p className="mt-2 max-w-3xl text-muted">{t("Rebuilt from the title fights in the data: a champion who wins a title fight is a defence, one who loses hands the belt on, and a vacant-title fight crowns a new one. What the results cannot show (a champion stripped, or a belt vacated by retirement) is not guessed; a dormant belt is marked as such.")}</p>
        <div className="mt-4 flex gap-2">
          <Link href="/titles" className={`chip ${sex === "male" ? "!border-gold/50 !text-gold" : ""}`}>{t("Men")}</Link>
          <Link href="/titles?sex=female" className={`chip ${sex === "female" ? "!border-gold/50 !text-gold" : ""}`}>{t("Women")}</Link>
        </div>
      </div>

      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={t("Belts")} value={mine.length} sub={t("bodies × titles × divisions")} />
        <Stat label={t("Reigns")} value={mine.reduce((s, b) => s + b.reigns.length, 0).toLocaleString("en-US")} sub={t("champions on record")} />
        <Stat label={t("Title defences")} value={totalDefenses.toLocaleString("en-US")} sub={t("wins by the champion")} />
        <Stat label={t("Multi-belt champions")} value={multi.length} sub={t("hold two or more live belts")} />
      </section>

      <nav aria-label={t("Jump to a division")} className="-mt-6 flex flex-wrap gap-1.5">
        {DIVISIONS_HEAVIEST_FIRST.filter((d) => mine.some((b) => b.division === d.name)).map((d) => <a key={d.name} href={`#div-${slugifyDivision(d.name)}`} className="chip hover:!text-ink">{divisionLabel(d.name, sex, t)}</a>)}
      </nav>

      {DIVISIONS_HEAVIEST_FIRST.map((d) => {
        const list = mine.filter((b) => b.division === d.name);
        if (!list.length) return null;
        return (
          <section key={d.name} id={`div-${slugifyDivision(d.name)}`}>
            <SectionTitle eyebrow={`${list.length} ${list.length === 1 ? t("belt") : t("belts")}`} title={divisionLabel(d.name, sex, t)} href={`/rankings/${slugifyDivision(d.name)}${q}`} cta={t("Rankings")} />
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {list.map((b) => {
                const champ = b.current ? w.byId.get(b.current.boxerId) : undefined;
                return (
                  <Link key={b.slug} href={`/titles/${b.slug}`} className="card card-hover min-w-0 p-4">
                    <div className="mb-2 flex items-center justify-between gap-2">
                      <div className="min-w-0 text-xs uppercase leading-snug tracking-widest text-gold">{beltLabel(b, t)}</div>
                      {b.stale && <span className="chip !px-2 !py-0 text-xs">{t("dormant")}</span>}
                    </div>
                    {champ && b.current ? (
                      <div className="flex items-center gap-3">
                        <Headshot boxer={champ} size={44} />
                        <div className="min-w-0">
                          <div className="truncate font-display text-xl font-bold leading-tight">{t.name(champ.name)}</div>
                          <div className="text-xs text-muted">{t("since {date}", { date: fmtDate(b.current.start, { month: "short", year: "numeric" }, t.locale) })} · {t.n(b.current.defenses.length, "{n} defence", "{n} defences")}</div>
                          {(holders.get(champ.id) ?? 0) > 1 && !b.stale && <span className="chip mt-1 !border-gold/40 !px-2 !py-0 text-xs !text-gold">{t("holds {n} belts", { n: holders.get(champ.id) ?? 0 })}</span>}
                        </div>
                      </div>
                    ) : <div className="text-sm text-muted">{t("Vacant")}</div>}
                    <div className="mt-3 text-xs text-muted">{t.n(b.reigns.length, "{n} reign", "{n} reigns")} · {t.n(b.titleFights, "{n} title fight", "{n} title fights")}</div>
                  </Link>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
