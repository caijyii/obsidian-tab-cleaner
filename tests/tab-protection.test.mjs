import test from "node:test";
import assert from "node:assert/strict";
import { defaultSelected, tabProtectionReason } from "../src/tab-protection.ts";

const settings = {
  pinnedProtection: "always",
  protectActiveTab: true,
};

function tab(overrides = {}) {
  return {
    isRestorable: true,
    isEmpty: false,
    isPinned: false,
    isActive: false,
    ...overrides,
  };
}

test("protects the active tab from manual and default selection", () => {
  const active = tab({ isActive: true });

  assert.equal(tabProtectionReason(active, settings), "active");
  assert.equal(defaultSelected(active, settings), false);
});

test("allows selecting the active tab when protection is disabled", () => {
  const active = tab({ isActive: true });
  const unprotected = { ...settings, protectActiveTab: false };

  assert.equal(tabProtectionReason(active, unprotected), null);
  assert.equal(defaultSelected(active, unprotected), true);
});
