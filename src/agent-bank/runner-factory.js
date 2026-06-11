// Default runner factory (A1): the opt-in PRODUCTION wiring for the Hanaita's
// injected createRunner({ id, recipe }) and for the sandbox smoke trial.
//
// Authority model (no "recipe string -> command" path exists):
// - RUNTIME_BUILDERS is the CODE-SIDE allow map. The only commands that can
//   ever start are the two approved micro-harnesses (codex app-server,
//   claude-code CLI), with command/args/transport fixed in code or injected
//   by the OPERATOR via runtimeOptions — never read from a recipe.
// - WHICH runtime a recipe rides is decided from the existing authorities:
//   the seed manifest (originOf — B-1) says whether an id is builtin, and the
//   code-side builtinRuntimes map says what a builtin id rides. A minted
//   recipe runs only when the operator opted in via mintedRuntime.
// - Frontmatter is never consulted for resolution (B-2 posture): a recipe
//   self-declaring runtime/command fields changes nothing.
//
// The recipe DOES contribute its role + body as a prompt preamble (dressing):
// data into the prompt, never into the command line.

import {
  createClaudeCodeCliMicroHarness,
  createCodexAppServerMicroHarness,
} from "../adapters/index.js";

import { assertValidRecipeId } from "./ids.js";
import { originOf } from "./seed.js";

// Code-side allow map: runtime key -> builder. Adding a runtime is a code
// change here, by design.
const RUNTIME_BUILDERS = Object.freeze({
  codex: ({ id, cwd, options }) =>
    createCodexAppServerMicroHarness({ id, cwd, ...options }),
  "claude-code": ({ id, cwd, options }) =>
    createClaudeCodeCliMicroHarness({ id, cwd, ...options }),
});

// Code-side map from BUILTIN recipe id (per the seed manifest) to runtime key.
export const DEFAULT_BUILTIN_RUNTIMES = Object.freeze({
  codex: "codex",
  "claude-code": "claude-code",
});

// The specialist preamble: recipe role + body prepended to the task purpose.
const specialistPreamble = (recipe) => {
  const parts = [];
  if (typeof recipe?.role === "string" && recipe.role.trim()) {
    parts.push(`You are acting as: ${recipe.role.trim()}.`);
  }
  if (typeof recipe?.body === "string" && recipe.body.trim()) {
    parts.push(recipe.body.trim());
  }
  return parts.join("\n\n");
};

const dressWorker = ({ worker, recipe }) => {
  const preamble = specialistPreamble(recipe);
  if (!preamble) {
    return worker;
  }
  return Object.freeze({
    id: worker.id,
    capabilities: worker.capabilities,
    run: (task, context) =>
      worker.run(
        {
          ...task,
          purpose: [preamble, task?.purpose ?? task?.title ?? ""]
            .filter(Boolean)
            .join("\n\n"),
        },
        context,
      ),
    close: () => worker.close?.(),
  });
};

export const createDefaultRunnerFactory = ({
  root,
  cwd = process.cwd(),
  builtinRuntimes = DEFAULT_BUILTIN_RUNTIMES,
  mintedRuntime = null,
  // Operator-injected per-runtime options (e.g. a fake transport for codex,
  // a stand-in command for claude-code in tests, a model override, ...).
  runtimeOptions = {},
} = {}) => {
  if (!root) {
    throw new Error(
      "createDefaultRunnerFactory requires the bank root (the seed manifest is the origin authority)",
    );
  }
  if (
    mintedRuntime !== null &&
    !Object.hasOwn(RUNTIME_BUILDERS, mintedRuntime)
  ) {
    throw new Error(
      `mintedRuntime must be one of the approved runtimes (${Object.keys(RUNTIME_BUILDERS).join(", ")}), got: ${JSON.stringify(mintedRuntime)}`,
    );
  }

  const created = [];

  // Resolution rides the existing authorities only: seed manifest (origin)
  // and code-side maps. Returns a runtime key or null (= refuse).
  const resolveRuntimeKey = (id) => {
    if (originOf({ root, id }) === "builtin") {
      return Object.hasOwn(builtinRuntimes, id) ? builtinRuntimes[id] : null;
    }
    return mintedRuntime;
  };

  // H-1: a caller may pin the runner's EXECUTION boundary per call (`cwd`) —
  // the smoke trial passes its isolated trial workspace here so the child
  // process cwd (and codex's default sandboxPolicy.writableRoots, which
  // derive from cwd) point at the trial workspace, not at the factory's
  // construction-time cwd.
  const createRunner = ({ id, recipe, cwd: runCwd = null }) => {
    assertValidRecipeId(id);
    const runtimeKey = resolveRuntimeKey(id);
    const builder = runtimeKey ? RUNTIME_BUILDERS[runtimeKey] : null;
    if (!builder) {
      throw new Error(
        `runner_unavailable: no approved runtime for recipe ${id} ` +
          `(origin=${originOf({ root, id })}) — the runtime map is code-side ` +
          "authority; recipes cannot select commands",
      );
    }
    const worker = builder({
      id,
      cwd: runCwd ?? cwd,
      options: runtimeOptions[runtimeKey] ?? {},
    });
    created.push(worker);
    return dressWorker({ worker, recipe });
  };

  // Close every micro-harness this factory created (codex app-server keeps a
  // child process per runner; claude-code CLI runs exit on their own).
  createRunner.close = () => {
    for (const worker of created.splice(0)) {
      worker.close?.();
    }
  };

  return createRunner;
};
