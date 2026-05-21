import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createHttpMicroHarness,
  createJsonlProcessMicroHarness
} from "../src/adapters/index.js";

test("HTTP micro harness posts task context and normalizes response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_endpoint, options) => {
    const payload = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          status: "completed",
          summary: `received ${payload.task.id}`,
          artifacts: [{ kind: "log", uri: "memory://run", title: "Run log" }]
        });
      }
    };
  };

  const harness = createHttpMicroHarness({
    id: "openclaw",
    endpoint: "http://127.0.0.1:8787/run",
    capabilities: ["assistant"]
  });

  try {
    const output = await harness.run({ id: "ticket_1" }, { character: { id: "iroha" } });
    assert.equal(output.status, "completed");
    assert.equal(output.summary, "received ticket_1");
    assert.equal(output.artifacts.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("JSONL process micro harness sends one task and parses final JSON line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-process-"));
  const scriptPath = join(dir, "worker.mjs");
  writeFileSync(
    scriptPath,
    [
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk.toString('utf8'); });",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  console.log(JSON.stringify({",
      "    status: 'completed',",
      "    summary: `processed ${payload.task.id}`,",
      "    artifacts: []",
      "  }));",
      "});"
    ].join("\n"),
    "utf8"
  );
  chmodSync(scriptPath, 0o755);

  const harness = createJsonlProcessMicroHarness({
    id: "hermes",
    command: process.execPath,
    args: [scriptPath],
    capabilities: ["learning"]
  });

  const output = await harness.run({ id: "ticket_2" }, { character: { id: "iroha" } });
  assert.equal(output.status, "completed");
  assert.equal(output.summary, "processed ticket_2");
});
