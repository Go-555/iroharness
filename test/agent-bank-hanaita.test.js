import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createInMemoryProjectOs } from "../src/index.js";
import {
  createHanaita,
  createToolUsageVerifier,
} from "../src/agent-bank/hanaita.js";

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

// ---- 4.3 star / pipeline / fan-out -----------------------------------------

test("a two-specialist pipeline completes one goal through the blackboard", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  writeRecipe(root, "active", "writer");
  const projectOs = createInMemoryProjectOs();
  const { hanaita } = makeHanaita({
    root,
    projectOs,
    createRunner: ({ id }) => ({
      id,
      run: async (task, context) => ({
        status: "completed",
        summary:
          id === "researcher"
            ? "FACTS: water is wet"
            : `ARTICLE built on [${context.slice.prior
                .map((p) => p.output.summary)
                .join("; ")}]`,
      }),
    }),
  });

  const result = await hanaita.delegateGoal({
    title: "publish",
    steps: [
      { id: "research", recipe: "researcher", slice: "gather facts" },
      { id: "write", recipe: "writer", dependsOn: ["research"] },
    ],
  }).summary;

  assert.equal(result.status, "completed");
  // the goal summary is the terminal step's confirmed output
  assert.match(result.summary, /ARTICLE built on \[FACTS: water is wet\]/);
  // 2 delegations = 2 tickets = 2 completed runs
  const snapshot = projectOs.snapshot();
  assert.equal(snapshot.tickets.length, 2);
  assert.equal(
    snapshot.runs.filter((run) => run.status === "completed").length,
    2,
  );
});

test("fan-out runs independent steps concurrently and fan-in aggregates them", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "alpha");
  writeRecipe(root, "active", "beta");
  writeRecipe(root, "active", "merger");

  // barrier: alpha and beta must BOTH be in flight before either resolves —
  // a sequential executor would deadlock here (and fail by timeout)
  let started = 0;
  let releaseBarrier;
  const barrier = new Promise((resolve) => {
    releaseBarrier = resolve;
  });
  const arrive = () => {
    started += 1;
    if (started === 2) {
      releaseBarrier();
    }
    return barrier;
  };

  const seen = {};
  const { hanaita } = makeHanaita({
    root,
    createRunner: ({ id }) => ({
      id,
      run: async (task, context) => {
        seen[id] = context.slice;
        if (id !== "merger") {
          await arrive();
        }
        return { status: "completed", summary: `${id}-result` };
      },
    }),
  });

  const result = await hanaita.delegateGoal({
    title: "fan",
    steps: [
      { id: "a", recipe: "alpha" },
      { id: "b", recipe: "beta" },
      { id: "merge", recipe: "merger", dependsOn: ["a", "b"] },
    ],
  }).summary;

  assert.equal(result.status, "completed");
  // fan-in: the merger received BOTH confirmed results
  const priors = seen.merger.prior.map((p) => p.output.summary).sort();
  assert.deepEqual(priors, ["alpha-result", "beta-result"]);
  assert.match(result.summary, /merger-result/);
});

test("a circular dependency stalls the goal instead of hanging", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "alpha");
  writeRecipe(root, "active", "beta");
  const { hanaita } = makeHanaita({ root });

  const result = await hanaita.delegateGoal({
    title: "loop",
    steps: [
      { id: "a", recipe: "alpha", dependsOn: ["b"] },
      { id: "b", recipe: "beta", dependsOn: ["a"] },
    ],
  }).summary;

  assert.equal(result.status, "failed");
  assert.match(result.reason, /stalled|circular/i);
});

// ---- 4.4 verify loop: send back, then cut off at the cap --------------------

