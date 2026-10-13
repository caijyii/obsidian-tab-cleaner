import { App, PluginSettingTab, Setting } from "obsidian";
import { getLocale, strings } from "./i18n";
import { filterOrders } from "./filter-order";
import type TabCleanerPlugin from "./main";
import type { CleanerStrategy } from "./types";
import { ConfirmStrategyDeleteModal, StrategyModal } from "./view";

export class TabCleanerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TabCleanerPlugin) {
    super(app, plugin);
  }

  display(): void {
    const text = strings(getLocale());
    const { containerEl } = this;
    const scrollTop = containerEl.scrollTop;
    containerEl.empty();

    new Setting(containerEl).setName(text.tabProtectionSection).setHeading();

    new Setting(containerEl)
      .setName(text.pinnedProtection)
      .setDesc(text.pinnedProtectionDesc)
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.pinnedProtection === "always")
          .onChange(async (value) => {
            this.plugin.settings.pinnedProtection = value ? "always" : "manual";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(text.protectActive)
      .setDesc(text.protectActiveDesc)
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.protectActiveTab).onChange(async (value) => {
          this.plugin.settings.protectActiveTab = value;
          await this.plugin.saveSettings();
        }),
      );

    new Setting(containerEl).setName(text.recentlyClosed).setHeading();

    new Setting(containerEl)
      .setName(text.recentBatchLimit)
      .setDesc(text.recentBatchLimitDesc)
      .addSlider((slider) =>
        slider
          .setLimits(5, 50, 5)
          .setValue(this.plugin.settings.recentBatchLimit)
          .onChange(async (value) => {
            this.plugin.settings.recentBatchLimit = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl)
      .setName(text.clearRecentlyClosed)
      .setDesc(text.clearRecentlyClosedDesc)
      .addButton((button) =>
        button.setButtonText(text.clearHistory).setWarning().onClick(async () => {
          await this.plugin.clearHistory();
        }),
      );

    new Setting(containerEl)
      .setName(text.savedStrategies)
      .setDesc(text.savedStrategiesDesc)
      .setHeading();

    const groups = new Map<string, { name: string; description: string; strategy?: CleanerStrategy }>([
      ["empty", { name: text.empty, description: `${text.builtInGroup} · ${text.builtInEmptyDescription}` }],
      ["duplicates", { name: text.duplicates, description: `${text.builtInGroup} · ${text.builtInDuplicatesDescription}` }],
    ]);
    for (const strategy of this.plugin.settings.strategies) {
      groups.set(strategy.id, {
        name: strategy.name,
        description: text.savedSearchDescription(strategy.query),
        strategy,
      });
    }
    const { displayIds } = filterOrders(
      ["empty", "duplicates"],
      this.plugin.settings.strategies.map(({ id }) => id),
      this.plugin.settings.recentFilterIds,
      "all",
      this.plugin.settings.pinnedFilterIds,
    );
    for (const id of displayIds) {
      const group = groups.get(id);
      if (!group) continue;
      if (group.strategy) this.renderStrategy(containerEl, group.strategy);
      else {
        const setting = new Setting(containerEl).setName(group.name).setDesc(group.description);
        this.addGroupControls(setting, id, group.name);
      }
    }

    if (this.plugin.settings.strategies.length === 0) {
      new Setting(containerEl).setDesc(text.noStrategies);
    }
    containerEl.scrollTop = scrollTop;
  }

  private renderStrategy(containerEl: HTMLElement, strategy: CleanerStrategy): void {
    const text = strings(getLocale());
    const setting = new Setting(containerEl)
      .setName(strategy.name)
      .setDesc(text.savedSearchDescription(strategy.query));
    setting
      .addExtraButton((button) =>
        button
          .setIcon("pencil")
          .setTooltip(text.edit)
          .onClick(() => {
            new StrategyModal(this.plugin, {
              strategy,
              onChanged: () => this.display(),
            }).open();
          }),
      )
      .addExtraButton((button) =>
        button
          .setIcon("trash-2")
          .setTooltip(text.deleteStrategy)
          .onClick(() => {
            new ConfirmStrategyDeleteModal(this.plugin, strategy, async () => {
              await this.plugin.removeStrategy(strategy.id);
              this.display();
            }).open();
          }),
      );
    this.addGroupControls(setting, strategy.id, strategy.name);
  }

  private addGroupControls(setting: Setting, filterId: string, name: string): void {
    const text = strings(getLocale());
    const pinned = this.plugin.isFilterPinned(filterId);

    if (pinned) {
      const index = this.plugin.settings.pinnedFilterIds.indexOf(filterId);
      for (const direction of ["up", "down"] as const) {
        const disabled = direction === "up"
          ? index === 0
          : index === this.plugin.settings.pinnedFilterIds.length - 1;
        if (disabled) continue;
        const tooltip = direction === "up" ? text.moveGroupUp(name) : text.moveGroupDown(name);
        setting.addButton((button) => {
          button.buttonEl.addClass("clickable-icon", "tab-cleaner__group-order-button");
          button
            .setIcon(direction === "up" ? "chevron-up" : "chevron-down")
            .setTooltip(tooltip)
            .onClick(async () => {
              await this.plugin.movePinnedFilter(filterId, direction);
              this.display();
            });
        });
      }
    }

    setting.controlEl.createSpan({ text: text.groupPin, cls: "tab-cleaner__group-pin-label" });
    setting.addToggle((toggle) => {
      toggle.toggleEl.setAttribute("aria-label", text.pinGroup(name));
      toggle
        .setValue(pinned)
        .setTooltip(text.pinGroup(name))
        .onChange(async (value) => {
          await this.plugin.setFilterPinned(filterId, value);
          this.display();
        });
    });
  }
}
