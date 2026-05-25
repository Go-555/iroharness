import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const runCli = (args) =>
  spawnSync(process.execPath, [join(process.cwd(), "bin", "iroharness.mjs"), ...args], {
    cwd: process.cwd(),
    encoding: "utf8"
  });

test("CLI init creates a minimal IroHarness app", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-init-"));
  const appDir = join(dir, "companion");

  const result = runCli(["init", appDir, "--name", "companion-app", "--character", "Iroha"]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Created companion-app/);
  assert.equal(existsSync(join(appDir, "package.json")), true);
  assert.equal(existsSync(join(appDir, "src", "app.mjs")), true);
  assert.equal(existsSync(join(appDir, "SOUL.md")), true);
  assert.equal(existsSync(join(appDir, "IDENTITY.md")), true);
  assert.equal(existsSync(join(appDir, "MEMORY.md")), true);
  assert.equal(existsSync(join(appDir, ".iroharness")), true);

  const packageJson = JSON.parse(readFileSync(join(appDir, "package.json"), "utf8"));
  const app = readFileSync(join(appDir, "src", "app.mjs"), "utf8");

  assert.equal(packageJson.dependencies.iroharness, "^0.1.0");
  assert.match(app, /createFileCharacterProfile/);
  assert.match(app, /createIroHarness/);
  assert.match(app, /name: "Iroha"/);
  assert.match(app, /createFileProjectOs/);
});

test("CLI init refuses to overwrite generated files without force", () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-init-existing-"));
  const first = runCli(["init", dir]);
  const second = runCli(["init", dir]);

  assert.equal(first.status, 0, first.stderr);
  assert.notEqual(second.status, 0);
  assert.match(second.stderr, /already exists/);
});
