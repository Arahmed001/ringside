/** URL of the generated portrait for a fighter: a cacheable image instead of ~9 KB of inline SVG in every page that lists them. */
export const portraitUrl = (slug: string) => `/api/art/portrait/${encodeURIComponent(slug)}.svg`;
