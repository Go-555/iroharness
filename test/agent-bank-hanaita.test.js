import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createInMemoryProjectOs } from "../src/index.js";
import { createHanaita } from "../src/agent-bank/hanaita.js";

const makeBank = () => mkdtempSync(join(tmpdir(), "agent-bank-hanaita-"));
const makeWorkspace = () => mkdtempSync(join(tmpdir(), "hanaita-ws-"));

const writeRecipe = (root, status, id, { toolset = ["doc-read"] } = {}) => {
  const dir = join(root, status, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "recipe.md"),
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

// The same shape `iroharness view export` writes to work-runner-policy.json
// (bin/iroharness.mjs createWorkRunnerPolicy). delegate_goal must obey it.
const workRunnerPolicy = (zone) => ({
  kind: "iroharness.workRunnerPolicy",
  zone,
  delegation: {
    public: "denied",
    trusted: "permission-required",
    owner: "allowed",
  }[zone],
  boundary: "runner-only",
  runnerAccess: {
    repositoryWork: zone === "public" ? "none" : "scoped-workspace",
    browserControl: zone === "public" ? "none" : "scoped-session",
    defaultSandbox: zone === "public" ? "none" : "workspace-write",
  },
});

const makeHanaita = (overrides = {}) => {
  const root = overrides.root ?? makeBank();
  const workspace = overrides.workspace ?? makeWorkspace();
  const projectOs = overrides.projectOs ?? createInMemoryProjectOs();
  const hanaita = createHanaita({
    root,
    projectOs,
    workRunnerPolicy: overrides.workRunnerPolicy ?? workRunnerPolicy("owner"),
    allowedWorkspaces: [workspace],
    defaultWorkspace: workspace,
    createRunner:
      overrides.createRunner ??
      (({ id }) => ({
        id,
        run: async () => ({
          status: "completed",
          summary: `${id} done`,
          artifacts: [],
        }),
      })),
    ...overrides.options,
  });
  return { hanaita, root, workspace, projectOs };
};

// ---- 4.1 delegate_goal: async envelope -------------------------------------

test("delegate_goal returns a goal id immediately and resolves a summary asynchronously", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  const projectOs = createInMemoryProjectOs();
  const { hanaita } = makeHanaita({
    root,
    projectOs,
    createRunner: ({ id }) => ({
      id,
      run: async () => ({
        status: "completed",
        summary: "FACTS: water is wet",
        artifacts: [],
      }),
    }),
  });

  const handle = hanaita.delegateGoal({
    title: "research water",
    steps: [{ id: "s1", recipe: "researcher", slice: "is water wet?" }],
  });

  // goal id is available synchronously; the summary resolves later
  assert.equal(typeof handle.goalId, "string");
  assert.ok(handle.goalId.length > 0);
  assert.ok(handle.summary instanceof Promise);

  const result = await handle.summary;
  assert.equal(result.goalId, handle.goalId);
  assert.equal(result.status, "completed");
  assert.match(result.summary, /water is wet/);

  // the delegation is on the blackboard: 1 ticket + 1 completed run keyed by
  // the specialist's harnessId (so the existing ledger derivation works)
  const snapshot = projectOs.snapshot();
  assert.equal(snapshot.tickets.length, 1);
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.runs[0].harnessId, "researcher");
  assert.equal(snapshot.runs[0].status, "completed");
});

// ---- 4.1 B-3: the existing permission policy is the gate --------------------

test("a public view (delegation: denied) cannot call delegate_goal", () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  const { hanaita } = makeHanaita({
    root,
    workRunnerPolicy: workRunnerPolicy("public"),
  });

  assert.throws(
    () =>
      hanaita.delegateGoal({
        title: "sneak work",
        steps: [{ id: "s1", recipe: "researcher" }],
      }),
    /delegation.*denied|denied/i,
  );
});

test("a trusted view needs delegate_work permission; with it the goal runs", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  const { hanaita } = makeHanaita({
    root,
    workRunnerPolicy: workRunnerPolicy("trusted"),
  });

  // without the permission: rejected
  assert.throws(
    () =>
      hanaita.delegateGoal(
        { title: "t", steps: [{ id: "s1", recipe: "researcher" }] },
        { audience: { canDelegateWork: false } },
      ),
    /permission/i,
  );

  // with it: completes
  const handle = hanaita.delegateGoal(
    { title: "t", steps: [{ id: "s1", recipe: "researcher" }] },
    { audience: { canDelegateWork: true } },
  );
  const result = await handle.summary;
  assert.equal(result.status, "completed");
});

// ---- 4.1 invariant 1: only ACTIVE recipes may be hired ----------------------

test("a staging recipe cannot be hired by delegate_goal (folder is the authority)", async () => {
  const root = makeBank();
  writeRecipe(root, "staging", "unproven");
  let hired = 0;
  const { hanaita } = makeHanaita({
    root,
    createRunner: ({ id }) => {
      hired += 1;
      return { id, run: async () => ({ status: "completed", summary: "x" }) };
    },
  });

  const handle = hanaita.delegateGoal({
    title: "t",
    steps: [{ id: "s1", recipe: "unproven" }],
  });
  const result = await handle.summary;

  assert.equal(result.status, "failed");
  assert.match(result.reason, /not active|recipe_not_active/i);
  assert.equal(hired, 0, "a staging recipe must never reach the runner");
});

