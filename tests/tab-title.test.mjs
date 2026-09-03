import test from "node:test";
import assert from "node:assert/strict";
import { resolvePathlessTabTitle } from "../src/tab-title.ts";

test("uses Obsidian's localized leaf title for an empty tab", () => {
  assert.equal(
    resolvePathlessTabTitle({
      sourceTitle: null,
      stateTitle: null,
      leafTitle: "新标签页",
      viewType: "empty",
    }),
    "新标签页",
  );
});

test("prefers a source-derived title when one is available", () => {
  assert.equal(
    resolvePathlessTabTitle({
      sourceTitle: "宠物乐园",
      stateTitle: "网页",
      leafTitle: "网页浏览器",
      viewType: "webviewer",
    }),
    "宠物乐园",
  );
});
