import test from "node:test";
import assert from "node:assert/strict";
import { setDestructiveButton } from "../src/button-compat.ts";

test("modern destructive buttons retain the existing primary action style", () => {
  const calls = [];
  const button = {
    setDestructive() { calls.push("destructive"); return this; },
    setCta() { calls.push("primary"); return this; },
    setWarning() { throw new Error("deprecated API must not be used"); },
    buttonEl: { addClass() { throw new Error("legacy style must not be used"); } },
  };
  assert.equal(setDestructiveButton(button), button);
  assert.deepEqual(calls, ["destructive", "primary"]);
});

test("legacy buttons remain destructive without requiring the 1.13 API", () => {
  const classes = new Set(["existing-class"]);
  const button = { buttonEl: { addClass(name) { classes.add(name); } } };
  assert.equal(setDestructiveButton(button), button);
  assert.deepEqual([...classes], ["existing-class", "mod-warning"]);
});
