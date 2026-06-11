import assert from "node:assert/strict";
import { copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";

const fixturesDir = join(process.cwd(), "fixtures", "persona-check");

const runCli = (args, { env } = {}) =>
  spawnSync(
    process.execPath,
    [join(process.cwd(), "bin", "iroharness.mjs"), ...args],
    { cwd: process.cwd(), encoding: "utf8", ...(env ? { env } : {}) },
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
  // 4 violations: 私 / です。/ いたします、(W3: comma counts as a boundary) / 拝承
  assert.match(result.stdout, /violations: 4/);
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
  assert.equal(report.violations.length, 4);
  assert.ok(report.violations[0].rule.kind);
});

test("persona-check rejects --responses without a value instead of silently probing", () => {
  const dir = companionDir();
  const result = runCli(["persona-check", dir, "--responses"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--responses/);
  assert.doesNotMatch(result.stdout, /echo brain/);
});

test("persona-check rejects --responses with an empty value instead of silently probing", () => {
  const dir = companionDir();
  const result = runCli(["persona-check", dir, "--responses", ""]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--responses/);
  assert.doesNotMatch(result.stdout, /echo brain/);
});

test("persona-check rejects --slot without a value instead of falling back to text", () => {
  const dir = companionDir();
  const result = runCli(["persona-check", dir, "--slot"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--slot/);
  assert.doesNotMatch(result.stdout, /slot: text/);
});

test("persona-check rejects --soul without a value", () => {
  const dir = companionDir();
  const result = runCli(["persona-check", dir, "--soul"]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /--soul/);
});

test("persona-check reads the soul file from --soul <path>", () => {
  const dir = companionDir({ soul: null });
  const soulPath = join(dir, "custom-soul.md");
  writeFileSync(
    soulPath,
    "## Vocabulary Rules\n\n- First person: あたし (never 私)\n",
  );
  const responses = join(dir, "responses.jsonl");
  writeFileSync(responses, '{"text":"私だよ。"}\n');
  const result = runCli([
    "persona-check",
    dir,
    "--soul",
    soulPath,
    "--responses",
    responses,
  ]);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /violations: 1/);
  assert.match(result.stdout, /first-person/);
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

// ─── Phase C: --rich (LLM-judged tier, opt-in) ────────────────────────────────

test("persona-check --rich without a judge brain configuration exits 1 with an explanation", () => {
  const dir = companionDir();
  const env = { ...process.env };
  delete env.IROHARNESS_JUDGE_BRAIN_ENDPOINT;
  const result = runCli(["persona-check", dir, "--rich"], { env });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /IROHARNESS_JUDGE_BRAIN_ENDPOINT/);
  assert.match(result.stderr, /LLM/); // the cost warning survives
  assert.doesNotMatch(result.stdout, /echo brain/); // it never silently probed
});

// The server-backed tests use ASYNC spawn: spawnSync would block the parent
// event loop, deadlocking against the in-process judge HTTP server.
const runCliAsync = (args, env) =>
  new Promise((resolvePromise) => {
    const child = spawn(
      process.execPath,
      [join(process.cwd(), "bin", "iroharness.mjs"), ...args],
      { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (status) => resolvePromise({ status, stdout, stderr }));
  });

// A minimal judge brain endpoint speaking the createHttpBrain contract:
// POST in, { text: "<verdict JSON>" } out.
const withJudgeServer = async (verdictFor, run) => {
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      const payload = JSON.parse(body);
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({ text: JSON.stringify(verdictFor(payload)) }),
      );
    });
  });
  await new Promise((resolvePromise) =>
    server.listen(0, "127.0.0.1", resolvePromise),
  );
  try {
    const { port } = server.address();
    await run(`http://127.0.0.1:${port}/judge`);
  } finally {
    await new Promise((resolvePromise) => server.close(resolvePromise));
  }
};

test("persona-check --rich judges responses through the configured endpoint and reports reasons", async () => {
  const dir = companionDir();
  const responses = join(dir, "broke.jsonl");
  writeFileSync(responses, '{"text":"あたしはそう思うよ。"}\n');
  await withJudgeServer(
    () => ({ ok: false, reasons: ["register drifted to keigo"] }),
    async (endpoint) => {
      const result = await runCliAsync(
        ["persona-check", dir, "--rich", "--responses", responses],
        { ...process.env, IROHARNESS_JUDGE_BRAIN_ENDPOINT: endpoint },
      );
      assert.equal(result.status, 1);
      assert.match(result.stdout, /rich/);
      assert.match(result.stdout, /register drifted to keigo/);
    },
  );
});

test("persona-check --rich exits 0 when the judge approves and emits the judge section in --json", async () => {
  const dir = companionDir();
  const responses = join(dir, "clean.jsonl");
  writeFileSync(responses, '{"text":"あたしはそう思うよ。"}\n');
  await withJudgeServer(
    () => ({ ok: true, reasons: [] }),
    async (endpoint) => {
      const result = await runCliAsync(
        ["persona-check", dir, "--rich", "--responses", responses, "--json"],
        { ...process.env, IROHARNESS_JUDGE_BRAIN_ENDPOINT: endpoint },
      );
      assert.equal(result.status, 0);
      const report = JSON.parse(result.stdout);
      assert.equal(report.tier, "rich");
      assert.equal(report.ok, true);
      assert.equal(report.judge.ok, true);
      assert.equal(report.judge.results.length, 1);
    },
  );
});

test("persona-check appears in --help usage", () => {
  const result = runCli(["--help"]);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /persona-check/);
});
