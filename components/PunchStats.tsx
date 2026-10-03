import type { PunchLine } from "@/lib/types";
import { getT } from "@/lib/i18n/server";

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");

/** Round-by-round landed punches (red left of the spine, blue right) plus fight totals. */
export async function PunchStats({ lines, redId, blueId, redName, blueName }: { lines: PunchLine[]; redId: number; blueId: number; redName: string; blueName: string }) {
  const rounds = lines.filter((l) => l.round > 0);
  const maxRound = Math.max(0, ...rounds.map((l) => l.round));
  if (!maxRound) return null;
  const t = await getT();
  const peak = Math.max(1, ...rounds.map((l) => l.landed));
  const by = (id: number, r: number) => rounds.find((l) => l.boxerId === id && l.round === r);
  const tot = (id: number) => lines.find((l) => l.boxerId === id && l.round === 0);
  const tr = tot(redId), tb = tot(blueId);
  const rows: [string, string, string][] = tr && tb ? [
    [t("Total landed / thrown"), `${tr.landed}/${tr.thrown}`, `${tb.landed}/${tb.thrown}`],
    [t("Accuracy"), pct(tr.landed, tr.thrown), pct(tb.landed, tb.thrown)],
    [t("Power punches"), `${tr.powerLanded}/${tr.powerThrown} (${pct(tr.powerLanded, tr.powerThrown)})`, `${tb.powerLanded}/${tb.powerThrown} (${pct(tb.powerLanded, tb.powerThrown)})`],
    [t("Jabs"), `${tr.jabLanded ?? 0}/${tr.jabThrown ?? 0} (${pct(tr.jabLanded ?? 0, tr.jabThrown ?? 0)})`, `${tb.jabLanded ?? 0}/${tb.jabThrown ?? 0} (${pct(tb.jabLanded ?? 0, tb.jabThrown ?? 0)})`],
  ] : [];
  return (
    <div>
      <div className="ltr-fixed mb-3 flex justify-between text-xs uppercase tracking-widest"><span className="text-red-ink">{redName}</span><span className="text-muted">{t("punches landed per round")}</span><span className="text-blue">{blueName}</span></div>
      <ul className="ltr-fixed space-y-1">
        {Array.from({ length: maxRound }, (_, i) => i + 1).map((r) => {
          const a = by(redId, r), b = by(blueId, r);
          return (
            <li key={r} className="grid grid-cols-[1fr_28px_1fr] items-center gap-1 text-xs">
              <div className="flex items-center justify-end gap-1.5"><span className="tabular text-muted">{a?.landed ?? 0}</span><div className="h-3 rounded-l-sm bg-red/80" style={{ width: `${((a?.landed ?? 0) / peak) * 85}%` }} /></div>
              <span className="text-center text-muted">{r}</span>
              <div className="flex items-center gap-1.5"><div className="h-3 rounded-r-sm bg-blue/80" style={{ width: `${((b?.landed ?? 0) / peak) * 85}%` }} /><span className="tabular text-muted">{b?.landed ?? 0}</span></div>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 overflow-hidden rounded-xl border border-line/60">
        {rows.map(([k, x, y]) => (
          <div key={k} className="ltr-fixed grid grid-cols-3 items-center border-t border-line/60 px-4 py-2 text-xs first:border-0"><span className="tabular font-semibold">{x}</span><span className="text-center uppercase tracking-widest text-muted">{k}</span><span className="text-end tabular font-semibold">{y}</span></div>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted">{t("CompuBox-style statistics: only some bouts are covered.")}</p>
    </div>
  );
}
