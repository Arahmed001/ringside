/**
 * Where each sanctioning body publishes its own champions and ratings, for a plain link out from a division's page. Nothing is read or copied from these addresses: no body grants a licence to reuse its
 * lists (docs/official-bodies.md, read 2026-10-09), and a link to the body's page sends the visitor to the authoritative list, which is what the WBA's own legal notice tells users to consult.
 * Each address answered when it was checked, except the IBF's, which is a page that refuses automated requests (HTTP 403) and opens in a browser.
 */
export interface BodyPages { body: "WBC" | "WBA" | "IBF" | "WBO"; name: string; men: string; women: string }
export const BODY_PAGES: BodyPages[] = [
  { body: "WBC", name: "World Boxing Council", men: "https://wbcboxing.com/ratings/", women: "https://wbcboxing.com/ratings/" },
  { body: "WBA", name: "World Boxing Association", men: "https://www.wbaboxing.com/wba-ranking", women: "https://www.wbaboxing.com/wba-female-ranking" },
  { body: "IBF", name: "International Boxing Federation", men: "https://www.ibf-usba-boxing.com/", women: "https://www.ibf-usba-boxing.com/" },
  { body: "WBO", name: "World Boxing Organization", men: "https://wboboxing.com/male-champions/", women: "https://wboboxing.com/female-champions/" },
];
export const bodyPage = (b: BodyPages, sex: "male" | "female"): string => (sex === "female" ? b.women : b.men);
