import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { movePinnedFilter, normalizePinnedFilterIds, reorderPinnedFilter, setFilterPinned } from "../src/filter-settings.ts";

// Compile the real view and model. Only Obsidian's host API and DOM extensions
// are replaced; these tests exercise the registered workspace event handlers.
const compiled = await build({
  entryPoints: [fileURLToPath(new URL("../src/view.ts", import.meta.url))],
  bundle: true,
  write: false,
  format: "cjs",
  platform: "node",
  external: ["obsidian"],
  logLevel: "silent",
});
const viewCode = compiled.outputFiles[0].text;

class FakeElement {
  constructor(tagName = "div", connected = false) {
    this.tagName = tagName;
    this.children = [];
    this.classes = new Set();
    this.attributes = new Map();
    this.listeners = new Map();
    this.parentNode = null;
    this.connectedRoot = connected;
    // Adaptive width layout is unrelated to these event and identity tests.
    this.ownerDocument = { defaultView: null };
    const properties = new Map();
    this.style = {
      getPropertyValue: (name) => properties.get(name)?.value ?? "",
      getPropertyPriority: (name) => properties.get(name)?.priority ?? "",
      setProperty: (name, value, priority = "") => properties.set(name, { value, priority }),
      removeProperty: (name) => { const old = properties.get(name)?.value ?? ""; properties.delete(name); return old; },
    };
    this.classList = {
      add: (...names) => this.addClass(...names),
      remove: (...names) => this.removeClass(...names),
      contains: (name) => this.hasClass(name),
      toggle: (name, force) => { this.toggleClass(name, force ?? !this.hasClass(name)); return this.hasClass(name); },
    };
    this.capturedPointers = new Set();
    this.bounds = { left: 0, right: 80, top: 0, bottom: 24, width: 80, height: 24 };
  }

  get isConnected() {
    return this.connectedRoot || Boolean(this.parentNode?.isConnected);
  }

  createEl(tagName, options = {}) {
    const element = new FakeElement(tagName);
    element.addClass(...(options.cls ?? "").split(" ").filter(Boolean));
    element.textContent = options.text ?? "";
    element.value = options.value ?? "";
    element.type = options.type;
    for (const [name, value] of Object.entries(options.attr ?? {})) {
      element.setAttribute(name, value);
    }
    return this.appendChild(element);
  }

  createDiv(options = {}) { return this.createEl("div", options); }
  createSpan(options = {}) { return this.createEl("span", options); }
  createSvg(tagName, options = {}) { return this.createEl(tagName, options); }
  addClass(...classes) { classes.forEach((name) => this.classes.add(name)); }
  removeClass(...classes) { classes.forEach((name) => this.classes.delete(name)); }
  hasClass(name) { return this.classes.has(name); }
  toggleClass(name, enabled) { enabled ? this.classes.add(name) : this.classes.delete(name); }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }

  appendChild(element) {
    if (element.parentNode) {
      element.parentNode.children = element.parentNode.children.filter((child) => child !== element);
    }
    this.children.push(element);
    element.parentNode = this;
    element.ownerDocument = this.ownerDocument;
    return element;
  }

  empty() {
    if (this.contains(this.ownerDocument.activeElement)) this.ownerDocument.activeElement = null;
    for (const child of this.children) child.parentNode = null;
    this.children = [];
  }

  addEventListener(type, listener, options) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ listener, capture: options === true || options?.capture === true });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, listener) {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item.listener !== listener));
  }

  fire(type, init = {}) {
    const path = [];
    for (let element = this; element; element = element.parentNode) path.push(element);
    let stopped = false;
    let immediate = false;
    const event = {
      type,
      target: this,
      detail: type === "click" ? 1 : 0,
      button: 0,
      isPrimary: true,
      pointerId: 1,
      clientX: 0,
      clientY: 0,
      defaultPrevented: false,
      pending: [],
      ...init,
      preventDefault() { this.defaultPrevented = true; },
      stopPropagation() { stopped = true; },
      stopImmediatePropagation() { immediate = true; stopped = true; },
      composedPath() { return path; },
    };
    for (const capture of [true, false]) {
      for (const element of capture ? [...path].reverse() : path) {
        for (const { listener, capture: registeredCapture } of element.listeners.get(type) ?? []) {
          if (registeredCapture === capture) {
            const result = listener(event);
            if (result?.then) event.pending.push(result);
            if (immediate) break;
          }
        }
        if (stopped) return event;
      }
    }
    return event;
  }

  async click() {
    if (this.tagName === "button" && this.disabled) return;
    const event = this.fire("click");
    await Promise.all(event.pending);
  }

  getBoundingClientRect() { return this.bounds; }
  setPointerCapture(id) { this.capturedPointers.add(id); }
  hasPointerCapture(id) { return this.capturedPointers.has(id); }
  releasePointerCapture(id) { this.capturedPointers.delete(id); }
  hide() { this.hidden = true; this.style.setProperty("display", "none"); }
  show() { this.hidden = false; this.style.removeProperty("display"); }
  toggle(visible) { visible ? this.show() : this.hide(); }

  findAll(className) {
    return [
      ...(this.hasClass(className) ? [this] : []),
      ...this.children.flatMap((child) => child.findAll(className)),
    ];
  }

  querySelector(selector) {
    const controlId = selector.match(/^\[data-tab-cleaner-control="([\w-]+)"\]$/)?.[1];
    if (selector === 'input[type="search"]' || selector === "svg" || controlId) {
      const find = (element) => {
        if (controlId && element.getAttribute("data-tab-cleaner-control") === controlId) return element;
        if (selector === "svg" && element.tagName === "svg") return element;
        if (selector === 'input[type="search"]' && element.tagName === "input" && element.type === "search") return element;
        for (const child of element.children) {
          const match = find(child);
          if (match) return match;
        }
        return null;
      };
      return find(this);
    }
    throw new Error(`Unsupported fixture selector: ${selector}`);
  }

  contains(element) {
    for (let current = element; current; current = current.parentNode) if (current === this) return true;
    return false;
  }
  matches(selector) {
    if (selector === ":focus-visible") return this.ownerDocument.activeElement === this && this.ownerDocument.keyboardFocusVisible === true;
    throw new Error(`Unsupported fixture match: ${selector}`);
  }
  focus() { this.ownerDocument.activeElement = this; }
  setSelectionRange() {}
}

