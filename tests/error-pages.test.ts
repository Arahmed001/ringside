import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createElement, type ComponentType } from "react";
import { renderToString } from "react-dom/server";
import { errorLine } from "../lib/error-log";
import { I18nProvider } from "../components/i18n";
import { ErrorView } from "../components/ErrorView";
import { clientDict } from "../lib/i18n/dicts";

const NOW = new Date("2026-10-03T12:00:00Z");

test("a server error is one line of JSON with what is needed to find it and nothing private", () => {
  const err = Object.assign(new Error("boom: could not read /data/ringside.db"), { digest: "1624447259" });
  const line = errorLine(err, { path: "/boxers/ramil-abad?q=my+private+search&token=abc", method: "GET", headers: { cookie: "rs_session=SECRET", authorization: "Bearer SECRET" } } as never,
    { routePath: "/[locale]/boxers/[slug]", routeType: "render", renderSource: "react-server-components" }, NOW);
  assert.ok(!line.includes("\n"), "one line");
  const o = JSON.parse(line);
  assert.deepEqual([o.at, o.level, o.event, o.digest, o.method, o.path, o.route, o.type, o.source, o.error], ["2026-10-03T12:00:00.000Z", "error", "request_error", "1624447259", "GET", "/boxers/ramil-abad", "/[locale]/boxers/[slug]", "render", "react-server-components", "Error"]);
  assert.equal(o.message, "boom: could not read /data/ringside.db", "the real message stays in the server log");
  for (const secret of ["SECRET", "my+private", "token=abc", "rs_session", "authorization"]) assert.ok(!line.includes(secret), `${secret} must not be logged`);
  assert.ok(Array.isArray(o.stack) && o.stack.length > 0 && o.stack.length <= 6 && o.stack.every((l: string) => l.startsWith("at ")));
});

test("anything can be thrown, and a line is still written; long messages and stacks are cut", () => {
  const req = { path: "/x", method: "POST" };
  assert.equal(JSON.parse(errorLine("plain string", req, {}, NOW)).message, "plain string");
  assert.equal(JSON.parse(errorLine({ code: 7 }, req, {}, NOW)).message, '{"code":7}');
  assert.equal(JSON.parse(errorLine(null, req, {}, NOW)).message, "null");
  assert.equal(JSON.parse(errorLine(undefined, req, {}, NOW)).error, "undefined");
  const circular: Record<string, unknown> = {}; circular.self = circular;
  assert.match(JSON.parse(errorLine(circular, req, {}, NOW)).message, /object/i, "an object that cannot be serialised does not break logging");
  const long = new Error("x".repeat(5000));
  assert.equal(JSON.parse(errorLine(long, req, {}, NOW)).message.length, 500);
  assert.equal(JSON.parse(errorLine(new Error("a"), { path: `/${"p".repeat(1000)}`, method: "GET" }, {}, NOW)).path.length, 300);
  const deep = new Error("deep"); deep.stack = "Error: deep\n" + Array.from({ length: 40 }, (_, i) => `    at frame${i} (file.js:1:1)`).join("\n");
  assert.equal(JSON.parse(errorLine(deep, req, {}, NOW)).stack.length, 6);
  assert.equal(JSON.parse(errorLine(new Error("no digest"), req, {}, NOW)).digest, undefined);
  assert.equal(JSON.parse(errorLine(new Error("e"), { path: undefined as never, method: "GET" }, {}, NOW)).path, "", "a missing path is not a crash");
});

const view = (locale: "en" | "ar", digest?: string) => renderToString(
  createElement(I18nProvider as unknown as ComponentType<{ locale: string; dict: object }>, { locale, dict: clientDict(locale) /* what the browser really receives, not the whole dictionary */ }, createElement(ErrorView, { digest, retry: () => {} })));

test("the error page tells a visitor what happened in their language, offers a way out, and shows only the reference", () => {
  const en = view("en", "1624447259"), ar = view("ar", "1624447259");
  assert.match(en, /role="alert"/); assert.match(en, /Down for the count/); assert.match(en, /Try again/); assert.match(en, /Back to the ring/); assert.match(en, /Reference: 1624447259/);
  assert.match(ar, /سقط على الحلبة/); assert.match(ar, /حاول مرة أخرى/); assert.match(ar, /المرجع: 1624447259/);
  assert.ok(!/Down for the count/.test(ar), "Arabic is not English with a different font");
  assert.ok(/href="\/ar"/.test(ar) && /href="\/"/.test(en.replace(/href="\/ar[^"]*"/g, "")), "the way home keeps the language");
  assert.ok(!/Reference:/.test(view("en")), "no digest, no reference line");
  for (const html of [en, ar]) assert.ok(!/undefined|NaN|\[object/.test(html));
});

test("neither error file ever prints the error's message or stack", () => {
  const read = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");
  for (const f of ["app/[locale]/error.tsx", "app/global-error.tsx", "components/ErrorView.tsx"]) {
    const src = read(f);
    assert.ok(!/\.message|\.stack|console\./.test(src.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "")), `${f} must not show or log the error's message or stack`);
  }
  assert.match(read("app/global-error.tsx"), /<html[\s>]/); assert.match(read("app/global-error.tsx"), /<body[\s>]/);
  assert.match(read("instrumentation.ts"), /export const onRequestError/);
});
