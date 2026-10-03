/**
 * The years to label along a strip that runs from `from` to `to` (ISO dates): those whose 1 January falls inside it, thinned to at most `max`.
 * A year that began before the strip is not labelled: its label would be pushed to the edge and sit on top of the next one (a belt that begins in
 * June 2019 has no "2019" tick, and a "2019" clamped to the left edge overlapped "2020"). `at` is where the tick falls, 0 at the start and 1 at the end.
 */
export function yearTicks(from: string, to: string, max = 8): { year: number; at: number }[] {
  const t0 = Date.parse(`${from}T12:00:00Z`), t1 = Date.parse(`${to}T12:00:00Z`), span = Math.max(1, t1 - t0);
  const years: number[] = [];
  for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) if (Date.parse(`${y}-01-01T12:00:00Z`) >= t0) years.push(y); // the loop ends at the strip's last year, whose 1 January is never after it
  const step = Math.max(1, Math.ceil(years.length / max));
  return years.filter((_, i) => i % step === 0).map((year) => ({ year, at: (Date.parse(`${year}-01-01T12:00:00Z`) - t0) / span }));
}
