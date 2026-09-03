import test from "node:test";
import assert from "node:assert/strict";
import {
  duplicateDefaultSelectionFlags,
  duplicateFlags,
} from "../src/duplicate-groups.ts";

test("marks multiple empty tabs as duplicates", () => {
  const flags = duplicateFlags([
    { path: null, isEmpty: true },
    { path: null, isEmpty: true },
  ]);

  assert.deepEqual(flags, [true, true]);
});

test("does not mark a single empty tab as a duplicate", () => {
  const flags = duplicateFlags([{ path: null, isEmpty: true }]);

  assert.deepEqual(flags, [false]);
});

test("continues to group tabs by file path", () => {
  const flags = duplicateFlags([
    { path: "项目/极光发布/项目概览.md", isEmpty: false },
    { path: "项目/极光发布/项目概览.md", isEmpty: false },
    { path: "日记/2026-09-02.md", isEmpty: false },
  ]);

  assert.deepEqual(flags, [true, true, false]);
});

test("selects two of three duplicate empty tabs and keeps the active one", () => {
  const flags = duplicateDefaultSelectionFlags([
    { path: null, isEmpty: true, isPinned: false, isActive: false, isSelectable: true },
    { path: null, isEmpty: true, isPinned: false, isActive: true, isSelectable: false },
    { path: null, isEmpty: true, isPinned: false, isActive: false, isSelectable: true },
  ]);

  assert.deepEqual(flags, [true, false, true]);
});
