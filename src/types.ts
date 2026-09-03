import type { ViewState, WorkspaceLeaf } from "obsidian";

export type PinnedProtection = "always" | "manual";

export interface CleanerStrategy {
  id: string;
  name: string;
  query: string;
}

export interface TabCleanerSettings {
  pinnedProtection: PinnedProtection;
  protectActiveTab: boolean;
  recentBatchLimit: number;
  recentStrategyIds: string[];
  strategies: CleanerStrategy[];
}

export interface ClosedTabRecord {
  path: string | null;
  url?: string | null;
  extension?: string;
  title: string;
  viewState: ViewState;
  count: number;
}

export interface ClosedBatch {
  id: string;
  closedAt: number;
  label: string;
  tabs: ClosedTabRecord[];
}

export interface PersistedData {
  settings: TabCleanerSettings;
  recentBatches: ClosedBatch[];
}

export interface TabDescriptor {
  id: string;
  leaf: WorkspaceLeaf;
  title: string;
  path: string | null;
  url: string | null;
  extension: string;
  viewType: string;
  viewState: ViewState;
  isEmpty: boolean;
  isDuplicate: boolean;
  isPinned: boolean;
  isActive: boolean;
  isRestorable: boolean;
}

export type BuiltInFilter = "all" | "empty" | "duplicates";
