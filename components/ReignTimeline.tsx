import { yearTicks } from "@/lib/timeline";
import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";
import type { World } from "@/lib/world";
import type { Belt } from "@/lib/lineage";

const SHADES = ["#d9b25f", "#b8923f", "#e8c97d", "#a67f30"];

/** Every reign on one strip, left to right through time: gaps are vacant periods, bar width is the reign's length. */
export async function ReignTimeline({ w, belt }: { w: World; belt: Belt }) {
  const t = await getT();
  const min = Date.parse(belt.firstDate + "T12:00:00Z"), max = Date.parse(w.today + "T12:00:00Z");
  const span = Math.max(1, max - min);
  const pos = (d: string) => ((Date.parse(d + "T12:00:00Z") - min) / span) * 100;
  return (
    <div className="ltr-fixed" dir="ltr">
      <div className="relative h-14 rounded-xl bg-panel2">
        {belt.reigns.map((r, i) => {
          const left = pos(r.start), right = r.end ? pos(r.end) : 100;
          const who = w.byId.get(r.boxerId);
          return (
            <Link key={r.n} href={`/boxers/${who?.slug ?? ""}`} title={`${t.name(who?.name ?? "")} · ${r.start} → ${r.end ?? t("present")} · ${t.n(r.defenses.length, "{n} defence", "{n} defences")}`}
              className="absolute top-1.5 bottom-1.5 overflow-hidden rounded-lg px-1.5 text-xs font-semibold leading-[2.6rem] text-black/80 transition hover:brightness-110"
              style={{ left: `${left}%`, width: `${Math.max(0.6, right - left)}%`, background: SHADES[i % SHADES.length] }}>
              {right - left > 7 ? t.name(who?.name ?? "").split(" ").slice(-1)[0] : ""}
            </Link>
          );
        })}
      </div>
      <div className="relative mt-1 h-4 text-xs text-muted">
        {yearTicks(belt.firstDate, w.today).map(({ year, at }) => (
          <span key={year} className="absolute -translate-x-1/2 tabular" style={{ left: `${Math.min(97, Math.max(1, at * 100))}%` }}>{year}</span>
        ))}
      </div>
    </div>
  );
}
