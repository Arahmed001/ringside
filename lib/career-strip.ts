/**
 * "Career in the data": for a fighter whose career is held in part (the supplier states a longer record than the fights Ringside holds, or its list and its total
 * disagree), where the fights we hold sit in the career. Without it a 27-fight record beside 16 fights reads as a mistake; with it the gap reads as information:
 * which years have fights, which stretch has none. Pure, so it is tested on its own; `components/CareerStrip.tsx` draws it.
 */
export interface CareerStrip {
  /** the first and last year drawn, and every year between with the number of fights held in it */
  fromYear: number; toYear: number; years: { year: number; held: number; /** before the first fight held, and after the year the career began: not in the data */ missing: boolean }[];
  held: number; total: number;
  /** the year the career began (the supplier's debut year), when that is before the first fight held: the years from there to the first fight held are not in the data */
  debutYear: number | null; firstHeldYear: number;
}

/**
 * `dates` are the dates of the fights held that count in a record; `total` is the career the page shows (the supplier's total, or the fights held). Null when nothing is
 * held, or when the fights held are the whole career (`total` not above `held`): then there is nothing to explain.
 */
export function careerStrip(input: { dates: string[]; total: number; turnedPro: number | null; debutDate?: string | null }): CareerStrip | null {
  const years = input.dates.map((d) => Number(d.slice(0, 4))).filter((y) => Number.isInteger(y) && y > 1800);
  if (!years.length || input.total <= years.length) return null;
  const firstHeldYear = Math.min(...years), lastHeldYear = Math.max(...years);
  const debut = input.turnedPro ?? (input.debutDate ? Number(input.debutDate.slice(0, 4)) : null);
  const debutYear = debut !== null && Number.isInteger(debut) && debut > 1800 && debut < firstHeldYear ? debut : null;
  const fromYear = debutYear ?? firstHeldYear;
  const count = new Map<number, number>();
  for (const y of years) count.set(y, (count.get(y) ?? 0) + 1);
  const out: CareerStrip["years"] = [];
  for (let y = fromYear; y <= lastHeldYear; y++) out.push({ year: y, held: count.get(y) ?? 0, missing: y < firstHeldYear });
  return { fromYear, toYear: lastHeldYear, years: out, held: years.length, total: input.total, debutYear, firstHeldYear };
}

/** The years to put a label under: the first, the last and evenly between, at most `max` (a 40-year career is not 40 labels). */
export function stripLabels(years: number[], max = 8): number[] {
  if (years.length <= max) return years;
  const step = Math.ceil((years.length - 1) / (max - 1));
  const out = years.filter((_, i) => i % step === 0);
  const last = years[years.length - 1];
  if (out[out.length - 1] !== last) { if (last - out[out.length - 1] < step / 2 + 1) out[out.length - 1] = last; else out.push(last); }
  return out;
}
