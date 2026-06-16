import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";

import {
  buildXurlSearchQuery,
  createXurlReadOnlyResearchRunner,
  createXurlResearchContext,
  shouldUseXurlResearch,
} from "../src/voice-pipeline/xurl-research.js";

const createSpawnStub = ({ code = 0, stdout = "", stderr = "" } = {}) => {
  const calls = [];
  const spawnImpl = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => {};
    queueMicrotask(() => {
      if (stdout) child.stdout.emit("data", Buffer.from(stdout));
      if (stderr) child.stderr.emit("data", Buffer.from(stderr));
      child.emit("close", code);
    });
    return child;
  };
  spawnImpl.calls = calls;
  return spawnImpl;
};

test("shouldUseXurlResearch detects X and Twitter research requests", () => {
  assert.equal(
    shouldUseXurlResearch({
      task: { type: "x_research", prompt: "AI agentを調べて" },
    }),
    true,
  );
  assert.equal(
    shouldUseXurlResearch({
      task: { prompt: "XでAI agentについて調べて" },
    }),
    true,
  );
  assert.equal(
    shouldUseXurlResearch({
      task: { prompt: "今日の天気を調べて" },
    }),
    false,
  );
});

test("buildXurlSearchQuery removes command words but keeps topic", () => {
  const query = buildXurlSearchQuery({
    task: { prompt: "XでAI agent lang:jaについて調べて、Slackに送っておいて" },
  });

  assert.match(query, /AI agent/);
  assert.match(query, /lang:ja/);
  assert.doesNotMatch(query, /Slackに送って/);
});

test("xurl read-only runner calls search with bounded result count", async () => {
  const spawnImpl = createSpawnStub({ stdout: "{\"data\":[]}" });
  const runner = createXurlReadOnlyResearchRunner({
    command: "xurl",
    maxResults: 3,
    spawnImpl,
  });

  const result = await runner.search({ query: "AI agent lang:ja" });

  assert.equal(result.ok, true);
  assert.deepEqual(spawnImpl.calls[0].args, ["search", "AI agent lang:ja", "-n", "10"]);
  assert.equal(result.stdout, "{\"data\":[]}");
});

test("xurl read-only runner returns unauthorized failure as context", async () => {
  const spawnImpl = createSpawnStub({
    code: 1,
    stderr: "{\"status\":401,\"detail\":\"Unauthorized\"}",
  });
  const runner = createXurlReadOnlyResearchRunner({ spawnImpl });

  const result = await runner.search({ query: "AI" });
  const context = createXurlResearchContext({ xurlResult: result });

  assert.equal(result.ok, false);
  assert.match(context, /XURL_SEARCH_FAILED/);
  assert.match(context, /Unauthorized/);
  assert.match(context, /web_search fallback/);
});
