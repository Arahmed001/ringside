import { getT } from "@/lib/i18n/server";

export interface PrintRow { date: string; opponent: string; result: "W" | "L" | "D" | "NC"; how: string }
export interface PrintSheetProps {
  name: string; nickname: string | null; line: string; division: string; rankLine: string | null; belts: string[];
  stats: { label: string; value: string; sub: string }[]; recent: PrintRow[]; recentTitle: string; next: string | null;
}

/** The one-page version of a fighter, shown only when printing (the full profile is on screen). Plain text and a small table: it has to fit on one sheet. */
export async function FighterPrintSheet(p: PrintSheetProps) {
  const t = await getT();
  const res = { W: t("W"), L: t("L"), D: t("D"), NC: t("NC") };
  return (
    <section className="print-only" aria-hidden="true">
      <div className="text-xs uppercase tracking-widest">{p.division}{p.rankLine ? ` · ${p.rankLine}` : ""}</div>
      <div className="font-display text-5xl font-extrabold uppercase leading-none">{p.name}</div>
      {p.nickname && <div className="mt-1 font-serif text-2xl italic">“{p.nickname}”</div>}
      <div className="mt-2 text-sm">{p.line}</div>
      {p.belts.length > 0 && <ul className="mt-2 text-sm font-semibold">{p.belts.map((b) => <li key={b}>{b}</li>)}</ul>}
      <div className="mt-5 grid grid-cols-4 gap-3">
        {p.stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-line p-3">
            <div className="text-xs uppercase tracking-widest">{s.label}</div>
            <div className="font-display text-3xl font-bold tabular">{s.value}</div>
            <div className="text-xs">{s.sub}</div>
          </div>
        ))}
      </div>
      {p.next && <div className="mt-4 rounded-lg border border-line p-3 text-sm"><b>{t("Next fight")}:</b> {p.next}</div>}
      {p.recent.length > 0 && (
        <div className="mt-5">
          <div className="mb-2 text-xs font-semibold uppercase tracking-widest">{p.recentTitle}</div>
          <table className="w-full text-sm" aria-label={p.recentTitle}>
            <thead><tr className="border-b border-line text-start text-xs uppercase"><th className="py-1 text-start font-semibold">{t("Date")}</th><th className="py-1 text-start font-semibold">{t("Opponent")}</th><th className="py-1 text-start font-semibold">{t("Result")}</th></tr></thead>
            <tbody>
              {p.recent.map((r, i) => (
                <tr key={i} className="border-b border-line/60"><td className="py-1.5 tabular">{r.date}</td><td className="py-1.5">{r.opponent}</td><td className="py-1.5"><b>{res[r.result]}</b> · {r.how}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