test("a rejected result is sent back with feedback and the corrected result completes", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  const projectOs = createInMemoryProjectOs();
  const feedbackSeen = [];
  let attempt = 0;
  const { hanaita } = makeHanaita({
    root,
    projectOs,
    createRunner: ({ id }) => ({
      id,
      run: async (task, context) => {
        attempt += 1;
        feedbackSeen.push(context.slice.feedback);
        return {
          status: "completed",
          summary: attempt === 1 ? "rough draft" : "VERIFIED-DATA final",
        };
      },
    }),
    options: {
      verifiers: [
        {
          id: "mekiki",
          verify: ({ result }) =>
            result.summary.includes("VERIFIED-DATA")
              ? { ok: true, reasons: [] }
              : { ok: false, reasons: ["summary lacks VERIFIED-DATA"] },
        },
      ],
      maxVerifyAttempts: 3,
    },
  });

  const result = await hanaita.delegateGoal({
    title: "t",
    steps: [{ id: "s1", recipe: "researcher" }],
  }).summary;

  assert.equal(result.status, "completed");
  assert.equal(result.steps[0].attempts, 2);
  // first attempt had no feedback; the send-back carried the verifier reasons
  assert.equal(feedbackSeen[0], null);
  assert.deepEqual(feedbackSeen[1], ["summary lacks VERIFIED-DATA"]);
  // still one delegation: 1 ticket, 1 run, completed (retries stay inside)
  const snapshot = projectOs.snapshot();
  assert.equal(snapshot.tickets.length, 1);
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.runs[0].status, "completed");
});

test("unfit work is cut off at the iteration cap and recorded as failed", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "researcher");
  const projectOs = createInMemoryProjectOs();
  let attempts = 0;
  const { hanaita } = makeHanaita({
    root,
    projectOs,
    createRunner: ({ id }) => ({
      id,
      run: async () => {
        attempts += 1;
        return { status: "completed", summary: "still sloppy" };
      },
    }),
    options: {
      verifiers: [
        {
          id: "mekiki",
          verify: () => ({ ok: false, reasons: ["not good enough"] }),
        },
      ],
      maxVerifyAttempts: 2,
    },
  });

  const result = await hanaita.delegateGoal({
    title: "t",
    steps: [{ id: "s1", recipe: "researcher" }],
  }).summary;

  assert.equal(result.status, "failed");
  assert.match(result.reason, /verify/i);
  assert.equal(attempts, 2, "stops exactly at the cap");
  // the failed delegation is on the board so the ledger counts it as a miss
  const snapshot = projectOs.snapshot();
  assert.equal(snapshot.runs.length, 1);
  assert.equal(snapshot.runs[0].status, "failed");
});

test("the bantou-style tool-usage verifier rejects work that claims tools outside the recipe toolset", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "clerk", { toolset: ["doc-read"] });
  const { hanaita } = makeHanaita({
    root,
    createRunner: ({ id }) => ({
      id,
      run: async () => ({
        status: "completed",
        summary: "did the work",
        toolsUsed: ["doc-read", "vault-read"],
      }),
    }),
    options: {
      verifiers: [createToolUsageVerifier()],
      maxVerifyAttempts: 1,
    },
  });

  const result = await hanaita.delegateGoal({
    title: "t",
    steps: [{ id: "s1", recipe: "clerk" }],
  }).summary;

  assert.equal(result.status, "failed");
  assert.match(result.reason, /vault-read/);
});

// ---- 4.5 cost / runaway guards (W-1) ----------------------------------------

test("a goal is cut off when it exceeds max_specialists_per_goal", async () => {
  const root = makeBank();
  for (const id of ["alpha", "beta", "gamma"]) {
    writeRecipe(root, "active", id);
  }
  let hired = 0;
  const { hanaita } = makeHanaita({
    root,
    createRunner: ({ id }) => {
      hired += 1;
      return {
        id,
        run: async () => ({ status: "completed", summary: `${id}-done` }),
      };
    },
    options: { guards: { maxSpecialistsPerGoal: 2 } },
  });

  const result = await hanaita.delegateGoal({
    title: "too many cooks",
    steps: [
      { id: "a", recipe: "alpha" },
      { id: "b", recipe: "beta" },
      { id: "c", recipe: "gamma" },
    ],
  }).summary;

  assert.equal(result.status, "failed");
  assert.match(result.reason, /max_specialists_per_goal/);
  assert.equal(hired, 2, "the third specialist is never hired");
});

