import test from "node:test";
import assert from "node:assert/strict";
import { toClosedRecords } from "../src/closed-records.ts";

function emptyTab(id) {
  return {
    id,
    leaf: {},
    title: "新标签页",
    path: null,
    url: null,
    extension: "",
    viewType: "empty",
    viewState: { type: "empty", state: {} },
    isEmpty: true,
    isDuplicate: true,
    isPinned: false,
    isActive: false,
    isRestorable: true,
  };
}

test("records closed empty tabs as one aggregated history entry", () => {
  const records = toClosedRecords([emptyTab("one"), emptyTab("two"), emptyTab("three")]);

  assert.equal(records.length, 1);
  assert.equal(records[0].title, "新标签页");
  assert.equal(records[0].count, 3);
  assert.equal(records[0].path, null);
  assert.equal(records[0].url, null);
  assert.equal(records[0].viewState.type, "empty");
});
