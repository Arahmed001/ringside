import type { World } from "./world";
import { memo } from "./memo";

/** Whether this league's supplier gives career totals at all (the demo league has none, and a fighter without one there is the rule, not a gap). Worked out once per world. */
export const suppliesTotals = (w: World): boolean => memo(w, "suppliesTotals", () => w.boxers.some((b) => b.vendorRecord !== null));
