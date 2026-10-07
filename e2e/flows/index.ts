import type { Flow } from "../harness";
import { pages } from "./pages";
import { accounts } from "./accounts";
import { forum } from "./forum";
import { browse } from "./browse";
import { keyboard } from "./keyboard";

export const FLOWS: Flow[] = [...pages, ...accounts, ...forum, ...browse, ...keyboard];
