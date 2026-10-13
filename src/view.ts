import {
  ItemView,
  Menu,
  Modal,
  Notice,
  Setting,
  setIcon,
  setTooltip,
  type ButtonComponent,
  type EventRef,
  type WorkspaceLeaf,
} from "obsidian";
import { getLocale, strings } from "./i18n";
import { visibleHistory } from "./history-retention";
import type TabCleanerPlugin from "./main";
import {
  defaultSelected,
  matchesSearch,
  matchesStrategy,
  scanTabs,
  tabProtectionReason,
} from "./model";
import { duplicateDefaultSelectionFlags } from "./duplicate-groups";
import { filterOrders } from "./filter-order";
import { tabListLabel } from "./tab-list-label";
import { tabListStateSignature } from "./tab-list-state";
import { PinnedFilterDrag } from "./pinned-filter-drag";
import { movePinnedFilter, setFilterPinned } from "./filter-settings";
import { extensionFromSource, stateString } from "./tab-state";
import { SourceEventRegistry } from "./source-event-registry";
import type { BuiltInFilter, CleanerStrategy, ClosedTabRecord, TabDescriptor } from "./types";

export const TAB_CLEANER_VIEW = "obsidian-tab-cleaner-view";

export class TabCleanerView extends ItemView {
  private query = "";
  private filter: BuiltInFilter | string = "all";
  private selected = new Set<string>();
  private filterResizeObserver: ResizeObserver | null = null;
  private webviewerRefreshTimer: number | null = null;
  private webviewerRefreshAttempts = 0;
  private renderedTabState: string | null = null;
  private filterDrag: PinnedFilterDrag | null = null;
  private suppressFilterClick = false;
  private readonly pinnedChangeListeners: SourceEventRegistry<WorkspaceLeaf, EventRef>;

  constructor(leaf: WorkspaceLeaf, private readonly plugin: TabCleanerPlugin) {
    super(leaf);
    this.pinnedChangeListeners = new SourceEventRegistry(
      (source, callback) => source.on("pinned-change", callback),
      (source, ref) => source.offref(ref),
    );
  }

  getViewType(): string {
    return TAB_CLEANER_VIEW;
  }

  getDisplayText(): string {
    return strings(getLocale()).pluginName;
  }

  getIcon(): string {
    return "brush-cleaning";
  }

