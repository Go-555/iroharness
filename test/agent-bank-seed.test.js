import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBankRegistry } from "../src/agent-bank/registry.js";
import { seedHarnessRecipe } from "../src/agent-bank/seed.js";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-seed-"));

test("seedHarnessRecipe registers a builtin harness as an active recipe", () => {
  const root = makeBank();
  const harness = {
    capabilities: ["code", "files", "review"],
    run: async () => "ok",
  };

  seedHarnessRecipe({ root, id: "codex", role: "coding worker", harness });

  const bank = createBankRegistry({ root });
  assert.deepEqual(bank.list("active"), ["codex"]);
  assert.deepEqual(bank.read("codex").recipe.toolset, [
    "code",
    "files",
    "review",
  ]);
  assert.equal(bank.read("codex").recipe.role, "coding worker");
});

// Non-destructive: seeding must not alter the harness; the existing direct
// delegation path keeps working. The Bank entry is a parallel, additive route.
test("seedHarnessRecipe does not mutate the harness (existing delegation unchanged)", async () => {
  const root = makeBank();
  const run = async () => "delegated";
  const harness = { capabilities: ["code"], run };

  seedHarnessRecipe({ root, id: "codex", role: "coder", harness });

  assert.equal(harness.run, run);
  assert.equal(await harness.run(), "delegated");
  assert.deepEqual(harness.capabilities, ["code"]);
});

// Fix 3: seeding with a traversal id must not write outside the bank root.
test("seedHarnessRecipe rejects path-traversal ids", () => {
  const root = makeBank();
  const harness = { capabilities: ["code"], run: async () => "ok" };

  assert.throws(
    () => seedHarnessRecipe({ root, id: "../escape", role: "x", harness }),
    /invalid recipe id/i,
  );
});
