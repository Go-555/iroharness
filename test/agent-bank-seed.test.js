import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBankRegistry } from "../src/agent-bank/registry.js";
import { originOf, seedHarnessRecipe } from "../src/agent-bank/seed.js";

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

// Bantou re-audit Fix B: the status argument is whitelist-validated, so a
// crafted status cannot path-traverse outside the bank root either.
test("seedHarnessRecipe rejects a status outside BANK_STATUSES", () => {
  // root sits one level inside a fresh tempdir so `root/../escaped` is a
  // location this test fully controls (no tmpdir pollution).
  const root = join(makeBank(), "bank");
  const harness = { capabilities: ["code"], run: async () => "ok" };

  for (const bad of ["../escaped", "..", "active/../..", "", undefined]) {
    if (bad === undefined) {
      continue; // undefined falls back to the default "active" — allowed
    }
    assert.throws(
      () =>
        seedHarnessRecipe({ root, id: "ok", role: "x", harness, status: bad }),
      /status/i,
      `status: ${JSON.stringify(bad)}`,
    );
  }
  assert.equal(existsSync(join(root, "..", "escaped")), false);
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

// B-1: seeding records the builtin id in seed-manifest.json at the bank root —
// outside any recipe folder, so frontmatter cannot taint it. That manifest is
// the single authority for origin (builtin vs minted).
test("seedHarnessRecipe records the id in seed-manifest.json at the bank root", () => {
  const root = makeBank();
  const harness = { capabilities: ["code"], run: async () => "ok" };

  seedHarnessRecipe({ root, id: "codex", role: "coder", harness });
  seedHarnessRecipe({ root, id: "claude", role: "reviewer", harness });
  // re-seeding must not duplicate the entry
  seedHarnessRecipe({ root, id: "codex", role: "coder", harness });

  const manifest = JSON.parse(
    readFileSync(join(root, "seed-manifest.json"), "utf8"),
  );
  assert.deepEqual(manifest.builtins, ["codex", "claude"]);
});

test("originOf reports builtin only for manifest-recorded ids (fail-safe minted)", () => {
  const root = makeBank();
  const harness = { capabilities: ["code"], run: async () => "ok" };
  seedHarnessRecipe({ root, id: "codex", role: "coder", harness });

  assert.equal(originOf({ root, id: "codex" }), "builtin");
  // not in the manifest -> minted, regardless of any frontmatter claim
  assert.equal(originOf({ root, id: "impostor" }), "minted");
});

test("originOf is fail-safe when no manifest exists", () => {
  const root = makeBank();
  assert.equal(originOf({ root, id: "anything" }), "minted");
});

// Fix 3 / requirement 5: ids flowing through the manifest are validated.
test("originOf validates the queried id and ignores tainted manifest entries", () => {
  const root = makeBank();
  writeFileSync(
    join(root, "seed-manifest.json"),
    JSON.stringify({ builtins: ["../escape", "ok-id"] }),
  );

  assert.throws(
    () => originOf({ root, id: "../escape" }),
    /invalid recipe id/i,
  );
  // a tainted entry never grants builtin status, valid entries still work
  assert.equal(originOf({ root, id: "ok-id" }), "builtin");
});
