import { Notice, Plugin, TFile, type ViewState, type WorkspaceLeaf } from "obsidian";
import { toClosedRecords } from "./closed-records";
import { getLocale, strings } from "./i18n";
import { retainedHistory } from "./history-retention";
import { scanTabs, tabProtectionReason } from "./model";
import { stateString } from "./tab-state";
import { TabCleanerSettingTab } from "./settings";
import type {
  CleanerStrategy,
  ClosedBatch,
  ClosedTabRecord,
  PersistedData,
  TabCleanerSettings,
  TabDescriptor,
} from "./types";
import { TAB_CLEANER_VIEW, TabCleanerView } from "./view";

const DEFAULT_SETTINGS: TabCleanerSettings = {
  pinnedProtection: "always",
  protectActiveTab: true,
  recentBatchLimit: 20,
  recentStrategyIds: [],
  strategies: [],
};

export default class TabCleanerPlugin extends Plugin {
  settings: TabCleanerSettings = structuredClone(DEFAULT_SETTINGS);
  recentBatches: ClosedBatch[] = [];
  private observedOpenTabs = new Map<WorkspaceLeaf, TabDescriptor>();
  private historyTrackingReady = false;
  private reconcilingHistory = false;
  private reconcilePending = false;
  private ignoredHistoryLeaves = new Set<WorkspaceLeaf>();

  async onload(): Promise<void> {
    await this.loadPluginData();
    const text = strings(getLocale());
    this.registerView(TAB_CLEANER_VIEW, (leaf) => new TabCleanerView(leaf, this));
    this.addRibbonIcon("brush-cleaning", text.openPlugin, () => void this.activateView());
    this.addCommand({
      id: "open-panel",
      name: text.openCommand,
      callback: () => void this.activateView(),
    });
    this.addSettingTab(new TabCleanerSettingTab(this.app, this));
    this.app.workspace.onLayoutReady(() => {
      this.observedOpenTabs = this.snapshotOpenTabs();
      this.historyTrackingReady = true;
      this.registerEvent(
        this.app.workspace.on("layout-change", () => void this.reconcileManualClosures()),
      );
    });
  }

  async onunload(): Promise<void> {
    this.historyTrackingReady = false;
    this.ignoredHistoryLeaves.clear();
    this.app.workspace.detachLeavesOfType(TAB_CLEANER_VIEW);
  }

