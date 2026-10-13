import test from "node:test";
import assert from "node:assert/strict";
import { filterOrders } from "../src/filter-order.ts";

test("changing only the active filter does not move the displayed groups", () => {
  const first = filterOrders(["empty", "duplicates"], ["one", "two", "three"], ["two"], "one", ["three", "empty"]);
  const second = filterOrders(["empty", "duplicates"], ["one", "two", "three"], ["two"], "two", ["three", "empty"]);

  assert.deepEqual(first.displayIds, ["three", "empty", "two", "duplicates", "one"]);
  assert.deepEqual(second.displayIds, first.displayIds);
});

test("prioritizes the active, pinned, and recent groups for overflow selection", () => {
  const orders = filterOrders(
    ["empty", "duplicates"],
    ["one", "two", "three", "four"],
    ["four", "one"],
    "two",
    ["three", "empty"],
  );

  assert.deepEqual(orders.displayIds, ["three", "empty", "four", "one", "duplicates", "two"]);
  assert.deepEqual(orders.priorityIds, ["two", "three", "empty", "four", "one", "duplicates"]);
});

test("keeps every unpinned group available in the full display", () => {
  const orders = filterOrders(
    ["empty", "duplicates"],
    ["one", "two", "three"],
    ["three"],
    "all",
    [],
  );

  assert.deepEqual(orders.displayIds, ["three", "empty", "duplicates", "one", "two"]);
  assert.deepEqual(orders.priorityIds, ["three", "empty", "duplicates", "one", "two"]);
});

test("uses the same pin order for custom and built-in groups", () => {
  const orders = filterOrders(
    ["empty", "duplicates"],
    ["one", "two", "three"],
    [],
    "all",
    ["two", "duplicates", "one"],
  );

  assert.deepEqual(orders.displayIds, ["two", "duplicates", "one", "empty", "three"]);
  assert.deepEqual(orders.priorityIds, orders.displayIds);
});

test("does not retain built-in overflow priority after unpinning", () => {
  const orders = filterOrders(
    ["empty", "duplicates"],
    ["one", "two"],
    ["two"],
    "one",
    ["duplicates"],
  );

  assert.deepEqual(orders.displayIds, ["duplicates", "two", "empty", "one"]);
  assert.deepEqual(orders.priorityIds, ["one", "duplicates", "two", "empty"]);
});

test("ignores stale groups and deduplicates overlapping priority sources", () => {
  const orders = filterOrders(
    ["empty", "duplicates", "empty"],
    ["one", "two", "one"],
    ["removed", "one", "one", "all", "two"],
    "one",
    ["removed", "two", "duplicates", "two", "all"],
  );

  assert.deepEqual(orders.displayIds, ["two", "duplicates", "one", "empty"]);
  assert.deepEqual(orders.priorityIds, ["one", "two", "duplicates", "empty"]);
});

test("does not include an active group that no longer exists", () => {
  const orders = filterOrders(["empty", "duplicates"], ["one"], ["one"], "removed", ["empty"]);

  assert.deepEqual(orders.displayIds, ["empty", "one", "duplicates"]);
  assert.deepEqual(orders.priorityIds, ["empty", "one", "duplicates"]);
});

test("recently used built-in and custom groups share the same display order", () => {
  const orders = filterOrders(
    ["empty", "duplicates"],
    ["one", "two", "three"],
    ["two", "duplicates", "one", "empty"],
    "all",
    [],
  );

  assert.deepEqual(orders.displayIds, ["two", "duplicates", "one", "empty", "three"]);
  assert.deepEqual(orders.priorityIds, orders.displayIds);
});

test("recent use never rearranges the manually ordered pinned groups", () => {
  const first = filterOrders(["empty", "duplicates"], ["one", "two"], ["one", "empty"], "one", ["two", "empty", "one"]);
  const second = filterOrders(["empty", "duplicates"], ["one", "two"], ["empty", "two", "one"], "empty", ["two", "empty", "one"]);

  assert.deepEqual(first.displayIds, ["two", "empty", "one", "duplicates"]);
  assert.deepEqual(second.displayIds, first.displayIds);
  assert.deepEqual(second.priorityIds, ["empty", "two", "one", "duplicates"]);
});

test("unused groups follow the built-in and custom configuration order", () => {
  const orders = filterOrders(["empty", "duplicates"], ["one", "two", "three"], [], "three", []);

  assert.deepEqual(orders.displayIds, ["empty", "duplicates", "one", "two", "three"]);
  assert.deepEqual(orders.priorityIds, ["three", "empty", "duplicates", "one", "two"]);
});

test("the all-tabs filter remains excluded even when supplied in a configuration list", () => {
  const orders = filterOrders(["all", "empty", "duplicates"], ["one", "all"], ["all", "one"], "all", ["all", "empty"]);

  assert.deepEqual(orders.displayIds, ["empty", "one", "duplicates"]);
  assert.deepEqual(orders.priorityIds, orders.displayIds);
});
