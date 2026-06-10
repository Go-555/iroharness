// Phase 5b (5.3): Work Runner isolation, hardened across EVERY delegate path.
//
// The single authority is the work-runner-policy.json that the real
// `iroharness view export` writes (public: delegate denied / trusted:
// permission-required / owner: allowed, runner-scoped only). These tests
// export the real views with the real bin and drive every delegation path
// with those exact policy objects:
//
//   path 2: createHanaita.delegateGoal (src/agent-bank/hanaita.js)
//   path 3: recursive specialist delegate() inside the hanaita
//   path 4: createScopedWorkRunnerMicroHarness.run (src/adapters/index.js)
//   path 5: bin / bank CLI (no delegate entry exists — pinned here)
//   path 6: sandbox runTrial injection point (policy premise pinned here)
//
// (path 1 — the createIroHarness work route — is covered in
// test/work-runner-policy-harness.test.js.)

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createScopedWorkRunnerMicroHarness,
  evaluateWorkRunnerDelegation,
} from "../src/adapters/index.js";
import {
  createHanaita,
  evaluateDelegationGate,
} from "../src/agent-bank/hanaita.js";
import {
  isSandboxVerified,
  runSandboxVerification,
} from "../src/agent-bank/sandbox.js";
import { createInMemoryProjectOs } from "../src/index.js";

const ZONES = ["public", "trusted", "owner"];

const runCli = (args) =>
  spawnSync(
    process.execPath,
    [join(process.cwd(), "bin", "iroharness.mjs"), ...args],
    { cwd: process.cwd(), encoding: "utf8" },
  );

// Export the REAL views once with the REAL bin; every test below uses the
// resulting work-runner-policy.json files as the policy authority.
const exported = (() => {
  const dir = mkdtempSync(join(tmpdir(), "wr-isolation-"));
  const appDir = join(dir, "companion");
  const init = runCli(["init", appDir, "--character", "Iroha"]);
  if (init.status !== 0) {
    throw new Error(`iroharness init failed: ${init.stderr}`);
  }
  const views = {};
  const policies = {};
  for (const zone of ZONES) {
    const out = join(dir, `${zone}-view`);
    const result = runCli([
      "view",
      "export",
      appDir,
      "--zone",
      zone,
      "--out",
      out,
      "--force",
      "--json",
    ]);
    if (result.status !== 0) {
      throw new Error(`view export (${zone}) failed: ${result.stderr}`);
    }
    views[zone] = out;
    policies[zone] = JSON.parse(
      readFileSync(join(out, "current", "work-runner-policy.json"), "utf8"),
    );
  }
  return { dir, appDir, views, policies };
})();

const makeBank = () => mkdtempSync(join(tmpdir(), "wr-isolation-bank-"));
const makeWorkspace = () => mkdtempSync(join(tmpdir(), "wr-isolation-ws-"));

const writeRecipe = (root, status, id, { toolset = ["doc-read"] } = {}) => {
  const recipeDir = join(root, status, id);
  mkdirSync(recipeDir, { recursive: true });
  writeFileSync(
    join(recipeDir, "recipe.md"),
    [
      "---",
      `id: ${id}`,
      `role: ${id} specialist`,
      `toolset: [${toolset.join(", ")}]`,
      "---",
      "",
      `You are the ${id} specialist.`,
      "",
    ].join("\n"),
  );
};

// ---- the exported policy is the authority -----------------------------------

test("view export writes the canonical delegation table for every zone", () => {
  assert.equal(exported.policies.public.delegation, "denied");
  assert.equal(exported.policies.trusted.delegation, "permission-required");
  assert.equal(exported.policies.owner.delegation, "allowed");
  for (const zone of ZONES) {
    const policy = exported.policies[zone];
    assert.equal(policy.kind, "iroharness.workRunnerPolicy");
    assert.equal(policy.zone, zone);
    // owner included: even the owner only ever reaches a runner-scoped runner
    assert.equal(policy.boundary, "runner-only");
  }
  assert.equal(exported.policies.public.runnerAccess.repositoryWork, "none");
  assert.equal(
    exported.policies.trusted.runnerAccess.repositoryWork,
    "scoped-workspace",
  );
  assert.equal(
    exported.policies.owner.runnerAccess.repositoryWork,
    "scoped-workspace",
  );
});

