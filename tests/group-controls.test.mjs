import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { movePinnedFilter, normalizePinnedFilterIds, setFilterPinned } from "../src/filter-settings.ts";

const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/settings.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  external: ["obsidian"],
  logLevel: "silent",
});

class Element {
  constructor(tagName = "div", connectedRoot = false) {
    this.tagName = tagName;
    this.connectedRoot = connectedRoot;
    this.parentNode = null;
    this.children = [];
    this.classes = new Set();
    this.attributes = new Map();
    this.listeners = new Map();
    this.disabled = false;
    this.textContent = "";
    this.scrollTop = 0;
  }
  get isConnected() { return this.connectedRoot || Boolean(this.parentNode?.isConnected); }
  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  createEl(tagName, options = {}) {
    const element = new Element(tagName);
    element.addClass(...(options.cls ?? "").split(" ").filter(Boolean));
    element.textContent = options.text ?? "";
    for (const [name, value] of Object.entries(options.attr ?? {})) element.setAttribute(name, value);
    return this.appendChild(element);
  }
  appendChild(element) {
    if (element.parentNode) {
      element.parentNode.children = element.parentNode.children.filter((child) => child !== element);
    }
    this.children.push(element);
    element.parentNode = this;
    return element;
  }
  empty() {
    for (const child of this.children) child.parentNode = null;
    this.children = [];
    this.scrollTop = 0;
  }
  addClass(...names) { names.forEach((name) => this.classes.add(name)); }
  removeClass(...names) { names.forEach((name) => this.classes.delete(name)); }
  toggleClass(name, enabled) { enabled ? this.classes.add(name) : this.classes.delete(name); }
  hasClass(name) { return this.classes.has(name); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  async click() {
    // Native HTMLButtonElement.click() does not activate a disabled button.
    if (this.tagName === "button" && this.disabled) return;
    for (const listener of this.listeners.get("click") ?? []) {
      await listener({ target: this, preventDefault() {}, stopPropagation() {} });
    }
  }
}

function fixture({ pinnedFilterIds = [], savedSettings, saveBarrier } = {}) {
  const containerEl = new Element("div", true);
  const renderedSettings = [];
  class Component {
    constructor(element, kind) { this.element = element; this.kind = kind; }
    setTooltip(label) { this.element.setAttribute("aria-label", label); return this; }
    setDisabled(disabled) { this.element.disabled = disabled; return this; }
  }
  class ButtonComponent extends Component {
    constructor(parent) {
      super(parent.createEl("button"), "button");
      this.buttonEl = this.element;
    }
    setIcon(icon) { this.icon = icon; return this; }
    setButtonText(label) { this.buttonEl.textContent = label; return this; }
    setWarning() { return this; }
    setCta() { return this; }
    onClick(callback) { this.buttonEl.addEventListener("click", callback); return this; }
  }
  class ExtraButtonComponent extends Component {
    constructor(parent) {
      super(parent.createDiv(), "extra");
      this.extraSettingsEl = this.element;
    }
    setIcon(icon) { this.icon = icon; return this; }
    onClick(callback) { this.extraSettingsEl.addEventListener("click", callback); return this; }
  }
  class ToggleComponent extends Component {
    constructor(parent) {
      super(parent.createDiv(), "toggle");
      this.toggleEl = this.element;
      this.toggleEl.setAttribute("role", "checkbox");
      this.toggleEl.addEventListener("click", async () => {
        this.setValue(!this.value);
        await this.callback?.(this.value);
      });
    }
    setValue(value) {
      this.value = value;
      this.toggleEl.setAttribute("aria-checked", String(value));
      this.toggleEl.toggleClass("is-enabled", value);
      return this;
    }
    getValue() { return this.value; }
    onChange(callback) { this.callback = callback; return this; }
  }
  class SliderComponent extends Component {
    constructor(parent) { super(parent.createEl("input"), "slider"); }
    setLimits() { return this; }
    setValue() { return this; }
    onChange() { return this; }
  }
  class Setting {
    constructor(parent) {
      this.settingEl = parent.createDiv();
      this.controlEl = this.settingEl.createDiv();
      this.components = [];
      renderedSettings.push(this);
    }
    setName(name) { this.name = name; return this; }
    setDesc(description) { this.description = description; return this; }
    setHeading() { return this; }
    addComponent(Type, callback) {
      const component = new Type(this.controlEl);
      this.components.push(component);
      callback(component);
      return this;
    }
    addToggle(callback) { return this.addComponent(ToggleComponent, callback); }
    addButton(callback) { return this.addComponent(ButtonComponent, callback); }
    addExtraButton(callback) { return this.addComponent(ExtraButtonComponent, callback); }
    addSlider(callback) { return this.addComponent(SliderComponent, callback); }
  }
  class PluginSettingTab {
    constructor(app, plugin) {
      this.app = app;
      this.plugin = plugin;
      this.containerEl = containerEl;
    }
  }
  const obsidian = {
    Component,
    Setting,
    PluginSettingTab,
    ItemView: class {},
    Modal: class {},
    TFile: class {},
    getLanguage: () => "zh",
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputFiles[0].text, {
    module,
    exports: module.exports,
    require(name) { assert.equal(name, "obsidian"); return obsidian; },
  });
  const strategies = [{ id: "custom", name: "我的检索", query: "tab" }];
  const settings = structuredClone(savedSettings ?? {
    strategies,
    pinnedFilterIds,
    recentFilterIds: [],
    pinnedProtection: "always",
    protectActiveTab: true,
    recentBatchLimit: 20,
  });
  settings.pinnedFilterIds = normalizePinnedFilterIds(settings.pinnedFilterIds, settings.strategies.map(({ id }) => id));
  const moveCalls = [];
  const pinCalls = [];
  const saves = [];
  const plugin = {
    settings,
    isFilterPinned(id) { return this.settings.pinnedFilterIds.includes(id); },
    async saveSettings() {
      saves.push(structuredClone(this.settings));
      if (saveBarrier) await saveBarrier;
    },
    async setFilterPinned(id, pinned) {
      pinCalls.push([id, pinned]);
      this.settings.pinnedFilterIds = setFilterPinned(this.settings.pinnedFilterIds, id, pinned);
      await this.saveSettings();
    },
    async movePinnedFilter(id, direction) {
      moveCalls.push([id, direction]);
      this.settings.pinnedFilterIds = movePinnedFilter(this.settings.pinnedFilterIds, id, direction);
      await this.saveSettings();
    },
  };
  const tab = new module.exports.TabCleanerSettingTab({}, plugin);
  tab.display();
  function row(name) {
    const found = renderedSettings.find((setting) => setting.settingEl.isConnected && setting.name === name);
    assert.ok(found, `expected the current ${name} setting row`);
    return found;
  }
  const groupNames = () => renderedSettings
    .filter((setting) => setting.settingEl.isConnected && ["空白", "重复", "我的检索"].includes(setting.name))
    .map((setting) => setting.name);
  return { tab, plugin, row, moveCalls, pinCalls, saves, containerEl, groupNames };
}

function toggle(row) {
  const toggles = row.components.filter((component) => component.kind === "toggle");
  assert.equal(toggles.length, 1, "each search group must use one ToggleComponent");
  return toggles[0];
}

function orderButtons(row) {
  return row.components.filter((component) =>
    component.kind === "button" && component.buttonEl.hasClass("tab-cleaner__group-order-button"),
  );
}

function orderButton(row, direction) {
  const found = orderButtons(row).find((button) => button.icon === `chevron-${direction}`);
  assert.ok(found, `expected the native ${direction} ordering button`);
  return found;
}

test("unpinned built-in and custom groups expose a named toggle without ordering buttons", () => {
  const { row } = fixture();
  for (const name of ["空白", "重复", "我的检索"]) {
    const group = row(name);
    const pinToggle = toggle(group);
    assert.equal(pinToggle.value, false);
    const label = pinToggle.toggleEl.getAttribute("aria-label") ?? "";
    assert.ok(label.includes("置顶检索组") && label.includes(name));
    assert.equal(orderButtons(group).length, 0);
    assert.equal(group.controlEl.children.at(-1), pinToggle.toggleEl);
  }
});

test("turning a built-in or custom toggle on shows only valid ordering directions and off removes them", async () => {
  const { row, pinCalls, plugin } = fixture({ pinnedFilterIds: ["duplicates"] });
  for (const [id, name] of [["empty", "空白"], ["custom", "我的检索"]]) {
    await toggle(row(name)).toggleEl.click();
    const pinnedRow = row(name);
    assert.equal(toggle(pinnedRow).value, true);
    assert.deepEqual(orderButtons(pinnedRow).map((button) => button.icon), ["chevron-up"]);
    assert.deepEqual(plugin.settings.pinnedFilterIds, ["duplicates", id]);
    await toggle(pinnedRow).toggleEl.click();
    assert.equal(toggle(row(name)).value, false);
    assert.equal(orderButtons(row(name)).length, 0);
    assert.deepEqual(plugin.settings.pinnedFilterIds, ["duplicates"]);
  }
  assert.deepEqual(pinCalls, [["empty", true], ["empty", false], ["custom", true], ["custom", false]]);
});

test("first, middle, and last pinned groups show only their valid native ordering buttons", () => {
  const { row } = fixture({ pinnedFilterIds: ["empty", "duplicates", "custom"] });
  assert.deepEqual(orderButtons(row("空白")).map((button) => button.icon), ["chevron-down"]);
  assert.deepEqual(orderButtons(row("重复")).map((button) => button.icon), ["chevron-up", "chevron-down"]);
  assert.deepEqual(orderButtons(row("我的检索")).map((button) => button.icon), ["chevron-up"]);
  for (const name of ["空白", "重复", "我的检索"]) {
    for (const button of orderButtons(row(name))) {
      assert.equal(button.buttonEl.tagName, "button");
      assert.equal(button.buttonEl.disabled, false);
    }
  }
});

test("a single pinned group remains pinned without either ordering button", () => {
  for (const [id, name] of [["empty", "空白"], ["custom", "我的检索"]]) {
    const { row } = fixture({ pinnedFilterIds: [id] });
    assert.equal(toggle(row(name)).value, true);
    assert.equal(orderButtons(row(name)).length, 0);
    assert.equal(row(name).controlEl.children.at(-1), toggle(row(name)).toggleEl);
  }
});

test("moving a middle group refreshes its boundary buttons and persists the manual order", async () => {
  const { row, plugin, moveCalls, saves } = fixture({ pinnedFilterIds: ["empty", "duplicates", "custom"] });
  assert.deepEqual(orderButtons(row("重复")).map((button) => button.icon), ["chevron-up", "chevron-down"]);
  await orderButton(row("重复"), "up").buttonEl.click();
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["duplicates", "empty", "custom"]);
  assert.deepEqual(orderButtons(row("重复")).map((button) => button.icon), ["chevron-down"]);
  await orderButton(row("重复"), "down").buttonEl.click();
  await orderButton(row("重复"), "down").buttonEl.click();
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["empty", "custom", "duplicates"]);
  assert.deepEqual(orderButtons(row("重复")).map((button) => button.icon), ["chevron-up"]);
  assert.deepEqual(moveCalls, [["duplicates", "up"], ["duplicates", "down"], ["duplicates", "down"]]);
  assert.deepEqual(saves.at(-1).pinnedFilterIds, ["empty", "custom", "duplicates"]);
});

