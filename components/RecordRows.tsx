import Link from "@/components/L";
import type { World } from "@/lib/world";
import { Headshot } from "./Portrait";
import { listDef, rowText, type ListId, type Row } from "@/lib/records";
import { beltLabel } from "@/lib/lineage";
import { divisionLabel } from "@/lib/divisions";
import { resultLine, tier, TIER_LABEL } from "@/lib/fight-score";
import { countryName, flag, fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";

/** One list as ranked rows: who or which fight, the figure that earned the place, and a line of detail under it. */
export async function RecordRows({ w, id, rows, compact = false }: { w: World; id: ListId; rows: Row[]; compact?: boolean }) {
  const t = await getT();
  const subject = listDef(id)!.subject;
  return (
    <ol className="divide-y divide-line/60">
      {rows.map((r) => {
        const { value, sub } = rowText(id, r, t);
        const b = r.boxer, bout = r.bout;
        return (
          <li key={`${r.rank}-${b?.id ?? bout?.id}-${r.reign?.n ?? ""}`} className={compact ? "grid grid-cols-[2rem_minmax(0,1fr)_auto] items-center gap-3 py-2" : "grid grid-cols-[2rem_minmax(0,1fr)] items-center gap-x-3 gap-y-1 py-3 sm:grid-cols-[2rem_minmax(0,1fr)_auto]"}>
            <span className={`font-display text-xl font-bold tabular text-muted ${compact ? "" : "row-span-2 sm:row-span-1"}`}>{r.rank}</span>
            {subject === "bout" && bout ? (
              <div className="min-w-0">
                <Link href={`/bouts/${bout.id}`} className="font-semibold hover:text-gold">{t.name(bout.redName)} <span className="text-muted">{t("vs")}</span> {t.name(bout.blueName)}</Link>
                <div className="text-xs text-muted">{resultLine(w, bout, t)} · {fmtDate(bout.date, { month: "short", day: "numeric", year: "numeric" }, t.locale)}</div>
              </div>
            ) : b ? (
              <div className="flex min-w-0 items-center gap-3">
                {!compact && <Headshot boxer={b} size={40} />}
                <div className="min-w-0">
                  <Link href={`/boxers/${b.slug}`} className="line-clamp-2 font-semibold hover:text-gold">{t.name(b.name)}</Link>
                  <div className="text-xs text-muted">
                    {r.belt && r.reign ? <><Link href={`/titles/${r.belt.slug}`} className="hover:text-ink">{beltLabel(r.belt, t)}</Link> · {divisionLabel(r.belt.division, r.belt.sex, t)}</>
                      : <>{flag(b.country)} {countryName(b.country, t.locale)} · {divisionLabel(b.weightClass, b.sex, t)}{!b.active && ` · ${t("retired")}`}</>}
                  </div>
                </div>
              </div>
            ) : <span />}
            <div className={compact ? "text-end" : "col-start-2 flex flex-wrap items-baseline gap-x-3 sm:col-start-3 sm:row-start-1 sm:block sm:text-end"}>
              <div className="font-display text-xl font-bold tabular text-gold">{value}</div>
              {id === "fights" ? <div className="text-xs text-muted">{t(TIER_LABEL[tier(r.value)])}</div> : sub && !compact && <div className="text-xs text-muted sm:max-w-[18rem]">{sub}</div>}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
