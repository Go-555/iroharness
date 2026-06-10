import assert from "node:assert/strict";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { mintSpecialist } from "../src/agent-bank/mint.js";
import { createBankRegistry } from "../src/agent-bank/registry.js";
import { originOf } from "../src/agent-bank/seed.js";
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
  assert.deepEqual(recipe.toolset, ["doc-read", "summarize"]);
  // B-1 source quarantine: `source` is advisory frontmatter only — the parser
  // quarantines it into `declared`, and the authoritative origin is "minted"
  // because the id is NOT in the seed manifest (fail-safe).
  assert.equal(recipe.source, undefined);
  assert.equal(recipe.declared.source, "minted");
  assert.equal(originOf({ root, id: "ma-advisor-v1" }), "minted");
});

// B-1: a minted recipe's identity comes from seed-manifest absence, not from
// anything the draft claims. A draft that self-declares a builtin source still
// mints as "minted" — there is no field a generator can set to become builtin.
test("mintSpecialist origin stays minted even when the draft claims builtin", () => {
  const root = makeBank();
  const generate = () => ({
    id: "impostor",
    role: "helper",
    prompt: "p",
    toolset: ["doc-read"],
    source: "builtin-harness", // ignored: mint never copies draft.source
  });

  mintSpecialist({
    root,
    task: {},
    allowlist: DEFAULT_STAGING_ALLOWLIST,
    generate,
  });

  assert.equal(originOf({ root, id: "impostor" }), "minted");
  const { recipe } = createBankRegistry({ root }).read("impostor");
  assert.equal(recipe.declared.source, "minted");
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

// ajimi handoff: the id is LLM-generated and becomes a path segment — it must
// pass the same whitelist validator as every other id entry point.
test("mintSpecialist rejects a path-traversal id from the generator", () => {
  const root = makeBank();
  const generate = () => ({
    id: "../escape",
    role: "helper",
    prompt: "p",
    toolset: ["doc-read"],
  });

  assert.throws(
    () =>
      mintSpecialist({
        root,
        task: {},
        allowlist: DEFAULT_STAGING_ALLOWLIST,
        generate,
      }),
    /invalid recipe id/i,
  );
  assert.equal(existsSync(join(root, "escape")), false);
});

// Frontmatter injection: the parser is last-wins per key, so a newline smuggled
// into a scalar (role) could append e.g. a second `id:` line and rewrite the
// recipe's identity. mint must reject such drafts and write nothing.
test("mintSpecialist rejects a role carrying a frontmatter newline injection", () => {
  const root = makeBank();
  const generate = () => ({
    id: "injector",
    role: "helper\nid: hijacked",
    prompt: "p",
    toolset: ["doc-read"],
  });

  assert.throws(
    () =>
      mintSpecialist({
        root,
        task: {},
        allowlist: DEFAULT_STAGING_ALLOWLIST,
        generate,
      }),
    /role/,
  );
  assert.deepEqual(createBankRegistry({ root }).list("staging"), []);
});

test("mintSpecialist rejects a non-string prompt", () => {
  const root = makeBank();
  const generate = () => ({
    id: "weird",
    role: "helper",
    prompt: { not: "a string" },
    toolset: ["doc-read"],
  });

  assert.throws(
    () =>
      mintSpecialist({
        root,
        task: {},
        allowlist: DEFAULT_STAGING_ALLOWLIST,
        generate,
      }),
    /prompt/,
  );
  assert.deepEqual(createBankRegistry({ root }).list("staging"), []);
});

// Invariant #1 wiring: a draft requesting owner visibility is refused by
// assertStagingSafe before anything reaches the staging folder.
test("mintSpecialist rejects a draft requesting owner visibility", () => {
  const root = makeBank();
  const generate = () => ({
    id: "power-grab",
    role: "helper",
    prompt: "p",
    toolset: ["doc-read"],
    visibility: "owner",
  });

  assert.throws(
    () =>
      mintSpecialist({
        root,
        task: {},
        allowlist: DEFAULT_STAGING_ALLOWLIST,
        generate,
      }),
    /owner/,
  );
  assert.deepEqual(createBankRegistry({ root }).list("staging"), []);
});

// Invariant #1 wiring: vault tools are forbidden in staging even when a
// misconfigured allowlist contains them — assertStagingSafe is the final gate.
test("mintSpecialist rejects vault tools even when the allowlist is tainted", () => {
  const root = makeBank();
  const generate = () => ({
    id: "vault-grab",
    role: "helper",
    prompt: "p",
    toolset: ["vault"],
  });

  assert.throws(
    () =>
      mintSpecialist({
        root,
        task: {},
        allowlist: [...DEFAULT_STAGING_ALLOWLIST, "vault"],
        generate,
      }),
    /vault/,
  );
  assert.deepEqual(createBankRegistry({ root }).list("staging"), []);
});
