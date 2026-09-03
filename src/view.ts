import {
  ItemView,
  Menu,
  Modal,
  Notice,
  Setting,
  setIcon,
  setTooltip,
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
    this.registerEvent(
      this.app.workspace.on("layout-change", () => {
        this.webviewerRefreshAttempts = 0;
        this.render();
      }),
    );
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.render()));
    this.render();
  }

  async onClose(): Promise<void> {
    this.filterResizeObserver?.disconnect();
    this.pinnedChangeListeners.clear();
    if (this.webviewerRefreshTimer !== null) window.clearTimeout(this.webviewerRefreshTimer);
  }

  refresh(): void {
    this.webviewerRefreshAttempts = 0;
    this.render();
  }

  private render(): void {
    this.filterResizeObserver?.disconnect();
    this.filterResizeObserver = null;
    const root = this.contentEl;
    root.empty();
    root.addClass("tab-cleaner");

    const tabs = scanTabs(this.app).filter((tab) => tab.viewType !== TAB_CLEANER_VIEW);
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
      this.render();
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
    const activeStrategy = strategies.find((strategy) => strategy.id === this.filter);
    const orders = filterOrders(
      builtInEntries.slice(1).map(({ id }) => id),
      strategies.map(({ id }) => id),
      this.plugin.settings.recentStrategyIds,
      this.filter,
    );
    let edit: HTMLButtonElement | null = null;
    const strategyButtons = strategies.map((strategy) => {
      const count = tabs.filter((tab) => matchesStrategy(tab, strategy)).length;
      const button = this.addFilterButton(
        filters,
        strategy.id,
        `${strategy.name} (${count})`,
        text.filterCount(strategy.name, count),
      );
      button.addClass("tab-cleaner__filter--strategy");
      if (strategy.id === activeStrategy?.id) {
        edit = filters.createEl("button", {
          cls: "clickable-icon tab-cleaner__filter-edit",
          attr: { "aria-label": text.editStrategy(strategy.name) },
        });
        setIcon(edit, "pencil");
        edit.addEventListener("click", () => {
          new StrategyModal(this.plugin, {
            strategy,
            onChanged: (strategyId) => {
              if (strategyId === null) this.filter = "all";
              this.render();
            },
          }).open();
        });
      }
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

    this.installAdaptiveFilterLayout(
      filters,
      allButton,
      optionalEntries,
      more,
      edit,
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
    const button = parent.createEl("button", {
      text: label,
      cls: this.filter === id ? "tab-cleaner__filter is-active" : "tab-cleaner__filter",
      attr: { title: tooltip },
    });
    button.addEventListener("click", () => this.activateFilter(id));
    return button;
  }

  private installAdaptiveFilterLayout(
    filters: HTMLElement,
    allButton: HTMLButtonElement,
    optionalEntries: Array<{ id: string; button: HTMLButtonElement }>,
    more: HTMLButtonElement,
    edit: HTMLButtonElement | null,
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
      const editWidth = edit?.offsetWidth ?? 0;

      const totalWidth = (widths: number[]): number =>
        widths.reduce((sum, width) => sum + width, 0) + gap * Math.max(0, widths.length - 1);

      const layout = (): void => {
        for (const { button } of optionalEntries) {
          button.removeClass("is-layout-hidden", "is-layout-shrink");
        }
        more.toggleClass("is-layout-hidden", optionalEntries.length === 0);

        const fixedWidths = [allWidth, ...(edit ? [editWidth] : [])];
        if (totalWidth([...fixedWidths, ...optionalWidths]) <= filters.clientWidth) {
          more.addClass("is-layout-hidden");
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
    if (!(["all", "empty", "duplicates"] as string[]).includes(id)) {
      this.plugin.markStrategyUsed(id);
    }
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
    heading.createEl("h3", { text: text.openTabsCount(tabs.length) });

    const headingActions = heading.createDiv({ cls: "tab-cleaner__heading-actions" });
    const pinnedProtected = this.plugin.settings.pinnedProtection === "always";
    const pinnedButton = headingActions.createEl("button", {
      cls: pinnedProtected
        ? "clickable-icon tab-cleaner__heading-icon tab-cleaner__heading-toggle is-active"
        : "clickable-icon tab-cleaner__heading-icon tab-cleaner__heading-toggle",
      attr: {
        "aria-label": pinnedProtected ? text.pinnedProtected : text.pinnedSelectable,
        "aria-pressed": String(pinnedProtected),
      },
    });
    setIcon(pinnedButton, pinnedProtected ? "pin" : "pin-off");
    setTooltip(pinnedButton, pinnedProtected ? text.pinnedProtected : text.pinnedSelectable);
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

  private renderTabRow(list: HTMLElement, tab: TabDescriptor): void {
    const text = strings(getLocale());
    const reason = tabProtectionReason(tab, this.plugin.settings);
    const row = list.createDiv({
      cls: reason ? "tab-cleaner__row is-disabled is-openable" : "tab-cleaner__row is-openable",
    });
    if (reason) {
      const reasonText =
        reason === "pinned"
          ? text.pinned
          : reason === "active"
            ? text.activeProtected
            : text.cannotRestore;
      row.setAttribute("title", reasonText);
    }

    const checkbox = row.createEl("input", { type: "checkbox" });
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
    if (tab.isActive && this.plugin.settings.protectActiveTab) {
      const current = title.createSpan({
        cls: "tab-cleaner__current",
        attr: { "aria-label": text.activeProtected },
      });
      setTooltip(current, text.activeProtected);
    }
    if (tab.isPinned) {
      const pin = title.createSpan({ cls: "tab-cleaner__pin", attr: { "aria-label": text.pinned } });
      setIcon(pin, "pin");
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

export class StrategyModal extends Modal {
  private name: string;
  private query: string;

  constructor(
    private readonly plugin: TabCleanerPlugin,
    private readonly options: StrategyModalOptions,
  ) {
    super(plugin.app);
    this.name = options.strategy?.name ?? options.query?.trim() ?? "";
    this.query = options.strategy?.query ?? options.query ?? "";
  }

  onOpen(): void {
    const text = strings(getLocale());
    this.contentEl.createEl("h2", {
      text: this.options.strategy ? text.strategyDialogEdit : text.strategyDialogCreate,
    });
    const searchSetting = new Setting(this.contentEl).setName(text.search);
    searchSetting.setDesc(this.query);
    new Setting(this.contentEl).setName(text.strategyName).addText((input) =>
      input
        .setPlaceholder(text.strategyNamePlaceholder)
        .setValue(this.name)
        .onChange((value) => {
          this.name = value.trim();
        }),
    );
    const actions = new Setting(this.contentEl);
    actions.addButton((button) => button.setButtonText(text.cancel).onClick(() => this.close()));
    if (this.options.strategy) {
      actions.addButton((button) =>
        button
          .setButtonText(text.deleteStrategy)
          .setWarning()
          .onClick(() => this.confirmDelete(this.options.strategy!)),
      );
    }
    actions.addButton((button) =>
      button.setButtonText(text.save).setCta().onClick(async () => {
        if (!this.name || !this.query) {
          new Notice(text.enterStrategyName);
          return;
        }
        const strategy: CleanerStrategy = {
          id:
            this.options.strategy?.id ??
            `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          name: this.name,
          query: this.options.strategy?.query ?? this.query,
        };
        if (this.options.strategy) await this.plugin.updateStrategy(strategy);
        else await this.plugin.addStrategy(strategy);
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
