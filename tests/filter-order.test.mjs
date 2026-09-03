import test from "node:test";
import assert from "node:assert/strict";
import { filterOrders } from "../src/filter-order.ts";

test("keeps the configured display order when the active filter changes", () => {
  const first = filterOrders(["empty", "duplicates"], ["one", "two", "three"], ["two"], "one");
  const second = filterOrders(["empty", "duplicates"], ["one", "two", "three"], ["one"], "two");

  assert.deepEqual(first.displayIds, ["empty", "duplicates", "one", "two", "three"]);
  assert.deepEqual(second.displayIds, first.displayIds);
});

test("prioritizes the active and recently used filters only for overflow selection", () => {
  const orders = filterOrders(
    ["empty", "duplicates"],
    ["one", "two", "three"],
    ["three", "one"],
    "two",
  );

  assert.deepEqual(orders.priorityIds, ["two", "empty", "duplicates", "three", "one"]);
});
