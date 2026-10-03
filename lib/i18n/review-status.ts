import fs from "node:fs";
import path from "node:path";
import { getDb } from "../db";
import { dictOf } from "./dicts";
import { EMPTY_META, summarise, type ReviewMeta } from "./review";

/** Read from disk each time: the file changes when a review is imported, and the data page is not hot. */
export const loadReviewMeta = (): ReviewMeta => {
  try { return { ...EMPTY_META(), ...JSON.parse(fs.readFileSync(path.join(process.cwd(), "i18n", "ar.review.json"), "utf8")) }; } catch { return EMPTY_META(); }
};

/** How much of the Arabic a person has looked at: strings (approved or edited, still matching what they saw) and proper names. */
export async function arabicReviewStatus() {
  const dict = dictOf("ar");
  const meta = loadReviewMeta();
  const s = summarise(Object.keys(dict), dict, meta);
  const db = await getDb();
  const n = db.prepare("SELECT COUNT(*) AS c, COALESCE(SUM(reviewed), 0) AS r FROM name_translations WHERE locale = 'ar'").get() as { c: number; r: number };
  const last = meta.reviews.at(-1) ?? null;
  return { ...s, names: n.c, namesReviewed: n.r, lastReview: last };
}
