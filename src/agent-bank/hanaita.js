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
// micro-harness (Codex / OpenClaw / Claude Code adapter). Tests inject a fake;
// production wiring is future work and is documented as such in
// docs/agent-bank.md (no hidden default exists on purpose).

import { createScopedWorkRunnerMicroHarness } from "../adapters/index.js";

import { createBlackboard } from "./blackboard.js";
import { createBankRegistry } from "./registry.js";

const createId = (prefix) =>
  `${prefix}-${Math.random().toString(36).slice(2, 10)}`;

// Same decision table as createScopedWorkRunnerMicroHarness /
// bin createWorkRunnerPolicy: public=denied, trusted=permission-required
// (audience.canDelegateWork), owner=allowed. Exported so the gate semantics
// are testable in isolation (B-3).
export const evaluateDelegationGate = ({ policy, audience } = {}) => {
  const delegation = policy?.delegation || "denied";
  if (delegation === "denied") {
    return { ok: false, reason: "delegation_denied" };
  }
  if (delegation === "permission-required" && !audience?.canDelegateWork) {
    return { ok: false, reason: "permission_required" };
  }
  return { ok: true, reason: null };
};

const normalizeSteps = (goal) => {
  if (!Array.isArray(goal?.steps) || goal.steps.length === 0) {
    throw new Error("delegate_goal requires goal.steps (a non-empty array)");
  }
  const ids = new Set();
  for (const step of goal.steps) {
    if (!step?.id || !step?.recipe) {
      throw new Error("every goal step requires an id and a recipe");
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

  const runStep = async ({ goal, goalId, step, audience }) => {
    const recipe = hire(step.recipe);

    // The specialist's context slice: ONLY the instruction for this step plus
    // confirmed prior results read from the blackboard. Never the raw goal
    // context, never Iroha's identity context (§6.3).
    const slice = Object.freeze({
      goal: Object.freeze({ id: goalId, title: goal.title ?? "" }),
      instruction: step.slice ?? goal.description ?? "",
      prior: [],
    });

    const { ticketId, runId } = blackboard.open({
      title: step.title ?? `${goal.title ?? goalId} / ${step.id}`,
      purpose: slice.instruction,
      harnessId: step.recipe,
      input: { slice },
    });

    // Invariant 3: the worker runs INSIDE the existing scoped Work Runner
    // wrapper — its policy / permission / workspace checks are the live path.
    const worker = createRunner({ id: step.recipe, recipe });
    const scoped = createScopedWorkRunnerMicroHarness({
      id: step.recipe,
      worker,
      policy: workRunnerPolicy,
      allowedWorkspaces,
      defaultWorkspace,
      capabilities: recipe.toolset ?? [],
    });

    const task = Object.freeze({
      id: ticketId,
      title: step.title ?? step.id,
      purpose: slice.instruction,
      metadata: Object.freeze(
        step.workspace ? { workspace: step.workspace } : {},
      ),
    });

    const result = await scoped.run(task, { audience, slice });

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

    const output = {
      status: "completed",
      summary: result.summary ?? "",
    };
    blackboard.confirm({
      ticketId,
      runId,
      output,
      artifacts: result.artifacts ?? [],
    });

    return {
      stepId: step.id,
      recipeId: step.recipe,
      ticketId,
      status: "completed",
      summary: output.summary,
    };
  };

  const runGoal = async ({ goal, goalId, steps, audience }) => {
    const stepResults = [];
    try {
      for (const step of steps) {
        stepResults.push(await runStep({ goal, goalId, step, audience }));
      }
    } catch (error) {
      return Object.freeze({
        goalId,
        status: "failed",
        reason: error.message,
        summary: `goal failed: ${error.message}`,
        steps: Object.freeze(stepResults),
      });
    }

    const summary = stepResults
      .map((step) => step.summary)
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

  // delegate_goal: synchronous gate + validation, asynchronous execution.
  // Returns { goalId, summary } where summary is a Promise resolving to the
  // goal result — goal failures RESOLVE (status: "failed"), they never reject.
  const delegateGoal = (goal, { audience } = {}) => {
    const gate = evaluateDelegationGate({ policy: workRunnerPolicy, audience });
    if (!gate.ok) {
      throw new Error(
        gate.reason === "delegation_denied"
          ? "delegate_goal denied: Work Runner delegation is denied for this view"
          : "delegate_goal denied: delegation requires delegate_work permission",
      );
    }
    const steps = normalizeSteps(goal);
    const goalId = createId("goal");
    const summary = runGoal({ goal, goalId, steps, audience });
    return Object.freeze({ goalId, summary });
  };

  return Object.freeze({ delegateGoal });
};