test("invalid boundary controls are absent from the DOM and do not occupy button slots", () => {
  const { row, moveCalls } = fixture({ pinnedFilterIds: ["empty", "custom"] });
  for (const [name, validDirection] of [["空白", "down"], ["我的检索", "up"]]) {
    const group = row(name);
    assert.deepEqual(
      group.controlEl.children.filter((element) => element.hasClass("tab-cleaner__group-order-button")),
      [orderButton(group, validDirection).buttonEl],
    );
    assert.equal(orderButtons(group).length, 1);
    assert.equal(group.controlEl.children.at(-1), toggle(group).toggleEl);
  }
  assert.deepEqual(moveCalls, []);
});

test("custom edit and delete precede ordering controls and the toggle remains rightmost", () => {
  const { row } = fixture({ pinnedFilterIds: ["empty", "custom", "duplicates"] });
  const group = row("我的检索");
  const extras = group.components.filter((component) => component.kind === "extra");
  assert.deepEqual(extras.map((component) => component.icon), ["pencil", "trash-2"]);
  const interactiveElements = group.controlEl.children.filter((element) =>
    group.components.some((component) => component.element === element),
  );
  assert.deepEqual(interactiveElements, [
    ...extras.map((component) => component.extraSettingsEl),
    orderButton(group, "up").buttonEl,
    orderButton(group, "down").buttonEl,
    toggle(group).toggleEl,
  ]);
  assert.equal(group.controlEl.children.at(-1), toggle(group).toggleEl);
  assert.equal(row("空白").controlEl.children.at(-1), toggle(row("空白")).toggleEl);
});

