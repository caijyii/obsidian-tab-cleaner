export type TabProtectionReason = "unrestorable" | "pinned" | "active";

interface ProtectableTab {
  isRestorable: boolean;
  isEmpty: boolean;
  isPinned: boolean;
  isActive: boolean;
}

interface ProtectionSettings {
  pinnedProtection: "always" | "manual";
  protectActiveTab: boolean;
}

export function tabProtectionReason(
  tab: ProtectableTab,
  settings: ProtectionSettings,
): TabProtectionReason | null {
  if (!tab.isRestorable && !tab.isEmpty) return "unrestorable";
  if (tab.isPinned && settings.pinnedProtection === "always") return "pinned";
  if (tab.isActive && settings.protectActiveTab) return "active";
  return null;
}

export function defaultSelected(tab: ProtectableTab, settings: ProtectionSettings): boolean {
  return tabProtectionReason(tab, settings) === null;
}
