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
          .setDynamicTooltip()
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

    if (this.plugin.settings.strategies.length === 0) {
      new Setting(containerEl).setDesc(text.noStrategies);
    }

    for (const strategy of this.plugin.settings.strategies) {
      this.renderStrategy(containerEl, strategy);
    }
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