// ---- the shared gate (single judgment function) ------------------------------

test("evaluateWorkRunnerDelegation decides the full zone x audience matrix", () => {
  const matrix = [
    // [zone, canDelegateWork, ok, reason]
    ["public", false, false, "delegation_denied"],
    ["public", true, false, "delegation_denied"],
    ["trusted", false, false, "permission_required"],
    ["trusted", true, true, null],
    ["owner", false, true, null],
    ["owner", true, true, null],
  ];
  for (const [zone, canDelegateWork, ok, reason] of matrix) {
    const verdict = evaluateWorkRunnerDelegation({
      policy: exported.policies[zone],
      audience: { canDelegateWork },
    });
    assert.equal(verdict.ok, ok, `${zone} canDelegateWork=${canDelegateWork}`);
    assert.equal(verdict.reason, reason, `${zone} reason`);
  }
});

test("evaluateWorkRunnerDelegation fails closed on missing or tainted policies", () => {
  // no policy at all
  assert.equal(evaluateWorkRunnerDelegation({}).ok, false);
  assert.equal(evaluateWorkRunnerDelegation().ok, false);
  // unknown delegation vocabulary never passes
  assert.equal(
    evaluateWorkRunnerDelegation({
      policy: { delegation: "maybe" },
      audience: { canDelegateWork: true },
    }).ok,
    false,
  );
  // permission-required demands a real boolean true, not truthy garbage
  assert.equal(
    evaluateWorkRunnerDelegation({
      policy: exported.policies.trusted,
      audience: { canDelegateWork: "yes" },
    }).ok,
    false,
  );
});

test("the hanaita gate IS the shared gate (one implementation, no fork)", () => {
  assert.equal(evaluateDelegationGate, evaluateWorkRunnerDelegation);
});

// ---- path 4: createScopedWorkRunnerMicroHarness ------------------------------

const makeScoped = ({ policy, workspace, calls }) =>
  createScopedWorkRunnerMicroHarness({
    id: "runner",
    worker: {
      run: async (task) => {
        calls.push(task);
        return { status: "completed", summary: "worker done" };
      },
    },
    policy,
    allowedWorkspaces: [workspace],
    defaultWorkspace: workspace,
  });

test("scoped runner: forbidden zone x audience combinations never reach the worker", async () => {
  const matrix = [
    // [zone, canDelegateWork, expected reason]
    ["public", true, "delegation_denied"],
    ["public", false, "delegation_denied"],
    ["trusted", false, "permission_required"],
  ];
  for (const [zone, canDelegateWork, reason] of matrix) {
    const calls = [];
    const scoped = makeScoped({
      policy: exported.policies[zone],
      workspace: makeWorkspace(),
      calls,
    });
    const result = await scoped.run(
      { id: "t1", title: "task" },
      { audience: { canDelegateWork } },
    );
    assert.equal(result.status, "failed", `${zone}/${canDelegateWork}`);
    assert.equal(result.raw.reason, reason, `${zone}/${canDelegateWork}`);
    assert.equal(calls.length, 0, "the worker must never be invoked");
  }
});

test("scoped runner: trusted with delegate_work and owner run, but only runner-scoped", async () => {
  for (const [zone, audience] of [
    ["trusted", { canDelegateWork: true }],
    ["owner", { canDelegateWork: false }],
  ]) {
    const calls = [];
    const workspace = makeWorkspace();
    const scoped = makeScoped({
      policy: exported.policies[zone],
      workspace,
      calls,
    });
    const ok = await scoped.run({ id: "t1", title: "task" }, { audience });
    assert.equal(ok.status, "completed", zone);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].metadata.workspace, workspace);

    // runner-scoped: a workspace outside the allowlist is refused even here
    const outside = await scoped.run(
      {
        id: "t2",
        title: "task",
        metadata: { workspace: mkdtempSync(join(tmpdir(), "wr-outside-")) },
      },
      { audience },
    );
    assert.equal(outside.status, "failed", zone);
    assert.equal(outside.raw.reason, "workspace_out_of_scope", zone);
    assert.equal(calls.length, 1, "the out-of-scope task never ran");
  }
});

