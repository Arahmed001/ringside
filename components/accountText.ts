import type { T } from "@/lib/i18n/t";

/** What to tell a person when the account API says no. One place, so every form words it the same way (and the translation scanner sees every string). */
export function explain(t: T, code: string | undefined): string {
  switch (code) {
    case "bad_login": return t("That name and password do not match.");
    case "rate_limited": return t("Too many tries. Wait a while and try again.");
    case "username_invalid": return t("Use 3 to 24 letters, digits or underscores.");
    case "username_taken": return t("That name is taken.");
    case "username_reserved": return t("That name is reserved.");
    case "password_short": return t("The password needs at least 10 characters.");
    case "password_long": return t("That password is too long.");
    case "password_common": return t("That password is too easy to guess.");
    case "password_username": return t("The password must not contain your name.");
    case "password_same_char": return t("Use more than one or two different characters.");
    case "wrong_password": return t("That password is not right.");
    case "invalid": return t("That code is wrong or has expired.");
    case "unauthorized": return t("Sign in first.");
    case "forbidden": return t("You are not allowed to do that.");
    case "locked": return t("This fight is locked: picks close when fight day begins.");
    case "no_such_bout": return t("That fight is not on the card any more.");
    case "not_in_bout": return t("That fighter is not in this bout.");
    case "too_many": return t("You have reached the limit.");
    case "boxer_unknown": return t("Pick a fighter from the list.");
    case "role_invalid": return t("Choose a role.");
    case "person_invalid": return t("Enter the person’s name (letters only, no links).");
    case "start_invalid": return t("Enter the start date as year-month-day.");
    case "end_invalid": return t("Enter the end date as year-month-day, or leave it empty.");
    case "dates_order": return t("The end date is before the start date.");
    case "future": return t("Dates cannot be in the future.");
    case "url_invalid": return t("Enter a full web address (https://…) for the source.");
    case "quote_short": return t("Quote the words from the page that say it (at least a short sentence).");
    case "quote_long": return t("The quote is too long: copy only the passage that says it (300 characters at most).");
    case "note_long": return t("The note is too long.");
    case "duplicate_pending": return t("You or someone else has already proposed this.");
    case "already_known": return t("This is already in the data.");
    case "not_found": return t("That no longer exists.");
    case "not_pending": return t("Someone has already decided this.");
    case "own": return t("You cannot decide your own proposal.");
    case "note_required": return t("Say why, in a few words.");
    case "this_session": return t("That is this device: use Sign out.");
    case "network": return t("Could not reach the server. Check your connection and try again.");
    default: return t("Something went wrong. Try again.");
  }
}
