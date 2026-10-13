import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const RELEASE_ASSETS = Object.freeze(["main.js", "manifest.json", "styles.css"]);

const releaseVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export async function verifyRelease({ tag, directory = process.cwd(), checkAssets = false }) {
  if (typeof tag !== "string" || !releaseVersion.test(tag)) {
    throw new Error("The release tag must be a version such as 1.1.3, without a v prefix.");
  }

  const [packageJson, manifest, versions] = await Promise.all(
    ["package.json", "manifest.json", "versions.json"].map(async (file) =>
      JSON.parse(await readFile(path.join(directory, file), "utf8")),
    ),
  );

  for (const [file, version] of [["package.json", packageJson.version], ["manifest.json", manifest.version]]) {
    if (version !== tag) throw new Error(`${file} version ${String(version)} does not match release tag ${tag}.`);
  }

  if (!Object.hasOwn(versions, tag)) throw new Error(`versions.json has no entry for ${tag}.`);
  if (typeof manifest.minAppVersion !== "string" || !releaseVersion.test(manifest.minAppVersion)) {
    throw new Error("manifest.json must declare a valid minAppVersion.");
  }
  if (versions[tag] !== manifest.minAppVersion) {
    throw new Error(`versions.json entry for ${tag} does not match manifest.json minAppVersion ${manifest.minAppVersion}.`);
  }

  if (checkAssets) {
    for (const file of RELEASE_ASSETS) {
      let info;
      try {
        info = await stat(path.join(directory, file));
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
        throw new Error(`Release asset ${file} is missing.`);
      }
      if (!info.isFile() || info.size === 0) throw new Error(`Release asset ${file} must be a nonempty file.`);
    }
  }

  return { version: tag, minAppVersion: manifest.minAppVersion };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [tag, ...flags] = process.argv.slice(2);
  try {
    if (flags.some((flag) => flag !== "--assets") || flags.length > 1) {
      throw new Error("Usage: node scripts/verify-release.mjs VERSION [--assets]");
    }
    const release = await verifyRelease({ tag, checkAssets: flags.includes("--assets") });
    console.log(`Verified release ${release.version} (Obsidian ${release.minAppVersion}+).`);
    if (flags.includes("--assets")) console.log(`Verified assets: ${RELEASE_ASSETS.join(", ")}.`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
