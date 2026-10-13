import { App, PluginSettingTab, Setting, type SettingDefinitionItem } from "obsidian";
import { setDestructiveButton } from "./button-compat";
import { getLocale, strings } from "./i18n";
import { filterOrders } from "./filter-order";
import type TabCleanerPlugin from "./main";
import type { CleanerStrategy } from "./types";
import { ConfirmStrategyDeleteModal, StrategyModal } from "./view";

type CleanerSettingDefinition = {
  name: string;
  desc?: string;
  searchable?: boolean;
  aliases?: string[];
  render: (setting: Setting) => void;
};

export class TabCleanerSettingTab extends PluginSettingTab {
  constructor(app: App, private readonly plugin: TabCleanerPlugin) {
    super(app, plugin);
  }

  getSettingDefinitions(): SettingDefinitionItem[] {
    return this.settingDefinitions();
  }

  // Obsidian < 1.13.0 calls this fallback; newer versions render the definitions above.
  display(): void {
    this.renderLegacy();
  }

  refresh(): void {
    if (typeof this.update === "function") this.update();
    else if (this.containerEl.isConnected) this.renderLegacy();
  }

  private renderLegacy(): void {
    const { containerEl } = this;
    const scrollTop = containerEl.scrollTop;
    containerEl.empty();
    for (const definition of this.settingDefinitions()) {
      const setting = new Setting(containerEl).setName(definition.name);
      if (definition.desc !== undefined) setting.setDesc(definition.desc);
      definition.render(setting);
    }
    containerEl.scrollTop = scrollTop;
  }

  private settingDefinitions(): CleanerSettingDefinition[] {
    const text = strings(getLocale());
    const definitions: CleanerSettingDefinition[] = [
      { name: text.tabProtectionSection, searchable: false, render: (setting) => { setting.setHeading(); } },
      {
        name: text.pinnedProtection,
        desc: text.pinnedProtectionDesc,
        render: (setting) => {
          setting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.pinnedProtection === "always").onChange(async (value) => {
              this.plugin.settings.pinnedProtection = value ? "always" : "manual";
              await this.plugin.saveSettings();
            }),
          );
        },
      },
      {
        name: text.protectActive,
        desc: text.protectActiveDesc,
        render: (setting) => {
          setting.addToggle((toggle) =>
            toggle.setValue(this.plugin.settings.protectActiveTab).onChange(async (value) => {
              this.plugin.settings.protectActiveTab = value;
              await this.plugin.saveSettings();
            }),
          );
        },
      },
      { name: text.recentlyClosed, searchable: false, render: (setting) => { setting.setHeading(); } },
      {
        name: text.recentBatchLimit,
        desc: text.recentBatchLimitDesc,
        render: (setting) => {
          setting.addSlider((slider) =>
            slider.setLimits(5, 50, 5).setValue(this.plugin.settings.recentBatchLimit).onChange(async (value) => {
              this.plugin.settings.recentBatchLimit = value;
              await this.plugin.saveSettings();
            }),
          );
        },
      },
      {
        name: text.clearRecentlyClosed,
        desc: text.clearRecentlyClosedDesc,
        render: (setting) => {
          setting.addButton((button) =>
            setDestructiveButton(button).setButtonText(text.clearHistory).onClick(async () => {
              await this.plugin.clearHistory();
            }),
          );
        },
      },
      { name: text.savedStrategies, desc: text.savedStrategiesDesc, searchable: false, render: (setting) => { setting.setHeading(); } },
    ];

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
    // Obsidian 1.13 keys rows by metadata name. Keep visible names unchanged,
    // while disambiguating custom groups that share a name with another row.
    const names = [
      ...definitions.map(({ name }) => name),
      text.empty,
      text.duplicates,
      ...this.plugin.settings.strategies.map(({ name }) => name),
    ];
    const nameCounts = new Map<string, number>();
    for (const name of names) nameCounts.set(name, (nameCounts.get(name) ?? 0) + 1);
    const reservedNames = new Set(names);
    const searchNames = new Map<string, string>();
    for (const strategy of this.plugin.settings.strategies) {
      let name = strategy.name;
      if ((nameCounts.get(name) ?? 0) > 1) {
        let ordinal = 1;
        do { name = `${strategy.name} · ${text.customGroup} ${ordinal++}`; } while (reservedNames.has(name));
        reservedNames.add(name);
      }
      searchNames.set(strategy.id, name);
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
      definitions.push({
        name: group.strategy ? searchNames.get(id) ?? group.name : group.name,
        desc: group.description,
        aliases: [
          group.name,
          text.groupPin,
          text.moveGroupUp(group.name),
          text.moveGroupDown(group.name),
          ...(group.strategy ? [text.edit, text.deleteStrategy] : []),
        ],
        render: (setting) => {
          if (group.strategy) this.renderStrategy(setting, group.strategy);
          else this.addGroupControls(setting, id, group.name);
        },
      });
    }

    if (this.plugin.settings.strategies.length === 0) {
      definitions.push({ name: "", desc: text.noStrategies, searchable: false, render: () => {} });
    }
    return definitions;
  }

  private renderStrategy(setting: Setting, strategy: CleanerStrategy): void {
    const text = strings(getLocale());
    setting.setName(strategy.name);
    setting
      .addExtraButton((button) =>
        button
          .setIcon("pencil")
          .setTooltip(text.edit)
          .onClick(() => {
            new StrategyModal(this.plugin, {
              strategy,
              onChanged: () => this.refresh(),
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
              this.refresh();
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
              this.refresh();
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
          this.refresh();
        });
    });
  }
}
