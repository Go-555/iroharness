import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { evaluatePromotion } from "../src/agent-bank/promotion.js";
import { createBankRegistry } from "../src/agent-bank/registry.js";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-"));

// A genuine passing verdict from the single composite gate.
const passingVerdict = () =>
  evaluatePromotion({
    ledgerEntry: { calls: 3, success: 3, avgScore: 4.6 },
    sandboxVerified: true,
    securityReview: { passed: true, by: "bantou" },
    origin: "builtin",
  });

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

test("move relocates a recipe from staging to active with a passing gate verdict", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "delta");
  const bank = createBankRegistry({ root });

  bank.move("delta", "active", { promotion: passingVerdict() });

  assert.deepEqual(bank.list("staging"), []);
  assert.deepEqual(bank.list("active"), ["delta"]);
  assert.equal(bank.read("delta").status, "active");
});

// Fix 1 (W-5): the raw folder move must NOT be a bypass around the composite
// promotion gate. Moving to active without a passing verdict throws.
test("move to active throws without a promotion verdict", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "delta");
  const bank = createBankRegistry({ root });

  assert.throws(() => bank.move("delta", "active"), /promotion|gate/i);
  assert.deepEqual(bank.list("staging"), ["delta"]);
  assert.deepEqual(bank.list("active"), []);
});

test("move to active rejects a forged verdict object", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "delta");
  const bank = createBankRegistry({ root });

  assert.throws(
    () =>
      bank.move("delta", "active", {
        promotion: { promote: true, reasons: [] },
      }),
    /promotion|gate/i,
  );
  assert.deepEqual(bank.list("staging"), ["delta"]);
});

test("move to active rejects a failing verdict from the real gate", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "delta");
  const bank = createBankRegistry({ root });
  const failing = evaluatePromotion({}); // everything fails

  assert.throws(
    () => bank.move("delta", "active", { promotion: failing }),
    /promotion|gate/i,
  );
});

test("move to non-active statuses keeps working without a verdict", () => {
  const root = makeBank();
  writeRecipe(root, "active", "tired");
  const bank = createBankRegistry({ root });

  bank.move("tired", "archived");

  assert.equal(bank.read("tired").status, "archived");
});

// Fix 3: recipe ids are validated at every registry entry point so a crafted
// id cannot traverse outside the status folders.
test("read rejects path-traversal and malformed ids", () => {
  const root = makeBank();
  const bank = createBankRegistry({ root });

  for (const bad of ["../foo", "..", ".", "a/b", "a\\b", "", ".hidden"]) {
    assert.throws(
      () => bank.read(bad),
      /invalid recipe id/i,
      `id: ${JSON.stringify(bad)}`,
    );
  }
});

test("move rejects path-traversal ids", () => {
  const root = makeBank();
  const bank = createBankRegistry({ root });

  assert.throws(() => bank.move("../escape", "archived"), /invalid recipe id/i);
});

// Fix 4: cell values containing "|" must not break the markdown index table.
test("renderIndex escapes pipe characters in cell values", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "alpha", "role: a|b");
  const bank = createBankRegistry({ root });

  const index = bank.renderIndex();

  assert.match(index, /a\\\|b/);
  assert.doesNotMatch(index, /\| a\|b \|/);
});

test("renderIndex lists staging and active recipes, excluding archived by default", () => {
  const root = makeBank();
  writeRecipe(root, "staging", "alpha");
  writeRecipe(root, "active", "beta");
  writeRecipe(root, "archived", "old-one");
  const bank = createBankRegistry({ root });

  const index = bank.renderIndex();

  assert.match(index, /alpha/);
  assert.match(index, /beta/);
  assert.doesNotMatch(index, /old-one/);
});

test("renderIndex includes archived when requested", () => {
  const root = makeBank();
  writeRecipe(root, "archived", "old-one");
  const bank = createBankRegistry({ root });

  const index = bank.renderIndex({ includeArchived: true });

  assert.match(index, /old-one/);
});
