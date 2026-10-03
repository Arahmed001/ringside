import type { World } from "../world";
import type { Names, T } from "../i18n/t";

/** A table cell: plain text, or text that links to a page (a locale-free path; the page adds the language prefix). Everything is already translated. */
export type Cell = string | { text: string; href?: string };

export interface Table { id: string; title: string; columns: string[]; rows: Cell[][]; note?: string }

/** What one tool found. `summary` is a finished sentence in the reader's language (the no-key answer); `lines` are compact facts for the model to write from. */
export interface ToolResult { tool: string; args: Record<string, unknown>; summary: string; lines: string[]; tables: Table[] }

export interface Call { tool: string; args: Record<string, unknown> }

export interface Ctx { w: World; t: T; names: Names }

export type ArgSpec =
  | { name: string; kind: "string"; about: string }
  | { name: string; kind: "number"; about: string; min: number; max: number }
  | { name: string; kind: "boolean"; about: string }
  | { name: string; kind: "enum"; about: string; values: readonly string[] };

export interface Tool {
  name: string;
  about: string;
  args: ArgSpec[];
  run: (ctx: Ctx, args: Record<string, unknown>) => ToolResult;
}
