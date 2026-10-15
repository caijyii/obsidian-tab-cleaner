import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/view.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  external: ["obsidian"],
  logLevel: "silent",
});

function fixture({ hidden = false, width = 240 } = {}) {
  let available = width;
  let visible = !hidden;
  let observer;
  const frames = [];
  const filters = {
    isConnected: true,
    ownerDocument: { defaultView: { requestAnimationFrame(callback) { frames.push(callback); } } },
    get clientWidth() { return visible ? available : 0; },
  };
  const button = (naturalWidth) => ({
    naturalWidth,
    classes: new Set(),
    get offsetWidth() {
      return visible && !this.hasClass("is-layout-hidden") ? this.naturalWidth : 0;
    },
    addClass(...names) { names.forEach((name) => this.classes.add(name)); },
    removeClass(...names) { names.forEach((name) => this.classes.delete(name)); },
    hasClass(name) { return this.classes.has(name); },
    toggleClass(name, enabled) { enabled ? this.classes.add(name) : this.classes.delete(name); },
  });
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require(name) {
      assert.equal(name, "obsidian");
      return { ItemView: class {}, Modal: class {} };
    },
    getComputedStyle(element) { assert.equal(element, filters); return { columnGap: "2px" }; },
    ResizeObserver: class {
      constructor(callback) { observer = this; this.callback = callback; }
      observe(element) { assert.equal(element, filters); this.observed = true; }
    },
  });
  const view = Object.create(module.exports.TabCleanerView.prototype);
  const all = button(40);
  const more = button(28);
  const entries = [90, 100, 110].map((width, index) => ({ id: String(index), button: button(width) }));
  view.installAdaptiveFilterLayout(filters, all, entries, more, "all", entries.map(({ id }) => id));
  frames.shift()();
  assert.equal(observer.observed, true, "hidden views must still observe their available width");
  return {
    entries,
    more,
    visibleIds: () => entries.filter(({ button }) => !button.hasClass("is-layout-hidden")).map(({ id }) => id),
    show() { visible = true; observer.callback(); },
    resize(width) { available = width; observer.callback(); },
  };
}

test("groups rendered in an inactive tab recover their overflow menu when shown", () => {
  const state = fixture({ hidden: true });
  state.show();
  assert.equal(state.more.hasClass("is-layout-hidden"), false);
  assert.deepEqual(state.visibleIds(), ["0"]);
  state.resize(600);
  assert.deepEqual(state.visibleIds(), ["0", "1", "2"]);
  assert.equal(state.more.hasClass("is-layout-hidden"), true);
  state.resize(180);
  assert.deepEqual(state.visibleIds(), ["0"]);
  assert.equal(state.more.hasClass("is-layout-hidden"), false);
});

test("resizing measures hidden groups at their natural width before selecting them", () => {
  const state = fixture({ width: 180 });
  assert.deepEqual(state.visibleIds(), ["0"]);
  state.resize(300);
  assert.deepEqual(state.visibleIds(), ["0", "1"]);
  assert.equal(state.more.hasClass("is-layout-hidden"), false);
});

test("layout uses current button sizes instead of widths from the initial frame", () => {
  const state = fixture({ width: 400 });
  state.entries[0].button.naturalWidth = 120;
  state.resize(180);
  assert.deepEqual(state.visibleIds(), ["1"]);
  assert.equal(state.more.hasClass("is-layout-hidden"), false);
});