function emitter() {
  const callbacks = new Map();
  return {
    on(type, callback) {
      const ref = { type, callback };
      const listeners = callbacks.get(type) ?? [];
      listeners.push(ref);
      callbacks.set(type, listeners);
      return ref;
    },
    offref(ref) {
      callbacks.set(ref.type, (callbacks.get(ref.type) ?? []).filter((item) => item !== ref));
    },
    trigger(type, ...args) {
      for (const ref of callbacks.get(type) ?? []) ref.callback(...args);
    },
  };
}

async function fixture({
  pendingWebviewer = false,
  locale = "en",
  strategies = [],
  pinnedFilterIds = ["empty", "duplicates"],
  recentFilterIds = [],
  saveBarrier,
} = {}) {
  const timers = new Map();
  let nextTimerId = 0;
  let now = 0;
  const fakeWindow = {
    setTimeout(callback, delay = 0) {
      const id = ++nextTimerId;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); },
  };
  const clock = {
    get pending() { return timers.size; },
    runNext() {
      const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
      assert.ok(next, "expected a pending timer");
      const [id, timer] = next;
      timers.delete(id);
      now = timer.at;
      timer.callback();
    },
  };
  const targetLeaf = {
    ...emitter(),
    state: { type: pendingWebviewer ? "webviewer" : "empty" },
    title: "First tab",
    getViewState() { return this.state; },
    getDisplayText() { return this.title; },
  };
  const otherLeaf = {
    ...emitter(),
    state: { type: "empty" },
    getViewState() { return this.state; },
    getDisplayText() { return "Second tab"; },
  };
  const workspace = {
    ...emitter(),
    activeLeaf: targetLeaf,
    recentContentLeaf: targetLeaf,
    getMostRecentLeaf() { return this.recentContentLeaf; },
    iterateRootLeaves(callback) { [targetLeaf, otherLeaf].forEach(callback); },
    setActiveLeaf(leaf) {
      if (leaf === this.activeLeaf) return;
      this.activeLeaf = leaf;
      if (leaf !== cleanerLeaf) this.recentContentLeaf = leaf;
      fakeWindow.setTimeout(() => this.trigger("active-leaf-change", leaf), 0);
    },
  };
  const app = { workspace, vault: { getAbstractFileByPath() { return null; } } };
  const document = new FakeElement("document", true);
  document.ownerDocument = document;
  document.defaultView = null;
  const host = document.createDiv();
  const root = host.createDiv();
  fakeWindow.document = document;
  const cleanerLeaf = { app };
  // The installed host activates a WorkspaceLeaf on capture-phase pointerdown.
  host.addEventListener("pointerdown", () => workspace.setActiveLeaf(cleanerLeaf), { capture: true });
  class ItemView {
    constructor(leaf) {
      this.leaf = leaf;
      this.app = leaf.app;
      this.contentEl = root;
    }
    registerEvent() {}
    registerDomEvent(element, type, callback, options) { element.addEventListener(type, callback, options); }
  }
  const openedModals = [];
  class Modal {
    constructor(modalApp) {
      this.app = modalApp;
      this.contentEl = new FakeElement("div", true);
      this.contentEl.ownerDocument = document;
    }
    open() { openedModals.push(this); this.onOpen?.(); }
    close() { this.closed = true; this.onClose?.(); }
  }
  class ButtonComponent {
    constructor(parent) { this.element = this.buttonEl = parent.createEl("button"); this.kind = "button"; }
    setIcon(icon) { this.icon = icon; return this; }
    setTooltip(label) { this.buttonEl.setAttribute("aria-label", label); return this; }
    setButtonText(label) { this.buttonEl.textContent = label; return this; }
    setDisabled(disabled) { this.buttonEl.disabled = disabled; return this; }
    setWarning() { this.warning = true; return this; }
    setCta() { return this; }
    onClick(callback) { this.buttonEl.addEventListener("click", callback); return this; }
  }
  class ToggleComponent {
    constructor(parent) {
      this.element = this.toggleEl = parent.createDiv();
      this.kind = "toggle";
      this.toggleEl.addEventListener("click", async () => {
        this.setValue(!this.value);
        await this.callback?.(this.value);
      });
    }
    setValue(value) { this.value = value; return this; }
    setTooltip(label) { this.toggleEl.setAttribute("aria-label", label); return this; }
    onChange(callback) { this.callback = callback; return this; }
  }
  class TextComponent {
    constructor(parent) { this.element = this.inputEl = parent.createEl("input"); this.kind = "text"; }
    setValue(value) { this.inputEl.value = value; return this; }
    setPlaceholder() { return this; }
    setDisabled(disabled) { this.inputEl.disabled = disabled; return this; }
    onChange(callback) {
      this.callback = callback;
      this.inputEl.addEventListener("input", () => callback(this.inputEl.value));
      return this;
    }
  }
  class Setting {
    constructor(parent) {
      this.settingEl = parent.createDiv({ cls: "test-setting" });
      this.settingEl.setting = this;
      this.controlEl = this.settingEl.createDiv();
      this.components = [];
    }
    setName(name) { this.name = name; return this; }
    setDesc() { return this; }
    setHeading() { return this; }
    clear() { this.controlEl.empty(); this.components = []; return this; }
    addComponent(Type, callback) {
      const component = new Type(this.controlEl);
      this.components.push(component);
      callback(component);
      return this;
    }
    addButton(callback) { return this.addComponent(ButtonComponent, callback); }
    addToggle(callback) { return this.addComponent(ToggleComponent, callback); }
    addText(callback) { return this.addComponent(TextComponent, callback); }
  }
  const obsidian = {
    ItemView,
    Modal,
    Menu: class {},
    Notice: class {},
    Setting,
    TFile: class {},
    getLanguage: () => locale,
    setIcon(element, icon) {
      element.empty();
      element.createSvg("svg", { attr: { "data-icon": icon } });
    },
    setTooltip(element, label, options) {
      element.setAttribute("aria-label", label);
      if (options?.delay) element.setAttribute("data-tooltip-delay", options.delay);
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(viewCode, {
    module,
    exports: module.exports,
    require(name) {
      assert.equal(name, "obsidian");
      return obsidian;
    },
    window: fakeWindow,
    document,
    console,
    URL,
    InputEvent: class {},
  });
  const activatedLeaves = [];
  const usedFilterIds = [];
  const saveCalls = [];
  const reorderCalls = [];
  const strategySaveCalls = [];
  const plugin = {
    app,
    settings: {
      strategies,
      recentFilterIds: [...recentFilterIds],
      pinnedFilterIds: [...pinnedFilterIds],
      protectActiveTab: true,
      pinnedProtection: "always",
      recentBatchLimit: 10,
    },
    recentBatches: [],
    activateLeaf(leaf) { activatedLeaves.push(leaf); },
    isFilterPinned(id) { return this.settings.pinnedFilterIds.includes(id); },
    async saveSettings() {
      saveCalls.push(structuredClone(this.settings));
      if (saveBarrier) await saveBarrier;
      view.refresh();
    },
    async setFilterPinned(id, pinned) {
      this.settings.pinnedFilterIds = setFilterPinned(this.settings.pinnedFilterIds, id, pinned);
      await this.saveSettings();
    },
    async movePinnedFilter(id, direction) {
      this.settings.pinnedFilterIds = movePinnedFilter(this.settings.pinnedFilterIds, id, direction);
      await this.saveSettings();
    },
    async reorderPinnedFilter(draggedId, targetId, placement) {
      reorderCalls.push([draggedId, targetId, placement]);
      const next = reorderPinnedFilter(this.settings.pinnedFilterIds, draggedId, targetId, placement);
      if (next.every((id, index) => id === this.settings.pinnedFilterIds[index])) return;
      this.settings.pinnedFilterIds = next;
      await this.saveSettings();
    },
    async addStrategy(strategy, pinned, order) {
      strategySaveCalls.push({ action: "add", strategy: structuredClone(strategy), pinned, order: structuredClone(order) });
      this.settings.strategies = [...this.settings.strategies, strategy];
      this.settings.pinnedFilterIds = normalizePinnedFilterIds(order, this.settings.strategies.map(({ id }) => id));
      await this.saveSettings();
    },
    async updateStrategy(strategy, pinned, order) {
      strategySaveCalls.push({ action: "update", strategy: structuredClone(strategy), pinned, order: structuredClone(order) });
      this.settings.strategies = this.settings.strategies.map((existing) => existing.id === strategy.id ? strategy : existing);
      this.settings.pinnedFilterIds = order === undefined
        ? setFilterPinned(this.settings.pinnedFilterIds, strategy.id, pinned ?? this.isFilterPinned(strategy.id))
        : normalizePinnedFilterIds(order, this.settings.strategies.map(({ id }) => id));
      await this.saveSettings();
    },
    async removeStrategy(id) {
      this.settings.strategies = this.settings.strategies.filter((strategy) => strategy.id !== id);
      this.settings.pinnedFilterIds = setFilterPinned(this.settings.pinnedFilterIds, id, false);
      this.settings.recentFilterIds = this.settings.recentFilterIds.filter((recentId) => recentId !== id);
      await this.saveSettings();
    },
    markFilterUsed(id) {
      usedFilterIds.push(id);
      this.settings.recentFilterIds = [id, ...this.settings.recentFilterIds.filter((savedId) => savedId !== id)];
    },
  };
  const view = new module.exports.TabCleanerView(cleanerLeaf, plugin);
  await view.onOpen();
  return {
    view, root, document, workspace, targetLeaf, otherLeaf, cleanerLeaf, plugin, clock,
    activatedLeaves, usedFilterIds, openedModals, saveCalls, reorderCalls, strategySaveCalls,
    createStrategyModal(options) {
      return new module.exports.StrategyModal(plugin, { onChanged() {}, ...options });
    },
  };
}

test("preserves the first click target while capture pointerdown activates the cleaner panel", async () => {
  const { root, targetLeaf, clock, activatedLeaves } = await fixture();
  const target = root.findAll("tab-cleaner__row-info")[0];
  target.fire("pointerdown");
  clock.runNext();

  assert.equal(target.isConnected, true, "panel activation must not detach the pending click target");
  assert.ok(root.findAll("tab-cleaner__row-info")[0] === target);
  target.fire("click");
  assert.deepEqual(activatedLeaves, [targetLeaf]);
});

test("keeps protection buttons connected when layout events contain no tab changes", async () => {
  const { root, workspace } = await fixture();
  const buttons = root.findAll("tab-cleaner__heading-icon");
  workspace.trigger("layout-change");
  workspace.trigger("layout-change");

  assert.equal(buttons.every((button) => button.isConnected), true);
  assert.deepEqual(root.findAll("tab-cleaner__heading-icon"), buttons);
});

function selectionControls(root) {
  const controls = root.findAll("tab-cleaner__selection-controls")[0];
  assert.ok(controls, "expected selection and protection controls to share a wrapper");
  return controls;
}

test("keyboard protection toggles retain focus across settings and workspace redraws", async () => {
  const { root, view } = await fixture();
  const document = root.ownerDocument;
  document.keyboardFocusVisible = true;
  for (const index of [0, 1]) {
    const button = root.findAll("tab-cleaner__protection-toggle")[index];
    button.focus();
    button.fire("click", { detail: 0 });
    const currentButton = root.findAll("tab-cleaner__protection-toggle")[index];
    assert.notEqual(currentButton, button);
    assert.equal(document.activeElement, currentButton);
    assert.equal(currentButton.getAttribute("aria-pressed"), "false");
    view.refresh();
    assert.equal(document.activeElement, root.findAll("tab-cleaner__protection-toggle")[index]);
  }
});

test("keyboard Select all keeps focus after selecting and deselecting tabs", async () => {
  const { root } = await fixture();
  const document = root.ownerDocument;
  document.keyboardFocusVisible = true;
  root.findAll("tab-cleaner__select-all")[0].focus();
  for (const expected of ["true", "false"]) {
    const oldButton = root.findAll("tab-cleaner__select-all")[0];
    oldButton.fire("click", { detail: 0 });
    const currentButton = root.findAll("tab-cleaner__select-all")[0];
    assert.notEqual(currentButton, oldButton);
    assert.equal(currentButton.getAttribute("aria-pressed"), expected);
    assert.equal(document.activeElement, currentButton);
  }
});

test("only entering Select all reveals protection controls until the selection region is left", async () => {
  const { root, view } = await fixture();
  const controls = selectionControls(root);
  const protectionControls = controls.findAll("tab-cleaner__protection-controls")[0];
  const selectControl = controls.findAll("tab-cleaner__select-control")[0];
  assert.equal(controls.hasClass("is-revealed"), false);
  assert.equal(protectionControls.findAll("tab-cleaner__protection-toggle").length, 2);
  assert.equal(controls.findAll("tab-cleaner__close-selected").length, 0);
  protectionControls.fire("pointerenter");
  protectionControls.findAll("tab-cleaner__protection-toggle")[0].fire("pointerenter");
  root.findAll("tab-cleaner__close-selected")[0].fire("pointerenter");
  assert.equal(controls.hasClass("is-revealed"), false);

  selectControl.fire("pointerenter");
  assert.equal(controls.hasClass("is-revealed"), true);
  protectionControls.findAll("tab-cleaner__protection-toggle")[1].fire("pointerenter");
  controls.fire("pointerenter");
  assert.equal(controls.hasClass("is-revealed"), true);
  controls.fire("pointerleave");
  assert.equal(controls.hasClass("is-revealed"), false);
  view.refresh();
  assert.equal(selectionControls(root).hasClass("is-revealed"), false);
});

test("revealed protection controls survive toggle and Select all rebuilds while stale leave events are ignored", async () => {
  const { root, view, plugin } = await fixture();
  const originalControls = selectionControls(root);
  originalControls.findAll("tab-cleaner__select-control")[0].fire("pointerenter");
  for (const index of [0, 1]) {
    root.findAll("tab-cleaner__protection-toggle")[index].fire("click");
    assert.equal(selectionControls(root).hasClass("is-revealed"), true);
  }
  assert.equal(plugin.settings.pinnedProtection, "manual");
  assert.equal(plugin.settings.protectActiveTab, false);
  assert.equal(originalControls.isConnected, false);
  originalControls.fire("pointerleave");
  assert.equal(selectionControls(root).hasClass("is-revealed"), true);
  view.refresh();
  assert.equal(selectionControls(root).hasClass("is-revealed"), true);

  root.findAll("tab-cleaner__select-all")[0].fire("click");
  assert.equal(selectionControls(root).hasClass("is-revealed"), true);
  assert.equal(root.findAll("tab-cleaner__row").every((row) => row.findAll("tab-cleaner__checkbox")[0].children[0].checked), true);
  selectionControls(root).fire("pointerleave");
  view.refresh();
  assert.equal(selectionControls(root).hasClass("is-revealed"), false);
});

test("checkbox selection tracks Select all changes and clears when a tab becomes protected", async () => {
  const { root, otherLeaf } = await fixture();
  const rows = () => root.findAll("tab-cleaner__row");
  const checkbox = (row) => row.findAll("tab-cleaner__checkbox")[0].children[0];
  const assertStates = (expected) => {
    assert.deepEqual(rows().map((row) => checkbox(row).checked), expected);
  };
  assertStates([false, false]);
  assert.equal(checkbox(rows()[0]).disabled, true);
  checkbox(rows()[1]).checked = true;
  checkbox(rows()[1]).fire("change");
  assertStates([false, true]);
  checkbox(rows()[1]).checked = false;
  checkbox(rows()[1]).fire("change");
  assertStates([false, false]);
  root.findAll("tab-cleaner__select-all")[0].fire("click");
  assertStates([false, true]);
  root.findAll("tab-cleaner__select-all")[0].fire("click");
  assertStates([false, false]);
  root.findAll("tab-cleaner__select-all")[0].fire("click");
  otherLeaf.state.pinned = true;
  otherLeaf.trigger("pinned-change");
  assertStates([false, false]);
  assert.equal(checkbox(rows()[1]).disabled, true);
});

test("updates the current-tab marker when the active content leaf changes", async () => {
  const { root, workspace, otherLeaf, clock } = await fixture();
  const originalRows = root.findAll("tab-cleaner__row");
  assert.equal(originalRows[0].findAll("tab-cleaner__current").length, 1);
  workspace.setActiveLeaf(otherLeaf);
  clock.runNext();

  const rows = root.findAll("tab-cleaner__row");
  assert.notEqual(rows[0], originalRows[0]);
  assert.equal(rows[0].findAll("tab-cleaner__current").length, 0);
  assert.equal(rows[1].findAll("tab-cleaner__current").length, 1);
});

test("still refreshes the pin marker after a leaf's pin state changes", async () => {
  const { root, targetLeaf } = await fixture();
  const originalRow = root.findAll("tab-cleaner__row")[0];
  targetLeaf.state.pinned = true;
  targetLeaf.trigger("pinned-change");

  const row = root.findAll("tab-cleaner__row")[0];
  assert.notEqual(row, originalRow);
  assert.equal(row.findAll("tab-cleaner__pin").length, 1);
});

test("a layout event refreshes a changed visible tab title", async () => {
  const { root, targetLeaf, workspace } = await fixture();
  const originalRow = root.findAll("tab-cleaner__row")[0];
  targetLeaf.title = "Renamed tab";
  workspace.trigger("layout-change");

  const row = root.findAll("tab-cleaner__row")[0];
  assert.ok(row !== originalRow);
  assert.equal(row.findAll("tab-cleaner__row-name")[0].textContent, "Renamed tab");
});

test("selection changes still update rows when workspace tab data is unchanged", async () => {
  const { root } = await fixture();
  const originalRow = root.findAll("tab-cleaner__row")[1];
  const checkbox = originalRow.findAll("tab-cleaner__checkbox")[0].children[0];
  checkbox.checked = true;
  checkbox.fire("change");

  const row = root.findAll("tab-cleaner__row")[1];
  assert.ok(row !== originalRow);
  assert.equal(row.findAll("tab-cleaner__checkbox")[0].children[0].checked, true);
  assert.equal(root.findAll("tab-cleaner__close-selected")[0].disabled, false);
});

test("explicit settings refresh updates protection even when tab data is unchanged", async () => {
  const { root, plugin, view } = await fixture();
  const originalRow = root.findAll("tab-cleaner__row")[0];
  assert.equal(originalRow.findAll("tab-cleaner__checkbox")[0].children[0].disabled, true);
  plugin.settings.protectActiveTab = false;
  view.refresh();

  const row = root.findAll("tab-cleaner__row")[0];
  assert.ok(row !== originalRow);
  assert.equal(row.findAll("tab-cleaner__checkbox")[0].children[0].disabled, false);
});

test("typing a search still updates the displayed rows without a workspace event", async () => {
  const { root } = await fixture();
  const input = root.querySelector('input[type="search"]');
  input.value = "Second";
  input.fire("input");

  const rows = root.findAll("tab-cleaner__row");
  assert.equal(rows.length, 1);
  assert.equal(rows[0].findAll("tab-cleaner__row-name")[0].textContent, "Second tab");
  assert.equal(root.querySelector('input[type="search"]').value, "Second");
});

test("unchanged pending webviewer polls preserve DOM targets and continue until metadata arrives", async () => {
  const { root, targetLeaf, clock } = await fixture({ pendingWebviewer: true });
  const originalRow = root.findAll("tab-cleaner__row")[0];
  assert.equal(clock.pending, 1);
  clock.runNext();
  assert.ok(root.findAll("tab-cleaner__row")[0] === originalRow, "unchanged metadata must preserve the existing row");
  assert.equal(clock.pending, 1, "unchanged metadata must still schedule the next poll");
  clock.runNext();
  assert.ok(root.findAll("tab-cleaner__row")[0] === originalRow);
  assert.equal(clock.pending, 1);

  targetLeaf.state.state = { url: "https://example.com/ready.html" };
  clock.runNext();
  const row = root.findAll("tab-cleaner__row")[0];
  assert.notEqual(row, originalRow);
  assert.equal(row.findAll("tab-cleaner__row-subtitle")[0].textContent, "https://example.com/ready.html");
  assert.equal(clock.pending, 0);
});

test("pending webviewer retries remain bounded when metadata never arrives", async () => {
  const { root, clock } = await fixture({ pendingWebviewer: true });
  const originalRow = root.findAll("tab-cleaner__row")[0];
  for (let attempt = 0; attempt < 8; attempt += 1) {
    assert.equal(clock.pending, 1);
    clock.runNext();
  }
  assert.equal(clock.pending, 0);
  assert.ok(root.findAll("tab-cleaner__row")[0] === originalRow);
});

test("gives both protection buttons the same short, nonzero tooltip delay", async () => {
  const { root } = await fixture();
  const buttons = root.findAll("tab-cleaner__heading-icon");
  assert.equal(buttons.length, 2);
  assert.deepEqual(buttons.map((button) => button.getAttribute("data-tooltip-delay")), ["200", "200"]);
});

test("both protection buttons describe the next action after toggling in Chinese", async () => {
  const { root } = await fixture({ locale: "zh" });
  for (const [index, name] of [[0, "固定"], [1, "当前"]]) {
    const originalButton = root.findAll("tab-cleaner__heading-icon")[index];
    assert.equal(originalButton.getAttribute("aria-pressed"), "true");
    assert.equal(originalButton.getAttribute("aria-label"), `关闭${name}标签页保护`);
    originalButton.fire("click");

    const unprotectedButton = root.findAll("tab-cleaner__heading-icon")[index];
    assert.equal(unprotectedButton.getAttribute("aria-pressed"), "false");
    assert.equal(unprotectedButton.getAttribute("aria-label"), `开启${name}标签页保护`);
    if (index === 0) {
      assert.equal(unprotectedButton.querySelector("svg").getAttribute("data-icon"), "pin-off");
    } else {
      assert.equal(unprotectedButton.querySelector("svg").children.length, 1);
      assert.equal(unprotectedButton.querySelector("svg").children[0].getAttribute("d"), "m2 2 20 20");
    }
    unprotectedButton.fire("click");

    const protectedButton = root.findAll("tab-cleaner__heading-icon")[index];
    assert.equal(protectedButton.getAttribute("aria-pressed"), "true");
    assert.equal(protectedButton.getAttribute("aria-label"), `关闭${name}标签页保护`);
    assert.equal(protectedButton.querySelector("svg").getAttribute("data-icon"), index === 0 ? "pin" : "crosshair");
    assert.equal(protectedButton.querySelector("svg").children.length, 0);
  }
});

function filterButton(root, label) {
  const button = root.findAll("tab-cleaner__filter").find((item) => item.textContent.split(" (")[0] === label);
  assert.ok(button, `expected the ${label} filter button`);
  return button;
}

test("clicking built-in and custom groups records recent use while All does not", async () => {
  const { root, usedFilterIds, plugin } = await fixture({
    strategies: [{ id: "custom", name: "My search", query: "tab" }],
  });
  for (const label of ["Empty", "Duplicates", "My search"]) filterButton(root, label).fire("click");

  assert.deepEqual(usedFilterIds, ["empty", "duplicates", "custom"]);
  assert.deepEqual(plugin.settings.recentFilterIds, ["custom", "duplicates", "empty"]);
  filterButton(root, "All").fire("click");
  assert.deepEqual(usedFilterIds, ["empty", "duplicates", "custom"]);
  assert.deepEqual(plugin.settings.recentFilterIds, ["custom", "duplicates", "empty"]);
});

test("clicking pinned groups preserves their manual order in settings and the view", async () => {
  const pinnedFilterIds = ["custom", "empty", "duplicates"];
  const { root, plugin } = await fixture({
    strategies: [{ id: "custom", name: "My search", query: "tab" }],
    pinnedFilterIds,
  });
  const displayedLabels = () => root.findAll("tab-cleaner__filter").map((button) => button.textContent.split(" (")[0]);
  assert.deepEqual(displayedLabels(), ["All", "My search", "Empty", "Duplicates"]);
  for (const label of ["Duplicates", "My search", "Empty"]) {
    filterButton(root, label).fire("click");
    assert.deepEqual(plugin.settings.pinnedFilterIds, pinnedFilterIds);
    assert.deepEqual(displayedLabels(), ["All", "My search", "Empty", "Duplicates"]);
  }
  assert.deepEqual(plugin.settings.recentFilterIds, ["empty", "custom", "duplicates"]);
});

test("clicking unpinned built-in and custom groups moves each to the recent-use display position", async () => {
  const { root } = await fixture({
    strategies: [{ id: "custom", name: "My search", query: "tab" }],
    pinnedFilterIds: [],
  });
  const displayedLabels = () => root.findAll("tab-cleaner__filter").map((button) => button.textContent.split(" (")[0]);
  filterButton(root, "My search").fire("click");
  assert.deepEqual(displayedLabels(), ["All", "My search", "Empty", "Duplicates"]);
  filterButton(root, "Duplicates").fire("click");
  assert.deepEqual(displayedLabels(), ["All", "Duplicates", "My search", "Empty"]);
});

test("only pinned built-in and custom groups receive the pinned filter class", async () => {
  const { root } = await fixture({
    strategies: [{ id: "custom", name: "My search", query: "tab" }],
    pinnedFilterIds: ["empty", "custom"],
  });
  assert.equal(filterButton(root, "Empty").hasClass("is-pinned"), true);
  assert.equal(filterButton(root, "My search").hasClass("is-pinned"), true);
  assert.equal(filterButton(root, "Duplicates").hasClass("is-pinned"), false);
  assert.equal(filterButton(root, "All").hasClass("is-pinned"), false);
});

function dragEmptyAfterDuplicates({ root, document }) {
  const source = filterButton(root, "Empty");
  const target = filterButton(root, "Duplicates");
  source.bounds = { left: 100, right: 160, top: 0, bottom: 24, width: 60, height: 24 };
  target.bounds = { left: 200, right: 260, top: 0, bottom: 24, width: 60, height: 24 };
  source.fire("pointerdown", { pointerId: 11, clientX: 110, clientY: 10 });
  document.fire("pointermove", { pointerId: 11, clientX: 250, clientY: 10 });
  document.fire("pointerup", { pointerId: 11, clientX: 250, clientY: 10 });
}

test("a real pinned drag saves the order once without activating a filter, recording recent use, or changing selection", async () => {
  const context = await fixture({
    strategies: [{ id: "hidden", name: "My search", query: "tab" }],
    pinnedFilterIds: ["empty", "hidden", "duplicates"],
  });
  const { root, plugin, activatedLeaves, usedFilterIds, saveCalls, reorderCalls } = context;
  const checkbox = root.findAll("tab-cleaner__row")[1].findAll("tab-cleaner__checkbox")[0].children[0];
  checkbox.checked = true;
  checkbox.fire("change");
  filterButton(root, "My search").addClass("is-layout-hidden");
  const closeLabel = root.findAll("tab-cleaner__close-selected")[0].textContent;
  dragEmptyAfterDuplicates(context);
  await Promise.resolve();

  assert.deepEqual(plugin.settings.pinnedFilterIds, ["hidden", "duplicates", "empty"]);
  assert.deepEqual(reorderCalls, [["empty", "duplicates", "after"]]);
  assert.equal(saveCalls.length, 1);
  assert.deepEqual(usedFilterIds, []);
  assert.deepEqual(plugin.settings.recentFilterIds, []);
  assert.deepEqual(activatedLeaves, []);
  assert.equal(filterButton(root, "All").hasClass("is-active"), true);
  assert.equal(root.findAll("tab-cleaner__close-selected")[0].textContent, closeLabel);
  assert.equal(root.findAll("tab-cleaner__row")[1].findAll("tab-cleaner__checkbox")[0].children[0].checked, true);

  // A post-drag click can land on the replacement button after settings refresh.
  filterButton(root, "Empty").fire("click", { detail: 1 });
  assert.deepEqual(usedFilterIds, []);
  assert.equal(filterButton(root, "All").hasClass("is-active"), true);
  filterButton(root, "Empty").fire("pointerdown");
  context.document.fire("pointerup");
  filterButton(root, "Empty").fire("click", { detail: 1 });
  assert.deepEqual(usedFilterIds, ["empty"]);
});

test("keyboard activation remains available immediately after a pinned drag", async () => {
  const context = await fixture();
  dragEmptyAfterDuplicates(context);
  filterButton(context.root, "Empty").fire("click", { detail: 0 });
  assert.deepEqual(context.usedFilterIds, ["empty"]);
  assert.equal(filterButton(context.root, "Empty").hasClass("is-active"), true);
});

function modalComponents(modal, kind) {
  return modal.contentEl.findAll("test-setting")
    .flatMap((element) => element.setting.components)
    .filter((component) => component.kind === kind && component.element.isConnected);
}

function modalButton(modal, { icon, label }) {
  const button = modalComponents(modal, "button").find((component) =>
    icon ? component.icon === icon : component.buttonEl.textContent === label,
  );
  assert.ok(button, `expected modal button ${icon ?? label}`);
  return button.buttonEl;
}

function modalOrderIcons(modal) {
  return modalComponents(modal, "button")
    .filter((component) => component.buttonEl.hasClass("tab-cleaner__group-order-button"))
    .map((component) => component.icon);
}

test("current built-in and custom management buttons share the list title and open the selected group", async () => {
  const { root, plugin, openedModals } = await fixture({
    strategies: [{ id: "custom", name: "My search", query: "tab" }],
    pinnedFilterIds: ["empty", "duplicates", "custom"],
  });
  for (const [id, label] of [["empty", "Empty"], ["custom", "My search"], ["duplicates", "Duplicates"]]) {
    filterButton(root, label).fire("click");
    const buttons = root.findAll("tab-cleaner__filter-edit");
    assert.equal(buttons.length, 1);
    const button = buttons[0];
    assert.equal(button.parentNode.hasClass("tab-cleaner__section-title"), true);
    assert.ok(button.parentNode.children.some((element) => element.tagName === "h3"));
    assert.ok(button.getAttribute("aria-label").includes(label));
    assert.equal(button.getAttribute("data-tooltip-delay"), "200");
    assert.equal(root.findAll("tab-cleaner__filters")[0].findAll("tab-cleaner__filter-edit").length, 0);
    assert.equal(root.findAll("tab-cleaner__heading-actions")[0].findAll("tab-cleaner__filter-edit").length, 0);
    button.fire("click");
    const modal = openedModals.at(-1);
    if (id === "custom") {
      assert.equal(modalComponents(modal, "text")[0].inputEl.value, label);
    } else {
      assert.equal(modalComponents(modal, "text").length, 0);
      assert.ok(modal.contentEl.children.find((element) => element.tagName === "h2").textContent.includes(label));
    }
    const previousPins = [...plugin.settings.pinnedFilterIds];
    await modalComponents(modal, "toggle")[0].toggleEl.click();
    assert.deepEqual(plugin.settings.pinnedFilterIds, previousPins.filter((pinnedId) => pinnedId !== id));
    modal.close();
  }
});

test("All and free-text search offer no current-group management entry", async () => {
  const { root } = await fixture({ strategies: [{ id: "custom", name: "My search", query: "tab" }] });
  assert.equal(root.findAll("tab-cleaner__filter-edit").length, 0);
  filterButton(root, "Empty").fire("click");
  assert.equal(root.findAll("tab-cleaner__filter-edit").length, 1);
  filterButton(root, "All").fire("click");
  assert.equal(root.findAll("tab-cleaner__filter-edit").length, 0);
  filterButton(root, "My search").fire("click");
  const input = root.querySelector('input[type="search"]');
  input.value = "First";
  input.fire("input");
  assert.equal(root.findAll("tab-cleaner__filter-edit").length, 0);
});

test("a built-in or custom group with zero matches still has management beside its list title", async () => {
  const { root, openedModals } = await fixture({
    pendingWebviewer: true,
    strategies: [{ id: "custom", name: "No matches", query: "missing-query" }],
  });
  for (const label of ["Duplicates", "No matches"]) {
    filterButton(root, label).fire("click");
    assert.equal(root.findAll("tab-cleaner__row").length, 0);
    const button = root.findAll("tab-cleaner__filter-edit")[0];
    assert.ok(button, "empty results must not remove the group's management entry");
    assert.equal(button.parentNode.hasClass("tab-cleaner__section-title"), true);
    button.fire("click");
    assert.ok(openedModals.at(-1));
    openedModals.at(-1).close();
  }
});

test("deleting the custom group managed from its list title returns the view to All", async () => {
  const { root, plugin, openedModals, usedFilterIds } = await fixture({
    strategies: [{ id: "custom", name: "My search", query: "tab" }],
    pinnedFilterIds: ["empty", "custom", "duplicates"],
  });
  filterButton(root, "My search").fire("click");
  root.findAll("tab-cleaner__filter-edit")[0].fire("click");
  const modal = openedModals.at(-1);
  const deleteButton = modalComponents(modal, "button").find((component) => component.warning);
  await deleteButton.buttonEl.click();
  const confirmation = openedModals.at(-1);
  await modalComponents(confirmation, "button").find((component) => component.warning).buttonEl.click();

  assert.equal(modal.closed, true);
  assert.equal(confirmation.closed, true);
  assert.deepEqual(plugin.settings.strategies, []);
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["empty", "duplicates"]);
  assert.deepEqual(plugin.settings.recentFilterIds, []);
  assert.equal(filterButton(root, "All").hasClass("is-active"), true);
  assert.equal(root.findAll("tab-cleaner__filter-edit").length, 0);
  assert.equal(root.findAll("tab-cleaner__row").length, 2);
  assert.deepEqual(usedFilterIds, ["custom"]);
});