// ---- paths 2 + 3: hanaita delegate_goal and recursive delegate ---------------

const makeHanaita = ({ policy, createRunner, workspace, options = {} }) => {
  const root = makeBank();
  writeRecipe(root, "active", "specialist");
  const ws = workspace ?? makeWorkspace();
  const projectOs = createInMemoryProjectOs();
  const hanaita = createHanaita({
    root,
    projectOs,
    workRunnerPolicy: policy,
    allowedWorkspaces: [ws],
    defaultWorkspace: ws,
    createRunner:
      createRunner ??
      (({ id }) => ({
        id,
        run: async () => ({ status: "completed", summary: `${id} done` }),
      })),
    ...options,
  });
  return { hanaita, root, workspace: ws, projectOs };
};

const oneStepGoal = () => ({
  title: "goal",
  steps: [{ id: "s1", recipe: "specialist", slice: "do the thing" }],
});

test("delegate_goal: forbidden zone x audience combinations throw before any runner exists", () => {
  const matrix = [
    ["public", { canDelegateWork: true }, /denied for this view/],
    ["public", { canDelegateWork: false }, /denied for this view/],
    ["trusted", { canDelegateWork: false }, /delegate_work permission/],
    ["trusted", undefined, /delegate_work permission/],
  ];
  for (const [zone, audience, message] of matrix) {
    let created = 0;
    const { hanaita } = makeHanaita({
      policy: exported.policies[zone],
      createRunner: ({ id }) => {
        created += 1;
        return {
          id,
          run: async () => ({ status: "completed", summary: "done" }),
        };
      },
    });
    assert.throws(
      () => hanaita.delegateGoal(oneStepGoal(), { audience }),
      message,
      `${zone}/${JSON.stringify(audience)}`,
    );
    assert.equal(created, 0, "no runner may be created for a denied goal");
  }
});

test("delegate_goal: trusted with delegate_work and owner complete a goal", async () => {
  for (const [zone, audience] of [
    ["trusted", { canDelegateWork: true }],
    ["owner", {}],
  ]) {
    const { hanaita } = makeHanaita({ policy: exported.policies[zone] });
    const handle = hanaita.delegateGoal(oneStepGoal(), { audience });
    const result = await handle.summary;
    assert.equal(result.status, "completed", zone);
  }
});

test("delegate_goal: even the owner stays runner-scoped — an out-of-scope workspace fails the step", async () => {
  const { hanaita } = makeHanaita({ policy: exported.policies.owner });
  const handle = hanaita.delegateGoal(
    {
      title: "escape attempt",
      steps: [
        {
          id: "s1",
          recipe: "specialist",
          slice: "write outside",
          workspace: mkdtempSync(join(tmpdir(), "wr-owner-outside-")),
        },
      ],
    },
    { audience: {} },
  );
  const result = await handle.summary;
  assert.equal(result.status, "failed");
  assert.match(result.reason, /step_failed/);
});

test("recursive delegate re-evaluates the SAME gate (policy flips mid-goal are honored)", async () => {
  // mutable copy of the real owner policy: the root gate passes, then the
  // policy is flipped to denied before the specialist recurses.
  const policy = JSON.parse(JSON.stringify(exported.policies.owner));
  const { hanaita } = makeHanaita({
    policy,
    createRunner: ({ id }) => ({
      id,
      run: async (task, context) => {
        policy.delegation = "denied";
        context.delegate({
          title: "sub",
          steps: [{ id: "sub1", recipe: "specialist", slice: "recurse" }],
        });
        return { status: "completed", summary: "should not get here" };
      },
    }),
  });
  const handle = hanaita.delegateGoal(oneStepGoal(), { audience: {} });
  const result = await handle.summary;
  assert.equal(result.status, "failed");
  assert.match(result.reason, /denied for this view/);
});

