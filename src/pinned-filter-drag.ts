type Placement = "before" | "after";

interface FilterEntry {
  id: string;
  button: HTMLButtonElement;
}

interface DragOptions {
  entries: FilterEntry[];
  isPinned: (id: string) => boolean;
  onReorder: (draggedId: string, targetId: string, placement: Placement) => void | Promise<void>;
  onDragStart?: () => void;
}

interface DropTarget {
  entry: FilterEntry;
  placement: Placement;
}

interface Gesture {
  entry: FilterEntry;
  document: Document;
  pointerId: number;
  startX: number;
  startY: number;
  transform: string;
  transformPriority: string;
  dragging: boolean;
  target: DropTarget | null;
}

const MOVE_THRESHOLD = 8;

/** Reorders visible pinned chips without activating their search filters. */
export class PinnedFilterDrag {
  private readonly options: DragOptions;
  private gesture: Gesture | null = null;
  private destroyed = false;
  private suppressedClickId: string | null = null;
  private readonly entryListeners: Array<{
    entry: FilterEntry;
    down: (event: PointerEvent) => void;
    click: (event: MouseEvent) => void;
  }>;

  constructor(options: DragOptions) {
    this.options = options;
    this.entryListeners = options.entries.map((entry) => {
      const down = (event: PointerEvent): void => this.onPointerDown(entry, event);
      const click = (event: MouseEvent): void => {
        if (this.suppressedClickId !== entry.id || event.detail === 0) return;
        this.suppressedClickId = null;
        event.preventDefault();
        event.stopImmediatePropagation();
      };
      entry.button.addEventListener("pointerdown", down);
      entry.button.addEventListener("click", click, true);
      return { entry, down, click };
    });
    this.updateAvailability();
  }

  updateAvailability(): void {
    if (this.destroyed) return;
    const available = this.visiblePinnedEntries();
    for (const { button } of this.options.entries) {
      if (available.length >= 2 && available.some((entry) => entry.button === button)) {
        button.addClass("is-reorderable");
      } else {
        button.removeClass("is-reorderable");
      }
    }
    const gesture = this.gesture;
    if (!gesture) return;
    if (available.length < 2 || !available.includes(gesture.entry)) {
      this.finishGesture();
    } else if (gesture.target && !available.includes(gesture.target.entry)) {
      this.setTarget(null);
    }
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.finishGesture();
    this.suppressedClickId = null;
    for (const { entry, down, click } of this.entryListeners) {
      entry.button.removeEventListener("pointerdown", down);
      entry.button.removeEventListener("click", click, true);
      entry.button.removeClass("is-reorderable", "is-dragging", "is-drop-before", "is-drop-after");
    }
  }

  private visiblePinnedEntries(): FilterEntry[] {
    return this.options.entries.filter(({ id, button }) =>
      button.isConnected && !button.hasClass("is-layout-hidden") && this.options.isPinned(id),
    );
  }

  private onPointerDown(entry: FilterEntry, event: PointerEvent): void {
    this.suppressedClickId = null;
    if (this.destroyed || this.gesture || event.button !== 0 || event.isPrimary === false) return;
    const available = this.visiblePinnedEntries();
    if (available.length < 2 || !available.includes(entry)) return;
    const document = entry.button.ownerDocument;
    this.gesture = {
      entry,
      document,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      transform: entry.button.style.getPropertyValue("transform"),
      transformPriority: entry.button.style.getPropertyPriority("transform"),
      dragging: false,
      target: null,
    };
    document.addEventListener("pointerdown", this.onAdditionalPointerDown, true);
    document.addEventListener("pointermove", this.onPointerMove, { passive: false });
    document.addEventListener("pointerup", this.onPointerUp);
    document.addEventListener("pointercancel", this.onPointerCancel);
    document.addEventListener("lostpointercapture", this.onPointerCancel);
    document.addEventListener("keydown", this.onKeyDown, true);
  }