test("built-in group management moves pinned order immediately and hides controls when unpinned", async () => {
  const { root, plugin, openedModals, saveCalls } = await fixture({
    strategies: [{ id: "custom", name: "My search", query: "tab" }],
    pinnedFilterIds: ["custom", "empty", "duplicates"],
  });
  filterButton(root, "Empty").fire("click");
  root.findAll("tab-cleaner__filter-edit")[0].fire("click");
  const modal = openedModals.at(-1);
  assert.ok(modal, "expected built-in group management to open");
  const pinToggle = modalComponents(modal, "toggle")[0].toggleEl;
  assert.deepEqual(modalOrderIcons(modal), ["chevron-up", "chevron-down"]);
  await modalButton(modal, { icon: "chevron-up" }).click();
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["empty", "custom", "duplicates"]);
  assert.equal(saveCalls.length, 1);
  assert.deepEqual(modalOrderIcons(modal), ["chevron-down"]);
  assert.ok(modalComponents(modal, "toggle")[0].toggleEl === pinToggle);
  await modalComponents(modal, "toggle")[0].toggleEl.click();
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["custom", "duplicates"]);
  assert.equal(saveCalls.length, 2);
  assert.deepEqual(modalOrderIcons(modal), []);
  assert.equal(pinToggle.isConnected, true);
});

