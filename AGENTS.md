# Project Guide

## Sources of Truth

- `src/` contains the plugin source.
- `manifest.json` defines the public plugin identity, version, minimum Obsidian version, and compatibility.
- `versions.json` maps every plugin release to its minimum Obsidian version.
- `main.js` is generated and ignored by Git; publish it only as a release asset.
- `demo-vault/` is local test data and is ignored by Git.

## Verification

Use Node.js 18 or later and pnpm:

```bash
pnpm install
pnpm test
pnpm build
```

Before release, also verify that `package.json`, `manifest.json`, and `versions.json` use the same version and that `main.js`, `manifest.json`, and `styles.css` are attached individually to the GitHub Release.

## Release Rules

- Use semantic versions without a `v` prefix for tags and releases.
- Keep the release tag identical to `manifest.json#version`.
- For new releases, wait for the matching tag's **Build release assets** workflow to pass. Download its `tab-cleaner-VERSION` artifact and publish those exact `main.js`, `manifest.json`, and `styles.css` files individually; do not replace them with a local rebuild.
- Verify each downloaded asset with `gh attestation verify FILE --repo caijyii/obsidian-tab-cleaner`. GitHub Actions builds and attests artifacts but does not publish Releases; release creation remains an explicitly authorized manual action.
- Preserve compatibility with Obsidian 1.8.7 unless a newer minimum version is explicitly approved.
- Do not detach Tab Cleaner leaves during plugin unload; Obsidian must retain the user's chosen panel location.
- Do not include `Obsidian` in the manifest description.
- Command IDs and command labels must not repeat the plugin ID or plugin name; Obsidian prefixes them automatically.
- Do not add network access, telemetry, production dependencies, or desktop-only APIs without explicit approval and corresponding manifest and README updates.
- Do not commit, tag, push, or create a GitHub Release without user approval.