  private readonly onAdditionalPointerDown = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (gesture && (event.pointerId !== gesture.pointerId || event.button !== 0 || event.isPrimary === false)) {
      this.finishGesture();
    }
  };

  private readonly onPointerMove = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const available = this.visiblePinnedEntries();
    if (available.length < 2 || !available.includes(gesture.entry)) {
      this.finishGesture();
      return;
    }
    const dx = event.clientX - gesture.startX;
    const dy = event.clientY - gesture.startY;
    if (!gesture.dragging) {
      // Leave vertical gestures to native scrolling, including touch pointercancel.
      if (Math.abs(dy) >= MOVE_THRESHOLD && Math.abs(dy) > Math.abs(dx)) {
        this.finishGesture();
        return;
      }
      if (Math.abs(dx) < MOVE_THRESHOLD) return;
      gesture.dragging = true;
      gesture.entry.button.addClass("is-dragging");
      this.options.onDragStart?.();
      if (this.gesture !== gesture) return;
      try {
        gesture.entry.button.setPointerCapture?.(gesture.pointerId);
      } catch {
        // Document listeners still complete the gesture when capture is unavailable.
      }
    }
    event.preventDefault();
    const transform = `${gesture.transform ? `${gesture.transform} ` : ""}translateX(${dx}px)`;
    gesture.entry.button.style.setProperty("transform", transform, gesture.transformPriority);
    this.setTarget(this.targetAt(event.clientX, event.clientY));
  };

  private targetAt(x: number, y: number): DropTarget | null {
    const source = this.gesture?.entry;
    // Exclude the transformed source: its moving rect must never expand the drop area.
    for (const entry of this.visiblePinnedEntries()) {
      if (entry === source) continue;
      const rect = entry.button.getBoundingClientRect();
      if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) continue;
      return { entry, placement: x < (rect.left + rect.right) / 2 ? "before" : "after" };
    }
    return null;
  }

  private setTarget(target: DropTarget | null): void {
    for (const { button } of this.options.entries) {
      button.removeClass("is-drop-before", "is-drop-after");
    }
    if (!this.gesture) return;
    this.gesture.target = target;
    target?.entry.button.addClass(target.placement === "before" ? "is-drop-before" : "is-drop-after");
  }

  private readonly onPointerUp = (event: PointerEvent): void => {
    const gesture = this.gesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const available = this.visiblePinnedEntries();
    const target = gesture.dragging && available.length >= 2 && available.includes(gesture.entry)
      ? this.targetAt(event.clientX, event.clientY)
      : null;
    this.finishGesture();
    if (target) {
      void this.options.onReorder(gesture.entry.id, target.entry.id, target.placement);
    }
  };

  private readonly onPointerCancel = (event: PointerEvent): void => {
    if (event.pointerId === this.gesture?.pointerId) this.finishGesture();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.key === "Escape") this.finishGesture();
  };

  private finishGesture(): void {
    const gesture = this.gesture;
    if (!gesture) return;
    // Clear state/listeners before releasing capture, which can dispatch cancellation.
    this.gesture = null;
    const { document, entry } = gesture;
    document.removeEventListener("pointerdown", this.onAdditionalPointerDown, true);
    document.removeEventListener("pointermove", this.onPointerMove);
    document.removeEventListener("pointerup", this.onPointerUp);
    document.removeEventListener("pointercancel", this.onPointerCancel);
    document.removeEventListener("lostpointercapture", this.onPointerCancel);
    document.removeEventListener("keydown", this.onKeyDown, true);
    if (gesture.dragging) this.suppressedClickId = entry.id;
    entry.button.removeClass("is-dragging");
    for (const { button } of this.options.entries) button.removeClass("is-drop-before", "is-drop-after");
    if (gesture.transform) {
      entry.button.style.setProperty("transform", gesture.transform, gesture.transformPriority);
    } else {
      entry.button.style.removeProperty("transform");
    }
    try {
      if (!entry.button.hasPointerCapture || entry.button.hasPointerCapture(gesture.pointerId)) {
        entry.button.releasePointerCapture?.(gesture.pointerId);
      }
    } catch {
      // Capture is also automatically released for cancelled or detached targets.
    }
  }
}
