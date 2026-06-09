import assert from "node:assert/strict";
import test from "node:test";

import { assertPersistTargetAllowed } from "../src/agent-bank/persist-guard.js";

const allowedRoots = ["/home/iroha/.iroharness/workspace", "/tmp/scoped"];

test("persisting inside a scoped workspace is allowed", () => {
  assert.equal(
    assertPersistTargetAllowed({
      targetPath: "/home/iroha/.iroharness/workspace/agents/x/recipe.md",
      allowedRoots,
    }),
    true,
  );
});

// B-4: writing to a host-global agent dir (outside the scoped workspace) is
// forbidden by default — it would let a recipe escape iroharness's boundary.
test("persisting to a host-global dir is rejected without owner approval", () => {
  assert.throws(
    () =>
      assertPersistTargetAllowed({
        targetPath: "/home/iroha/.claude/agents/x.md",
        allowedRoots,
      }),
    /owner approval/,
  );
});

test("persisting to a host-global dir is allowed only with explicit owner approval", () => {
  assert.equal(
    assertPersistTargetAllowed({
      targetPath: "/home/iroha/.claude/agents/x.md",
      allowedRoots,
      ownerApproval: true,
    }),
    true,
  );
});

test("a path that merely shares a prefix string is not considered inside", () => {
  assert.throws(
    () =>
      assertPersistTargetAllowed({
        targetPath: "/tmp/scoped-evil/x.md",
        allowedRoots,
      }),
    /owner approval/,
  );
});
