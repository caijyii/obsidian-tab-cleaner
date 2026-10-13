import test from "node:test";
import assert from "node:assert/strict";
import { PinnedFilterDrag } from "../src/pinned-filter-drag.ts";

class EventTargetMock {
  listeners = new Map();

  addEventListener(type, callback, options) {
    const capture = options === true || Boolean(options?.capture);
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ callback, capture });
    this.listeners.set(type, listeners);
  }

  removeEventListener(type, callback, options) {
    const capture = options === true || Boolean(options?.capture);
    this.listeners.set(type, (this.listeners.get(type) ?? [])
      .filter((listener) => listener.callback !== callback || listener.capture !== capture));
  }

  fire(type, values = {}) {
    const event = {
      pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10, detail: 1,
      defaultPrevented: false, stopped: false,
      preventDefault() { this.defaultPrevented = true; },
      stopImmediatePropagation() { this.stopped = true; },
      ...values,
    };
    const listeners = [...(this.listeners.get(type) ?? [])]
      .sort((left, right) => Number(right.capture) - Number(left.capture));
    for (const { callback } of listeners) {
      callback(event);
      if (event.stopped) break;
    }
    return event;
  }

  get listenerCount() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.length, 0);
  }
}

class StyleMock {
  values = new Map();
  priorities = new Map();
  getPropertyValue(name) { return this.values.get(name) ?? ""; }
  getPropertyPriority(name) { return this.priorities.get(name) ?? ""; }
  setProperty(name, value, priority = "") {
    this.values.set(name, value);
    this.priorities.set(name, priority);
  }
  removeProperty(name) {
    this.values.delete(name);
    this.priorities.delete(name);
  }
}

class ButtonMock extends EventTargetMock {
  constructor(document, left, right) {
    super();
    this.ownerDocument = document;
    this.isConnected = true;
    this.classes = new Set();
    this.style = new StyleMock();
    this.rect = { left, right, top: 0, bottom: 30 };
    this.captured = new Set();
  }

  addClass(...classes) { classes.forEach((name) => this.classes.add(name)); }
  removeClass(...classes) { classes.forEach((name) => this.classes.delete(name)); }
  hasClass(name) { return this.classes.has(name); }
  getBoundingClientRect() {
    const transform = this.style.getPropertyValue("transform");
    const dx = Number(transform.match(/translateX\((-?[\d.]+)px\)/)?.[1] ?? 0);
    return { ...this.rect, left: this.rect.left + dx, right: this.rect.right + dx };
  }
  setPointerCapture(pointerId) { this.captured.add(pointerId); }
  hasPointerCapture(pointerId) { return this.captured.has(pointerId); }
  releasePointerCapture(pointerId) { this.captured.delete(pointerId); }
}

function fixture({ pinnedIds = ["first", "second", "third"], hiddenIds = [], detachedIds = [] } = {}) {
  const document = new EventTargetMock();
  const entries = ["first", "second", "third", "unpinned"].map((id, index) => ({
    id, button: new ButtonMock(document, index * 50, index * 50 + 40),
  }));
  const pins = new Set(pinnedIds);
  for (const { id, button } of entries) {
    if (hiddenIds.includes(id)) button.addClass("is-layout-hidden");
    if (detachedIds.includes(id)) button.isConnected = false;
  }
  const commits = [];
  let starts = 0;
  const drag = new PinnedFilterDrag({
    entries,
    isPinned: (id) => pins.has(id),
    onReorder: (...commit) => commits.push(commit),
    onDragStart: () => { starts += 1; },
  });
  const buttons = Object.fromEntries(entries.map(({ id, button }) => [id, button]));
  const outside = new ButtonMock(document, 200, 240); // All is not supplied as an entry.
  return { drag, document, buttons, outside, pins, commits, get starts() { return starts; } };
}

test("only connected, visible pins are reorderable when at least two are available", () => {
  const { drag, buttons, pins } = fixture({ hiddenIds: ["third"] });
  assert.equal(buttons.first.hasClass("is-reorderable"), true);
  assert.equal(buttons.second.hasClass("is-reorderable"), true);
  assert.equal(buttons.third.hasClass("is-reorderable"), false);
  assert.equal(buttons.unpinned.hasClass("is-reorderable"), false);
  pins.delete("second");
  drag.updateAvailability();
  assert.equal(buttons.first.hasClass("is-reorderable"), false);
  pins.add("third");
  buttons.third.removeClass("is-layout-hidden");
  buttons.third.isConnected = false;
  drag.updateAvailability();
  assert.equal(buttons.first.hasClass("is-reorderable"), false);
  drag.destroy();
});

