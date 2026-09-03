# Obsidian Tab Cleaner

[English](README.md) | [简体中文](README.zh-CN.md)

Tab Cleaner 是一款 Obsidian 可视化标签页清理插件，帮助你查看标签页，并在确认后安全地批量关闭。

![Tab Cleaner 操作演示](assets/tab-cleaner-demo.gif)

## 功能

- 可视化展示主工作区中的标签页
- 内置空白标签页和重复标签页筛选
- 按路径、文件名、扩展名或视图类型搜索
- 将搜索条件保存为可编辑、可删除的检索组
- 可在清理面板中开关固定标签页保护
- 默认保护当前活动标签页
- 按批次保存最近关闭记录，并支持一键重新打开
- 根据 Obsidian 应用语言自动显示简体中文或英文
- 安全关闭边界：只允许选择空白标签页和以文件为基础的标签页

空白标签页会合并写入“最近关闭”，并可重新打开为一个新的空白标签页。左右侧栏工具和 Tab Cleaner 自己的面板不会进入清理范围。

## 使用要求

- Obsidian 1.8.7 或更高版本
- 面向桌面端和移动端设计；目前仅在 macOS 上经过实测

建议备份重要内容，并在将任何标签页管理插件用于重要 Vault 前验证你常用的工作流程。

## 安装

### 通过第三方插件目录安装

Tab Cleaner 进入 Obsidian 第三方插件目录后：

1. 在 Obsidian 中打开“设置 → 第三方插件”。
2. 点击“浏览”并搜索 **Tab Cleaner**。
3. 点击“安装”，然后启用插件。

### 通过 BRAT 安装

在第三方插件目录上架前，可以通过 [BRAT](https://github.com/TfTHacker/obsidian42-brat) 安装 GitHub Release：

1. 安装并启用 BRAT。
2. 在 BRAT 设置中选择 **Add Beta plugin**。
3. 输入 `https://github.com/caijyii/obsidian-tab-cleaner`。

### 手动安装

从对应的 [GitHub Release](https://github.com/caijyii/obsidian-tab-cleaner/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，然后复制到：

```text
你的 Obsidian 仓库目录/.obsidian/plugins/tab-cleaner/
```

请将“你的 Obsidian 仓库目录”替换为实际存放 Obsidian 笔记的文件夹。

重启 Obsidian 或重新加载插件，然后前往“设置 → 第三方插件”启用 **Tab Cleaner**。

## 使用方法

点击 Obsidian 左侧功能区中的清理刷图标，或者在命令面板中运行 **Tab Cleaner: 打开面板**。

1. 选择“全部”“空白”“重复”、已保存的检索组，或者直接输入搜索内容。
2. 决定是否允许选择固定标签页，然后选择当前可见项或逐项勾选。
3. 点击 **关闭所选**。
4. 如果需要找回标签页，可在 **最近关闭** 中重新打开。

“最近关闭”会把同一批次中相同的文件、网址或空白标签页合并为 `×N` 记录；数量表示当时关闭的标签页数量，重新打开时每条记录只恢复一个标签页。

要创建可重复使用的检索组，可以搜索稳定的路径、文件名、扩展名或视图类型，再点击保存图标。已保存的检索组可从当前筛选旁的编辑图标或插件设置页中编辑、删除。

## 安全与隐私

- Tab Cleaner 不会向外部发送数据。
- 插件不会读取或修改笔记内容。
- 设置和最近清理记录只保存在 Obsidian 本地的插件数据文件中。
- 无法安全恢复的非文件视图不会被允许关闭。
- 空白标签页会合并为一条历史记录，重新打开时恢复为一个新的空白标签页。

## 已知限制

- 如果 `×N` 表示多个相同标签页被关闭，重新打开时每条历史记录仍只恢复一个标签页。
- 文件被删除或移动后，对应的最近关闭记录无法重新打开。

## 反馈

请通过 [GitHub Issues](https://github.com/caijyii/obsidian-tab-cleaner/issues) 报告问题或提出功能建议。

## 致谢

产品概念受到 [Tab Out](https://github.com/zarazhangrui/tab-out) 启发。Tab Cleaner 是针对 Obsidian 独立实现的，没有复用 Tab Out 的代码或素材。

## 许可证

[MIT](LICENSE) © 2026 caijyii
