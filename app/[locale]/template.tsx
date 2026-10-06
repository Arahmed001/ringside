import { ViewTransition, type ReactNode } from "react";

/**
 * A template is made again on every navigation (a layout is not), so the page inside it can enter and leave: a short fade with a small rise, driven by the browser's
 * View Transitions API through React's <ViewTransition>. The rail and the top bar live in the layout and stay where they are. Browsers without the API just swap the page;
 * a visitor who asks for reduced motion gets no animation (app/globals.css). The CSS classes `page-in` and `page-out` are defined there.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <ViewTransition enter="page-in" exit="page-out" default="none">{children}</ViewTransition>;
}
