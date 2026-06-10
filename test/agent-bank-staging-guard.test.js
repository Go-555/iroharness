import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_STAGING_ALLOWLIST } from "../src/agent-bank/tool-policy.js";
import { assertStagingSafe } from "../src/agent-bank/staging-guard.js";

const allowlist = DEFAULT_STAGING_ALLOWLIST;

test("assertStagingSafe accepts a recipe within the allowlist and non-owner visibility", () => {
  assert.equal(
    assertStagingSafe({
      toolset: ["doc-read", "summarize"],
      visibility: "trusted",
      allowlist,
    }),
    true,
  );
});

test("assertStagingSafe rejects owner visibility in staging", () => {
  assert.throws(
    () =>
      assertStagingSafe({
        toolset: ["doc-read"],
        visibility: "owner",
        allowlist,
      }),
    /owner/,
  );
});

test("assertStagingSafe rejects tools outside the allowlist", () => {
  assert.throws(
    () =>
      assertStagingSafe({
        toolset: ["doc-read", "repo-write"],
        visibility: "trusted",
        allowlist,
      }),
    /repo-write/,
  );
});

test("assertStagingSafe rejects vault tools even if allowlisted by mistake", () => {
  assert.throws(
    () =>
      assertStagingSafe({
        toolset: ["vault"],
        visibility: "trusted",
        allowlist: [...allowlist, "vault"],
      }),
    /vault/,
  );
});
