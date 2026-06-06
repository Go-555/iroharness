import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createBankRegistry } from "../src/agent-bank/registry.js";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-"));

const writeRecipe = (root, status, id, extraFrontmatter = "") => {
  const dir = join(root, status, id);
  mkdirSync(dir, { recursive: true });
  const md = [
    "---",
    `id: ${id}`,
    "role: helper",
    extraFrontmatter,
    "---",
    "",
    "body",
    "",
  ].join("\n");
  writeFileSync(join(dir, "recipe.md"), md);
};

test("list returns empty for a fresh bank", () => {
  const root = makeBank();
  const bank = createBankRegistry({ root });
  assert.deepEqual(bank.list("staging"), []);
});

test("list returns ids present in a status folder", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "alpha");
  writeRecipe(root, "staging", "beta");
  const bank = createBankRegistry({ root });
  assert.deepEqual(bank.list("staging").sort(), ["alpha", "beta"]);
});

test("read finds a recipe across statuses and reports its folder", () => {
  const root = makeBank();
  writeRecipe(root, "active", "gamma");
  const bank = createBankRegistry({ root });
  const found = bank.read("gamma");
  assert.equal(found.status, "active");
  assert.equal(found.recipe.id, "gamma");
  assert.equal(found.recipe.role, "helper");
});

test("move relocates a recipe from staging to active", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "delta");
  const bank = createBankRegistry({ root });

  bank.move("delta", "active");

  assert.deepEqual(bank.list("staging"), []);
  assert.deepEqual(bank.list("active"), ["delta"]);
  assert.equal(bank.read("delta").status, "active");
});
