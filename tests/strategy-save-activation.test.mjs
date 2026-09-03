import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("activates a newly saved search group through the normal filter path", () => {
  const source = fs.readFileSync(new URL("../src/view.ts", import.meta.url), "utf8");
  const saveDialog = source.match(
    /new StrategyModal\(this\.plugin, \{\s*query: this\.query,\s*onChanged: \(strategyId\) => \{([\s\S]*?)\}\s*,?\s*\}\)\.open\(\)/,
  );

  assert.ok(saveDialog, "expected to find the save-search StrategyModal callback");
  assert.match(saveDialog[1], /this\.activateFilter\(strategyId \?\? "all"\)/);
});