  async onOpen(): Promise<void> {
    this.registerDomEvent(this.contentEl, "pointerdown", (event) => {
      if (event.isPrimary !== false) this.suppressFilterClick = false;
    }, { capture: true });
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.webviewerRefreshAttempts = 0;
        this.renderWorkspaceChanges();
      }),
    );
    this.registerEvent(this.app.workspace.on("active-leaf-change", (leaf) => {
      // Obsidian activates a pane on pointerdown. Replacing its contents here
      // would remove the target before pointerup/click can reveal the tab.
      if (leaf === this.leaf) return;
      this.renderWorkspaceChanges();
    }));
    this.render();
  }

  async onClose(): Promise<void> {
    this.filterDrag?.destroy();
    this.filterDrag = null;
    this.filterResizeObserver?.disconnect();
    this.pinnedChangeListeners.clear();
    if (this.webviewerRefreshTimer !== null) window.clearTimeout(this.webviewerRefreshTimer);
  }

  refresh(): void {
    this.webviewerRefreshAttempts = 0;
    this.render();
  }

  private renderWorkspaceChanges(): void {
    const tabs = scanTabs(this.app).filter((tab) => tab.viewType !== TAB_CLEANER_VIEW);
    if (tabListStateSignature(tabs) === this.renderedTabState) {
      this.schedulePendingWebviewerRefresh(tabs);
      return;
    }
    this.render(tabs);
  }

  private render(
    tabs: TabDescriptor[] = scanTabs(this.app).filter((tab) => tab.viewType !== TAB_CLEANER_VIEW),
  ): void {
    this.filterDrag?.destroy();
    this.filterDrag = null;
    this.filterResizeObserver?.disconnect();
    this.filterResizeObserver = null;
    const root = this.contentEl;
    root.empty();
    root.addClass("tab-cleaner");

    this.renderedTabState = tabListStateSignature(tabs);
    this.pinnedChangeListeners.sync(
      tabs.map((tab) => tab.leaf),
      () => this.render(),
    );
    this.schedulePendingWebviewerRefresh(tabs);
    const filtered = this.filteredTabs(tabs);
    this.selected = new Set(
      [...this.selected].filter((id) =>
        filtered.some(
          (tab) => tab.id === id && !tabProtectionReason(tab, this.plugin.settings),
        ),
      ),
    );

    this.renderHeader(root);
    this.renderFilters(root, tabs);
    this.renderTabList(root, filtered);
    this.renderRecent(root);
  }

  private schedulePendingWebviewerRefresh(tabs: TabDescriptor[]): void {
    if (this.webviewerRefreshTimer !== null) {
      window.clearTimeout(this.webviewerRefreshTimer);
      this.webviewerRefreshTimer = null;
    }

    const hasPendingWebviewer = tabs.some(
      (tab) => tab.viewType === "webviewer" && tab.url === null,
    );
    if (!hasPendingWebviewer) {
      this.webviewerRefreshAttempts = 0;
      return;
    }
    if (this.webviewerRefreshAttempts >= 8) return;

    this.webviewerRefreshTimer = window.setTimeout(() => {
      this.webviewerRefreshTimer = null;
      this.webviewerRefreshAttempts += 1;
      this.renderWorkspaceChanges();
    }, 250);
  }

  private renderHeader(root: HTMLElement): void {
    const text = strings(getLocale());
    const toolbar = root.createDiv({ cls: "tab-cleaner__toolbar" });
    const searchGroup = toolbar.createDiv({ cls: "tab-cleaner__search-group" });
    const inputWrap = searchGroup.createDiv({ cls: "tab-cleaner__search-field" });
    inputWrap.toggleClass("has-query", this.query.length > 0);
    const input = inputWrap.createEl("input", {
      type: "search",
      placeholder: text.searchPlaceholder,
      value: this.query,
    });
    let composing = false;
    input.addEventListener("compositionstart", () => {
      composing = true;
    });
    input.addEventListener("compositionend", () => {
      composing = false;
      this.applySearchQuery(input.value);
    });
    input.addEventListener("input", (event) => {
      if (composing || (event instanceof InputEvent && event.isComposing)) return;
      this.applySearchQuery(input.value);
    });

    if (this.query.length > 0) {
      const clearButton = inputWrap.createEl("button", {
        cls: "clickable-icon tab-cleaner__clear-search",
        attr: { "aria-label": text.clearSearch },
      });
      setIcon(clearButton, "x");
      setTooltip(clearButton, text.clearSearch);
      clearButton.addEventListener("click", () => this.applySearchQuery(""));
    }

    const saveButton = searchGroup.createEl("button", {
      cls: "clickable-icon tab-cleaner__save-search",
      attr: { "aria-label": text.saveSearchTooltip },
    });
    setIcon(saveButton, "save");
    setTooltip(saveButton, text.saveSearchTooltip);
    saveButton.disabled = this.query.trim().length === 0;
    saveButton.addEventListener("click", () => {
      new StrategyModal(this.plugin, {
        query: this.query,
        onChanged: (strategyId) => {
          this.activateFilter(strategyId ?? "all");
        },
      }).open();
    });
  }

  private applySearchQuery(value: string): void {
    this.query = value;
    this.filter = "all";
    this.selected.clear();
    this.render();
    const nextInput = this.contentEl.querySelector<HTMLInputElement>('input[type="search"]');
    nextInput?.focus();
    nextInput?.setSelectionRange(this.query.length, this.query.length);
  }

  private renderFilters(root: HTMLElement, tabs: TabDescriptor[]): void {
    const text = strings(getLocale());
    const filters = root.createDiv({ cls: "tab-cleaner__filters" });
    const builtIns: Array<{ id: BuiltInFilter; label: string; count: number }> = [
      { id: "all", label: text.all, count: tabs.length },
      { id: "empty", label: text.empty, count: tabs.filter((tab) => tab.isEmpty).length },
      {
        id: "duplicates",
        label: text.duplicates,
        count: tabs.filter((tab) => tab.isDuplicate).length,
      },
    ];

    const builtInEntries = builtIns.map((builtIn) => ({
      id: builtIn.id,
      menuTitle:
        builtIn.id === "all" ? builtIn.label : `${builtIn.label} (${builtIn.count})`,
      button: this.addFilterButton(
        filters,
        builtIn.id,
        builtIn.id === "all" ? builtIn.label : `${builtIn.label} (${builtIn.count})`,
        text.filterCount(builtIn.label, builtIn.count),
      ),
    }));
    const strategies = this.plugin.settings.strategies;
    const orders = filterOrders(
      builtInEntries.slice(1).map(({ id }) => id),
      strategies.map(({ id }) => id),
      this.plugin.settings.recentFilterIds,
      this.filter,
      this.plugin.settings.pinnedFilterIds,
    );
    const strategyButtons = strategies.map((strategy) => {
      const count = tabs.filter((tab) => matchesStrategy(tab, strategy)).length;
      const button = this.addFilterButton(
        filters,
        strategy.id,
        `${strategy.name} (${count})`,
        text.filterCount(strategy.name, count),
      );
      return { strategy, button, menuTitle: `${strategy.name} (${count})` };
    });

    const allButton = builtInEntries[0]?.button;
    if (!allButton) return;
    const allOptionalEntries = [
      ...builtInEntries.slice(1).map(({ id, menuTitle, button }) => ({ id, menuTitle, button })),
      ...strategyButtons.map(({ strategy, menuTitle, button }) => ({
        id: strategy.id,
        menuTitle,
        button,
      })),
    ];
    const optionalEntryById = new Map(allOptionalEntries.map((entry) => [entry.id, entry]));
    const optionalEntries = orders.displayIds
      .map((id) => optionalEntryById.get(id))
      .filter((entry): entry is (typeof allOptionalEntries)[number] => entry !== undefined);

    for (const { button } of optionalEntries) {
      filters.appendChild(button);
    }

    const more = filters.createEl("button", {
      cls: "clickable-icon tab-cleaner__more-filters",
      attr: { "aria-label": text.moreFilters },
    });
    setIcon(more, "ellipsis");
    more.addEventListener("click", (event) => {
      const menu = new Menu();
      for (const { id, menuTitle, button } of optionalEntries) {
        if (!button.hasClass("is-layout-hidden")) continue;
        menu.addItem((item) =>
          item
            .setTitle(menuTitle)
            .setChecked(this.filter === id)
            .onClick(() => this.activateFilter(id)),
        );
      }
      menu.showAtMouseEvent(event);
    });

    this.filterDrag = new PinnedFilterDrag({
      entries: optionalEntries.map(({ id, button }) => ({ id, button })),
      isPinned: (id) => this.plugin.isFilterPinned(id),
      onDragStart: () => { this.suppressFilterClick = true; },
      onReorder: (draggedId, targetId, placement) =>
        this.plugin.reorderPinnedFilter(draggedId, targetId, placement),
    });

    this.installAdaptiveFilterLayout(
      filters,
      allButton,
      optionalEntries,
      more,
      this.filter,
      orders.priorityIds,
    );
  }

  private addFilterButton(
    parent: HTMLElement,
    id: string,
    label: string,
    tooltip: string,
  ): HTMLButtonElement {
    const groupClass = id === "all"
      ? "tab-cleaner__filter--all"
      : id === "empty" || id === "duplicates"
        ? ""
        : "tab-cleaner__filter--strategy";
    const button = parent.createEl("button", {
      text: label,
      cls: `tab-cleaner__filter ${groupClass}${this.filter === id ? " is-active" : ""}`,
      attr: { title: tooltip, "aria-pressed": String(this.filter === id) },
    });
    button.toggleClass("is-pinned", id !== "all" && this.plugin.isFilterPinned(id));
    button.setAttribute("data-filter-id", id);
    button.addEventListener("click", (event) => {
      if (this.suppressFilterClick && event.detail !== 0) {
        this.suppressFilterClick = false;
        event.preventDefault();
        return;
      }
      this.activateFilter(id);
    });
    return button;
  }

  private installAdaptiveFilterLayout(
    filters: HTMLElement,
    allButton: HTMLButtonElement,
    optionalEntries: Array<{ id: string; button: HTMLButtonElement }>,
    more: HTMLButtonElement,
    activeFilterId: string,
    priorityIds: string[],
  ): void {
    const requestFrame = filters.ownerDocument.defaultView?.requestAnimationFrame;
    if (!requestFrame) return;
    requestFrame.call(filters.ownerDocument.defaultView, () => {
      if (!filters.isConnected) return;
      const gap = Number.parseFloat(getComputedStyle(filters).columnGap) || 0;
      const allWidth = allButton.offsetWidth;
      const optionalWidths = optionalEntries.map(({ button }) => button.offsetWidth);
      const moreWidth = more.offsetWidth;

      const totalWidth = (widths: number[]): number =>
        widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);

      const layout = (): void => {
        for (const { button } of optionalEntries) {
          button.removeClass("is-layout-hidden", "is-layout-shrink");
        }
        more.toggleClass("is-layout-hidden", optionalEntries.length === 0);

        const fixedWidths = [allWidth];
        if (totalWidth([...fixedWidths, ...optionalWidths]) <= filters.clientWidth) {
          more.addClass("is-layout-hidden");
          this.filterDrag?.updateAvailability();
          return;
        }

        for (const { button } of optionalEntries) button.addClass("is-layout-hidden");
        let used = totalWidth([...fixedWidths, moreWidth]);
        const activeIndex = optionalEntries.findIndex(({ id }) => id === activeFilterId);
        if (activeIndex >= 0) {
          const activeEntry = optionalEntries[activeIndex];
          const activeWidth = optionalWidths[activeIndex];
          if (activeEntry && activeWidth !== undefined) {
            const available = Math.max(40, filters.clientWidth - used - gap);
            const shownWidth = Math.min(activeWidth, available);
            activeEntry.button.removeClass("is-layout-hidden");
            if (shownWidth < activeWidth) activeEntry.button.addClass("is-layout-shrink");
            used += gap + shownWidth;
          }
        }

        for (const id of priorityIds) {
          const index = optionalEntries.findIndex((entry) => entry.id === id);
          if (index < 0) continue;
          const entry = optionalEntries[index];
          const width = optionalWidths[index];
          if (!entry || width === undefined) continue;
          if (index === activeIndex) continue;
          const required = gap + width;
          if (used + required > filters.clientWidth) continue;
          entry.button.removeClass("is-layout-hidden");
          used += required;
        }

        const hasHidden = optionalEntries.some(({ button }) =>
          button.hasClass("is-layout-hidden"),
        );
        more.toggleClass("is-layout-hidden", !hasHidden);
        this.filterDrag?.updateAvailability();
      };

      layout();
      this.filterResizeObserver = new ResizeObserver(layout);
      this.filterResizeObserver.observe(filters);
    });
  }

  private activateFilter(id: string): void {
    this.filter = id;
    this.query = "";
    this.selected.clear();
    const tabs = this.filteredTabs(
      scanTabs(this.app).filter((tab) => tab.viewType !== TAB_CLEANER_VIEW),
    );
    this.selectFilterDefaults(tabs, id);
    if (id !== "all") this.plugin.markFilterUsed(id);
    this.render();
  }

  private selectFilterDefaults(tabs: TabDescriptor[], filterId: string): void {
    if (filterId !== "duplicates") {
      for (const tab of tabs) {
        if (defaultSelected(tab, this.plugin.settings)) this.selected.add(tab.id);
      }
      return;
    }

    const defaults = duplicateDefaultSelectionFlags(
      tabs.map((tab) => ({
        path: tab.path,
        isEmpty: tab.isEmpty,
        isPinned: tab.isPinned,
        isActive: tab.isActive,
        isSelectable: defaultSelected(tab, this.plugin.settings),
      })),
    );
    for (const [index, tab] of tabs.entries()) {
      if (defaults[index]) this.selected.add(tab.id);
    }
  }

  private renderTabList(root: HTMLElement, tabs: TabDescriptor[]): void {
    const text = strings(getLocale());
    const section = root.createEl("section", { cls: "tab-cleaner__section" });
    const heading = section.createDiv({ cls: "tab-cleaner__section-heading" });
    const selectableTabs = tabs.filter((tab) => !tabProtectionReason(tab, this.plugin.settings));
    const selectedVisibleCount = selectableTabs.filter((tab) => this.selected.has(tab.id)).length;
    const allSelected =
      selectableTabs.length > 0 && selectedVisibleCount === selectableTabs.length;
    const listLabel = tabListLabel(this.filter, this.query, this.plugin.settings.strategies, text);
    const title = heading.createDiv({ cls: "tab-cleaner__section-title" });
    title.createEl("h3", { text: text.tabListCount(listLabel, tabs.length) });
    this.addGroupManagementButton(title);

    const headingActions = heading.createDiv({ cls: "tab-cleaner__heading-actions" });
    const pinnedProtected = this.plugin.settings.pinnedProtection === "always";
    const pinnedTooltip = text.pinnedProtectionAction(pinnedProtected);
    const pinnedButton = headingActions.createEl("button", {
      cls: pinnedProtected
        ? "clickable-icon tab-cleaner__heading-icon tab-cleaner__heading-toggle tab-cleaner__protection-toggle is-active"
        : "clickable-icon tab-cleaner__heading-icon tab-cleaner__heading-toggle tab-cleaner__protection-toggle",
      attr: {
        "aria-label": pinnedTooltip,
        "aria-pressed": String(pinnedProtected),
      },
    });
    setIcon(pinnedButton, pinnedProtected ? "pin" : "pin-off");
    setTooltip(pinnedButton, pinnedTooltip, { placement: "top", delay: 200 });
    pinnedButton.addEventListener("click", () => {
      this.plugin.settings.pinnedProtection = pinnedProtected ? "manual" : "always";
      this.selected = new Set(
        [...this.selected].filter((id) => {
          const tab = tabs.find((candidate) => candidate.id === id);
          return tab && !tabProtectionReason(tab, this.plugin.settings);
        }),
      );
      void this.plugin.saveSettings();
    });

    const activeProtected = this.plugin.settings.protectActiveTab;
    const activeTooltip = text.activeProtectionAction(activeProtected);
    const activeButton = headingActions.createEl("button", {
      cls: activeProtected
        ? "clickable-icon tab-cleaner__heading-icon tab-cleaner__heading-toggle tab-cleaner__protection-toggle is-active"
        : "clickable-icon tab-cleaner__heading-icon tab-cleaner__heading-toggle tab-cleaner__protection-toggle",
      attr: {
        "aria-label": activeTooltip,
        "aria-pressed": String(activeProtected),
      },
    });
    setIcon(activeButton, "crosshair");
    if (!activeProtected) {
      activeButton.querySelector("svg")?.createSvg("path", { attr: { d: "m2 2 20 20" } });
    }
    setTooltip(activeButton, activeTooltip, { placement: "top", delay: 200 });
    activeButton.addEventListener("click", () => {
      this.plugin.settings.protectActiveTab = !activeProtected;
      void this.plugin.saveSettings();
    });

    const selectVisible = headingActions.createEl("button", {
      text: text.selectAll,
      cls: allSelected
        ? "tab-cleaner__select-all tab-cleaner__heading-toggle is-active"
        : "tab-cleaner__select-all tab-cleaner__heading-toggle",
      attr: {
        "aria-label": allSelected ? text.deselectVisible : text.selectVisible,
        "aria-pressed": String(allSelected),
      },
    });
    setTooltip(selectVisible, allSelected ? text.deselectVisible : text.selectVisible);
    selectVisible.disabled = selectableTabs.length === 0;
    selectVisible.addEventListener("click", () => {
      for (const tab of selectableTabs) {
        if (allSelected) this.selected.delete(tab.id);
        else this.selected.add(tab.id);
      }
      this.render();
    });

    const closeButton = headingActions.createEl("button", {
      text: text.closeCount(this.selected.size),
      cls: "tab-cleaner__close-selected",
    });
    closeButton.disabled = this.selected.size === 0;
    closeButton.addEventListener("click", () => void this.closeSelected(tabs));

    if (tabs.length === 0) {
      section.createEl("p", { text: text.noMatches, cls: "tab-cleaner__empty" });
      return;
    }

    const list = section.createDiv({ cls: "tab-cleaner__list" });
    for (const tab of tabs) this.renderTabRow(list, tab);
  }

  private addGroupManagementButton(parent: HTMLElement): void {
    if (this.query.trim()) return;
    const text = strings(getLocale());
    const activeStrategy = this.plugin.settings.strategies.find((strategy) => strategy.id === this.filter);
    const activeBuiltIn = this.filter === "empty" || this.filter === "duplicates"
      ? { id: this.filter, label: this.filter === "empty" ? text.empty : text.duplicates }
      : null;
    const name = activeStrategy?.name ?? activeBuiltIn?.label;
    if (!name) return;

    const edit = parent.createEl("button", {
      cls: "clickable-icon tab-cleaner__filter-edit",
      attr: { "aria-label": text.manageStrategy(name) },
    });
    setIcon(edit, "settings-2");
    setTooltip(edit, text.manageStrategy(name), { placement: "top", delay: 200 });
    edit.addEventListener("click", () => {
      if (activeStrategy) {
        new StrategyModal(this.plugin, {
          strategy: activeStrategy,
          onChanged: (strategyId) => {
            if (strategyId === null) this.filter = "all";
            this.render();
          },
        }).open();
      } else if (activeBuiltIn) {
        new BuiltInGroupModal(this.plugin, activeBuiltIn.id, activeBuiltIn.label).open();
      }
    });
  }

  private renderTabRow(list: HTMLElement, tab: TabDescriptor): void {
    const text = strings(getLocale());
    const reason = tabProtectionReason(tab, this.plugin.settings);
    const row = list.createDiv({
      cls: "tab-cleaner__row is-openable",
    });

    const checkboxContainer = row.createSpan({ cls: "tab-cleaner__checkbox" });
    const checkbox = checkboxContainer.createEl("input", { type: "checkbox" });
    if (reason) {
      const reasonText =
        reason === "pinned"
          ? text.pinnedSelectionProtected
          : reason === "active"
            ? text.activeSelectionProtected
            : text.cannotRestore;
      setTooltip(checkboxContainer, reasonText);
      checkbox.setAttribute("aria-label", reasonText);
    } else {
      checkbox.setAttribute("aria-label", tab.title);
    }

    checkbox.checked = this.selected.has(tab.id);
    checkbox.disabled = reason !== null;
    checkbox.addEventListener("click", (event) => event.stopPropagation());
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) this.selected.add(tab.id);
      else this.selected.delete(tab.id);
      this.render();
    });

    const info = row.createDiv({ cls: "tab-cleaner__row-info" });
    info.setAttribute("role", "button");
    info.setAttribute("tabindex", "0");
    info.setAttribute("aria-label", text.openTab(tab.title));
    const reveal = (): void => this.plugin.activateLeaf(tab.leaf);
    info.addEventListener("click", reveal);
    info.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      reveal();
    });
    const title = info.createDiv({ cls: "tab-cleaner__row-title" });
    this.addTypeBadge(title, tab.extension || (tab.viewType === "webviewer" ? "web" : ""));
    title.createSpan({ text: tab.title, cls: "tab-cleaner__row-name" });
    if (tab.isPinned) {
      const pin = title.createSpan({ cls: "tab-cleaner__pin", attr: { "aria-label": text.pinned } });
      setIcon(pin, "pin");
      setTooltip(pin, text.pinned);
    }
    if (tab.isActive) {
      const current = title.createSpan({
        cls: "tab-cleaner__current",
        attr: { "aria-label": text.activeTab },
      });
      setTooltip(current, text.activeTab);
    }
    const subtitleText = tab.path ? this.parentPath(tab.path) : tab.url;
    if (subtitleText) {
      const subtitle = info.createDiv({
        text: subtitleText,
        cls: "tab-cleaner__row-subtitle",
      });
      setTooltip(subtitle, tab.path ?? tab.url ?? subtitleText);
    }

  }

  private renderRecent(root: HTMLElement): void {
    const text = strings(getLocale());
    const section = root.createEl("section", { cls: "tab-cleaner__section" });
    const heading = section.createDiv({ cls: "tab-cleaner__section-heading" });
    heading.createEl("h3", { text: text.recentlyClosed });
    if (this.plugin.recentBatches.length === 0) {
      section.createEl("p", { text: text.noRecent, cls: "tab-cleaner__empty" });
      return;
    }

    for (const batch of visibleHistory(
      this.plugin.recentBatches,
      this.plugin.settings.recentBatchLimit,
    )) {
      const details = section.createEl("details", { cls: "tab-cleaner__batch" });
      const summary = details.createEl("summary");
      const chevron = summary.createSpan({ cls: "tab-cleaner__batch-chevron" });
      setIcon(chevron, "chevron-right");
      const summaryInfo = summary.createDiv({ cls: "tab-cleaner__batch-info" });
      const count = batch.tabs.reduce((sum, tab) => sum + tab.count, 0);
      summaryInfo.createSpan({
        text: text.batchLabelCount(this.localizedBatchLabel(batch.label), count),
        cls: "tab-cleaner__batch-label",
      });
      summaryInfo.createSpan({
        text: this.relativeTime(batch.closedAt),
        cls: "tab-cleaner__muted",
      });
      const reopenAll = summary.createEl("button", {
        text: text.openAll,
        cls: "tab-cleaner__reopen-all",
      });
      setTooltip(reopenAll, text.openAllOneEach);
      reopenAll.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        void this.plugin.reopenBatch(batch);
      });
      for (const tab of batch.tabs) {
        const row = details.createDiv({ cls: "tab-cleaner__recent-row is-openable" });
        const info = row.createDiv({ cls: "tab-cleaner__row-info" });
        info.setAttribute("role", "button");
        info.setAttribute("tabindex", "0");
        info.setAttribute("aria-label", text.openOne(tab.title));
        const reopen = (): void => void this.plugin.reopenRecord(tab);
        info.addEventListener("click", reopen);
        info.addEventListener("keydown", (event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          event.preventDefault();
          reopen();
        });
        const title = info.createDiv({ cls: "tab-cleaner__row-title" });
        this.addTypeBadge(title, this.recordExtension(tab));
        title.createSpan({
          text: tab.count > 1 ? `${tab.title} ×${tab.count}` : tab.title,
          cls: "tab-cleaner__row-name",
        });
        const source = tab.path ?? tab.url ?? stateString(tab.viewState, "url");
        const subtitleText = tab.path ? this.parentPath(tab.path) : source;
        if (subtitleText) {
          const subtitle = info.createDiv({
            text: subtitleText,
            cls: "tab-cleaner__row-subtitle",
          });
          setTooltip(subtitle, source ?? subtitleText);
        }
      }
    }
  }

  private addTypeBadge(parent: HTMLElement, extension: string): void {
    if (!extension) return;
    const normalized = extension.toLocaleLowerCase();
    const displayExtension = normalized.slice(0, 6);
    const category = ["html", "htm", "css", "js", "jsx", "ts", "tsx", "web"].includes(normalized)
      ? "web"
      : ["json", "yaml", "yml", "csv", "tsv", "xml"].includes(normalized)
        ? "data"
        : "neutral";
    parent.createSpan({
      text: displayExtension,
      cls: [
        "tab-cleaner__type",
        `tab-cleaner__type--${category}`,
        displayExtension.length > 4 ? "tab-cleaner__type--long" : "",
      ].filter(Boolean).join(" "),
      attr: { title: normalized.toLocaleUpperCase() },
    });
  }

  private recordExtension(record: ClosedTabRecord): string {
    return (
      record.extension ||
      extensionFromSource(record.path ?? "") ||
      extensionFromSource(record.url ?? stateString(record.viewState, "url") ?? "") ||
      (record.viewState.type === "webviewer" ? "web" : "")
    );
  }

  private filteredTabs(tabs: TabDescriptor[]): TabDescriptor[] {
    if (this.query.trim()) return tabs.filter((tab) => matchesSearch(tab, this.query));
    if (this.filter === "empty") return tabs.filter((tab) => tab.isEmpty);
    if (this.filter === "duplicates") return tabs.filter((tab) => tab.isDuplicate);
    if (this.filter === "all") return tabs;
    const strategy = this.plugin.settings.strategies.find((item) => item.id === this.filter);
    return strategy ? tabs.filter((tab) => matchesStrategy(tab, strategy)) : tabs;
  }

  private parentPath(path: string | null): string | null {
    if (!path) return null;
    const separator = path.lastIndexOf("/");
    return separator > 0 ? path.slice(0, separator) : null;
  }

  private async closeSelected(visibleTabs: TabDescriptor[]): Promise<void> {
    const tabs = visibleTabs.filter((tab) => this.selected.has(tab.id));
    if (tabs.length === 0) return;
    await this.plugin.closeTabs(tabs, this.currentFilterLabel());
    this.selected.clear();
    this.render();
  }

  private currentFilterLabel(): string {
    const text = strings(getLocale());
    if (this.query.trim()) return text.searchLabel(this.query.trim());
    if (this.filter === "empty") return text.emptyTabs;
    if (this.filter === "duplicates") return text.duplicateTabs;
    const strategy = this.plugin.settings.strategies.find((item) => item.id === this.filter);
    return strategy?.name ?? text.manualCleanup;
  }

  private localizedBatchLabel(label: string): string {
    const text = strings(getLocale());
    const normalized = label.trim();
    if (["Manual cleanup", "手动清理", "Bulk close", "批量关闭"].includes(normalized)) {
      return text.manualCleanup;
    }
    if (["Manually closed", "手动关闭", "Regular close", "常规关闭"].includes(normalized)) {
      return text.manualClosed;
    }
    if (normalized === "Empty tabs" || normalized === "空白标签页") {
      return text.emptyTabs;
    }
    if (normalized === "Duplicate tabs" || normalized === "重复标签页") {
      return text.duplicateTabs;
    }
    if (normalized.startsWith("Search: ")) {
      return text.searchLabel(normalized.slice("Search: ".length));
    }
    if (normalized.startsWith("检索：")) {
      return text.searchLabel(normalized.slice("检索：".length));
    }
    return label;
  }

  private relativeTime(timestamp: number): string {
    const text = strings(getLocale());
    const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60_000));
    if (minutes < 1) return text.justNow;
    if (minutes < 60) return text.minutesAgo(minutes);
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return text.hoursAgo(hours);
    return new Date(timestamp).toLocaleDateString(getLocale() === "zh" ? "zh-CN" : "en");
  }
}

