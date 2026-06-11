import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  assertPersistTargetAllowed,
  DEFAULT_HOST_GLOBAL_AGENT_DIRS,
  persistRecipe,
} from "../src/agent-bank/persist-guard.js";

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

// B-4 hardening: host-global agent dirs sit on a default deny list. Even a
// misconfigured allowedRoots that covers them (e.g. the whole home dir) does
// NOT waive the owner-approval requirement — the deny list wins.
test("the host-global deny list overrides an allowedRoots misconfiguration", () => {
  const target = join(homedir(), ".claude", "agents", "x.md");
  assert.ok(
    DEFAULT_HOST_GLOBAL_AGENT_DIRS.some((dir) => target.startsWith(dir)),
    "the default deny list covers ~/.claude/agents",
  );
  assert.throws(
    () =>
      assertPersistTargetAllowed({
        targetPath: target,
        allowedRoots: [homedir()], // misconfiguration: home dir allowlisted
      }),
    /owner approval/,
  );
  // owner approval is the only way through
  assert.equal(
    assertPersistTargetAllowed({
      targetPath: target,
      allowedRoots: [homedir()],
      ownerApproval: true,
    }),
    true,
  );
});

// bantou M-1 (symlink hardening): path.resolve alone does not follow
// symlinks, so a symlink INSIDE an allowed root pointing at a host-global
// agent dir would lexically pass the allowlist and skip the deny list. The
// guard must compare REAL paths. The test builds its own "host-global" dir
// inside the tmpdir so it never touches the real home directory.
test("a symlink inside an allowed root pointing at a host-global dir is denied", () => {
  const base = mkdtempSync(join(tmpdir(), "persist-symlink-"));
  const workspace = join(base, "workspace");
  const hostGlobal = join(base, "fake-home", ".claude", "agents");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(hostGlobal, { recursive: true });
  // workspace/agents -> ~/.claude/agents (equivalent)
  symlinkSync(hostGlobal, join(workspace, "agents"));

  assert.throws(
    () =>
      assertPersistTargetAllowed({
        targetPath: join(workspace, "agents", "x.md"),
        allowedRoots: [workspace],
        hostGlobalRoots: [hostGlobal],
      }),
    /owner approval/,
  );
});

test("a symlink escaping the allowed root is not treated as inside it", () => {
  const base = mkdtempSync(join(tmpdir(), "persist-symlink-out-"));
  const workspace = join(base, "workspace");
  const outside = join(base, "outside");
  mkdirSync(workspace, { recursive: true });
  mkdirSync(outside, { recursive: true });
  // workspace/exit -> a dir outside every allowed root (not host-global):
  // the allowlist check must follow the link and refuse without approval
  symlinkSync(outside, join(workspace, "exit"));

  assert.throws(
    () =>
      assertPersistTargetAllowed({
        targetPath: join(workspace, "exit", "x.md"),
        allowedRoots: [workspace],
        hostGlobalRoots: [],
      }),
    /owner approval/,
  );
});

// ---- persistRecipe: the actual persistence hookup (3.2) ----

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-persist-"));
const makeWorkspace = () => mkdtempSync(join(tmpdir(), "scoped-workspace-"));

const writeRecipe = (root, status, id) => {
  const dir = join(root, status, id);
  mkdirSync(dir, { recursive: true });
  const md = ["---", `id: ${id}`, "role: helper", "---", "", "body", ""].join(
    "\n",
  );
  writeFileSync(join(dir, "recipe.md"), md);
  return md;
};

test("persistRecipe writes an active recipe into the scoped workspace", () => {
  const root = makeBank();
  const workspace = makeWorkspace();
  const md = writeRecipe(root, "active", "tax-v3");
  const targetPath = join(workspace, "agents", "tax-v3.md");

  const result = persistRecipe({
    root,
    id: "tax-v3",
    targetPath,
    allowedRoots: [workspace],
  });

  assert.equal(result.targetPath, targetPath);
  assert.equal(readFileSync(targetPath, "utf8"), md);
});

test("persistRecipe refuses a host-global target by default and writes nothing", () => {
  const root = makeBank();
  writeRecipe(root, "active", "tax-v3");
  const targetPath = join(
    homedir(),
    ".claude",
    "agents",
    "agent-bank-test-never-written.md",
  );

  assert.throws(
    () =>
      persistRecipe({
        root,
        id: "tax-v3",
        targetPath,
        allowedRoots: [makeWorkspace()],
      }),
    /owner approval/,
  );
  assert.equal(existsSync(targetPath), false);
});

test("persistRecipe writes outside the scope only with explicit owner approval", () => {
  const root = makeBank();
  const md = writeRecipe(root, "active", "tax-v3");
  // an out-of-scope (non-allowlisted) destination stands in for a host-global
  // dir so the test never touches the real home directory
  const outside = mkdtempSync(join(tmpdir(), "outside-scope-"));
  const targetPath = join(outside, "tax-v3.md");

  assert.throws(
    () =>
      persistRecipe({
        root,
        id: "tax-v3",
        targetPath,
        allowedRoots: ["/tmp/scoped"],
      }),
    /owner approval/,
  );

  const result = persistRecipe({
    root,
    id: "tax-v3",
    targetPath,
    allowedRoots: ["/tmp/scoped"],
    ownerApproval: true,
  });
  assert.equal(result.targetPath, targetPath);
  assert.equal(readFileSync(targetPath, "utf8"), md);
});

// Persisting IS the "promotion = write a persistent definition" step (§8). A
// staging recipe escaping to a runtime would bypass the composite promotion
// gate, so only active recipes may be persisted.
test("persistRecipe refuses a recipe that is not active", () => {
  const root = makeBank();
  const workspace = makeWorkspace();
  writeRecipe(root, "staging", "unproven");

  assert.throws(
    () =>
      persistRecipe({
        root,
        id: "unproven",
        targetPath: join(workspace, "unproven.md"),
        allowedRoots: [workspace],
      }),
    /active/,
  );
  assert.equal(existsSync(join(workspace, "unproven.md")), false);
});

test("persistRecipe rejects a path-traversal id", () => {
  const root = makeBank();
  const workspace = makeWorkspace();

  assert.throws(
    () =>
      persistRecipe({
        root,
        id: "../escape",
        targetPath: join(workspace, "x.md"),
        allowedRoots: [workspace],
      }),
    /invalid recipe id/i,
  );
});
