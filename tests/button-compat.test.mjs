import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/button-compat.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  external: ["obsidian"],
  logLevel: "silent",
});

function fixture(modern) {
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require(name) {
      assert.equal(name, "obsidian");
      return { requireApiVersion(version) { assert.equal(version, "1.13.0"); return modern; } };
    },
  });
  return module.exports.setDestructiveButton;
}

test("modern destructive buttons retain the existing primary action style", () => {
  const setDestructiveButton = fixture(true);
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
  const setDestructiveButton = fixture(false);
  const classes = new Set(["existing-class"]);
  const button = { buttonEl: { addClass(name) { classes.add(name); } } };
  assert.equal(setDestructiveButton(button), button);
  assert.deepEqual([...classes], ["existing-class", "mod-warning"]);
});

test("older hosts never access the newer destructive API", () => {
  const setDestructiveButton = fixture(false);
  const classes = new Set();
  const button = {
    get setDestructive() { throw new Error("1.13 API must not be accessed on an older host"); },
    buttonEl: { addClass(name) { classes.add(name); } },
  };
  assert.equal(setDestructiveButton(button), button);
  assert.deepEqual([...classes], ["mod-warning"]);
});

test("the legacy destructive style remains available when a modern host lacks the method", () => {
  const setDestructiveButton = fixture(true);
  const classes = new Set();
  const button = { buttonEl: { addClass(name) { classes.add(name); } } };
  assert.equal(setDestructiveButton(button), button);
  assert.deepEqual([...classes], ["mod-warning"]);
});
