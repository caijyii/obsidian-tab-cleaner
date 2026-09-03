import { App, PluginSettingTab, Setting } from "obsidian";
import { getLocale, strings } from "./i18n";
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
    containerEl.empty();
    containerEl.createEl("h2", { text: text.pluginName });

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

    new Setting(containerEl)
      .setName(text.recentBatchLimit)
      .setDesc(text.recentBatchLimitDesc)
      .addSlider((slider) =>
        slider
          .setLimits(5, 50, 5)
          .setDynamicTooltip()
          .setValue(this.plugin.settings.recentBatchLimit)
          .onChange(async (value) => {
            this.plugin.settings.recentBatchLimit = value;
            await this.plugin.trimAndSaveHistory();
          }),
      );

    containerEl.createEl("h3", { text: text.savedStrategies });
    containerEl.createEl("p", {
      text: text.savedStrategiesDesc,
      cls: "setting-item-description",
    });

    if (this.plugin.settings.strategies.length === 0) {
      containerEl.createEl("p", { text: text.noStrategies, cls: "setting-item-description" });
    }

    for (const strategy of this.plugin.settings.strategies) {
      this.renderStrategy(containerEl, strategy);
    }

    new Setting(containerEl)
      .setName(text.clearRecentlyClosed)
      .setDesc(text.clearRecentlyClosedDesc)
      .addButton((button) =>
        button.setButtonText(text.clearHistory).setWarning().onClick(async () => {
          await this.plugin.clearHistory();
        }),
      );
  }

  private renderStrategy(containerEl: HTMLElement, strategy: CleanerStrategy): void {
    const text = strings(getLocale());
    new Setting(containerEl)
      .setName(strategy.name)
      .setDesc(text.savedSearchDescription(strategy.query))
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
  }
}
