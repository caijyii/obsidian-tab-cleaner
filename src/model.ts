import { TFile, type App, type ViewState, type WorkspaceLeaf } from "obsidian";
import type {
  CleanerStrategy,
  TabCleanerSettings,
  TabDescriptor,
} from "./types";
import { duplicateFlags } from "./duplicate-groups";
import { resolvePathlessTabTitle } from "./tab-title";
import { extensionFromSource, stateString, titleFromSource } from "./tab-state";

const leafIds = new WeakMap<WorkspaceLeaf, string>();
let nextLeafId = 1;

function leafId(leaf: WorkspaceLeaf): string {
  let id = leafIds.get(leaf);
  if (!id) {
    id = `leaf-${nextLeafId++}`;
    leafIds.set(leaf, id);
  }
  return id;
}

function stateFilePath(viewState: ViewState): string | null {
  return stateString(viewState, "file");
}

function titleFromPath(path: string): string {
  const last = path.split("/").pop();
  return last || path;
}

export function scanTabs(app: App): TabDescriptor[] {
  const tabs: TabDescriptor[] = [];

  app.workspace.iterateRootLeaves((leaf) => {
    const viewState = leaf.getViewState();
    const path = stateFilePath(viewState);
    const url = stateString(viewState, "url");
    const stateTitle = stateString(viewState, "title");
    const file = path ? app.vault.getAbstractFileByPath(path) : null;
    const extension = file instanceof TFile
      ? file.extension.toLocaleLowerCase()
      : extensionFromSource(url ?? "") || extensionFromSource(stateTitle ?? "");
    const isEmpty = viewState.type === "empty";

    tabs.push({
      id: leafId(leaf),
      leaf,
      title:
        path
          ? titleFromPath(path)
          : resolvePathlessTabTitle({
              sourceTitle: titleFromSource(url ?? ""),
              stateTitle,
              leafTitle: leaf.getDisplayText(),
              viewType: viewState.type,
            }),
      path,
      url,
      extension,
      viewType: viewState.type,
      viewState,
      isEmpty,
      isDuplicate: false,
      isPinned: viewState.pinned === true,
      isActive: app.workspace.activeLeaf === leaf,
      isRestorable: isEmpty || file instanceof TFile || (viewState.type === "webviewer" && !!url),
    });
  });

  const duplicates = duplicateFlags(tabs);
  for (const [index, tab] of tabs.entries()) tab.isDuplicate = duplicates[index] ?? false;

  return tabs;
}

export function matchesSearch(tab: TabDescriptor, query: string): boolean {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  return [tab.title, tab.path ?? "", tab.url ?? "", tab.extension, tab.viewType].some((value) =>
    value.toLocaleLowerCase().includes(normalized),
  );
}

export function matchesStrategy(tab: TabDescriptor, strategy: CleanerStrategy): boolean {
  return matchesSearch(tab, strategy.query);
}

export function tabProtectionReason(
  tab: TabDescriptor,
  settings: TabCleanerSettings,
): "unrestorable" | "pinned" | null {
  if (!tab.isRestorable && !tab.isEmpty) return "unrestorable";
  if (tab.isPinned && settings.pinnedProtection === "always") return "pinned";
  return null;
}

export function defaultSelected(tab: TabDescriptor, settings: TabCleanerSettings): boolean {
  if (tabProtectionReason(tab, settings)) return false;
  if (tab.isActive && settings.protectActiveTab) return false;
  return true;
}