test("recursive delegation by a specialist obeys max_depth (W-1)", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "fractal");
  let hired = 0;
  const depthErrors = [];
  const { hanaita } = makeHanaita({
    root,
    createRunner: ({ id }) => ({
      id,
      run: async (task, context) => {
        hired += 1;
        try {
          // every specialist tries to delegate a sub-goal, forever
          const sub = context.delegate({
            title: "go deeper",
            steps: [{ id: "deeper", recipe: "fractal" }],
          });
          const subResult = await sub.summary;
          return {
            status: "completed",
            summary: `spawned: ${subResult.status}`,
          };
        } catch (error) {
          depthErrors.push(error.message);
          return { status: "completed", summary: "bottomed out" };
        }
      },
    }),
    options: { guards: { maxDepth: 1, maxSpecialistsPerGoal: 10 } },
  });

  const result = await hanaita.delegateGoal({
    title: "recurse",
    steps: [{ id: "top", recipe: "fractal" }],
  }).summary;

  assert.equal(result.status, "completed");
  // root specialist (depth 0) may delegate once (depth 1); the depth-1
  // specialist's attempt to go to depth 2 is refused
  assert.equal(hired, 2, "recursion stops after one sub-delegation");
  assert.equal(depthErrors.length, 1);
  assert.match(depthErrors[0], /max_depth/);
});

test("a goal is cut off when the reported token usage exceeds token_budget", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "alpha");
  writeRecipe(root, "active", "beta");
  let hired = 0;
  const { hanaita } = makeHanaita({
    root,
    createRunner: ({ id }) => {
      hired += 1;
      return {
        id,
        run: async () => ({
          status: "completed",
          summary: `${id}-done`,
          tokensUsed: 100,
        }),
      };
    },
    options: { guards: { tokenBudget: 50 } },
  });

  const result = await hanaita.delegateGoal({
    title: "expensive",
    steps: [
      { id: "a", recipe: "alpha" },
      { id: "b", recipe: "beta", dependsOn: ["a"] },
    ],
  }).summary;

  assert.equal(result.status, "failed");
  assert.match(result.reason, /token_budget/);
  assert.equal(hired, 1, "no new specialist is hired once the budget is spent");
});

test("recursive sub-goals draw down the SAME root token budget", async () => {
  const root = makeBank();
  writeRecipe(root, "active", "spender");
  writeRecipe(root, "active", "alpha");
  let alphaHired = 0;
  const { hanaita } = makeHanaita({
    root,
    createRunner: ({ id }) => ({
      id,
      run: async (task, context) => {
        if (id === "spender" && context.slice.goal.title === "root") {
          // the root spender delegates a sub-goal that burns the budget
          const sub = context.delegate({
            title: "burn",
            steps: [{ id: "burnit", recipe: "spender" }],
          });
          await sub.summary;
          return { status: "completed", summary: "delegated", tokensUsed: 0 };
        }
        if (id === "alpha") {
          alphaHired += 1;
        }
        return { status: "completed", summary: "spent", tokensUsed: 100 };
      },
    }),
    options: { guards: { tokenBudget: 50, maxSpecialistsPerGoal: 10 } },
  });

  const result = await hanaita.delegateGoal({
    title: "root",
    steps: [
      { id: "first", recipe: "spender" },
      { id: "second", recipe: "alpha", dependsOn: ["first"] },
    ],
  }).summary;

  assert.equal(result.status, "failed");
  assert.match(result.reason, /token_budget/);
  assert.equal(
    alphaHired,
    0,
    "the sub-goal's spend blocks the root's next hire",
  );
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
