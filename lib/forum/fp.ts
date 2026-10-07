import crypto from "node:crypto";
import { normalizedWords, waveLetters } from "./rules";

/** A hash of the words (see normalizedWords): enough to notice the same post twice, not enough to read it back. */
export const fingerprint = (text: string): string => crypto.createHash("sha256").update(normalizedWords(text)).digest("hex").slice(0, 32);
/** A hash of the letters only (see waveLetters), to notice one post sent from several accounts; "" for a post too short to be compared, so nothing ever matches it. */
export const waveFingerprint = (text: string, minChars: number): string => {
  const letters = waveLetters(text);
  return [...letters].length < minChars ? "" : crypto.createHash("sha256").update(letters).digest("hex").slice(0, 32);
};
