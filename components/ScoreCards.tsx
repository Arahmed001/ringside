import Link from "@/components/L";
import { getT } from "@/lib/i18n/server";

export interface CardRow { seat: number; judge: string; judgeSlug: string; red: number; blue: number }

/** The three judges' scorecards for a bout, red corner on the left. */
export async function ScoreCards({ cards, redName, blueName }: { cards: CardRow[]; redName: string; blueName: string }) {
  if (!cards.length) return null;
  const t = await getT();
  return (
    <div>
      <div className="ltr-fixed mb-2 grid grid-cols-[1fr_auto_1fr] items-end gap-3 text-[11px] uppercase tracking-widest text-muted">
        <span className="text-red">{redName}</span><span /><span className="text-end text-blue">{blueName}</span>
      </div>
      <ul className="space-y-2">
        {cards.map((c) => {
          const rw = c.red > c.blue, bw = c.blue > c.red;
          return (
            <li key={c.seat} className="ltr-fixed grid grid-cols-[1fr_auto_1fr] items-center gap-3 rounded-xl bg-panel2 px-4 py-2.5">
              <span className={`font-display text-3xl font-bold tabular ${rw ? "text-red" : "text-muted"}`}>{c.red}</span>
              <Link href={`/people/${c.judgeSlug}`} className="text-center text-xs text-muted hover:text-ink">{t("Judge {n}", { n: c.seat })}<br /><span className="text-ink/90">{t.name(c.judge)}</span></Link>
              <span className={`text-end font-display text-3xl font-bold tabular ${bw ? "text-blue" : "text-muted"}`}>{c.blue}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