interface StrategyModalOptions {
  query?: string;
  strategy?: CleanerStrategy;
  onChanged: (strategyId: string | null) => void;
}

function renderGroupOrderControls(
  setting: Setting,
  groupId: string,
  pinnedIds: string[],
  groupName: string,
  onMove: (direction: "up" | "down") => void | Promise<void>,
): void {
  const text = strings(getLocale());
  setting.clear();
  const index = pinnedIds.indexOf(groupId);
  setting.settingEl.addClass("tab-cleaner__group-order-setting");
  setting.settingEl.toggleClass("is-empty", index < 0 || pinnedIds.length < 2);
  if (index < 0 || pinnedIds.length < 2) return;
  for (const direction of ["up", "down"] as const) {
    if (direction === "up" ? index === 0 : index === pinnedIds.length - 1) continue;
    setting.addButton((button) => {
      button.buttonEl.addClass("clickable-icon", "tab-cleaner__group-order-button");
      button
        .setIcon(direction === "up" ? "chevron-up" : "chevron-down")
        .setTooltip(direction === "up" ? text.moveGroupUp(groupName) : text.moveGroupDown(groupName))
        .onClick(() => onMove(direction));
    });
  }
}

class BuiltInGroupModal extends Modal {
  constructor(
    private readonly plugin: TabCleanerPlugin,
    private readonly filterId: string,
    private readonly name: string,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const text = strings(getLocale());
    this.contentEl.createEl("h2", { text: text.manageStrategy(this.name) });
    new Setting(this.contentEl)
      .setName(text.builtInGroup)
      .setDesc(this.filterId === "empty"
        ? text.builtInEmptyDescription
        : text.builtInDuplicatesDescription);
    const pinSetting = new Setting(this.contentEl).setName(text.groupPin).setDesc(text.groupPinDesc);
    const orderSetting = new Setting(this.contentEl).setName(text.groupOrder);
    const refreshOrder = (): void => renderGroupOrderControls(
      orderSetting,
      this.filterId,
      this.plugin.settings.pinnedFilterIds,
      this.name,
      async (direction) => {
        await this.plugin.movePinnedFilter(this.filterId, direction);
        refreshOrder();
      },
    );
    refreshOrder();
    pinSetting.addToggle((toggle) =>
      toggle.setValue(this.plugin.isFilterPinned(this.filterId)).onChange(async (pinned) => {
        await this.plugin.setFilterPinned(this.filterId, pinned);
        refreshOrder();
      }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export class StrategyModal extends Modal {
  private name: string;
  private savedName: string;
  private savingName = false;
  private query: string;
  private pinned: boolean;
  private readonly strategyId: string;
  private pinnedFilterOrder: string[];

  constructor(
    private readonly plugin: TabCleanerPlugin,
    private readonly options: StrategyModalOptions,
  ) {
    super(plugin.app);
    this.name = options.strategy?.name ?? options.query?.trim() ?? "";
    this.savedName = this.name;
    this.query = options.strategy?.query ?? options.query ?? "";
    this.pinned = options.strategy ? this.plugin.isFilterPinned(options.strategy.id) : false;
    this.strategyId = options.strategy?.id ?? `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.pinnedFilterOrder = [...this.plugin.settings.pinnedFilterIds];
  }

  onOpen(): void {
    const text = strings(getLocale());
    this.contentEl.createEl("h2", {
      text: this.options.strategy ? text.strategyDialogManage : text.strategyDialogCreate,
    });
    const searchSetting = new Setting(this.contentEl).setName(text.search);
    searchSetting.setDesc(this.query);
    const nameSetting = new Setting(this.contentEl).setName(text.strategyName);
    let nameSaveButton: ButtonComponent | null = null;
    const refreshNameSave = (): void => {
      if (!nameSaveButton) return;
      const changed = this.name !== this.savedName;
      nameSaveButton.buttonEl.toggleClass("is-hidden", !changed);
      nameSaveButton.setDisabled(this.savingName || !this.name || !changed);
    };
    nameSetting.addText((input) =>
      input
        .setPlaceholder(text.strategyNamePlaceholder)
        .setValue(this.name)
        .onChange((value) => {
          this.name = value.trim();
          refreshNameSave();
        }),
    );
    const pinSetting = new Setting(this.contentEl).setName(text.groupPin).setDesc(text.groupPinDesc);
    const orderSetting = new Setting(this.contentEl).setName(text.groupOrder);
    if (!this.options.strategy) orderSetting.setDesc(text.groupOrderDraftDesc);
    const refreshOrder = (): void => renderGroupOrderControls(
      orderSetting,
      this.strategyId,
      this.options.strategy ? this.plugin.settings.pinnedFilterIds : this.pinnedFilterOrder,
      this.options.strategy ? this.savedName : this.name,
      async (direction) => {
        if (this.options.strategy) {
          await this.plugin.movePinnedFilter(this.strategyId, direction);
          this.options.onChanged(this.strategyId);
        } else {
          this.pinnedFilterOrder = movePinnedFilter(this.pinnedFilterOrder, this.strategyId, direction);
        }
        refreshOrder();
      },
    );
    refreshOrder();
    pinSetting.addToggle((toggle) =>
      toggle.setValue(this.pinned).onChange(async (pinned) => {
        this.pinned = pinned;
        if (this.options.strategy) {
          await this.plugin.setFilterPinned(this.strategyId, pinned);
          this.options.onChanged(this.strategyId);
        } else {
          this.pinnedFilterOrder = setFilterPinned(this.pinnedFilterOrder, this.strategyId, pinned);
        }
        refreshOrder();
      }),
    );
    if (this.options.strategy) {
      nameSetting.addButton((button) => {
        nameSaveButton = button;
        button.buttonEl.addClass("clickable-icon", "tab-cleaner__save-group-name");
        button.buttonEl.setAttribute("aria-label", text.saveStrategyName);
        button.setIcon("check").setTooltip(text.saveStrategyName).onClick(async () => {
          if (this.savingName || !this.name || this.name === this.savedName) return;
          const strategy = this.plugin.settings.strategies.find(({ id }) => id === this.strategyId);
          if (!strategy) return;
          const name = this.name;
          this.savingName = true;
          refreshNameSave();
          try {
            await this.plugin.updateStrategy({ ...strategy, name });
            this.savedName = name;
            this.options.onChanged(this.strategyId);
            refreshOrder();
          } finally {
            this.savingName = false;
            refreshNameSave();
          }
        });
        refreshNameSave();
      });
    }
    const actions = new Setting(this.contentEl);
    if (this.options.strategy) {
      actions.addButton((button) =>
        button
          .setButtonText(text.deleteStrategy)
          .setWarning()
          .onClick(() => {
            const strategy = this.plugin.settings.strategies.find(({ id }) => id === this.strategyId);
            if (strategy) this.confirmDelete(strategy);
          }),
      );
      return;
    }
    actions.addButton((button) => button.setButtonText(text.cancel).onClick(() => this.close()));
    actions.addButton((button) =>
      button.setButtonText(text.save).setCta().onClick(async () => {
        if (!this.name || !this.query) {
          new Notice(text.enterStrategyName);
          return;
        }
        const strategy: CleanerStrategy = {
          id: this.strategyId,
          name: this.name,
          query: this.options.strategy?.query ?? this.query,
        };
        await this.plugin.addStrategy(strategy, this.pinned, this.pinnedFilterOrder);
        this.close();
        this.options.onChanged(strategy.id);
      }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }

  private confirmDelete(strategy: CleanerStrategy): void {
    new ConfirmStrategyDeleteModal(this.plugin, strategy, async () => {
      await this.plugin.removeStrategy(strategy.id);
      this.close();
      this.options.onChanged(null);
    }).open();
  }
}

export class ConfirmStrategyDeleteModal extends Modal {
  constructor(
    plugin: TabCleanerPlugin,
    private readonly strategy: CleanerStrategy,
    private readonly onConfirm: () => Promise<void>,
  ) {
    super(plugin.app);
  }

  onOpen(): void {
    const text = strings(getLocale());
    this.contentEl.createEl("h2", { text: text.deleteStrategyTitle(this.strategy.name) });
    this.contentEl.createEl("p", { text: text.deleteStrategyDescription });
    const actions = new Setting(this.contentEl);
    actions.addButton((button) => button.setButtonText(text.cancel).onClick(() => this.close()));
    actions.addButton((button) =>
      button.setButtonText(text.delete).setWarning().onClick(async () => {
        await this.onConfirm();
        this.close();
      }),
    );
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
