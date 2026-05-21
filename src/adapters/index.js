import { spawn } from "node:child_process";

const normalizeMicroHarnessOutput = (value, fallbackSummary) => {
  if (value && typeof value === "object") {
    return Object.freeze({
      status: value.status || "completed",
      summary: value.summary || fallbackSummary,
      artifacts: Object.freeze([...(value.artifacts || [])]),
      raw: value.raw === undefined ? value : value.raw
    });
  }
  return Object.freeze({
    status: "completed",
    summary: String(value || fallbackSummary),
    artifacts: Object.freeze([]),
    raw: value
  });
};

const createTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return Object.freeze({
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  });
};

export const createHttpMicroHarness = ({
  id,
  endpoint,
  capabilities = [],
  headers = {},
  timeoutMs = 60_000
}) => {
  if (!id || !endpoint) {
    throw new Error("createHttpMicroHarness requires id and endpoint");
  }

  return Object.freeze({
    id,
    capabilities: Object.freeze([...capabilities]),
    async run(task, context) {
      const timeout = createTimeoutSignal(timeoutMs);
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers
          },
          body: JSON.stringify({ task, context }),
          signal: timeout.signal
        });
        const responseText = await response.text();
        if (!response.ok) {
          return normalizeMicroHarnessOutput(
            {
              status: "failed",
              summary: `${id} HTTP ${response.status}: ${responseText}`,
              artifacts: [],
              raw: responseText
            },
            `${id} failed`
          );
        }
        const parsed = responseText.trim() ? JSON.parse(responseText) : {};
        return normalizeMicroHarnessOutput(parsed, `${id} completed`);
      } finally {
        timeout.clear();
      }
    }
  });
};

export const createJsonlProcessMicroHarness = ({
  id,
  command,
  args = [],
  cwd,
  env = {},
  capabilities = [],
  timeoutMs = 120_000
}) => {
  if (!id || !command) {
    throw new Error("createJsonlProcessMicroHarness requires id and command");
  }

  return Object.freeze({
    id,
    capabilities: Object.freeze([...capabilities]),
    run(task, context) {
      return new Promise((resolve) => {
        const child = spawn(command, args, {
          cwd,
          env: {
            ...process.env,
            ...env
          },
          stdio: ["pipe", "pipe", "pipe"]
        });
        let stdout = "";
        let stderr = "";
        let settled = false;

        const finish = (output) => {
          if (settled) {
            return;
          }
          settled = true;
          clearTimeout(timer);
          resolve(normalizeMicroHarnessOutput(output, `${id} completed`));
        };

        const timer = setTimeout(() => {
          child.kill("SIGTERM");
          finish({
            status: "failed",
            summary: `${id} timed out after ${timeoutMs}ms`,
            artifacts: [],
            raw: { stdout, stderr }
          });
        }, timeoutMs);

        child.stdout.on("data", (chunk) => {
          stdout += chunk.toString("utf8");
        });
        child.stderr.on("data", (chunk) => {
          stderr += chunk.toString("utf8");
        });
        child.on("error", (error) => {
          finish({
            status: "failed",
            summary: `${id} process error: ${error.message}`,
            artifacts: [],
            raw: { stdout, stderr }
          });
        });
        child.on("close", (code) => {
          const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
          const lastLine = lines.at(-1);
          if (lastLine) {
            try {
              finish(JSON.parse(lastLine));
              return;
            } catch {
              // Fall through to plain text output.
            }
          }
          finish({
            status: code === 0 ? "completed" : "failed",
            summary: stdout.trim() || stderr.trim() || `${id} exited with ${code}`,
            artifacts: [],
            raw: { stdout, stderr, code }
          });
        });
        child.stdin.end(`${JSON.stringify({ task, context })}\n`);
      });
    }
  });
};

export const createMotionPngTuberMapper = () =>
  Object.freeze({
    id: "motionpngtuber-mapper",
    mapState(state) {
      if (state.mode === "speaking") {
        return "mouth_on_eye_on";
      }
      if (state.mode === "working" || state.mode === "thinking") {
        return "mouth_off_eye_on";
      }
      if (state.mode === "error") {
        return "mouth_off_eye_off";
      }
      return "mouth_off_eye_on";
    }
  });

export const createM5StackFaceMapper = () =>
  Object.freeze({
    id: "m5stack-face-mapper",
    mapState(state) {
      const faces = {
        idle: ":)",
        listening: "o_o",
        thinking: "...",
        speaking: ":D",
        working: ">_>",
        error: "x_x"
      };
      return faces[state.mode] || faces.idle;
    }
  });

export const createEvenG2DisplayMapper = () =>
  Object.freeze({
    id: "even-g2-display-mapper",
    mapState(state) {
      if (state.speechText) {
        return state.speechText.slice(0, 80);
      }
      if (state.mode === "working") {
        return "Working...";
      }
      if (state.mode === "thinking") {
        return "Thinking...";
      }
      return "";
    }
  });