test("an archived or missing recipe cannot be hired either", async () => {
  const root = makeBank();
  writeRecipe(root, "archived", "retired");
  const { hanaita } = makeHanaita({ root });

  const archived = await hanaita.delegateGoal({
    title: "t",
    steps: [{ id: "s1", recipe: "retired" }],
  }).summary;
  assert.equal(archived.status, "failed");

  const missing = await hanaita.delegateGoal({
    title: "t",
    steps: [{ id: "s1", recipe: "nobody" }],
  }).summary;
  assert.equal(missing.status, "failed");
});

// ---- 4.1 invariant 3: every specialist run passes through the scoped runner --

test("specialist runs go through createScopedWorkRunnerMicroHarness (no direct path)", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  const workspace = makeWorkspace();
  const seen = [];
  const policy = workRunnerPolicy("owner");
  const { hanaita } = makeHanaita({
    root,
    workspace,
    workRunnerPolicy: policy,
    createRunner: ({ id }) => ({
      id,
      run: async (task, context) => {
        seen.push({ task, context });
        return { status: "completed", summary: "ok" };
      },
    }),
  });

  const result = await hanaita.delegateGoal({
    title: "t",
    steps: [{ id: "s1", recipe: "researcher" }],
  }).summary;
  assert.equal(result.status, "completed");

  assert.equal(seen.length, 1);
  const { task, context } = seen[0];
  // proof the run went through the scoped Work Runner wrapper: it injects
  // context.workRunner with the policy and the scoped workspace
  assert.equal(context.workRunner.policy, policy);
  assert.equal(context.workRunner.workspace, workspace);
  assert.equal(task.metadata.workspace, workspace);
});

// ---- 4.2 isolation, forward: the specialist gets only its slice -------------

test("a specialist receives only its context slice and confirmed board results — never the raw/identity context", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  writeRecipe(root, "active", "writer");
  const seen = {};
  const { hanaita } = makeHanaita({
    root,
    createRunner: ({ id }) => ({
      id,
      run: async (task, context) => {
        seen[id] = { task, context };
        return {
          status: "completed",
          summary: id === "researcher" ? "FACTS: water is wet" : "ARTICLE",
        };
      },
    }),
  });

  const identityContext = {
    persona: "SECRET-IDENTITY-MARKER",
    memory: ["owner said SECRET-MEMORY-MARKER"],
  };
  const result = await hanaita.delegateGoal(
    {
      title: "write an article",
      description: "article about water",
      steps: [
        { id: "research", recipe: "researcher", slice: "gather facts" },
        {
          id: "write",
          recipe: "writer",
          slice: "write from confirmed facts",
          dependsOn: ["research"],
        },
      ],
    },
    { audience: { canDelegateWork: true }, identityContext },
  ).summary;
  assert.equal(result.status, "completed");

  // the writer got the researcher's CONFIRMED output via the blackboard ...
  const writerSlice = seen.writer.context.slice;
  assert.equal(writerSlice.prior.length, 1);
  assert.equal(writerSlice.prior[0].harnessId, "researcher");
  assert.match(writerSlice.prior[0].output.summary, /water is wet/);
  // ... and the first specialist got no prior at all
  assert.deepEqual(seen.researcher.context.slice.prior, []);

  // neither specialist ever sees the identity context (forward isolation)
  for (const id of ["researcher", "writer"]) {
    const visible = JSON.stringify([seen[id].task, seen[id].context]);
    assert.ok(!visible.includes("SECRET-IDENTITY-MARKER"));
    assert.ok(!visible.includes("SECRET-MEMORY-MARKER"));
  }
});

// ---- 4.2 isolation, reverse: chatter never reaches Iroha's identity ---------

test("orchestration chatter does not pollute the identity context or the goal result", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  const { hanaita } = makeHanaita({
    root,
    createRunner: ({ id }) => ({
      id,
      run: async () => ({
        status: "completed",
        summary: "clean confirmed summary",
        raw: { spawnLog: "CHATTER-MARKER intermediate spawn output" },
      }),
    }),
  });

  const identityContext = Object.freeze({
    persona: Object.freeze({ name: "iroha" }),
    memory: Object.freeze(["stable memory"]),
  });
  const before = JSON.stringify(identityContext);

  const result = await hanaita.delegateGoal(
    { title: "t", steps: [{ id: "s1", recipe: "researcher" }] },
    { identityContext },
  ).summary;

  // the identity context object is untouched by the orchestration
  assert.equal(JSON.stringify(identityContext), before);

  // the goal result carries ONLY the confirmed shape — no runner raw output,
  // no intermediate chatter
  assert.ok(!JSON.stringify(result).includes("CHATTER-MARKER"));
  assert.deepEqual(Object.keys(result).sort(), [
    "goalId",
    "reason",
    "status",
    "steps",
    "summary",
  ]);
  for (const step of result.steps) {
    assert.deepEqual(Object.keys(step).sort(), [
      "attempts",
      "recipeId",
      "status",
      "stepId",
      "summary",
      "ticketId",
    ]);
  }
});

test("a workspace outside the allowed scope fails the step (scoped runner enforces it)", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  const { hanaita } = makeHanaita({ root });

  const result = await hanaita.delegateGoal({
    title: "t",
    steps: [{ id: "s1", recipe: "researcher", workspace: "/etc" }],
  }).summary;

  assert.equal(result.status, "failed");
});
