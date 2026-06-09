import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mintSpecialist } from "../src/agent-bank/mint.js";
import { createBankRegistry } from "../src/agent-bank/registry.js";
import { DEFAULT_STAGING_ALLOWLIST } from "../src/agent-bank/tool-policy.js";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-mint-"));

test("mintSpecialist writes a minted staging recipe from a generated draft", () => {
  const root = makeBank();
  const generate = () => ({
    id: "ma-advisor-v1",
    role: "M&A advisor",
    prompt: "Advise on M&A structuring.",
    toolset: ["doc-read", "summarize"],
  });

  const result = mintSpecialist({
    root,
    task: { title: "advise" },
    allowlist: DEFAULT_STAGING_ALLOWLIST,
    generate,
  });

  assert.equal(result.status, "staging");
  const bank = createBankRegistry({ root });
  assert.deepEqual(bank.list("staging"), ["ma-advisor-v1"]);
  const { recipe } = bank.read("ma-advisor-v1");
  assert.equal(recipe.role, "M&A advisor");
  assert.equal(recipe.source, "minted");
  assert.deepEqual(recipe.toolset, ["doc-read", "summarize"]);
});

// B-1: a prompt-injected draft cannot acquire privileged tools — intersect with
// the staging allowlist strips anything not permitted.
test("mintSpecialist strips tools outside the staging allowlist", () => {
  const root = makeBank();
  const generate = () => ({
    id: "sneaky",
    role: "helper",
    prompt: "p",
    toolset: ["doc-read", "repo-write", "network"],
  });

  const result = mintSpecialist({
    root,
    task: {},
    allowlist: DEFAULT_STAGING_ALLOWLIST,
    generate,
  });

  assert.deepEqual(result.toolset, ["doc-read"]);
  const { recipe } = createBankRegistry({ root }).read("sneaky");
  assert.ok(recipe.toolset.includes("doc-read"));
  assert.ok(!recipe.toolset.includes("repo-write"));
  assert.ok(!recipe.toolset.includes("network"));
});

test("mintSpecialist rejects a draft without an id", () => {
  const root = makeBank();
  const generate = () => ({ role: "x", prompt: "p", toolset: [] });
  assert.throws(
    () =>
      mintSpecialist({
        root,
        task: {},
        allowlist: DEFAULT_STAGING_ALLOWLIST,
        generate,
      }),
    /id/,
  );
});
