// mekiki W-D: shouldDecay was a predicate with no executor. sweepDecayedRecipes
// walks ALL active recipes, joins them against the beads-derived ledger, and
// moves the decayed ones to archived/ (retirement needs no promotion verdict —
// only the move INTO active is gated).

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBankRegistry } from "../src/agent-bank/registry.js";
import { sweepDecayedRecipes } from "../src/agent-bank/sweep.js";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-sweep-"));

const writeRecipe = (root, status, id) => {
  const dir = join(root, status, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "recipe.md"),
    ["---", `id: ${id}`, "role: helper", "---", "", "body", ""].join("\n"),
  );
};

const runFor = (harnessId, updatedAt) => ({
  harnessId,
  status: "completed",
  output: null,
  updatedAt,
});

const NOW = "2026-06-10T00:00:00Z";

test("sweep moves decayed actives to archived and keeps fresh ones", () => {
  const root = makeBank();
  writeRecipe(root, "active", "stale");
  writeRecipe(root, "active", "fresh");
  const projectOs = {
    snapshot: () => ({
      runs: [
        runFor("stale", "2026-01-01T00:00:00Z"), // idle far beyond 30 days
        runFor("fresh", "2026-06-09T00:00:00Z"),
      ],
    }),
  };

  const result = sweepDecayedRecipes({
    root,
    projectOs,
    now: NOW,
    maxIdleDays: 30,
  });

  assert.deepEqual(result.decayed, ["stale"]);
  assert.deepEqual(result.kept, ["fresh"]);
  const registry = createBankRegistry({ root });
  assert.deepEqual(registry.list("archived"), ["stale"]);
  assert.deepEqual(registry.list("active"), ["fresh"]);
});

test("sweep --dry-run reports decay candidates without moving anything", () => {
  const root = makeBank();
  writeRecipe(root, "active", "stale");
  const projectOs = {
    snapshot: () => ({ runs: [runFor("stale", "2026-01-01T00:00:00Z")] }),
  };

  const result = sweepDecayedRecipes({
    root,
    projectOs,
    now: NOW,
    maxIdleDays: 30,
    dryRun: true,
  });

  assert.deepEqual(result.decayed, ["stale"]);
  assert.equal(result.dryRun, true);
  const registry = createBankRegistry({ root });
  assert.deepEqual(registry.list("active"), ["stale"]); // untouched
  assert.deepEqual(registry.list("archived"), []);
});

// Known behavior, pinned (not changed): an active recipe with NO ledger entry —
// promoted but never used since — has no lastUsed, shouldDecay returns false,
// and the sweep keeps it forever ("immortal"). Documented in sweep.js JSDoc.
test("sweep keeps a never-used active recipe (no lastUsed -> immortal)", () => {
  const root = makeBank();
  writeRecipe(root, "active", "never-used");
  const projectOs = { snapshot: () => ({ runs: [] }) };

  const result = sweepDecayedRecipes({
    root,
    projectOs,
    now: "2099-01-01T00:00:00Z",
    maxIdleDays: 30,
  });

  assert.deepEqual(result.decayed, []);
  assert.deepEqual(result.kept, ["never-used"]);
  assert.deepEqual(createBankRegistry({ root }).list("active"), ["never-used"]);
});

test("sweep only looks at active/ — staging and archived are untouched", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "trialing");
  writeRecipe(root, "archived", "already-retired");
  const projectOs = {
    snapshot: () => ({
      runs: [
        runFor("trialing", "2026-01-01T00:00:00Z"),
        runFor("already-retired", "2026-01-01T00:00:00Z"),
      ],
    }),
  };

  const result = sweepDecayedRecipes({
    root,
    projectOs,
    now: NOW,
    maxIdleDays: 30,
  });

  assert.deepEqual(result.decayed, []);
  assert.deepEqual(result.kept, []);
  const registry = createBankRegistry({ root });
  assert.deepEqual(registry.list("staging"), ["trialing"]);
  assert.deepEqual(registry.list("archived"), ["already-retired"]);
});

test("sweep works without a project OS (no runs -> nothing decays)", () => {
  const root = makeBank();
  writeRecipe(root, "active", "lonely");

  const result = sweepDecayedRecipes({ root, now: NOW, maxIdleDays: 30 });

  assert.deepEqual(result.decayed, []);
  assert.deepEqual(result.kept, ["lonely"]);
});
