import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_STAGING_ALLOWLIST,
  intersectToolset,
  loadStagingAllowlist,
} from "../src/agent-bank/tool-policy.js";

test("loadStagingAllowlist returns the default allowlist when none configured", () => {
  const allowlist = loadStagingAllowlist();
  assert.deepEqual(allowlist, [...DEFAULT_STAGING_ALLOWLIST]);
  // default must not contain privileged tools
  assert.ok(!allowlist.includes("repo-write"));
  assert.ok(!allowlist.includes("network"));
});

test("loadStagingAllowlist accepts a configured allowlist", () => {
  const allowlist = loadStagingAllowlist({
    allowlist: ["doc-read", "summarize"],
  });
  assert.deepEqual(allowlist, ["doc-read", "summarize"]);
});

test("loadStagingAllowlist rejects a non-array allowlist", () => {
  assert.throws(() => loadStagingAllowlist({ allowlist: "doc-read" }), /array/);
});

// B-1: a staging recipe cannot acquire tools outside the allowlist. intersect
// strips anything not permitted — this is what mint (3.1) will enforce.
test("intersectToolset strips tools outside the allowlist", () => {
  const requested = ["doc-write", "repo-write", "network"];
  const allowed = intersectToolset(requested, DEFAULT_STAGING_ALLOWLIST);
  assert.ok(allowed.includes("doc-write"));
  assert.ok(!allowed.includes("repo-write"));
  assert.ok(!allowed.includes("network"));
});

test("intersectToolset on an empty request yields nothing", () => {
  assert.deepEqual(intersectToolset([], DEFAULT_STAGING_ALLOWLIST), []);
  assert.deepEqual(intersectToolset(undefined, DEFAULT_STAGING_ALLOWLIST), []);
});
