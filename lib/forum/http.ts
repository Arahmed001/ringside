import { fail, json } from "../accounts/api";
import type { ForumError } from "./posts";

/** Every forum answer says it is not for search engines: what people write must not become the site's public face by accident (round 125). */
export const NOINDEX = { "x-robots-tag": "noindex, nofollow" };

const STATUS: Partial<Record<ForumError, number>> = { unauthorized: 401, forbidden: 403, too_new: 403, not_found: 404, no_such_subject: 404, locked: 409, duplicate: 409, rate_limited: 429, edit_window_over: 403 };
export const forumFail = (error: ForumError, extra: Record<string, string> = {}) => fail(error, STATUS[error] ?? 400, { ...NOINDEX, ...(error === "rate_limited" ? { "retry-after": "600" } : {}), ...extra });
export const forumJson = (body: unknown, status = 200) => json(body, status, NOINDEX);
