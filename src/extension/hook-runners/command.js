import { spawn } from "node:child_process";

const MAX_STDOUT_BYTES = 1024 * 1024; // 1 MiB streaming cap
const DEFAULT_TIMEOUT_MS = 5000;

// Map the §3.4 wire contract to the internal decision shape.
const toDecision = (parsed) => {
  if (!parsed || typeof parsed !== "object") {
    throw new Error("command hook stdout is not a JSON object");
  }
  if (parsed.decision === "deny") {
    return { block: { reason: parsed.reason ?? null } };
  }
  if (parsed.decision === "allow") {
    const t = parsed.transform;
    return t && typeof t === "object" && Object.keys(t).length > 0
      ? { transform: t }
      : undefined;
  }
  throw new Error(
    `command hook returned an unrecognized decision: ${JSON.stringify(parsed.decision)}`,
  );
};

export const createCommandHook = (spec = {}) => {
  const {
    command,
    args = [],
    timeout = DEFAULT_TIMEOUT_MS,
    cwd = process.cwd(),
    env,
  } = spec;
  if (typeof command !== "string" || command.length === 0) {
    throw new Error("createCommandHook requires a non-empty string command");
  }
  if (!Array.isArray(args) || args.some((a) => typeof a !== "string")) {
    throw new Error(
      "createCommandHook requires args to be an array of strings",
    );
  }
  // Minimal environment by default: enough to locate an interpreter, never the
  // parent's secrets. spec.env explicitly extends the allow-list.
  const childEnv = { PATH: process.env.PATH, ...(env ?? {}) };

  return (ctx) =>
    new Promise((resolve, reject) => {
      const child = spawn(command, args, { shell: false, cwd, env: childEnv });
      let stdout = "";
      let bytes = 0;
      let settled = false;
      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        fn(value);
      };
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        finish(reject, new Error(`command hook timed out after ${timeout}ms`));
      }, timeout);

      child.stdout.on("data", (chunk) => {
        bytes += chunk.length;
        if (bytes > MAX_STDOUT_BYTES) {
          child.kill("SIGKILL");
          finish(reject, new Error("command hook stdout exceeded 1 MiB"));
          return;
        }
        stdout += chunk;
      });
      child.on("error", (error) => finish(reject, error));
      // A child that exits before reading stdin raises EPIPE on the write;
      // catch it so it routes through failModeFor, not as an uncaught rejection.
      child.stdin.on("error", (error) => finish(reject, error));
      child.on("close", (code) => {
        if (settled) return;
        if (code !== 0) {
          finish(reject, new Error(`command hook exited with code ${code}`));
          return;
        }
        let parsed;
        try {
          parsed = JSON.parse(stdout);
        } catch {
          finish(reject, new Error("command hook stdout is not valid JSON"));
          return;
        }
        try {
          finish(resolve, toDecision(parsed));
        } catch (error) {
          finish(reject, error);
        }
      });

      try {
        child.stdin.write(JSON.stringify(ctx ?? {}));
        child.stdin.end();
      } catch (error) {
        finish(reject, error);
      }
    });
};
