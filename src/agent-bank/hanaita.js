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
  // Phase 4.4 verify loop: mekiki-style (quality) and bantou-style
  // (permission) verifiers. Each is { id, verify({ step, recipe, result }) }
  // returning { ok, reasons } (sync or async). A rejected result is sent back
  // to the SAME specialist with the reasons as feedback, up to
  // maxVerifyAttempts; then the step is cut off and recorded as failed.
  verifiers = [],
  maxVerifyAttempts = 3,
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

  const runStep = async ({ goal, goalId, step, audience, ticketsByStep }) => {
    const recipe = hire(step.recipe);

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
      harnessId: step.recipe,
      input: { slice: makeSlice(null) },
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
      purpose: step.slice ?? goal.description ?? "",
      metadata: Object.freeze(
        step.workspace ? { workspace: step.workspace } : {},
      ),
    });

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
      });

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
        // The step record is the ONLY thing that leaves the orchestration for
        // this step (§6.3 reverse isolation): confirmed summary and
        // bookkeeping, never the runner's raw output or verify chatter.
        return {
          stepId: step.id,
          recipeId: step.recipe,
          ticketId,
          status: "completed",
          summary: output.summary,
          attempts,
        };
      }
      feedback = Object.freeze([...reasons]);
    }

    blackboard.reject({
      runId,
      output: {
        status: "failed",
        summary: `verify rejected after ${attempts} attempt(s): ${feedback.join("; ")}`,
      },
    });
    throw new Error(
      `verify_exhausted: step ${step.id} was rejected ${attempts} time(s) and was cut off: ${feedback.join("; ")}`,
    );
  };

  // The vertical thread (4.3): the Hanaita assigns every READY step (all
  // dependencies confirmed) as one parallel wave — fan-out — then folds the
  // confirmed results back before assigning dependents — pipeline / fan-in.
  // Star topology: specialists only ever talk to the Hanaita/blackboard.
  const runGoal = async ({ goal, goalId, steps, audience }) => {
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
          runStep({ goal, goalId, step, audience, ticketsByStep }),
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
