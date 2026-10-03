import Link from "next/link";
import type { FighterTenure } from "@/lib/team";
import { Headshot } from "./Portrait";
import { fmtDate } from "@/lib/format";

/** One row per fighter-tenure with the record and Elo change accumulated during it. */
export function TenureTable({ tenures, limit = 40 }: { tenures: FighterTenure[]; limit?: number }) {
  const rows = tenures.slice(0, limit);
  if (!rows.length) return <p className="text-sm text-muted">No fighters on record.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-[11px] uppercase tracking-widest text-muted"><th className="py-2">Fighter</th><th>Period</th><th>Record together</th><th className="text-right">Elo change</th></tr></thead>
        <tbody>
          {rows.map((t) => (
            <tr key={t.stint.id} className="border-t border-line/60">
              <td className="py-2"><Link href={`/boxers/${t.boxer.slug}`} className="flex items-center gap-3"><Headshot boxer={t.boxer} size={30} /><span><b>{t.boxer.name}</b><span className="block text-xs text-muted">{t.boxer.weightClass}</span></span></Link></td>
              <td className="whitespace-nowrap text-muted">{t.stint.start ? fmtDate(t.stint.start, { month: "short", year: "numeric" }) : "?"} – {t.current ? <span className="text-win">present</span> : t.stint.end ? fmtDate(t.stint.end, { month: "short", year: "numeric" }) : "?"}</td>
              <td className="tabular">{t.record.wins}-{t.record.losses}-{t.record.draws}{t.record.bouts ? <span className="ml-1.5 text-xs text-muted">{Math.round(t.record.winRate * 100)}%</span> : null}</td>
              <td className={`text-right tabular font-semibold ${t.ratingChange === null ? "text-muted" : t.ratingChange >= 0 ? "text-win" : "text-red"}`}>{t.ratingChange === null ? "–" : `${t.ratingChange >= 0 ? "+" : ""}${Math.round(t.ratingChange)}`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {tenures.length > limit && <p className="mt-2 text-xs text-muted">Showing the {limit} most recent of {tenures.length}.</p>}
    </div>
  );
}
