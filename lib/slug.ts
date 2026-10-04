/** Longest slug: an address, not a copy of a name (a 300-letter name from a feed slip made a 300-character address). No real name comes near it, so no existing address changes. */
export const MAX_SLUG = 100;

/** URL-safe slug: no accents, lower-case, hyphens between words, at most `MAX_SLUG` characters (cut at a word where one is near the end). */
export const slugify = (s: string) => {
  const full = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
  if (full.length <= MAX_SLUG) return full;
  const cut = full.slice(0, MAX_SLUG), at = cut.lastIndexOf("-");
  return (at >= MAX_SLUG - 30 ? cut.slice(0, at) : cut).replace(/-$/, "");
};
