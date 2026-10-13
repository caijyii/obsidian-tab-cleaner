import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { RELEASE_ASSETS, verifyRelease } from "../scripts/verify-release.mjs";

async function fixture(t, { packageVersion = "1.1.3", manifestVersion = "1.1.3", minAppVersion = "1.8.7", versions = { "1.1.3": "1.8.7" } } = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tab-cleaner-release-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await Promise.all([
    writeFile(path.join(directory, "package.json"), JSON.stringify({ version: packageVersion })),
    writeFile(path.join(directory, "manifest.json"), JSON.stringify({ version: manifestVersion, minAppVersion })),
    writeFile(path.join(directory, "versions.json"), JSON.stringify(versions)),
    writeFile(path.join(directory, "main.js"), "module.exports = {};"),
    writeFile(path.join(directory, "styles.css"), ".tab-cleaner { display: flex; }"),
  ]);
  return { tag: "1.1.3", directory };
}

test("a matching release verifies the exact three individual assets", async (t) => {
  const options = await fixture(t);
  assert.deepEqual(RELEASE_ASSETS, ["main.js", "manifest.json", "styles.css"]);
  assert.deepEqual(await verifyRelease({ ...options, checkAssets: true }), { version: "1.1.3", minAppVersion: "1.8.7" });
});

test("release metadata rejects a tag that differs from either version file", async (t) => {
  for (const overrides of [{ packageVersion: "1.1.2" }, { manifestVersion: "1.1.2" }]) {
    const options = await fixture(t, overrides);
    await assert.rejects(verifyRelease(options), /does not match release tag 1\.1\.3/);
  }
});

test("release metadata requires the version compatibility mapping", async (t) => {
  const options = await fixture(t, { versions: { "1.1.2": "1.8.7" } });
  await assert.rejects(verifyRelease(options), /versions\.json has no entry for 1\.1\.3/);
});

test("release metadata rejects a minimum Obsidian version mismatch", async (t) => {
  const options = await fixture(t, { versions: { "1.1.3": "1.13.0" } });
  await assert.rejects(verifyRelease(options), /does not match manifest\.json minAppVersion 1\.8\.7/);
});

test("release tags follow the repository format without a v prefix", async (t) => {
  const options = await fixture(t);
  for (const tag of [undefined, "v1.1.3", "1.1", "01.1.3", "1.1.3/other"]) {
    await assert.rejects(verifyRelease({ ...options, tag }), /release tag must be a version/);
  }
});

test("metadata can be checked before building but asset verification rejects a missing bundle", async (t) => {
  const options = await fixture(t);
  await rm(path.join(options.directory, "main.js"));
  await verifyRelease(options);
  await assert.rejects(verifyRelease({ ...options, checkAssets: true }), /Release asset main\.js is missing/);
});

test("asset verification rejects an empty stylesheet or a directory posing as an asset", async (t) => {
  const options = await fixture(t);
  await writeFile(path.join(options.directory, "styles.css"), "");
  await assert.rejects(verifyRelease({ ...options, checkAssets: true }), /styles\.css must be a nonempty file/);
  await rm(path.join(options.directory, "styles.css"));
  await mkdir(path.join(options.directory, "styles.css"));
  await assert.rejects(verifyRelease({ ...options, checkAssets: true }), /styles\.css must be a nonempty file/);
});

test("the command exits unsuccessfully when release metadata does not match", async (t) => {
  const options = await fixture(t, { manifestVersion: "1.1.2" });
  const result = spawnSync(process.execPath, [fileURLToPath(new URL("../scripts/verify-release.mjs", import.meta.url)), options.tag], { cwd: options.directory, encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /manifest\.json version 1\.1\.2 does not match release tag 1\.1\.3/);
});
