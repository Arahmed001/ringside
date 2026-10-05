import type { IconName } from "@/lib/nav";

/** Plain 24-px stroke icons, drawn for this site, decorative (the text label names the link). */
const PATHS: Record<IconName | "menu" | "close" | "chevron", React.ReactNode> = {
  ask: <path d="M4 5h16v11H9l-5 4V5zM8 9h8M8 12h5" />,
  rankings: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3" />,
  titles: <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3z" />,
  "all-time": <path d="M6 3h12M6 21h12M7 3v4l5 5-5 5v4M17 3v4l-5 5 5 5v4" />,
  fighters: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21c0-4 3.5-7 8-7s8 3 8 7" />,
  events: <path d="M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" />,
  previews: <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z" />,
  "fight-of-the-year": <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" />,
  "on-this-day": <path d="M4 5h16v15H4zM4 9h16M8 3v4M16 3v4M12 12v4l2 1" />,
  matchups: <path d="M4 8h13l-3-3M20 16H7l3 3" />,
  matchmaking: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 8v8M8 12h8" />,
  leaderboard: <path d="M6 20V11M12 20V4M18 20v-6M3 20h18" />,
  tonight: <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z" />,
  watchlist: <path d="M12 3l2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6L3.3 9.3l6.1-.7z" />,
  picks: <path d="M9 12l2 2 4-4M5 4h14a1 1 0 0 1 1 1v15l-4-3H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1z" />,
  corners: <path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2 20c0-3.5 3-6 7-6s7 2.5 7 6M17 5a3 3 0 0 1 0 6M22 20c0-2.5-2-4.5-4.5-5.4" />,
  "upset-watch": <path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" />,
  trainers: <path d="M6 5v14M18 5v14M6 12h12M3 8v8M21 8v8" />,
  orgs: <path d="M4 21V8l8-5 8 5v13M9 21v-6h6v6M3 21h18" />,
  "weigh-ins": <path d="M12 4v16M6 20h12M5 7h14M5 7l-3 7a3 3 0 0 0 6 0L5 7zM19 7l-3 7a3 3 0 0 0 6 0l-3-7z" />,
  money: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM14.5 9.5c-.5-1-1.5-1.5-2.5-1.5-1.5 0-2.5.8-2.5 2s1 1.7 2.5 2 2.5.8 2.5 2-1 2-2.5 2c-1 0-2-.5-2.5-1.5M12 6.5V8M12 16v1.5" />,
  accountability: <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2" />,
  analytics: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  learn: <><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2z" /><path d="M4 19V5" /><path d="M9 8h6" /></>,
  countries: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z" /></>,
  "style-map": <><circle cx="7" cy="8" r="1.6" /><circle cx="17" cy="7" r="1.6" /><circle cx="11" cy="14" r="1.6" /><circle cx="18" cy="17" r="1.6" /><path d="M3 3v18h18" /></>,
  data: <path d="M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6" />,
  menu: <path d="M4 6h16M4 12h16M4 18h16" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  chevron: <path d="M15 6l-6 6 6 6" />,
};

export function Icon({ name, className = "h-5 w-5" }: { name: IconName | "menu" | "close" | "chevron"; className?: string }) {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 ${className}`} aria-hidden>{PATHS[name]}</svg>;
}