function enterModalName(modal, value) {
  const input = modalComponents(modal, "text")[0].inputEl;
  input.value = value;
  input.fire("input");
  return input;
}

function visibleNameChecks(modal) {
  return modalComponents(modal, "button")
    .filter((component) => component.icon === "check")
    .map((component) => component.buttonEl)
    .filter((button) => !button.hidden && !button.hasClass("is-hidden") &&
      button.getAttribute("aria-hidden") !== "true" && button.style.display !== "none" &&
      button.style.getPropertyValue("display") !== "none");
}

test("existing custom group pin and order changes save immediately while closing discards an unconfirmed name", async () => {
  const { plugin, createStrategyModal, saveCalls, strategySaveCalls } = await fixture({
    strategies: [{ id: "custom", name: "My search", query: "tab" }],
    pinnedFilterIds: ["empty", "custom", "duplicates"],
  });
  const changedIds = [];
  const modal = createStrategyModal({ strategy: plugin.settings.strategies[0], onChanged: (id) => changedIds.push(id) });
  modal.open();
  const actionLabels = modalComponents(modal, "button").map((component) => component.buttonEl.textContent);
  assert.equal(actionLabels.includes("Save"), false);
  assert.equal(actionLabels.includes("Cancel"), false);
  assert.equal(actionLabels.includes("Done"), false);
  assert.ok(actionLabels.some((label) => label.startsWith("Delete")));
  enterModalName(modal, "Unconfirmed name");
  await modalButton(modal, { icon: "chevron-up" }).click();
  assert.deepEqual(modalOrderIcons(modal), ["chevron-down"]);
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["custom", "empty", "duplicates"]);
  assert.equal(saveCalls.length, 1);
  assert.equal(plugin.settings.strategies[0].name, "My search");
  await modalComponents(modal, "toggle")[0].toggleEl.click();
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["empty", "duplicates"]);
  assert.deepEqual(modalOrderIcons(modal), []);
  await modalComponents(modal, "toggle")[0].toggleEl.click();
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["empty", "duplicates", "custom"]);
  await modalButton(modal, { icon: "chevron-up" }).click();
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["empty", "custom", "duplicates"]);
  assert.equal(saveCalls.length, 4);
  modal.close();
  assert.equal(modal.closed, true);
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["empty", "custom", "duplicates"]);
  assert.equal(plugin.settings.strategies[0].name, "My search");
  assert.equal(saveCalls.length, 4);
  assert.deepEqual(changedIds, ["custom", "custom", "custom", "custom"]);
  assert.deepEqual(strategySaveCalls, []);
});

