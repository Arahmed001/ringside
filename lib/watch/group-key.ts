import { TABLE_OF } from "./vendor-policy";

/** The group a proposal belongs to on the approval page: `boxers.height_cm` for a field, `result` for a fight's result, `lists` for ranking lists, else its own kind. Safe for the browser. */
export function groupOf(kind: string, targetKey: string): string {
  if (kind === "field_change") { const [type, , column] = targetKey.split("|"); return `${TABLE_OF[type] ?? type}.${column}`; }
  if (kind === "result_change") return "result";
  if (kind === "list_change") return "lists";
  return kind;
}
