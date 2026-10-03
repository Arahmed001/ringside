import { msg } from "./i18n/t";

export type IconName =
  | "rankings" | "titles" | "all-time" | "fighters" | "events" | "previews" | "fight-of-the-year" | "matchups" | "matchmaking" | "picks"
  | "corners" | "orgs" | "weigh-ins" | "money" | "accountability" | "analytics" | "style-map" | "data";

export interface NavItem { href: string; label: string; icon: IconName }
export interface NavGroup { id: string; title: string; items: NavItem[] }

/** The site's sections, grouped. Labels and titles go through t(); the `msg` marks are what the translation scanner sees. */
export const NAV_GROUPS: NavGroup[] = [
  { id: "discover", title: msg("Discover"), items: [
    { href: "/rankings", label: msg("Rankings"), icon: "rankings" },
    { href: "/titles", label: msg("Titles"), icon: "titles" },
    { href: "/all-time", label: msg("All-time"), icon: "all-time" },
    { href: "/boxers", label: msg("Fighters"), icon: "fighters" },
  ] },
  { id: "fights", title: msg("Fights"), items: [
    { href: "/events", label: msg("Events"), icon: "events" },
    { href: "/previews", label: msg("Fight previews"), icon: "previews" },
    { href: "/fight-of-the-year", label: msg("Fight of the year"), icon: "fight-of-the-year" },
    { href: "/compare", label: msg("Matchups"), icon: "matchups" },
    { href: "/matchmaking", label: msg("Matchmaking"), icon: "matchmaking" },
    { href: "/picks", label: msg("My picks"), icon: "picks" },
  ] },
  { id: "camps", title: msg("Camps and money"), items: [
    { href: "/people", label: msg("Corners"), icon: "corners" },
    { href: "/orgs", label: msg("Gyms, promotions & bodies"), icon: "orgs" },
    { href: "/weights", label: msg("Weigh-ins"), icon: "weigh-ins" },
    { href: "/money", label: msg("Money"), icon: "money" },
  ] },
  { id: "data", title: msg("Data and models"), items: [
    { href: "/analytics", label: msg("Analytics"), icon: "analytics" },
    { href: "/accountability", label: msg("Track record"), icon: "accountability" },
    { href: "/map", label: msg("Style Map"), icon: "style-map" },
    { href: "/data", label: msg("Data"), icon: "data" },
  ] },
];

/** localStorage key and the two values `<html data-nav>` takes. With no saved choice the rail follows the screen width (open from 1280 px). */
export const NAV_KEY = "ringside-nav";
