import { msg } from "./i18n/t";

export type IconName =
  | "ask" | "rankings" | "titles" | "all-time" | "fighters" | "countries" | "learn" | "events" | "previews" | "fight-of-the-year" | "matchups" | "matchmaking" | "picks" | "tonight" | "watchlist" | "leaderboard"
  | "on-this-day" | "news" | "upset-watch" | "trainers" | "corners" | "orgs" | "weigh-ins" | "money" | "accountability" | "analytics" | "style-map" | "data";

export interface NavItem { href: string; label: string; icon: IconName }
export interface NavGroup { id: string; title: string; items: NavItem[] }

/** The site's sections, grouped. Labels and titles go through t(); the `msg` marks are what the translation scanner sees. */
export const NAV_GROUPS: NavGroup[] = [
  { id: "follow", title: msg("Follow the sport"), items: [
    { href: "/tonight", label: msg("Tonight"), icon: "tonight" },
    { href: "/events", label: msg("Events"), icon: "events" },
    { href: "/previews", label: msg("Fight previews"), icon: "previews" },
    { href: "/news", label: msg("News"), icon: "news" },
    { href: "/on-this-day", label: msg("On this day"), icon: "on-this-day" },
  ] },
  { id: "records", title: msg("Rankings and records"), items: [
    { href: "/rankings", label: msg("Rankings"), icon: "rankings" },
    { href: "/titles", label: msg("Titles"), icon: "titles" },
    { href: "/all-time", label: msg("All-time"), icon: "all-time" },
    { href: "/boxers", label: msg("Fighters"), icon: "fighters" },
    { href: "/countries", label: msg("Countries"), icon: "countries" },
    { href: "/fight-of-the-year", label: msg("Fight of the year"), icon: "fight-of-the-year" },
  ] },
  { id: "play", title: msg("Predict and play"), items: [
    { href: "/upset-watch", label: msg("Upset watch"), icon: "upset-watch" },
    { href: "/compare", label: msg("Matchups"), icon: "matchups" },
    { href: "/matchmaking", label: msg("Matchmaking"), icon: "matchmaking" },
    { href: "/picks", label: msg("My picks"), icon: "picks" },
    { href: "/watchlist", label: msg("My watchlist"), icon: "watchlist" },
    { href: "/leaderboard", label: msg("Leaderboard"), icon: "leaderboard" },
  ] },
  { id: "camps", title: msg("Corners, camps and money"), items: [
    { href: "/people", label: msg("Corners"), icon: "corners" },
    { href: "/trainers", label: msg("Trainer impact"), icon: "trainers" },
    { href: "/orgs", label: msg("Gyms, promotions & bodies"), icon: "orgs" },
    { href: "/weights", label: msg("Weigh-ins"), icon: "weigh-ins" },
    { href: "/money", label: msg("Money"), icon: "money" },
  ] },
  { id: "learn", title: msg("Learn and data"), items: [
    { href: "/ask", label: msg("Ask the data"), icon: "ask" },
    { href: "/learn", label: msg("Boxing, explained"), icon: "learn" },
    { href: "/analytics", label: msg("Analytics"), icon: "analytics" },
    { href: "/accountability", label: msg("Track record"), icon: "accountability" },
    { href: "/map", label: msg("Style map"), icon: "style-map" },
    { href: "/data", label: msg("Data"), icon: "data" },
  ] },
];

/** localStorage key and the two values `<html data-nav>` takes. With no saved choice the rail follows the screen width (open from 1280 px). */
export const NAV_KEY = "ringside-nav";

/** Pages that exist but are not sections of the site: reached from the account menu or a link on another page, so they are not in the rail. */
export const OFF_NAV = ["/account", "/contribute", "/report", "/review", "/review/reports", "/review/updates", "/review/forum", "/review/social", "/review/photos", "/forum", "/forum/rules", "/privacy", "/terms", "/tour", "/developers"];

/** Shown in the rail only to a signed-in editor or administrator (components/EditorNav.tsx). The pages are in OFF_NAV because the public rail never lists them. */
export const EDITOR_NAV: { title: string; items: (NavItem & { admin?: boolean })[] } = {
  title: msg("Editor tools"),
  items: [
    { href: "/review", label: msg("Team-history edits"), icon: "corners" },
    { href: "/review/reports", label: msg("Reports of mistakes"), icon: "accountability" },
    { href: "/review/updates", label: msg("Updates from public sources"), icon: "data", admin: true },
    { href: "/review/forum", label: msg("Forum moderation"), icon: "ask" },
  ],
};

/** The editor group's links for a role: none for readers (and for nobody signed in), all but the administrators' for an editor, all for an administrator. */
export function editorNavItems(role: string | null | undefined) {
  if (role !== "editor" && role !== "admin") return [];
  return EDITOR_NAV.items.filter((it) => !it.admin || role === "admin");
}
