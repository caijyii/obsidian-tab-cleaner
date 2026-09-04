import test from "node:test";
import assert from "node:assert/strict";
import { tabListLabel } from "../src/tab-list-label.ts";

const labels = {
  openTabs: "已打开的标签页",
  searchResults: "检索结果",
  emptyTabs: "空白标签页",
  duplicateTabs: "重复标签页",
};
const strategies = [{ id: "project", name: "项目文档" }];

test("describes the current tab-list scope", () => {
  assert.equal(tabListLabel("all", "", strategies, labels), "已打开的标签页");
  assert.equal(tabListLabel("empty", "", strategies, labels), "空白标签页");
  assert.equal(tabListLabel("duplicates", "", strategies, labels), "重复标签页");
  assert.equal(tabListLabel("project", "", strategies, labels), "项目文档");
  assert.equal(tabListLabel("all", "readme", strategies, labels), "检索结果");
});

test("falls back to open tabs when a saved group no longer exists", () => {
  assert.equal(tabListLabel("removed", "", strategies, labels), "已打开的标签页");
});