test("saved toggle states and manual ordering are retained after reopening settings", async () => {
  const { row, saves } = fixture();
  await toggle(row("我的检索")).toggleEl.click();
  await toggle(row("重复")).toggleEl.click();
  await orderButton(row("重复"), "up").buttonEl.click();
  const reopened = fixture({ savedSettings: saves.at(-1) });

  assert.deepEqual(reopened.plugin.settings.pinnedFilterIds, ["duplicates", "custom"]);
  assert.equal(toggle(reopened.row("重复")).value, true);
  assert.equal(toggle(reopened.row("我的检索")).value, true);
  assert.equal(toggle(reopened.row("空白")).value, false);
  assert.deepEqual(orderButtons(reopened.row("重复")).map((button) => button.icon), ["chevron-down"]);
  assert.deepEqual(orderButtons(reopened.row("我的检索")).map((button) => button.icon), ["chevron-up"]);
});

test("pinning and unpinning built-in and custom groups preserve the viewport while reordering and saving", async () => {
  const { row, plugin, saves, containerEl, groupNames } = fixture();
  const defaultNames = ["空白", "重复", "我的检索"];
  for (const [id, name] of [["duplicates", "重复"], ["custom", "我的检索"]]) {
    containerEl.scrollTop = 160;
    await toggle(row(name)).toggleEl.click();
    assert.equal(containerEl.scrollTop, 160, "pinning must preserve the settings viewport");
    assert.deepEqual(groupNames(), [name, ...defaultNames.filter((groupName) => groupName !== name)]);
    assert.deepEqual(plugin.settings.pinnedFilterIds, [id]);
    assert.deepEqual(saves.at(-1).pinnedFilterIds, [id]);

    containerEl.scrollTop = 240;
    await toggle(row(name)).toggleEl.click();
    assert.equal(containerEl.scrollTop, 240, "unpinning must preserve the settings viewport");
    assert.deepEqual(groupNames(), defaultNames);
    assert.deepEqual(plugin.settings.pinnedFilterIds, []);
    assert.deepEqual(saves.at(-1).pinnedFilterIds, []);
  }
});