test("confirming an existing group's trimmed name keeps the modal, filter, selection, and live pinned order intact", async () => {
  const { root, plugin, openedModals, usedFilterIds, activatedLeaves, saveCalls, strategySaveCalls } = await fixture({
    strategies: [{ id: "custom", name: "My search", query: "tab" }],
    pinnedFilterIds: ["empty", "custom", "duplicates"],
  });
  filterButton(root, "My search").fire("click");
  const closeLabel = root.findAll("tab-cleaner__close-selected")[0].textContent;
  root.findAll("tab-cleaner__filter-edit")[0].fire("click");
  const modal = openedModals.at(-1);
  enterModalName(modal, "  Renamed search  ");
  await modalButton(modal, { icon: "chevron-up" }).click();
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["custom", "empty", "duplicates"]);
  const check = visibleNameChecks(modal)[0];
  assert.ok(check, "changed nonempty names should expose confirmation");
  assert.equal(check.getAttribute("aria-label"), "Save name");
  assert.equal(check.disabled, false);
  await check.click();
  assert.equal(strategySaveCalls.length, 1);
  assert.equal(strategySaveCalls[0].action, "update");
  assert.equal(strategySaveCalls[0].strategy.name, "Renamed search");
  assert.equal(strategySaveCalls[0].order, undefined, "renaming must not submit a stale pin-order snapshot");
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["custom", "empty", "duplicates"]);
  assert.equal(saveCalls.length, 2);
  assert.notEqual(modal.closed, true);
  assert.deepEqual(visibleNameChecks(modal), []);
  assert.equal(filterButton(root, "Renamed search").hasClass("is-active"), true);
  assert.deepEqual(usedFilterIds, ["custom"]);
  assert.deepEqual(activatedLeaves, []);
  assert.equal(root.findAll("tab-cleaner__close-selected")[0].textContent, closeLabel);
  assert.equal(root.findAll("tab-cleaner__row")[1].findAll("tab-cleaner__checkbox")[0].children[0].checked, true);
  const deleteButton = modalComponents(modal, "button").find((component) => component.buttonEl.textContent.startsWith("Delete"));
  await deleteButton.buttonEl.click();
  const confirmation = openedModals.at(-1);
  assert.notEqual(confirmation, modal);
  assert.ok(confirmation.contentEl.children.find((element) => element.tagName === "h2").textContent.includes("Renamed search"));
});

