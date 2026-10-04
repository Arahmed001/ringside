import type { World } from "../lib/world";
import type { BoxerFull } from "../lib/types";

/**
 * Plain-English fighter searches ("fighters with more than 10 losses", "heavyweights with a losing record", "taller than 190 cm"), each with the plain truth
 * about the league worked out from the fighters' own numbers: the search must return exactly the fighters the sentence describes, no more and no fewer. A search
 * that ignores part of the sentence, or reads a number as the wrong thing, returns the wrong set; that is what this measures. Fighters with no fight are not
 * in a search, and a fact the data does not have never satisfies a condition on it.
 */
export interface NlCase { q: string; kind: string; group: "A" | "B" | "C"; truth: (b: BoxerFull) => boolean }

const known = (v: number | null, f: (v: number) => boolean) => v !== null && f(v);

export function nlCases(): NlCase[] {
  const c = (group: NlCase["group"], kind: string, q: string, truth: NlCase["truth"]): NlCase => ({ q, kind, group, truth });
  return [
    // A: the comparisons the search was meant to read
    c("A", "wins, at least", "fighters with at least 20 wins", (b) => b.wins >= 20),
    c("A", "wins, N+", "fighters with 25+ wins", (b) => b.wins >= 25),
    c("A", "knockouts, at least", "fighters with at least 8 KOs", (b) => b.kos >= 8),
    c("A", "knockouts, N or more", "boxers with 10 or more knockouts", (b) => b.kos >= 10),
    c("A", "age, over", "boxers over 35", (b) => known(b.age, (a) => a >= 36)),
    c("A", "age, under", "boxers under 25", (b) => known(b.age, (a) => a < 25)),
    c("A", "reach, over", "fighters with a reach over 185", (b) => known(b.reachCm, (r) => r > 185)),
    c("A", "undefeated", "undefeated fighters", (b) => b.losses === 0),
    // B: other comparisons and measures, and the plain-words ones
    c("B", "losses, more than", "fighters with more than 10 losses", (b) => b.losses > 10),
    c("B", "losses, at least", "fighters with at least 8 losses", (b) => b.losses >= 8),
    c("B", "losses, fewer than", "fighters with fewer than 3 losses", (b) => b.losses < 3),
    c("B", "losses, exactly", "fighters with exactly 4 losses", (b) => b.losses === 4),
    c("B", "losses, at most", "fighters with at most 2 losses", (b) => b.losses <= 2),
    c("B", "losses, none", "fighters with no losses", (b) => b.losses === 0),
    c("B", "losses, never", "fighters who have never lost", (b) => b.losses === 0),
    c("B", "losses, under", "boxers with under 5 losses", (b) => b.losses < 5),
    c("B", "wins, more than", "fighters with more than 25 wins", (b) => b.wins > 25),
    c("B", "wins, fewer than", "fighters with fewer than 10 wins", (b) => b.wins < 10),
    c("B", "wins, between", "fighters with between 15 and 25 wins", (b) => b.wins >= 15 && b.wins <= 25),
    c("B", "wins, to", "fighters with 20 to 30 wins", (b) => b.wins >= 20 && b.wins <= 30),
    c("B", "wins, exactly", "fighters with exactly 12 wins", (b) => b.wins === 12),
    c("B", "wins, under", "fighters with under 15 wins", (b) => b.wins < 15),
    c("B", "knockouts, more than", "boxers with more than 10 knockouts", (b) => b.kos > 10),
    c("B", "knockouts, fewer than", "boxers with fewer than 5 knockouts", (b) => b.kos < 5),
    c("B", "knockouts, none", "fighters with no knockouts", (b) => b.kos === 0),
    c("B", "knockouts, never won by", "fighters who never won by knockout", (b) => b.kos === 0),
    c("B", "knockouts, between", "fighters with between 5 and 10 KOs", (b) => b.kos >= 5 && b.kos <= 10),
    c("B", "fights, more than", "fighters who have fought more than 30 times", (b) => b.bouts > 30),
    c("B", "fights, more than (fights)", "fighters with more than 30 fights", (b) => b.bouts > 30),
    c("B", "fights, fewer than", "boxers with fewer than 10 fights", (b) => b.bouts < 10),
    c("B", "fights, at least", "boxers with at least 25 bouts", (b) => b.bouts >= 25),
    c("B", "fights, or fewer", "boxers with 10 or fewer fights", (b) => b.bouts <= 10),
    c("B", "age, to", "fighters aged 30 to 35", (b) => known(b.age, (a) => a >= 30 && a <= 35)),
    c("B", "age, between", "fighters between 25 and 30 years old", (b) => known(b.age, (a) => a >= 25 && a <= 30)),
    c("B", "age, or older", "boxers 36 or older", (b) => known(b.age, (a) => a >= 36)),
    c("B", "age, younger than", "boxers younger than 28", (b) => known(b.age, (a) => a < 28)),
    c("B", "height, taller than", "fighters taller than 185 cm", (b) => known(b.heightCm, (h) => h > 185)),
    c("B", "height, shorter than", "fighters shorter than 170 cm", (b) => known(b.heightCm, (h) => h < 170)),
    c("B", "height, at least", "fighters at least 190 cm tall", (b) => known(b.heightCm, (h) => h >= 190)),
    c("B", "height, feet", "fighters over 6 feet", (b) => known(b.heightCm, (h) => h > 182.88)),
    c("B", "reach, at least", "boxers with a reach of at least 190", (b) => known(b.reachCm, (r) => r >= 190)),
    c("B", "reach, under", "boxers with a reach under 175", (b) => known(b.reachCm, (r) => r < 175)),
    c("B", "record, winning", "fighters with a winning record", (b) => b.wins > b.losses),
    c("B", "record, losing", "fighters with a losing record", (b) => b.losses > b.wins),
    c("B", "turned pro in", "fighters who turned pro in 2015", (b) => b.turnedPro === 2015),
    c("B", "combined: division + losing record", "heavyweights with a losing record", (b) => b.weightClass === "Heavyweight" && b.losses > b.wins),
    c("B", "combined: division + losses", "welterweights with more than 10 losses", (b) => b.weightClass === "Welterweight" && b.losses > 10),
    c("B", "combined: stance + wins + no losses", "southpaws with at least 15 wins and no losses", (b) => b.stance === "Southpaw" && b.wins >= 15 && b.losses === 0),
    c("B", "combined: sex + fights", "women with fewer than 5 fights", (b) => b.sex === "female" && b.bouts < 5),
    c("B", "combined: active + age + wins", "active fighters over 30 with more than 20 wins", (b) => b.active && known(b.age, (a) => a >= 31) && b.wins > 20),
    c("B", "combined: knockouts + no losses", "fighters with 10 or more knockouts and no losses", (b) => b.kos >= 10 && b.losses === 0),
    c("B", "combined: wins range + division", "heavyweights between 20 and 30 wins", (b) => b.weightClass === "Heavyweight" && b.wins >= 20 && b.wins <= 30),
    // C: a second batch, other wordings, written after the parser and measured once before anything was changed for it
    c("C", "losses, lost N times", "fighters who have lost more than 5 times", (b) => b.losses > 5),
    c("C", "wins, won N times", "fighters who have won at least 20 times", (b) => b.wins >= 20),
    c("C", "fights, fought N times", "fighters who have fought exactly 15 times", (b) => b.bouts === 15),
    c("C", "losses, fewer than, plural", "welterweights with fewer than 2 defeats", (b) => b.weightClass === "Welterweight" && b.losses < 2),
    c("C", "wins, 30 or more", "boxers who have 30 or more victories", (b) => b.wins >= 30),
    c("C", "wins, no more than", "boxers with no more than 5 wins", (b) => b.wins <= 5),
    c("C", "wins, up to", "boxers with up to 8 wins", (b) => b.wins <= 8),
    c("C", "wins, plus", "boxers with 30 plus wins", (b) => b.wins >= 30),
    c("C", "kos, a minimum of", "fighters with a minimum of 12 knockouts", (b) => b.kos >= 12),
    c("C", "kos, zero", "fighters with zero knockouts", (b) => b.kos === 0),
    c("C", "kos, 20+", "fighters with 20+ KOs", (b) => b.kos >= 20),
    c("C", "bouts, greater than", "boxers with greater than 40 bouts", (b) => b.bouts > 40),
    c("C", "bouts, less than", "boxers with less than 6 bouts", (b) => b.bouts < 6),
    c("C", "bouts, professional", "boxers with at least 20 professional fights", (b) => b.bouts >= 20),
    c("C", "age, 40 and over", "boxers 40 and over", (b) => known(b.age, (a) => a >= 40)),
    c("C", "age, older than", "boxers older than 38", (b) => known(b.age, (a) => a > 38)),
    c("C", "age, years old, exact", "boxers 30 years old", (b) => b.age === 30),
    c("C", "age, aged exact", "boxers aged 27", (b) => b.age === 27),
    c("C", "age, ages range", "fighters ages 22 to 26", (b) => known(b.age, (a) => a >= 22 && a <= 26)),
    c("C", "age, 25 or younger", "fighters 25 or younger", (b) => known(b.age, (a) => a <= 25)),
    c("C", "age, under + division", "heavyweights under 30", (b) => b.weightClass === "Heavyweight" && known(b.age, (a) => a < 30)),
    c("C", "reach, 200", "boxers with a reach of 200 or more", (b) => known(b.reachCm, (r) => r >= 200)),
    c("C", "reach, 180 cm", "boxers with 180 cm reach or less", (b) => known(b.reachCm, (r) => r <= 180)),
    c("C", "reach, between", "boxers with a reach between 180 and 190", (b) => known(b.reachCm, (r) => r >= 180 && r <= 190)),
    c("C", "height, cm tall", "fighters 180 cm tall or more", (b) => known(b.heightCm, (h) => h >= 180)),
    c("C", "height, 6ft 2", "fighters taller than 6 ft 2", (b) => known(b.heightCm, (h) => h > 187.96)),
    c("C", "height, under 5 ft 8", "fighters under 5'8", (b) => known(b.heightCm, (h) => h < 172.72)),
    c("C", "height, between", "fighters between 175 and 185 cm", (b) => known(b.heightCm, (h) => h >= 175 && h <= 185)),
    c("C", "record, winning + country", "Mexican boxers with a winning record", (b) => b.country === "Mexico" && b.wins > b.losses),
    c("C", "record, losing + age", "boxers over 35 with a losing record", (b) => known(b.age, (a) => a >= 36) && b.losses > b.wins),
    c("C", "record, more wins than losses", "fighters with more wins than losses", (b) => b.wins > b.losses),
    c("C", "winless", "winless fighters", (b) => b.wins === 0),
    c("C", "never won", "fighters who have never won", (b) => b.wins === 0),
    c("C", "turned pro before", "fighters who turned pro before 2012", (b) => b.turnedPro !== null && b.turnedPro < 2012),
    c("C", "turned pro after", "fighters who turned pro after 2020", (b) => b.turnedPro !== null && b.turnedPro > 2020),
    c("C", "turned pro since", "fighters who turned pro since 2020", (b) => b.turnedPro !== null && b.turnedPro >= 2020),
    c("C", "combined: two measures", "fighters with more than 15 wins and fewer than 4 losses", (b) => b.wins > 15 && b.losses < 4),
    c("C", "combined: wins + knockouts", "boxers with at least 20 wins and at least 15 knockouts", (b) => b.wins >= 20 && b.kos >= 15),
    c("C", "combined: losses + age + division", "middleweights over 30 with 5 or more losses", (b) => b.weightClass === "Middleweight" && known(b.age, (a) => a >= 31) && b.losses >= 5),
    c("C", "combined: country + fights", "Japanese fighters with fewer than 8 fights", (b) => b.country === "Japan" && b.bouts < 8),
    c("C", "combined: no losses + height", "undefeated fighters taller than 180 cm", (b) => b.losses === 0 && known(b.heightCm, (h) => h > 180)),
    c("C", "combined: retired + wins", "retired fighters with more than 25 wins", (b) => !b.active && b.wins > 25),
    c("C", "combined: women + wins range", "women with between 5 and 10 wins", (b) => b.sex === "female" && b.wins >= 5 && b.wins <= 10),
  ];
}

/** Whether the search for `q` returns exactly the fighters that match `truth`; and who is wrong. */
export function nlProblem(w: World, c: NlCase, found: BoxerFull[]): string | null {
  const want = new Set(w.boxers.filter((b) => b.bouts > 0 && c.truth(b)).map((b) => b.id));
  const got = new Set(found.map((b) => b.id));
  const extra = [...got].filter((id) => !want.has(id)).length, missing = [...want].filter((id) => !got.has(id)).length;
  return extra || missing ? `${got.size} returned, ${want.size} expected (${extra} too many, ${missing} missing)` : null;
}
