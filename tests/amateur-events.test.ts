import test from "node:test";
import assert from "node:assert/strict";
import { AMATEUR_EVENT } from "../lib/providers/boxing-data-api";

test("amateur federation events are skipped, professional cards that share a word with them are not", () => {
  for (const t of ["2025 World Boxing Championships: Day 4", "World Boxing Cup Astana 2025: Day 7", "Grand Prix Usti nad Labem 2025: World Boxing Challenge Day 2",
    "2025 ASBC U22 & Youth Men's & Women's Asian Boxing Championships: Day 9", "2025 OCBC Elite Men's & Women's Oceania Boxing Championships: Day 1",
    "2024 EUBC Elite Men's and Women's Championships: Day 2", "2025 IBA Men's World Boxing Championships: Finals", "Rio Olympics: Boxing Day 4"]) assert.ok(AMATEUR_EVENT.test(t), t);
  for (const t of ["IBA.Pro 8", "Pulev vs. Gassiev: IBA Pro 13", "IBA Champions Night: Tashkent", "WBC Boxing Grand Prix Finals", "Friday Night Fights", "Usyk vs. Fury", "Boxxer Series :Cruiserweight"]) assert.ok(!AMATEUR_EVENT.test(t), t);
});