test("name confirmation is hidden for unchanged trimmed names and disabled for blank names", async () => {
  const { plugin, createStrategyModal, saveCalls } = await fixture({
    locale: "zh",
    strategies: [{ id: "custom", name: "我的检索", query: "tab" }],
  });
  const modal = createStrategyModal({ strategy: plugin.settings.strategies[0] });
  modal.open();
  assert.deepEqual(visibleNameChecks(modal), []);
  enterModalName(modal, "  我的检索  ");
  assert.deepEqual(visibleNameChecks(modal), []);
  enterModalName(modal, "   ");
  const blankCheck = visibleNameChecks(modal)[0];
  assert.ok(blankCheck);
  assert.equal(blankCheck.getAttribute("aria-label"), "保存名称");
  assert.equal(blankCheck.disabled, true);
  await blankCheck.click();
  const syntheticClick = blankCheck.fire("click");
  await Promise.all(syntheticClick.pending);
  assert.deepEqual(saveCalls, []);
  assert.equal(plugin.settings.strategies[0].name, "我的检索");
  enterModalName(modal, "另一个名称");
  assert.equal(visibleNameChecks(modal)[0].disabled, false);
  enterModalName(modal, "我的检索");
  assert.deepEqual(visibleNameChecks(modal), []);
  assert.equal(modalComponents(modal, "button").some((component) => component.buttonEl.textContent === "完成"), false);
});