test("short movements preserve ordinary clicks and never start or save a drag", () => {
  const f = fixture();
  f.buttons.first.fire("pointerdown");
  const move = f.document.fire("pointermove", { clientX: 17 });
  f.document.fire("pointerup", { clientX: 17 });
  assert.equal(move.defaultPrevented, false);
  assert.equal(f.buttons.first.fire("click").defaultPrevented, false);
  assert.equal(f.starts, 0);
  assert.deepEqual(f.commits, []);
  assert.equal(f.document.listenerCount, 0);
  f.drag.destroy();
});

test("horizontal threshold starts once; the target's left half commits before exactly once", () => {
  const f = fixture();
  f.buttons.first.fire("pointerdown");
  const move = f.document.fire("pointermove", { clientX: 18 });
  assert.equal(move.defaultPrevented, true);
  assert.equal(f.starts, 1);
  assert.equal(f.buttons.first.hasClass("is-dragging"), true);
  assert.equal(f.buttons.first.hasPointerCapture(1), true);
  f.document.fire("pointermove", { clientX: 55 });
  assert.equal(f.buttons.second.hasClass("is-drop-before"), true);
  f.document.fire("pointerup", { clientX: 55 });
  f.document.fire("pointerup", { clientX: 55 });
  assert.deepEqual(f.commits, [["first", "second", "before"]]);
  assert.equal(f.starts, 1);
  assert.equal(f.buttons.first.style.getPropertyValue("transform"), "");
  assert.equal(f.buttons.first.hasPointerCapture(1), false);
  assert.equal(f.buttons.second.hasClass("is-drop-before"), false);
  assert.equal(f.document.listenerCount, 0);
  f.drag.destroy();
});

test("the target's right half commits after and pointerup uses the final target position", () => {
  const f = fixture();
  f.buttons.first.fire("pointerdown");
  f.document.fire("pointermove", { clientX: 55 });
  f.document.fire("pointerup", { clientX: 85 });
  assert.deepEqual(f.commits, [["first", "second", "after"]]);
  f.drag.destroy();
});

test("vertical movement first cancels without preventing touch scrolling", () => {
  const f = fixture();
  f.buttons.first.fire("pointerdown", { pointerType: "touch" });
  const move = f.document.fire("pointermove", { clientX: 12, clientY: 18, pointerType: "touch" });
  f.document.fire("pointermove", { clientX: 85 });
  f.document.fire("pointerup", { clientX: 85 });
  assert.equal(move.defaultPrevented, false);
  assert.equal(f.starts, 0);
  assert.deepEqual(f.commits, []);
  assert.equal(f.document.listenerCount, 0);
  f.drag.destroy();
});

test("non-primary pointers and non-primary buttons cannot begin a gesture", () => {
  for (const values of [{ isPrimary: false }, { button: 1 }, { button: 2 }]) {
    const f = fixture();
    f.buttons.first.fire("pointerdown", values);
    f.document.fire("pointermove", { clientX: 85 });
    f.document.fire("pointerup", { clientX: 85 });
    assert.equal(f.starts, 0);
    assert.deepEqual(f.commits, []);
    assert.equal(f.document.listenerCount, 0);
    f.drag.destroy();
  }
});

test("a second pointer cancels a gesture and other pointer IDs cannot move or commit it", () => {
  const f = fixture();
  f.buttons.first.fire("pointerdown");
  f.document.fire("pointermove", { pointerId: 2, clientX: 85 });
  f.document.fire("pointerup", { pointerId: 2, clientX: 85 });
  assert.equal(f.starts, 0);
  f.document.fire("pointermove", { clientX: 55 });
  f.document.fire("pointerdown", { pointerId: 2, isPrimary: false });
  f.document.fire("pointerup", { clientX: 55 });
  assert.deepEqual(f.commits, []);
  assert.equal(f.buttons.first.hasClass("is-dragging"), false);
  assert.equal(f.document.listenerCount, 0);
  f.drag.destroy();
});

test("hidden, unpinned, All, gaps, and points outside the chip row are not drop targets", () => {
  for (const point of [
    { clientX: 110, clientY: 10 }, // Hidden third pin.
    { clientX: 160, clientY: 10 }, // Unpinned group.
    { clientX: 210, clientY: 10 }, // All/other controls are outside the supplied entries.
    { clientX: 45, clientY: 10 },  // Gap.
    { clientX: 60, clientY: 40 },  // Outside the vertical bounds.
  ]) {
    const f = fixture({ hiddenIds: ["third"] });
    f.buttons.first.fire("pointerdown");
    f.document.fire("pointermove", point);
    f.document.fire("pointerup", point);
    assert.deepEqual(f.commits, []);
    assert.equal(f.buttons.second.hasClass("is-drop-before"), false);
    f.drag.destroy();
  }
});

test("the moving source rect never supplies a drop area or stale target", () => {
  const f = fixture();
  f.buttons.first.fire("pointerdown");
  f.document.fire("pointermove", { clientX: 55 });
  assert.equal(f.buttons.second.hasClass("is-drop-before"), true);
  f.document.fire("pointermove", { clientX: 145 }); // Source rect becomes 135–175.
  assert.equal(f.buttons.second.hasClass("is-drop-before"), false);
  f.document.fire("pointerup", { clientX: 145 });
  assert.deepEqual(f.commits, []);
  f.drag.destroy();
});

