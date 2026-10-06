import type { T } from "@/lib/i18n/t";
import { POST_MAX } from "./rules";

/** What to tell a person when the forum says no: one place, so every form words it the same way (and the translation scanner sees every string). */
export function forumExplain(t: T, code: string | undefined): string {
  switch (code) {
    case "has_link": return t("Links are not allowed in posts.");
    case "has_number": return t("Long numbers, like phone numbers, are not allowed in posts.");
    case "too_short": return t("Write a little more.");
    case "empty": return t("Write something first.");
    case "too_long": return t("That is too long: {max} characters at most.", { max: POST_MAX });
    case "repetitive": return t("Please do not repeat one character over and over.");
    case "unauthorized": return t("Sign in first.");
    case "forbidden": return t("You are not allowed to do that.");
    case "too_new": return t("New accounts can post after a few minutes. Try again soon.");
    case "rate_limited": return t("You are posting too fast. Wait a few minutes.");
    case "duplicate": return t("You already said that.");
    case "locked": return t("This thread is locked.");
    case "title_invalid": return t("A title is 5 to 100 characters on one line, with no links.");
    case "not_found": case "no_such_subject": return t("That is not there any more.");
    case "edit_window_over": return t("A post can be edited for 15 minutes after it is written.");
    case "own_post": return t("You cannot report your own post.");
    case "already_reported": return t("You already reported this post.");
    case "network": return t("Could not reach the server. Try again.");
    default: return t("Something went wrong. Try again.");
  }
}
