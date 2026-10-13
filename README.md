# Tab Cleaner for Obsidian

[English](README.md) | [简体中文](README.zh-CN.md)

Tab Cleaner is a visual workspace for reviewing and safely closing groups of Obsidian tabs.

![Tab Cleaner workflow demo](assets/tab-cleaner-demo-en.gif)

## Features

- Visual list of tabs in the main workspace
- Built-in Empty and Duplicates search groups that can be unpinned
- Search by path, file name, extension, or view type
- Reusable search groups that can be pinned, edited, or removed
- Quick toggles for pinned-tab and active-tab protection in the cleaner panel
- Active-tab protection by default
- Recently closed cleanup batches with one-click reopening
- Simplified Chinese and English interfaces based on the Obsidian language
- Safe closing boundary: only empty tabs and file-backed tabs can be selected

Empty tabs are grouped into Recently closed and can be reopened as a new empty tab. Sidebar tools and the Tab Cleaner panel itself are never included.

## Requirements

- Obsidian 1.8.7 or later
- Designed for desktop and mobile; currently tested on macOS

Back up important work and test the workflows you rely on before introducing any tab-management plugin to an important vault.

## Install

### Community Plugins

Tab Cleaner is available in the Obsidian Community Plugins directory:

1. Open **Settings → Community plugins** in Obsidian.
2. Choose **Browse** and search for **Tab Cleaner**.
3. Choose **Install**, then enable the plugin.

### BRAT

To test a GitHub release directly, install it with [BRAT](https://github.com/TfTHacker/obsidian42-brat):

1. Install and enable BRAT.
2. Choose **Add Beta plugin** in the BRAT settings.
3. Enter `https://github.com/caijyii/obsidian-tab-cleaner`.

### Manual installation

Download `main.js`, `manifest.json`, and `styles.css` from the matching [GitHub release](https://github.com/caijyii/obsidian-tab-cleaner/releases), then copy them into:

```text
YOUR_OBSIDIAN_VAULT/.obsidian/plugins/tab-cleaner/
```

Replace `YOUR_OBSIDIAN_VAULT` with the folder that contains your Obsidian notes.

Restart Obsidian or reload plugins, then enable **Tab Cleaner** under Settings → Community plugins.

## Usage

Open the ribbon brush icon or run **Tab Cleaner: Open panel** from the command palette.

1. Choose All, Empty, Duplicates, a custom search group, or enter a search.
2. Use the protection toggles above the tab list to choose whether pinned and active tabs can be selected, then select visible tabs or adjust them individually.
3. Choose **Close selected**.
4. Reopen tabs later from **Recently closed** if needed.

Recently closed consolidates repeated instances of the same file, URL, or empty-tab type into an `×N` record. The count describes how many tabs were closed; reopening restores one tab per record.

To create a reusable search group, search for a stable path, file name, extension, or view type, then choose the save icon. Edit or delete saved groups from the pencil beside an active filter or from the plugin settings.

Empty and Duplicates are built-in search groups pinned to top by default. Use the pin toggles in the plugin settings for built-in and custom groups. Only available up and down buttons are shown: the first has no up button, the last has no down button, and a single pinned group has no ordering buttons. Unpinned groups follow recent usage, including built-in groups. All groups remain visible when the panel is wide enough. When space is limited, the current group and pinned groups take priority; additional groups are available through More search groups.

Pinned groups use a subtle accent tint. All and unpinned groups share the same subtle neutral background and hover color, whether built-in or custom. Selected groups share the theme's accent text color, an underline, and slightly heavier text while retaining their own light background, keeping pin status recognizable. Drag pinned groups horizontally to reorder them without switching the active group. The management dialog also provides up and down buttons, including for groups hidden in the panel. Pinning and order changes for existing groups save immediately. After editing a custom group's name, choose the check icon beside the name to save it. Closing the dialog discards only an unconfirmed name. New groups still require Save to create them.

The current group's management icon sits beside the list heading. It appears on hover or keyboard focus and stays visible on touchscreens. Its space is reserved, so revealing it does not shift the heading or the group tabs above.

Protection disables only a tab's checkbox. Click its name or details to reveal it in the workspace. The pinned icon and active-tab marker use the theme accent color. The active marker appears to the right of the pinned icon and remains visible whether active-tab protection is enabled or disabled.

Both tab-protection shortcuts have transparent backgrounds. Enabled protection uses accent-colored icons without a slash; disabled protection uses muted icons with a slash.

## Safety and privacy

- Tab Cleaner does not send data anywhere.
- It does not read or modify note contents.
- Settings and recent cleanup history stay in Obsidian's local plugin data file.
- Non-file views that cannot be safely restored are excluded from closing.
- Empty tabs are saved as an aggregated history entry and reopen as one new empty tab.

## Known limitations

- Reopening a cleanup batch restores one tab per history entry, even if `×N` indicates that several equivalent tabs were closed.
- A recently closed file cannot be reopened after the file has been deleted or moved.

## Feedback

Please report bugs and feature requests in [GitHub Issues](https://github.com/caijyii/obsidian-tab-cleaner/issues).

## Acknowledgements

The product concept was inspired by [Tab Out](https://github.com/zarazhangrui/tab-out).

## License

[MIT](LICENSE) © 2026 caijyii
