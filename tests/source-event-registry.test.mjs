import test from "node:test";
import assert from "node:assert/strict";
import { SourceEventRegistry } from "../src/source-event-registry.ts";

test("subscribes once, refreshes on an event, and removes stale sources", () => {
  const subscribed = [];
  const unsubscribed = [];
  const callbacks = new Map();
  const registry = new SourceEventRegistry(
    (source, callback) => {
      subscribed.push(source);
      callbacks.set(source, callback);
      return { source };
    },
    (source, ref) => unsubscribed.push([source, ref.source]),
  );
  const first = { id: "first" };
  const second = { id: "second" };
  let refreshCount = 0;

  registry.sync([first, second], () => {
    refreshCount += 1;
  });
  registry.sync([first, second], () => {
    refreshCount += 1;
  });
  callbacks.get(second)();
  registry.sync([second], () => {
    refreshCount += 1;
  });

  assert.deepEqual(subscribed, [first, second]);
  assert.equal(refreshCount, 1);
  assert.deepEqual(unsubscribed, [[first, first]]);
});

test("clear unsubscribes every source", () => {
  const unsubscribed = [];
  const registry = new SourceEventRegistry(
    (source) => ({ source }),
    (source, ref) => unsubscribed.push([source, ref.source]),
  );
  const first = { id: "first" };
  const second = { id: "second" };

  registry.sync([first, second], () => undefined);
  registry.clear();

  assert.deepEqual(unsubscribed, [
    [first, first],
    [second, second],
  ]);
});
