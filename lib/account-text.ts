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
    case "target_unknown": return t("That fighter or fight could not be found.");
    case "kind_invalid": return t("Choose what kind of report this is.");
    case "field_invalid": return t("Choose which detail is wrong.");
    case "value_invalid": return t("That value does not look right for this detail.");
    case "no_change": return t("That is what the site already shows.");
    case "bout_not_finished": return t("This fight has no result yet, so there is nothing to correct.");
    case "method_needed": return t("Say how the fight ended.");
    case "method_mismatch": return t("That way of ending does not fit the result.");
    case "note_short": return t("Say a little more (at least a couple of sentences).");
    case "contact_long": return t("The contact detail is too long.");
    case "duplicate_open": return t("Someone has already reported exactly this and it is waiting for review.");
    case "too_many_open": return t("You have 20 reports waiting. Wait for a decision, or withdraw one.");
    case "source_not_owner": return t("This source is not published by the owner of that fact, so it cannot change what the site shows. Note it instead.");
    case "not_a_correction": return t("That request is not a correction.");
    case "stale": return t("The data has changed since this was proposed, so nothing was applied. The next check will replace it.");
    case "gone": return t("The entry this change is about is no longer held, so nothing was applied.");
    case "group_changed": return t("This group has changed since you opened the page, so nothing was decided. Reload and look again.");
    case "group_empty": return t("There is nothing waiting in that group any more.");
    case "field_unknown": return t("A rule cannot name that field.");
    case "condition_invalid": return t("That condition does not fit this field.");
    case "amount_invalid": return t("Enter a number, zero or more.");
    case "duplicate": return t("That rule already exists.");
    case "bad_proposal": case "unknown_source": case "failed": return t("This change could not be applied.");
    case "network": return t("Could not reach the server. Check your connection and try again.");
    default: return t("Something went wrong. Try again.");
  }
}
