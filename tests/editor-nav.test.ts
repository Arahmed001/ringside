import test from "node:test";
import assert from "node:assert/strict";
import { editorNavItems, EDITOR_NAV, OFF_NAV } from "../lib/nav";

test("the editor group is for editors and administrators only", () => {
  assert.deepEqual(editorNavItems(undefined), []);
  assert.deepEqual(editorNavItems(null), []);
  assert.deepEqual(editorNavItems("user"), []);
  const editor = editorNavItems("editor").map((i) => i.href);
  const admin = editorNavItems("admin").map((i) => i.href);
  assert.ok(editor.includes("/review") && editor.includes("/review/reports"));
  assert.ok(!editor.includes("/review/updates"), "an editor cannot decide source updates, so the link is not offered");
  assert.ok(admin.includes("/review/updates"));
  assert.equal(admin.length, EDITOR_NAV.items.length);
});

test("every editor link is a page the public rail leaves out", () => {
  for (const it of EDITOR_NAV.items) assert.ok(OFF_NAV.includes(it.href), `${it.href} should be listed in OFF_NAV`);
});
