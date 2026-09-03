import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_STORAGE_LIMIT,
  retainedHistory,
  visibleHistory,
} from "../src/history-retention.ts";

test("changing the display limit does not discard stored history", () => {
  const stored = Array.from({ length: 13 }, (_, index) => index + 1);

  assert.deepEqual(visibleHistory(stored, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(visibleHistory(stored, 20), stored);
  assert.equal(stored.length, 13);
});

test("stored history is capped independently at 50 batches", () => {
  const stored = Array.from({ length: 60 }, (_, index) => index + 1);

  assert.equal(HISTORY_STORAGE_LIMIT, 50);
  assert.deepEqual(retainedHistory(stored), stored.slice(0, 50));
});