test("name saving prevents duplicate submissions while preserving input typed during the save", async () => {
  let finishSave;
  const saveBarrier = new Promise((resolve) => { finishSave = resolve; });
  const { plugin, createStrategyModal, saveCalls, strategySaveCalls } = await fixture({
    strategies: [{ id: "custom", name: "My search", query: "tab" }],
    pinnedFilterIds: ["empty", "custom", "duplicates"],
    saveBarrier,
  });
  const modal = createStrategyModal({ strategy: plugin.settings.strategies[0] });
  modal.open();
  enterModalName(modal, "First submitted name");
  const check = visibleNameChecks(modal)[0];
  const pendingSave = check.click();
  assert.equal(check.disabled, true);
  await check.click();
  const syntheticClick = check.fire("click");
  await Promise.all(syntheticClick.pending);
  assert.equal(strategySaveCalls.length, 1);
  assert.equal(saveCalls.length, 1);
  const input = enterModalName(modal, "Later draft name");
  finishSave();
  await pendingSave;
  assert.equal(plugin.settings.strategies[0].name, "First submitted name");
  assert.equal(input.value, "Later draft name");
  assert.equal(visibleNameChecks(modal)[0].disabled, false);
  assert.notEqual(modal.closed, true);
  await visibleNameChecks(modal)[0].click();
  assert.equal(plugin.settings.strategies[0].name, "Later draft name");
  assert.equal(strategySaveCalls.length, 2);
  assert.equal(saveCalls.length, 2);
  assert.deepEqual(visibleNameChecks(modal), []);
});

test("a new custom group's staged pin position is passed atomically with the generated strategy ID", async () => {
  const { plugin, createStrategyModal, saveCalls, strategySaveCalls } = await fixture();
  const modal = createStrategyModal({ query: "tab" });
  modal.open();
  assert.deepEqual(modalOrderIcons(modal), []);
  await modalComponents(modal, "toggle")[0].toggleEl.click();
  assert.deepEqual(modalOrderIcons(modal), ["chevron-up"]);
  await modalButton(modal, { icon: "chevron-up" }).click();
  assert.deepEqual(plugin.settings.pinnedFilterIds, ["empty", "duplicates"]);
  assert.deepEqual(saveCalls, []);
  await modalButton(modal, { label: "Save" }).click();
  assert.equal(strategySaveCalls.length, 1);
  const saved = strategySaveCalls[0];
  assert.equal(saved.action, "add");
  assert.equal(saved.pinned, true);
  assert.deepEqual(saved.order, ["empty", saved.strategy.id, "duplicates"]);
  assert.deepEqual(plugin.settings.pinnedFilterIds, saved.order);
  assert.equal(saveCalls.length, 1);
});
