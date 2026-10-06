import Link from "@/components/L";
import type { FighterTenure } from "@/lib/team";
import { Headshot } from "./Portrait";
import { fmtDate } from "@/lib/format";
import { getT } from "@/lib/i18n/server";
import { Pager } from "@/components/ui";
import { paginate } from "@/lib/paging";

/**
 * One row per fighter-tenure with the record and Elo change accumulated during it, newest first. Given a `pager` (the page asked for and the address of any
 * page) it shows `limit` rows a page and every row is reachable; without one it shows the first `limit` and says how many there are.
 */
export async function TenureTable({ tenures, limit = 40, pager }: { tenures: FighterTenure[]; limit?: number; pager?: { page: string | undefined; href: (n: number) => string; label?: string } }) {
  const t = await getT();
  const pg = pager ? paginate(tenures.length, pager.page, limit) : null;
  const rows = pg ? tenures.slice(pg.first, pg.first + limit) : tenures.slice(0, limit);
  if (!rows.length) return <p className="text-sm text-muted">{t("No fighters on record.")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm" aria-label={t("Fighters")}>
        <thead><tr className="text-start text-xs uppercase tracking-widest text-muted"><th className="py-2">{t("Fighter")}</th><th>{t("Period")}</th><th>{t("Record together")}</th><th className="text-end">{t("Elo change")}</th></tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.stint.id} className="border-t border-line/60">
              <td className="py-2"><Link href={`/boxers/${x.boxer.slug}`} className="flex items-center gap-3"><Headshot boxer={x.boxer} size={30} /><span><b>{t.name(x.boxer.name)}</b><span className="block text-xs text-muted">{t(x.boxer.weightClass)}</span></span></Link></td>
              <td className="whitespace-nowrap text-muted">{x.stint.start ? fmtDate(x.stint.start, { month: "short", year: "numeric" }, t.locale) : "?"} – {x.current ? <span className="text-win">{t("present")}</span> : x.stint.end ? fmtDate(x.stint.end, { month: "short", year: "numeric" }, t.locale) : "?"}</td>
              <td className="tabular">{x.record.wins}-{x.record.losses}-{x.record.draws}{x.record.bouts ? <span className="ms-1.5 text-xs text-muted">{Math.round(x.record.winRate * 100)}%</span> : null}</td>
              <td className={`text-end tabular font-semibold ${x.ratingChange === null ? "text-muted" : x.ratingChange >= 0 ? "text-win" : "text-red-ink"}`}><bdi dir="ltr">{x.ratingChange === null ? "–" : `${x.ratingChange >= 0 ? "+" : ""}${Math.round(x.ratingChange)}`}</bdi></td>
            </tr>
          ))}
        </tbody>
      </table>
      {pg && pager ? <Pager page={pg.page} pages={pg.pages} href={pager.href} label={pager.label} /> : tenures.length > limit && <p className="mt-2 text-xs text-muted">{t("Showing the {limit} most recent of {total}.", { limit, total: tenures.length })}</p>}
    </div>
  );
}