test("availability changes remove stale targets and cancel when the source is hidden", () => {
  const f = fixture();
  f.buttons.first.fire("pointerdown");
  f.document.fire("pointermove", { clientX: 55 });
  f.buttons.second.addClass("is-layout-hidden");
  f.drag.updateAvailability();
  assert.equal(f.buttons.second.hasClass("is-drop-before"), false);
  f.buttons.first.addClass("is-layout-hidden");
  f.drag.updateAvailability();
  f.document.fire("pointerup", { clientX: 110 });
  assert.deepEqual(f.commits, []);
  assert.equal(f.document.listenerCount, 0);
  assert.equal(f.buttons.first.hasPointerCapture(1), false);
  f.drag.destroy();
});

test("pointerup checks current pin membership before committing", () => {
  const f = fixture();
  f.buttons.first.fire("pointerdown");
  f.document.fire("pointermove", { clientX: 55 });
  f.pins.delete("second");
  f.document.fire("pointerup", { clientX: 55 });
  assert.deepEqual(f.commits, []);
  f.drag.destroy();
});

test("Escape, pointercancel, and lost capture restore the existing inline transform", () => {
  for (const [type, values] of [
    ["keydown", { key: "Escape" }],
    ["pointercancel", {}],
    ["lostpointercapture", {}],
  ]) {
    const f = fixture();
    f.buttons.first.style.setProperty("transform", "scale(0.9)", "important");
    f.buttons.first.fire("pointerdown");
    f.document.fire("pointermove", { clientX: 55 });
    assert.equal(f.buttons.first.style.getPropertyValue("transform"), "scale(0.9) translateX(45px)");
    f.document.fire(type, values);
    f.document.fire("pointerup", { clientX: 55 });
    assert.deepEqual(f.commits, []);
    assert.equal(f.buttons.first.style.getPropertyValue("transform"), "scale(0.9)");
    assert.equal(f.buttons.first.style.getPropertyPriority("transform"), "important");
    assert.equal(f.buttons.first.hasClass("is-dragging"), false);
    assert.equal(f.buttons.second.hasClass("is-drop-before"), false);
    assert.equal(f.document.listenerCount, 0);
    f.drag.destroy();
  }
});

test("a completed or cancelled drag suppresses its pointer click but preserves keyboard clicks", () => {
  for (const cancel of [false, true]) {
    const f = fixture();
    let activated = 0;
    f.buttons.first.addEventListener("click", () => { activated += 1; });
    f.buttons.first.fire("pointerdown");
    f.document.fire("pointermove", { clientX: 55 });
    f.document.fire(cancel ? "pointercancel" : "pointerup", { clientX: 55 });
    const keyboard = f.buttons.first.fire("click", { detail: 0 });
    assert.equal(keyboard.defaultPrevented, false);
    assert.equal(activated, 1);
    const pointer = f.buttons.first.fire("click", { detail: 1 });
    assert.equal(pointer.defaultPrevented, true);
    assert.equal(activated, 1);
    f.buttons.first.fire("pointerdown");
    f.document.fire("pointerup");
    assert.equal(f.buttons.first.fire("click").defaultPrevented, false);
    assert.equal(activated, 2);
    f.drag.destroy();
  }
});

test("destroy cancels and removes all listeners, capture, transient classes, and styles", () => {
  const f = fixture();
  f.buttons.first.fire("pointerdown");
  f.document.fire("pointermove", { clientX: 55 });
  f.drag.destroy();
  f.drag.destroy();
  f.drag.updateAvailability();
  f.document.fire("pointerup", { clientX: 55 });
  assert.deepEqual(f.commits, []);
  assert.equal(f.document.listenerCount, 0);
  for (const button of Object.values(f.buttons)) {
    assert.equal(button.listenerCount, 0);
    assert.deepEqual([...button.classes], []);
  }
  assert.equal(f.buttons.first.hasPointerCapture(1), false);
  assert.equal(f.buttons.first.style.getPropertyValue("transform"), "");
  f.buttons.first.fire("pointerdown");
  assert.equal(f.document.listenerCount, 0);
});

test("missing or rejected pointer capture still permits a document-tracked gesture", () => {
  for (const mode of ["missing", "throws"]) {
    const f = fixture();
    f.buttons.first.setPointerCapture = mode === "missing" ? undefined : () => { throw new Error("No capture"); };
    f.buttons.first.fire("pointerdown");
    f.document.fire("pointermove", { clientX: 55 });
    f.document.fire("pointerup", { clientX: 55 });
    assert.deepEqual(f.commits, [["first", "second", "before"]]);
    f.drag.destroy();
  }
});
