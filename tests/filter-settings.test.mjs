import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  movePinnedFilter,
  normalizePinnedFilterIds,
  normalizeRecentFilterIds,
  reorderPinnedFilter,
  setFilterPinned,
} from "../src/filter-settings.ts";

const compiledPlugin = await build({
  entryPoints: [fileURLToPath(new URL("../src/main.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  external: ["obsidian"],
  logLevel: "silent",
});

async function loadedPlugin(settings) {
  const savedData = [];
  class Plugin {
    constructor() { this.app = { workspace: { getLeavesOfType: () => [] } }; }
    async loadData() { return { settings, recentBatches: [] }; }
    async saveData(data) { savedData.push(structuredClone(data)); }
  }
  const obsidian = {
    Plugin,
    ItemView: class {},
    Modal: class {},
    PluginSettingTab: class {},
    TFile: class {},
  };
  const module = { exports: {} };
  vm.runInNewContext(compiledPlugin.outputFiles[0].text, {
    module,
    exports: module.exports,
    structuredClone,
    require(name) {
      assert.equal(name, "obsidian");
      return obsidian;
    },
  });
  const plugin = new module.exports.default();
  await plugin.loadPluginData();
  return { plugin, savedData };
}

test("actual settings saves refresh the owned search index after persisting without losing closed history", async () => {
  const { plugin, savedData } = await loadedPlugin({ strategies: [], pinnedFilterIds: [] });
  const history = [{ id: "history", closedAt: 100, label: "all", tabs: [] }];
  plugin.recentBatches = structuredClone(history);
  const indexed = [];
  plugin.settingsTab = {
    refresh() {
      const names = Array.from(plugin.settings.strategies, (strategy) => strategy.name);
      assert.deepEqual(savedData.at(-1).settings.strategies.map((strategy) => strategy.name), names);
      indexed.push(names);
    },
  };
  await plugin.addStrategy({ id: "new", name: "原名", query: "tab" });
  await plugin.updateStrategy({ id: "new", name: "新名", query: "tab" });
  await plugin.removeStrategy("new");
  assert.deepEqual(indexed, [["原名"], ["新名"], []]);
  for (const saved of savedData) assert.deepEqual(saved.recentBatches, history);
});

test("preserves the built-in pins for old configurations without an array", () => {
  for (const savedIds of [undefined, null, false, 0, "empty", { empty: true }]) {
    assert.deepEqual(normalizePinnedFilterIds(savedIds, ["custom"]), ["empty", "duplicates"]);
  }
});

test("preserves an explicit choice to unpin every group", () => {
  assert.deepEqual(normalizePinnedFilterIds([], ["custom"]), []);
});

test("normalizes custom and built-in pins together in the saved order", () => {
  const savedIds = ["second", "duplicates", "first", "empty"];

  assert.deepEqual(normalizePinnedFilterIds(savedIds, ["first", "second"]), savedIds);
});

test("removes deleted, invalid, and duplicate pinned group IDs", () => {
  assert.deepEqual(
    normalizePinnedFilterIds(
      ["removed", "custom", "empty", "custom", "all", 3, null, undefined, {}, "duplicates", "empty"],
      ["custom"],
    ),
    ["custom", "empty", "duplicates"],
  );
});

test("never treats the all-tabs filter as a pinnable search group", () => {
  assert.deepEqual(normalizePinnedFilterIds(["all", "custom"], ["all", "custom"]), ["custom"]);
});

test("does not restore defaults when an explicit pin array contains no valid groups", () => {
  assert.deepEqual(normalizePinnedFilterIds(["removed", "all", 42], []), []);
});

test("appends a newly pinned group without changing existing pin order", () => {
  const pinnedIds = ["custom", "empty"];

  assert.deepEqual(setFilterPinned(pinnedIds, "duplicates", true), ["custom", "empty", "duplicates"]);
  assert.deepEqual(pinnedIds, ["custom", "empty"]);
});

test("repeatedly pinning an existing group keeps one entry in its original position", () => {
  assert.deepEqual(setFilterPinned(["custom", "empty", "duplicates"], "empty", true), ["custom", "empty", "duplicates"]);
  assert.deepEqual(setFilterPinned(["custom", "empty", "custom"], "custom", true), ["custom", "empty"]);
});

test("unpins built-in and custom groups while preserving the remaining order", () => {
  const pinnedIds = ["custom", "empty", "other", "duplicates"];

  assert.deepEqual(setFilterPinned(pinnedIds, "empty", false), ["custom", "other", "duplicates"]);
  assert.deepEqual(setFilterPinned(pinnedIds, "custom", false), ["empty", "other", "duplicates"]);
  assert.deepEqual(pinnedIds, ["custom", "empty", "other", "duplicates"]);
});

test("unpinning a missing group leaves the pins intact and removing the last pin keeps an empty array", () => {
  assert.deepEqual(setFilterPinned(["custom", "empty"], "removed", false), ["custom", "empty"]);
  assert.deepEqual(setFilterPinned(["custom"], "custom", false), []);
});

test("missing or malformed recent-use settings start with no recorded groups", () => {
  for (const savedIds of [undefined, null, false, 0, "empty", { custom: true }]) {
    assert.deepEqual(normalizeRecentFilterIds(savedIds, ["custom"]), []);
  }
  assert.deepEqual(normalizeRecentFilterIds([], ["custom"]), []);
});

test("recent use preserves the saved order across built-in and custom groups", () => {
  const savedIds = ["second", "duplicates", "first", "empty"];

  assert.deepEqual(normalizeRecentFilterIds(savedIds, ["first", "second"]), savedIds);
});

test("recent use removes stale, duplicate, all-tabs, and non-string entries", () => {
  assert.deepEqual(
    normalizeRecentFilterIds(
      ["removed", "custom", "empty", "custom", "all", 3, null, undefined, {}, "duplicates", "empty"],
      ["custom", "all"],
    ),
    ["custom", "empty", "duplicates"],
  );
});

test("recent-use normalization keeps more than ten valid custom groups", () => {
  const ids = Array.from({ length: 12 }, (_, index) => `custom-${index}`);

  assert.deepEqual(normalizeRecentFilterIds(ids, ids), ids);
});

test("moves a pinned group one adjacent position without mutating the input", () => {
  const ids = ["custom", "empty", "duplicates", "other"];

  assert.deepEqual(movePinnedFilter(ids, "duplicates", "up"), ["custom", "duplicates", "empty", "other"]);
  assert.deepEqual(movePinnedFilter(ids, "empty", "down"), ["custom", "duplicates", "empty", "other"]);
  assert.deepEqual(movePinnedFilter(ids, "custom", "down"), ["empty", "custom", "duplicates", "other"]);
  assert.deepEqual(ids, ["custom", "empty", "duplicates", "other"]);
});

test("leaves pinned order unchanged at either boundary or for a missing group", () => {
  const ids = ["custom", "empty", "duplicates"];

  assert.deepEqual(movePinnedFilter(ids, "custom", "up"), ids);
  assert.deepEqual(movePinnedFilter(ids, "duplicates", "down"), ids);
  assert.deepEqual(movePinnedFilter(ids, "removed", "up"), ids);
  assert.deepEqual(movePinnedFilter([], "custom", "down"), []);
  assert.deepEqual(movePinnedFilter(["custom"], "custom", "down"), ["custom"]);
  assert.deepEqual(ids, ["custom", "empty", "duplicates"]);
});

test("the actual plugin migrates and normalizes old recentStrategyIds without saving the legacy field", async () => {
  const { plugin, savedData } = await loadedPlugin({
    strategies: [{ id: "custom", name: "Custom", query: "tab" }],
    recentStrategyIds: ["custom", "removed", "custom", "all"],
  });

  assert.deepEqual([...plugin.settings.recentFilterIds], ["custom"]);
  assert.equal(Object.hasOwn(plugin.settings, "recentStrategyIds"), false);
  await plugin.saveSettings();
  assert.deepEqual(savedData.at(-1).settings.recentFilterIds, ["custom"]);
  assert.equal(Object.hasOwn(savedData.at(-1).settings, "recentStrategyIds"), false);
});

test("an explicitly empty current recent-use setting takes precedence over legacy history", async () => {
  const { plugin } = await loadedPlugin({
    strategies: [{ id: "custom", name: "Custom", query: "tab" }],
    recentFilterIds: [],
    recentStrategyIds: ["custom"],
  });

  assert.deepEqual([...plugin.settings.recentFilterIds], []);
});

test("the actual plugin records built-in recent use without truncating existing groups to ten", async () => {
  const ids = Array.from({ length: 12 }, (_, index) => `custom-${index}`);
  const { plugin } = await loadedPlugin({
    strategies: ids.map((id) => ({ id, name: id, query: "tab" })),
    recentFilterIds: ids,
  });

  plugin.markFilterUsed("empty");
  assert.deepEqual([...plugin.settings.recentFilterIds], ["empty", ...ids]);
  plugin.markFilterUsed("custom-11");
  const expected = ["custom-11", "empty", ...ids.slice(0, 11)];
  assert.deepEqual([...plugin.settings.recentFilterIds], expected);
  plugin.markFilterUsed("all");
  plugin.markFilterUsed("removed");
  assert.deepEqual([...plugin.settings.recentFilterIds], expected);
});

test("deleting a custom group removes it from actual pinned and recent settings and persists the result", async () => {
  const { plugin, savedData } = await loadedPlugin({
    strategies: [
      { id: "custom", name: "Custom", query: "tab" },
      { id: "other", name: "Other", query: "note" },
    ],
    pinnedFilterIds: ["empty", "custom", "other"],
    recentFilterIds: ["custom", "duplicates", "other"],
  });
  await plugin.removeStrategy("custom");

  assert.deepEqual([...plugin.settings.pinnedFilterIds], ["empty", "other"]);
  assert.deepEqual([...plugin.settings.recentFilterIds], ["duplicates", "other"]);
  assert.deepEqual([...plugin.settings.strategies].map(({ id }) => id), ["other"]);
  assert.deepEqual(savedData.at(-1).settings.pinnedFilterIds, ["empty", "other"]);
  assert.deepEqual(savedData.at(-1).settings.recentFilterIds, ["duplicates", "other"]);
});

test("drag insertion before or after a target preserves all other pinned groups, including hidden ones", () => {
  const ids = ["empty", "hidden", "duplicates", "custom"];

  assert.deepEqual(reorderPinnedFilter(ids, "custom", "empty", "before"), ["custom", "empty", "hidden", "duplicates"]);
  assert.deepEqual(reorderPinnedFilter(ids, "empty", "duplicates", "after"), ["hidden", "duplicates", "empty", "custom"]);
  assert.deepEqual(reorderPinnedFilter(ids, "duplicates", "custom", "after"), ["empty", "hidden", "custom", "duplicates"]);
  assert.deepEqual(ids, ["empty", "hidden", "duplicates", "custom"]);
});

test("invalid, self, and already adjacent drag insertions leave the pinned order unchanged", () => {
  const ids = ["empty", "hidden", "duplicates", "custom"];
  for (const [dragged, target, placement] of [
    ["removed", "empty", "before"],
    ["empty", "removed", "after"],
    ["empty", "empty", "before"],
    ["hidden", "duplicates", "before"],
    ["duplicates", "hidden", "after"],
    ["all", "empty", "after"],
  ]) {
    assert.deepEqual(reorderPinnedFilter(ids, dragged, target, placement), ids);
  }
  assert.deepEqual(reorderPinnedFilter([], "empty", "duplicates", "before"), []);
});

test("the actual plugin saves one changed drag order and skips subsequent no-op orders", async () => {
  const { plugin, savedData } = await loadedPlugin({
    strategies: [
      { id: "hidden", name: "Hidden", query: "hidden" },
      { id: "custom", name: "Custom", query: "tab" },
    ],
    pinnedFilterIds: ["empty", "hidden", "duplicates", "custom"],
    recentFilterIds: ["duplicates", "custom"],
  });
  await plugin.reorderPinnedFilter("custom", "empty", "before");
  assert.deepEqual([...plugin.settings.pinnedFilterIds], ["custom", "empty", "hidden", "duplicates"]);
  assert.deepEqual([...plugin.settings.recentFilterIds], ["duplicates", "custom"]);
  assert.equal(savedData.length, 1);
  assert.deepEqual(savedData[0].settings.pinnedFilterIds, ["custom", "empty", "hidden", "duplicates"]);

  await plugin.reorderPinnedFilter("custom", "empty", "before");
  await plugin.reorderPinnedFilter("custom", "custom", "after");
  await plugin.reorderPinnedFilter("removed", "empty", "before");
  assert.equal(savedData.length, 1);
});

test("adding and updating a custom group atomically persist its staged full pin order", async () => {
  const { plugin, savedData } = await loadedPlugin({
    strategies: [{ id: "custom", name: "Custom", query: "tab" }],
    pinnedFilterIds: ["empty", "custom", "duplicates"],
  });
  const added = { id: "new", name: "New", query: "note" };
  await plugin.addStrategy(added, true, ["new", "custom", "empty", "duplicates"]);
  assert.equal(savedData.length, 1);
  assert.deepEqual(savedData[0].settings.pinnedFilterIds, ["new", "custom", "empty", "duplicates"]);
  assert.equal(savedData[0].settings.strategies.find(({ id }) => id === "new").name, "New");

  await plugin.updateStrategy({ id: "custom", name: "Renamed", query: "tab" }, false, ["duplicates", "empty", "new"]);
  assert.equal(savedData.length, 2);
  assert.deepEqual(savedData[1].settings.pinnedFilterIds, ["duplicates", "empty", "new"]);
  assert.equal(savedData[1].settings.strategies.find(({ id }) => id === "custom").name, "Renamed");
});

test("confirming a name after immediate pin changes retains the latest pin state and order", async () => {
  const { plugin, savedData } = await loadedPlugin({
    strategies: [{ id: "custom", name: "Custom", query: "tab" }],
    pinnedFilterIds: ["empty", "custom", "duplicates"],
    recentFilterIds: ["duplicates", "custom"],
  });
  await plugin.setFilterPinned("custom", false);
  await plugin.updateStrategy({ id: "custom", name: "Renamed", query: "tab" });
  assert.deepEqual(savedData.at(-1).settings.pinnedFilterIds, ["empty", "duplicates"]);
  assert.equal(savedData.at(-1).settings.strategies[0].name, "Renamed");

  await plugin.setFilterPinned("custom", true);
  await plugin.reorderPinnedFilter("custom", "empty", "before");
  await plugin.updateStrategy({ id: "custom", name: "Renamed again", query: "tab" });
  assert.deepEqual(savedData.at(-1).settings.pinnedFilterIds, ["custom", "empty", "duplicates"]);
  assert.deepEqual(savedData.at(-1).settings.recentFilterIds, ["duplicates", "custom"]);
  assert.equal(savedData.at(-1).settings.strategies[0].name, "Renamed again");
});