test("recursive delegate ignores a forged audience and re-checks the root audience", async () => {
  // trusted zone, real exported policy; the ROOT audience holds delegate_work,
  // is revoked mid-goal, and the specialist tries to recurse with a forged
  // broader audience — the gate must see the revoked root audience.
  const audience = { canDelegateWork: true };
  const { hanaita } = makeHanaita({
    policy: exported.policies.trusted,
    createRunner: ({ id }) => ({
      id,
      run: async (task, context) => {
        context.audience.canDelegateWork = false; // revoked mid-goal
        context.delegate(
          {
            title: "sub",
            steps: [{ id: "sub1", recipe: "specialist", slice: "recurse" }],
          },
          { audience: { canDelegateWork: true } }, // forged: must be ignored
        );
        return { status: "completed", summary: "should not get here" };
      },
    }),
  });
  const handle = hanaita.delegateGoal(oneStepGoal(), { audience });
  const result = await handle.summary;
  assert.equal(result.status, "failed");
  assert.match(result.reason, /delegate_work permission/);
});

// ---- path 6: sandbox runTrial premise ----------------------------------------

const makeTrialRunner = ({ policy, workspace, audience }) => {
  return async ({ id }) => {
    const scoped = createScopedWorkRunnerMicroHarness({
      id: `trial-${id}`,
      worker: {
        run: async () => ({ status: "completed", summary: "trial passed" }),
      },
      policy,
      allowedWorkspaces: [workspace],
      defaultWorkspace: workspace,
    });
    const result = await scoped.run(
      { id: `trial-${id}`, title: "sandbox trial" },
      { audience },
    );
    return { passed: result.status === "completed" };
  };
};

test("sandbox trial premise: only an owner runner-scoped trial can record verified:true", async () => {
  const matrix = [
    ["public", { canDelegateWork: true }, false],
    ["trusted", { canDelegateWork: false }, false],
    ["trusted", { canDelegateWork: true }, true],
    ["owner", {}, true],
  ];
  for (const [zone, audience, verified] of matrix) {
    const root = makeBank();
    writeRecipe(root, "staging", "candidate");
    const outcome = await runSandboxVerification({
      root,
      id: "candidate",
      runTrial: makeTrialRunner({
        policy: exported.policies[zone],
        workspace: makeWorkspace(),
        audience,
      }),
    });
    assert.equal(outcome.verified, verified, `${zone}`);
    assert.equal(isSandboxVerified({ root, id: "candidate" }), verified, zone);
  }
});

// ---- path 5: no CLI delegate entry exists --------------------------------------

test("the CLI offers no delegate entry: bank delegate and top-level delegate are refused", () => {
  const bankDelegate = runCli([
    "bank",
    "delegate",
    "specialist",
    exported.appDir,
  ]);
  assert.notEqual(bankDelegate.status, 0);
  assert.match(
    `${bankDelegate.stdout}${bankDelegate.stderr}`,
    /Unknown bank action: delegate/,
  );

  const topLevel = runCli(["delegate", "specialist"]);
  assert.notEqual(topLevel.status, 0);

  const usage = runCli(["--help"]);
  assert.doesNotMatch(`${usage.stdout}${usage.stderr}`, /delegate/i);
});

test("work-runner check reports the canonical delegation for every exported zone", () => {
  const expected = {
    public: "denied",
    trusted: "permission-required",
    owner: "allowed",
  };
  for (const zone of ZONES) {
    const check = runCli([
      "work-runner",
      "check",
      exported.views[zone],
      "--json",
    ]);
    assert.equal(check.status, 0, check.stderr);
    const report = JSON.parse(check.stdout);
    assert.equal(report.ok, true, zone);
    assert.equal(report.zone, zone);
    assert.equal(report.delegation, expected[zone], zone);
  }
});
