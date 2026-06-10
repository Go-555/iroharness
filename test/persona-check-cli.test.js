import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const fixturesDir = join(process.cwd(), "fixtures", "persona-check");

const runCli = (args) =>
  spawnSync(
    process.execPath,
    [join(process.cwd(), "bin", "iroharness.mjs"), ...args],
    { cwd: process.cwd(), encoding: "utf8" },
  );

const companionDir = ({ soul } = {}) => {
  const dir = mkdtempSync(join(tmpdir(), "persona-check-cli-"));
  if (soul === undefined) {
    copyFileSync(join(fixturesDir, "SOUL.sample.md"), join(dir, "SOUL.md"));
  } else if (soul !== null) {
    writeFileSync(join(dir, "SOUL.md"), soul);
  }
  return dir;
};

test("persona-check fails with violations from a responses file", () => {
  const dir = companionDir();
  const result = runCli([
    "persona-check",
    dir,
    "--responses",
    join(fixturesDir, "responses.violations.jsonl"),
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /violations: 3/);
  assert.match(result.stdout, /first-person/);
  assert.match(result.stdout, /「私」/);
  assert.match(result.stdout, /forbidden/);
});

test("persona-check passes on clean responses", () => {
  const dir = companionDir();
  const responses = join(dir, "clean.jsonl");
  writeFileSync(
    responses,
    '{"text":"あたしはそう思うよ。"}\n{"text":"わかんないなあ、あたしの畑じゃないし。"}\n',
  );
  const result = runCli(["persona-check", dir, "--responses", responses]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /violations: 0/);
  assert.match(result.stdout, /ok/);
});

test("persona-check without a Vocabulary Rules section exits 0 with zero checkable rules", () => {
  const dir = companionDir({ soul: "# SOUL\n\nJust prose, no rules.\n" });
  const result = runCli(["persona-check", dir]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /checkable rules: 0/);
});

test("persona-check without any SOUL.md exits 0 with zero checkable rules", () => {
  const dir = companionDir({ soul: null });
  const result = runCli(["persona-check", dir]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /checkable rules: 0/);
});

test("persona-check probes the local echo brain by default (zero cost)", () => {
  const dir = companionDir();
  const result = runCli(["persona-check", dir, "--slot", "voice"]);
  // The echo brain answers in plain form, so the sample rules pass.
  assert.equal(result.status, 0);
  assert.match(result.stdout, /echo brain/);
  assert.match(result.stdout, /slot: voice/);
});

test("persona-check --json emits the full machine-readable report", () => {
  const dir = companionDir();
  const result = runCli([
    "persona-check",
    dir,
    "--responses",
    join(fixturesDir, "responses.violations.jsonl"),
    "--json",
  ]);
  assert.equal(result.status, 1);
  const report = JSON.parse(result.stdout);
  assert.equal(report.ok, false);
  assert.equal(report.tier, "cheap");
  assert.equal(report.totalRules, 4);
  assert.equal(report.checkableRules, 3);
  assert.equal(report.violations.length, 3);
  assert.ok(report.violations[0].rule.kind);
});

test("persona-check rejects an invalid slot", () => {
  const dir = companionDir();
  const result = runCli(["persona-check", dir, "--slot", "turbo"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /slot/);
});

test("persona-check reports malformed responses files as errors", () => {
  const dir = companionDir();
  const responses = join(dir, "broken.jsonl");
  writeFileSync(responses, "not json\n");
  const result = runCli(["persona-check", dir, "--responses", responses]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /line 1/);
});

test("persona-check --rich is reserved for Phase C and not silently ignored", () => {
  const dir = companionDir();
  const result = runCli(["persona-check", dir, "--rich"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Phase C/);
  assert.match(result.stderr, /LLM/);
});

test("persona-check appears in --help usage", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /persona-check/);
});