  async activateView(): Promise<void> {
    let leaf = this.app.workspace.getLeavesOfType(TAB_CLEANER_VIEW)[0];
    if (!leaf) {
      leaf =
        this.app.workspace.getLeftLeaf(false) ??
        this.app.workspace.getRightLeaf(false) ??
        this.app.workspace.getLeaf(true);
      await leaf.setViewState({ type: TAB_CLEANER_VIEW, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  async closeTabs(tabs: TabDescriptor[], label: string): Promise<void> {
    const activeContentLeaf = this.app.workspace.getMostRecentLeaf();
    const safeTabs = tabs.filter(
      (tab) =>
        !tabProtectionReason(
          { ...tab, isActive: tab.leaf === activeContentLeaf },
          this.settings,
        ),
    );
    const records = toClosedRecords(safeTabs);

    for (const tab of safeTabs) this.ignoredHistoryLeaves.add(tab.leaf);
    for (const tab of safeTabs) tab.leaf.detach();

    await this.addHistoryBatch(records, label);
    new Notice(strings(getLocale()).closedTabs(safeTabs.length));
    this.refreshViews();
  }

  async reopenRecord(record: ClosedTabRecord): Promise<void> {
    const leaf = await this.restoreRecord(record);
    if (leaf) this.activateLeaf(leaf);
  }

  async reopenBatch(batch: ClosedBatch): Promise<void> {
    let lastRestoredLeaf: WorkspaceLeaf | null = null;
    for (const record of batch.tabs) {
      const leaf = await this.restoreRecord(record);
      if (leaf) lastRestoredLeaf = leaf;
    }
    if (lastRestoredLeaf) this.activateLeaf(lastRestoredLeaf);
  }

  activateLeaf(leaf: WorkspaceLeaf): void {
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
  }

  private async restoreRecord(record: ClosedTabRecord): Promise<WorkspaceLeaf | null> {
    if (record.path) {
      const file = this.app.vault.getAbstractFileByPath(record.path);
      if (!(file instanceof TFile)) {
        new Notice(strings(getLocale()).cannotReopen(record.title));
        return null;
      }
    } else if (record.viewState.type !== "empty") {
      const url = record.url ?? stateString(record.viewState, "url");
      if (record.viewState.type !== "webviewer" || !url) {
        new Notice(strings(getLocale()).cannotReopen(record.title));
        return null;
      }
    }
    const viewState = structuredClone(record.viewState) as ViewState;
    viewState.active = false;
    const leaf = this.app.workspace.getLeaf(true);
    await leaf.setViewState(viewState);
    return leaf;
  }

  async addStrategy(strategy: CleanerStrategy): Promise<void> {
    this.settings.strategies.push(strategy);
    await this.saveSettings();
  }

  async updateStrategy(strategy: CleanerStrategy): Promise<void> {
    const index = this.settings.strategies.findIndex((candidate) => candidate.id === strategy.id);
    if (index === -1) return;
    this.settings.strategies[index] = strategy;
    await this.saveSettings();
  }

  async removeStrategy(strategyId: string): Promise<void> {
    this.settings.strategies = this.settings.strategies.filter(
      (candidate) => candidate.id !== strategyId,
    );
    this.settings.recentStrategyIds = this.settings.recentStrategyIds.filter(
      (candidate) => candidate !== strategyId,
    );
    await this.saveSettings();
  }

  markStrategyUsed(strategyId: string): void {
    this.settings.recentStrategyIds = [
      strategyId,
      ...this.settings.recentStrategyIds.filter((candidate) => candidate !== strategyId),
    ].slice(0, 10);
    void this.saveSettings();
  }

  async saveSettings(): Promise<void> {
    await this.savePluginData();
    this.refreshViews();
  }

  async clearHistory(): Promise<void> {
    this.recentBatches = [];
    await this.savePluginData();
    this.refreshViews();
    new Notice(strings(getLocale()).historyCleared);
  }

  private snapshotOpenTabs(): Map<WorkspaceLeaf, TabDescriptor> {
    const tabs = scanTabs(this.app).filter((tab) => tab.viewType !== TAB_CLEANER_VIEW);
    return new Map(
      tabs.map((tab) => [
        tab.leaf,
        {
          ...tab,
          viewState: structuredClone(tab.viewState),
        },
      ]),
    );
  }

  private async reconcileManualClosures(): Promise<void> {
    if (!this.historyTrackingReady) return;
    if (this.reconcilingHistory) {
      this.reconcilePending = true;
      return;
    }

    this.reconcilingHistory = true;
    try {
      const currentTabs = this.snapshotOpenTabs();
      const closedTabs: TabDescriptor[] = [];
      for (const [leaf, previousTab] of this.observedOpenTabs) {
        const currentTab = currentTabs.get(leaf);
        const wasClosed = currentTab === undefined || (!previousTab.isEmpty && currentTab.isEmpty);
        if (!wasClosed) continue;
        if (this.ignoredHistoryLeaves.delete(leaf)) continue;
        closedTabs.push(previousTab);
      }
      this.observedOpenTabs = currentTabs;
      await this.addHistoryBatch(toClosedRecords(closedTabs), strings(getLocale()).manualClosed);
    } finally {
      this.reconcilingHistory = false;
      if (this.reconcilePending) {
        this.reconcilePending = false;
        void this.reconcileManualClosures();
      }
    }
  }

  private async addHistoryBatch(records: ClosedTabRecord[], label: string): Promise<void> {
    if (records.length === 0) return;
    this.recentBatches.unshift({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      closedAt: Date.now(),
      label,
      tabs: records,
    });
    this.recentBatches = retainedHistory(this.recentBatches);
    await this.savePluginData();
    this.refreshViews();
  }

  private refreshViews(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TAB_CLEANER_VIEW)) {
      if (leaf.view instanceof TabCleanerView) leaf.view.refresh();
    }
  }

  private async loadPluginData(): Promise<void> {
    const data = (await this.loadData()) as Partial<PersistedData> | null;
    this.settings = {
      ...structuredClone(DEFAULT_SETTINGS),
      ...(data?.settings ?? {}),
      recentStrategyIds: data?.settings?.recentStrategyIds ?? [],
      strategies: (data?.settings?.strategies ?? []).map((strategy) => ({
        id: strategy.id,
        name: strategy.name,
        query: strategy.query,
      })),
    };
    this.recentBatches = retainedHistory(
      Array.isArray(data?.recentBatches) ? data.recentBatches : [],
    );
  }

  private async savePluginData(): Promise<void> {
    const data: PersistedData = {
      settings: this.settings,
      recentBatches: this.recentBatches,
    };
    await this.saveData(data);
  }
}
