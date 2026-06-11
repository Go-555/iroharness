// Hanaita orchestration (Phase 4): delegate_goal over the Agent Bank.
//
// The Hanaita is Iroha's own back-of-counter decision loop (§5-§7 of
// docs/agent-bank.md): it hires ACTIVE regulars from the Bank, hands each an
// isolated context slice, has results verified, and shares only confirmed
// results through the blackboard (Project OS).
//
// Security invariants honored here:
// - invariant 1: only recipes in active/ may be hired (folder authority);
//   staging/archived hires fail before any runner is created.
// - invariant 3: there is NO direct execution path. The entry gate speaks the
//   existing work-runner-policy vocabulary (delegation: denied /
//   permission-required / allowed), and every specialist run is wrapped in
//   createScopedWorkRunnerMicroHarness, so the existing policy + workspace
//   scoping code is what actually runs the worker.
// - invariant 4: writes happen inside the scoped workspace (enforced by the
//   scoped runner) and on the Project OS blackboard — nothing else.
//
// `createRunner({ id, recipe })` is the injection point for the real
// micro-harness. Tests inject a fake; production wiring is the opt-in
// `createDefaultRunnerFactory` (src/agent-bank/runner-factory.js — Codex
// app-server / Claude Code CLI behind a code-side allow map). No hidden
// default exists on purpose: omitting createRunner still throws.

import {
  createScopedWorkRunnerMicroHarness,
  evaluateWorkRunnerDelegation,
} from "../adapters/index.js";

import { askBank } from "./ask-bank.js";
import { createBlackboard } from "./blackboard.js";
import { createBankRegistry } from "./registry.js";

const createId = (prefix) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

// Cost / runaway guard policy (Phase 4.5, W-1). Finite, safe-by-default:
// - maxSpecialistsPerGoal: hires across the ROOT goal and every recursive
//   sub-goal it spawns (one shared counter — a runaway recursion cannot
//   reset it).
// - maxDepth: how deep recursive delegate() may nest (root goal = depth 0).
// - tokenBudget: the runner-REPORTED token spend (result.tokensUsed, an
//   estimate, not metered billing) shared by the root goal and its sub-goals;
//   once exceeded, no further specialist is hired.
export const DEFAULT_HANAITA_GUARDS = Object.freeze({
  maxSpecialistsPerGoal: 8,
  maxDepth: 1,
  tokenBudget: 200_000,
});

const reportedTokens = (result) => {
  const tokens = Number(result?.tokensUsed ?? result?.raw?.tokensUsed);
  return Number.isFinite(tokens) && tokens > 0 ? tokens : 0;
};

// Phase 5b (5.3): the gate is the SAME function the scoped Work Runner uses
// (src/adapters evaluateWorkRunnerDelegation) — one implementation for every
// delegate path, speaking the work-runner-policy.json vocabulary written by
// `iroharness view export` (public=denied, trusted=permission-required via
// audience.canDelegateWork, owner=allowed). Kept under its Phase 4 name so
// the gate semantics stay testable in isolation (B-3).
export const evaluateDelegationGate = evaluateWorkRunnerDelegation;

// Bantou-style permission verifier (Phase 4.4): work that claims to have used
// tools outside the recipe's toolset is rejected. Mechanical and honest — it
// audits the runner's own report (toolsUsed); a deeper audit belongs to the
// runtime sandbox, not this loop.
export const createToolUsageVerifier = () => ({
  id: "bantou-tool-usage",
  verify: ({ recipe, result }) => {
    const used = result?.toolsUsed ?? result?.raw?.toolsUsed ?? [];
    const allowed = new Set(recipe?.toolset ?? []);
    const outside = used.filter((tool) => !allowed.has(tool));
    return outside.length > 0
      ? {
          ok: false,
          reasons: [
            `tools used outside the recipe toolset: ${outside.join(", ")}`,
          ],
        }
      : { ok: true, reasons: [] };
  },
});