test("manual up and down moves preserve the viewport while refreshing group order", async () => {
  const { row, containerEl, groupNames, saves } = fixture({ pinnedFilterIds: ["empty", "duplicates", "custom"] });
  containerEl.scrollTop = 320;
  await orderButton(row("重复"), "up").buttonEl.click();
  assert.equal(containerEl.scrollTop, 320);
  assert.deepEqual(groupNames(), ["重复", "空白", "我的检索"]);
  assert.deepEqual(saves.at(-1).pinnedFilterIds, ["duplicates", "empty", "custom"]);

  containerEl.scrollTop = 480;
  await orderButton(row("重复"), "down").buttonEl.click();
  assert.equal(containerEl.scrollTop, 480);
  assert.deepEqual(groupNames(), ["空白", "重复", "我的检索"]);
  assert.deepEqual(saves.at(-1).pinnedFilterIds, ["empty", "duplicates", "custom"]);
});

test("a rebuild after asynchronous save preserves the user's latest scroll position", async () => {
  let finishSave;
  const saveBarrier = new Promise((resolve) => { finishSave = resolve; });
  const { row, containerEl, groupNames } = fixture({ saveBarrier });
  containerEl.scrollTop = 100;
  const pendingClick = toggle(row("我的检索")).toggleEl.click();
  containerEl.scrollTop = 430;
  finishSave();
  await pendingClick;

  assert.equal(containerEl.scrollTop, 430, "capture the viewport when display starts, after save resolves");
  assert.deepEqual(groupNames(), ["我的检索", "空白", "重复"]);
});
