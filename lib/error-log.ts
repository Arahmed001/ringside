/**
 * One line of JSON per server error, for whoever reads the logs. What goes in: when, what route, what went wrong, and the digest that Next
 * puts on the error page a visitor sees, so a reported "reference" can be matched to its line. What never goes in: headers (cookies, tokens,
 * addresses), bodies, and the query string (a search is a person's question). Messages and stacks are cut short so one bad loop cannot fill a disk.
 */
export interface RequestInfo { path: string; method: string }
export interface ErrorContext { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string }

const MAX_MESSAGE = 500, STACK_LINES = 6;

export function errorLine(err: unknown, request: RequestInfo, context: ErrorContext = {}, at = new Date()): string {
  const e = err instanceof Error ? err : null;
  const digest = typeof err === "object" && err !== null && "digest" in err ? String((err as { digest: unknown }).digest) : undefined;
  const message = (e ? e.message : typeof err === "string" ? err : (() => { try { return JSON.stringify(err) ?? String(err); } catch { return String(err); } })()).slice(0, MAX_MESSAGE);
  return JSON.stringify({
    at: at.toISOString(), level: "error", event: "request_error", digest,
    method: request.method, path: (request.path ?? "").split("?")[0].slice(0, 300),
    route: context.routePath, type: context.routeType, source: context.renderSource,
    error: e?.name ?? typeof err, message,
    stack: e?.stack?.split("\n").slice(1, 1 + STACK_LINES).map((l) => l.trim()),
  });
}