const normalizeSteps = (goal) => {
  if (!Array.isArray(goal?.steps) || goal.steps.length === 0) {
    throw new Error("delegate_goal requires goal.steps (a non-empty array)");
  }
  const ids = new Set();
  for (const step of goal.steps) {
    // A2: a step names its recipe directly OR brings a chooseRecipe(listing)
    // callback (LLM-driven selection over the ask_bank menu). Either way the
    // resolved id must pass the SAME hire gate (active-only) — the callback
    // is a proposal, never an authority.
    if (
      !step?.id ||
      (!step?.recipe && typeof step?.chooseRecipe !== "function")
    ) {
      throw new Error(
        "every goal step requires an id and a recipe (or a chooseRecipe callback)",
      );
    }
    if (ids.has(step.id)) {
      throw new Error(`duplicate step id: ${step.id}`);
    }
    ids.add(step.id);
  }
  for (const step of goal.steps) {
    for (const dep of step.dependsOn ?? []) {
      if (!ids.has(dep)) {
        throw new Error(`step ${step.id} depends on unknown step: ${dep}`);
      }
    }
  }
  return goal.steps;
};

export const createHanaita = ({
  root,
  projectOs,
  workRunnerPolicy,
  createRunner,
  allowedWorkspaces = [],
  defaultWorkspace = null,
  ownerCharacterId = "iroha",
  // Phase 4.4 verify loop: mekiki-style (quality) and bantou-style
  // (permission) verifiers. Each is { id, verify({ step, recipe, result }) }
  // returning { ok, reasons } (sync or async). A rejected result is sent back
  // to the SAME specialist with the reasons as feedback, up to
  // maxVerifyAttempts; then the step is cut off and recorded as failed.
  verifiers = [],
  maxVerifyAttempts = 3,
  guards = {},
} = {}) => {
  if (!root) {
    throw new Error("createHanaita requires the bank root");
  }
  if (!projectOs) {
    throw new Error("createHanaita requires a ProjectOs handle");
  }
  if (workRunnerPolicy?.kind !== "iroharness.workRunnerPolicy") {
    throw new Error(
      "createHanaita requires the view's work-runner policy (iroharness.workRunnerPolicy)",
    );
  }
  if (typeof createRunner !== "function") {
    throw new Error(
      "createHanaita requires createRunner({ id, recipe }) — the micro-harness injection point",
    );
  }

  const registry = createBankRegistry({ root });
  const blackboard = createBlackboard({ projectOs, ownerCharacterId });
  const guardPolicy = Object.freeze({ ...DEFAULT_HANAITA_GUARDS, ...guards });

  // Hire = resolve the recipe with the FOLDER as the status authority.
  // Anything not in active/ is refused (invariant 1).
  const hire = (recipeId) => {
    let entry;
    try {
      entry = registry.read(recipeId);
    } catch {
      throw new Error(`recipe_not_active: recipe not found: ${recipeId}`);
    }
    if (entry.status !== "active") {
      throw new Error(
        `recipe_not_active: recipe ${recipeId} is ${entry.status}, not active — staging/archived recipes cannot be hired`,
      );
    }
    return entry.recipe;
  };

  // A2: resolve a step's recipe id — named directly, or chosen by the step's
  // chooseRecipe(listing) callback over the ask_bank menu (active recipes +
  // derived track record). The returned id is ONLY a proposal: the hire gate
  // above (folder authority, id validation) stays the authority.
  const resolveStepRecipe = async (step) => {
    if (step.recipe) {
      return step.recipe;
    }
    const chosen = await step.chooseRecipe(askBank({ root, projectOs }));
    if (typeof chosen !== "string" || !chosen) {
      throw new Error(
        `choose_recipe_invalid: step ${step.id} chooseRecipe must return a recipe id string`,
      );
    }
    return chosen;
  };

  // Run every verifier; collect rejection reasons (empty = pass).
  const runVerifiers = async ({ step, recipe, result }) => {
    const reasons = [];
    for (const verifier of verifiers) {
      const verdict = await verifier.verify({ step, recipe, result });
      if (verdict?.ok !== true) {
        reasons.push(
          ...(verdict?.reasons?.length
            ? verdict.reasons
            : [`${verifier.id ?? "verifier"} rejected the result`]),
        );
      }
    }
    return reasons;
  };

  const runStep = async ({
    goal,
    goalId,
    step,
    audience,
    ticketsByStep,
    depth,
    trackers,
  }) => {
    // 4.5 guards, checked BEFORE any hire so a tripped guard stops the goal
    // without creating another runner. Both counters are shared with every
    // recursive sub-goal of the same root goal (W-1).
    if (trackers.tokensUsed > guardPolicy.tokenBudget) {
      throw new Error(
        `token_budget_exceeded: ~${trackers.tokensUsed} reported tokens spent of ${guardPolicy.tokenBudget} — the goal is cut off`,
      );
    }
    trackers.hires += 1;
    if (trackers.hires > guardPolicy.maxSpecialistsPerGoal) {
      throw new Error(
        `max_specialists_per_goal_exceeded: hiring specialist #${trackers.hires} exceeds the limit of ${guardPolicy.maxSpecialistsPerGoal}`,
      );
    }

    const recipeId = await resolveStepRecipe(step);
    const recipe = hire(recipeId);

    // The specialist's context slice: ONLY the instruction for this step plus
    // the CONFIRMED outputs of its dependencies, read back from the blackboard
    // (not handed over in-memory — the board is the single cross-specialist
    // data path). Never the raw goal context, never Iroha's identity context
    // (§6.3 forward isolation).
    const dependencyTickets = (step.dependsOn ?? [])
      .map((dep) => ticketsByStep.get(dep))
      .filter(Boolean);
    const prior = Object.freeze(blackboard.readConfirmed(dependencyTickets));
    const makeSlice = (feedback) =>
      Object.freeze({
        goal: Object.freeze({ id: goalId, title: goal.title ?? "" }),
        instruction: step.slice ?? goal.description ?? "",
        prior,
        feedback,
      });

    const { ticketId, runId } = blackboard.open({
      title: step.title ?? `${goal.title ?? goalId} / ${step.id}`,
      purpose: step.slice ?? goal.description ?? "",
      harnessId: recipeId,
      input: { slice: makeSlice(null) },
    });

    // Invariant 3: the worker runs INSIDE the existing scoped Work Runner
    // wrapper — its policy / permission / workspace checks are the live path.
    const worker = createRunner({ id: recipeId, recipe });
    try {
      const scoped = createScopedWorkRunnerMicroHarness({
        id: recipeId,
        worker,
        policy: workRunnerPolicy,
        allowedWorkspaces,
        defaultWorkspace,
        capabilities: recipe.toolset ?? [],
      });

      const task = Object.freeze({
        id: ticketId,
        title: step.title ?? step.id,
        purpose: step.slice ?? goal.description ?? "",
        metadata: Object.freeze(
          step.workspace ? { workspace: step.workspace } : {},
        ),
      });

      // Recursive delegation (W-1): a specialist may delegate a sub-goal, but
      // only through the SAME gate + guards (no bypass): the sub-goal re-runs
      // the permission gate with the ROOT caller's audience (a specialist
      // cannot claim broader permissions), sits one level deeper for maxDepth,
      // and draws down the shared hire/token trackers.
      const delegate = (subGoal) =>
        delegateInternal(subGoal, { audience, depth: depth + 1, trackers });

      // Verify loop (4.4): run → verify → send back with feedback → ... → cap.
      // Retries stay INSIDE the one delegation: 1 ticket = 1 run; only the
      // final outcome is folded onto the board.
      let attempts = 0;
      let feedback = null;
      while (attempts < maxVerifyAttempts) {
        attempts += 1;
        const result = await scoped.run(task, {
          audience,
          slice: makeSlice(feedback),
          delegate,
        });
        trackers.tokensUsed += reportedTokens(result);

        if (result?.status !== "completed") {
          blackboard.reject({
            runId,
            output: {
              status: "failed",
              summary: result?.summary ?? "specialist run failed",
            },
          });
          throw new Error(
            `step_failed: step ${step.id} failed: ${result?.summary ?? "unknown"}`,
          );
        }

        const reasons = await runVerifiers({ step, recipe, result });
        if (reasons.length === 0) {
          const output = { status: "completed", summary: result.summary ?? "" };
          blackboard.confirm({
            ticketId,
            runId,
            output,
            artifacts: result.artifacts ?? [],
          });
          // The step record is the ONLY thing that leaves the orchestration
          // for this step (§6.3 reverse isolation): confirmed summary and
          // bookkeeping, never the runner's raw output or verify chatter.
          return {
            stepId: step.id,
            recipeId,
            ticketId,
            status: "completed",
            summary: output.summary,
            attempts,
          };
        }
        feedback = Object.freeze([...reasons]);
      }

      // feedback is null when the loop never ran (maxVerifyAttempts < 1):
      // surface a meaningful exhaustion message instead of a TypeError.
      const failureReasons = feedback ?? [
        "verify attempts exhausted before any run (maxVerifyAttempts < 1)",
      ];
      blackboard.reject({
        runId,
        output: {
          status: "failed",
          summary: `verify rejected after ${attempts} attempt(s): ${failureReasons.join("; ")}`,
        },
      });
      throw new Error(
        `verify_exhausted: step ${step.id} was rejected ${attempts} time(s) and was cut off: ${failureReasons.join("; ")}`,
      );
    } finally {
      // M-2: the step's worker is closed once the step settles (completed,
      // failed, or verify-exhausted) — retries within the verify loop share
      // the one worker; nothing outlives the step. Best-effort and idempotent
      // alongside factory.close() (the default factory tolerates re-close):
      // a throwing close must not mask the step outcome.
      try {
        worker.close?.();
      } catch {
        // the step outcome stands; nothing useful to add
      }
    }
  };

  // The vertical thread (4.3): the Hanaita assigns every READY step (all
  // dependencies confirmed) as one parallel wave — fan-out — then folds the
  // confirmed results back before assigning dependents — pipeline / fan-in.
  // Star topology: specialists only ever talk to the Hanaita/blackboard.
  const runGoal = async ({
    goal,
    goalId,
    steps,
    audience,
    depth,
    trackers,
  }) => {
    const stepResults = [];
    const ticketsByStep = new Map();
    const remaining = new Map(steps.map((step) => [step.id, step]));
    let failure = null;

    while (remaining.size > 0 && !failure) {
      const ready = [...remaining.values()].filter((step) =>
        (step.dependsOn ?? []).every((dep) => ticketsByStep.has(dep)),
      );
      if (ready.length === 0) {
        failure = new Error(
          "goal_stalled: circular or unsatisfiable step dependencies",
        );
        break;
      }
      for (const step of ready) {
        remaining.delete(step.id);
      }
      const settled = await Promise.allSettled(
        ready.map((step) =>
          runStep({
            goal,
            goalId,
            step,
            audience,
            ticketsByStep,
            depth,
            trackers,
          }),
        ),
      );
      settled.forEach((outcome, index) => {
        if (outcome.status === "fulfilled") {
          ticketsByStep.set(ready[index].id, outcome.value.ticketId);
          stepResults.push(outcome.value);
        } else if (!failure) {
          failure = outcome.reason;
        }
      });
    }

    if (failure) {
      return Object.freeze({
        goalId,
        status: "failed",
        reason: failure.message,
        summary: `goal failed: ${failure.message}`,
        steps: Object.freeze(stepResults),
      });
    }

    // The goal summary aggregates the TERMINAL confirmed results (steps no
    // other step depends on) — the fan-in plate handed back to Iroha.
    const dependedOn = new Set(steps.flatMap((step) => step.dependsOn ?? []));
    const summary = stepResults
      .filter((record) => !dependedOn.has(record.stepId))
      .map((record) => record.summary)
      .filter(Boolean)
      .join("\n");
    return Object.freeze({
      goalId,
      status: "completed",
      reason: null,
      summary,
      steps: Object.freeze(stepResults),
    });
  };

  // Shared entry for the public delegate_goal and recursive sub-delegations:
  // BOTH pass the same permission gate and the same guards — there is no
  // privileged inner path.
  const delegateInternal = (goal, { audience, depth, trackers }) => {
    const gate = evaluateDelegationGate({ policy: workRunnerPolicy, audience });
    if (!gate.ok) {
      throw new Error(
        gate.reason === "delegation_denied"
          ? "delegate_goal denied: Work Runner delegation is denied for this view"
          : "delegate_goal denied: delegation requires delegate_work permission",
      );
    }
    if (depth > guardPolicy.maxDepth) {
      throw new Error(
        `max_depth_exceeded: delegation depth ${depth} exceeds the limit of ${guardPolicy.maxDepth}`,
      );
    }
    const steps = normalizeSteps(goal);
    const goalId = createId("goal");
    const summary = runGoal({ goal, goalId, steps, audience, depth, trackers });
    return Object.freeze({ goalId, summary });
  };

  // delegate_goal: synchronous gate + validation, asynchronous execution.
  // Returns { goalId, summary } where summary is a Promise resolving to the
  // goal result — goal failures RESOLVE (status: "failed"), they never reject.
  const delegateGoal = (goal, { audience } = {}) =>
    delegateInternal(goal, {
      audience,
      depth: 0,
      trackers: { hires: 0, tokensUsed: 0 },
    });

  return Object.freeze({ delegateGoal });
};
