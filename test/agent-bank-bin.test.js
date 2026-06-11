// mekiki W-B: `iroharness bank <list|promote|sweep>` wiring in bin/iroharness.mjs.
// These tests exercise the real bin (spawn), following the cli.test.js style:
// stdout for success, error message + exitCode 1 for refusals, usage in --help.

import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runCli = (args) =>
  spawnSync(
    process.execPath,
    [join(process.cwd(), "bin", "iroharness.mjs"), ...args],
    { cwd: process.cwd(), encoding: "utf8" },
  );

const makeApp = () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-bank-bin-"));
  mkdirSync(join(dir, ".iroharness", "agent-bank"), { recursive: true });
  return dir;
};

const writeRecipe = (appDir, status, id) => {
  const recipeDir = join(appDir, ".iroharness", "agent-bank", status, id);
  mkdirSync(recipeDir, { recursive: true });
  writeFileSync(
    join(recipeDir, "recipe.md"),
    ["---", `id: ${id}`, "role: helper", "---", "", "body", ""].join("\n"),
  );
};

const writePjos = (appDir, runs) => {
  writeFileSync(
    join(appDir, ".iroharness", "pjos.json"),
    `${JSON.stringify({ tickets: [], runs, artifacts: [] }, null, 2)}\n`,
  );
};

test("usage documents the bank subcommands", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /iroharness bank list \[dir\] \[--all\]/);
  assert.match(
    result.stdout,
    /iroharness bank promote <id> \[dir\] \[--owner-approve\]/,
  );
  assert.match(
    result.stdout,
    /iroharness bank sweep \[dir\] \[--max-idle-days <days>\] \[--dry-run\]/,
  );
});

test("bank list renders the index for the app's bank", () => {
  const appDir = makeApp();
  writeRecipe(appDir, "active", "tax-v3");
  writeRecipe(appDir, "staging", "ma-v1");
  writeRecipe(appDir, "archived", "retired-v0");

  const result = runCli(["bank", "list", appDir]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /tax-v3/);
  assert.match(result.stdout, /ma-v1/);
  assert.doesNotMatch(result.stdout, /retired-v0/); // archived hidden by default
});

test("bank list --all includes archived recipes", () => {
  const appDir = makeApp();
  writeRecipe(appDir, "archived", "retired-v0");

  const result = runCli(["bank", "list", appDir, "--all"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /retired-v0/);
});

test("bank promote without an id fails with usage and exit 1", () => {
  const appDir = makeApp();

  const result = runCli(["bank", "promote", appDir]);

  // `promote <id>` — the dir positional cannot be mistaken for the id, so the
  // appDir here is consumed as the id and refused (not found / invalid), OR
  // a missing id yields usage. Either way: refusal with exit 1, no promotion.
  assert.equal(result.status, 1);
});

test("bank promote refuses when the composite gate is not satisfied", () => {
  const appDir = makeApp();
  writeRecipe(appDir, "staging", "weak");
  writePjos(appDir, []);

  const result = runCli(["bank", "promote", "weak", appDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /not promoted/i);
  // still in staging
  const recipe = readFileSync(
    join(appDir, ".iroharness", "agent-bank", "staging", "weak", "recipe.md"),
    "utf8",
  );
  assert.match(recipe, /id: weak/);
});

test("bank sweep archives a stale active recipe via the real bin", () => {
  const appDir = makeApp();
  writeRecipe(appDir, "active", "stale");
  writeRecipe(appDir, "active", "fresh");
  writePjos(appDir, [
    {
      harnessId: "stale",
      status: "completed",
      output: null,
      updatedAt: "2020-01-01T00:00:00Z", // long past any window
    },
    {
      harnessId: "fresh",
      status: "completed",
      output: null,
      updatedAt: new Date().toISOString(),
    },
  ]);

  const result = runCli(["bank", "sweep", appDir]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /archived stale/);
  const archived = readFileSync(
    join(appDir, ".iroharness", "agent-bank", "archived", "stale", "recipe.md"),
    "utf8",
  );
  assert.match(archived, /id: stale/);
  const fresh = readFileSync(
    join(appDir, ".iroharness", "agent-bank", "active", "fresh", "recipe.md"),
    "utf8",
  );
  assert.match(fresh, /id: fresh/);
});

test("bank sweep --dry-run reports without moving", () => {
  const appDir = makeApp();
  writeRecipe(appDir, "active", "stale");
  writePjos(appDir, [
    {
      harnessId: "stale",
      status: "completed",
      output: null,
      updatedAt: "2020-01-01T00:00:00Z",
    },
  ]);

  const result = runCli(["bank", "sweep", appDir, "--dry-run"]);

  assert.equal(result.status, 0);
  assert.match(result.stdout, /would archive stale/);
  const recipe = readFileSync(
    join(appDir, ".iroharness", "agent-bank", "active", "stale", "recipe.md"),
    "utf8",
  );
  assert.match(recipe, /id: stale/);
});

test("an unknown bank action fails with exit 1 and the usage text", () => {
  const appDir = makeApp();

  const result = runCli(["bank", "frobnicate", appDir]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Unknown bank action/i);
});
