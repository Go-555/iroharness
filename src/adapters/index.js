import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, normalize, relative, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

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

const tryParseJsonLine = (stdout) => {
  const lines = stdout.trim().split(/\r?\n/).filter(Boolean);
  const lastLine = lines.at(-1);
  if (!lastLine) {
    return null;
  }
  try {
    return JSON.parse(lastLine);
  } catch {
    return null;
  }
};

const truncateForPrompt = (value, maxLength = 8000) => {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength)}\n[truncated]`;
};

const normalizeSpeechText = (text) =>
  String(text || "")
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>|~-]+/g, "")
    .replace(/\b(?:OK|okay)\b/g, "うん")
    .replace(/\b(?:Yes|No)\b/g, (match) => (match === "Yes" ? "はい" : "いいえ"))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const buildDefaultMicroHarnessPrompt = ({ task, context = {}, label }) =>
  [
    `${label} task from IroHarness.`,
    "IroHarness owns the character identity, user permissions, and PJOS state. Treat yourself as a delegated micro harness.",
    `Task ID: ${task.id || "task"}`,
    task.title ? `Title: ${task.title}` : "",
    task.purpose ? `Purpose: ${task.purpose}` : "",
    context.character
      ? `Character:\n${truncateForPrompt(context.character, 2000)}`
      : "",
    context.actor ? `Actor:\n${truncateForPrompt(context.actor, 2000)}` : "",
    context.projectOs ? `Project OS:\n${truncateForPrompt(context.projectOs)}` : "",
    "Return either natural language or a final JSON line with status, summary, and artifacts."
  ]
    .filter(Boolean)
    .join("\n\n");

const withTimeout = (promise, timeoutMs, message) =>
  new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });

const createTimeoutSignal = (timeoutMs) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return Object.freeze({
    signal: controller.signal,
    clear: () => clearTimeout(timeout)
  });
};

const nowIso = () => new Date().toISOString();

const createAdapterEvent = ({ adapterId, sequence, event, extra = {} }) =>
  Object.freeze({
    ...event,
    ...extra,
    adapterId,
    sequence,
    timestamp: nowIso()
  });

const parseJsonResponse = async ({ response, label }) => {
  const responseText = await response.text();
  if (!response.ok) {
    throw new Error(`${label} failed: ${response.status} ${responseText}`);
  }
  return responseText.trim() ? JSON.parse(responseText) : {};
};

const bufferFromAudioChunk = (chunk) => {
  const audio = chunk?.audio || chunk?.data || chunk;
  if (!audio) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(audio)) {
    return audio;
  }
  if (audio instanceof ArrayBuffer) {
    return Buffer.from(audio);
  }
  if (ArrayBuffer.isView(audio)) {
    return Buffer.from(audio.buffer, audio.byteOffset, audio.byteLength);
  }
  if (typeof audio === "object" && typeof audio.dataBase64 === "string") {
    return Buffer.from(audio.dataBase64, "base64");
  }
  if (typeof audio === "string") {
    return Buffer.from(audio, "base64");
  }
  return Buffer.alloc(0);
};

const arrayBufferToBase64 = (value) => Buffer.from(value).toString("base64");

const isRiffWave = (buffer) =>
  Buffer.isBuffer(buffer) &&
  buffer.length >= 12 &&
  buffer.toString("ascii", 0, 4) === "RIFF" &&
  buffer.toString("ascii", 8, 12) === "WAVE";

const createPcm16WavBuffer = ({ pcm, sampleRate = 16000, channels = 1 } = {}) => {
  const data = Buffer.isBuffer(pcm) ? pcm : Buffer.from(pcm || []);
  const wav = Buffer.alloc(44 + data.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + data.length, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * 2, 28);
  wav.writeUInt16LE(channels * 2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(data.length, 40);
  data.copy(wav, 44);
  return wav;
};

const parsePcm16Wav = (audio) => {
  const buffer = Buffer.isBuffer(audio) ? audio : Buffer.from(audio || []);
  if (!isRiffWave(buffer)) {
    throw new Error("expected RIFF/WAVE audio");
  }

  let fmt = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkSize;
    if (chunkEnd > buffer.length) {
      break;
    }
    if (chunkId === "fmt ") {
      fmt = {
        audioFormat: buffer.readUInt16LE(chunkStart),
        channels: buffer.readUInt16LE(chunkStart + 2),
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14)
      };
    }
    if (chunkId === "data") {
      data = buffer.subarray(chunkStart, chunkEnd);
    }
    offset = chunkEnd + (chunkSize % 2);
  }

  if (!fmt || !data) {
    throw new Error("WAV audio is missing fmt or data chunk");
  }
  if (fmt.audioFormat !== 1 || fmt.bitsPerSample !== 16) {
    throw new Error(`unsupported WAV format=${fmt.audioFormat} bits=${fmt.bitsPerSample}`);
  }
  return Object.freeze({
    encoding: "pcm16",
    dataBase64: data.toString("base64"),
    sampleRate: fmt.sampleRate,
    channels: fmt.channels,
    bitsPerSample: 16
  });
};

const normalizeStackChanSpeechAudio = (event) => {
  const encoding = String(event?.encoding || "wav").toLowerCase();
  if (encoding === "wav") {
    const parsed = parsePcm16Wav(Buffer.from(event.audio || "", "base64"));
    return Object.freeze({
      encoding: "pcm16",
      dataBase64: parsed.dataBase64,
      sampleRate: parsed.sampleRate,
      channels: parsed.channels,
      bitsPerSample: parsed.bitsPerSample
    });
  }
  return Object.freeze({
    encoding: encoding === "pcm_s16le" ? "pcm16" : encoding,
    dataBase64: event?.audio || event?.dataBase64 || "",
    sampleRate: event?.sampleRate || event?.sample_rate || 24000,
    channels: event?.channels || 1,
    bitsPerSample: event?.bitsPerSample || event?.bits_per_sample || 16
  });
};

const splitStackChanSpeechAudio = (audio, { maxBytes = 8192 } = {}) => {
  const data = Buffer.from(audio?.dataBase64 || "", "base64");
  if (data.length === 0 || data.length <= maxBytes || audio?.encoding !== "pcm16") {
    return Object.freeze([audio]);
  }
  const bytesPerSampleFrame = Math.max(
    1,
    Number(audio.channels || 1) * Math.max(1, Number(audio.bitsPerSample || 16) / 8)
  );
  const chunkBytes = Math.max(
    bytesPerSampleFrame,
    Math.floor(maxBytes / bytesPerSampleFrame) * bytesPerSampleFrame
  );
  const chunks = [];
  for (let offset = 0; offset < data.length; offset += chunkBytes) {
    chunks.push(
      Object.freeze({
        ...audio,
        dataBase64: data.subarray(offset, offset + chunkBytes).toString("base64")
      })
    );
  }
  return Object.freeze(chunks);
};

const sendJson = (response, status, value) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(`${JSON.stringify(value)}\n`);
};

const readRequestJson = (request) =>
  new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString("utf8");
    });
    request.on("end", () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });

const mimeTypes = Object.freeze({
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8"
});

const defaultPublicDir = () =>
  fileURLToPath(new URL("../../examples/browser-avatar", import.meta.url));

const readOpenApiSpec = () =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL("../../protocols/openapi.json", import.meta.url)), "utf8")
  );

const readPackageInfo = () => {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../../package.json", import.meta.url)), "utf8")
  );
  return Object.freeze({
    name: pkg.name || "iroharness",
    version: pkg.version || "0.0.0"
  });
};

const serveStatic = (response, publicDir, pathname) => {
  const requestPath = pathname === "/" ? "/index.html" : pathname;
  const normalizedPath = normalize(requestPath).replace(/^(\.\.[/\\])+/, "");
  const fullPath = join(publicDir, normalizedPath);
  const publicRoot = normalize(publicDir);
  if (!normalize(fullPath).startsWith(publicRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }
  try {
    const stats = statSync(fullPath);
    if (!stats.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": mimeTypes[extname(fullPath)] || "application/octet-stream",
      "cache-control": "no-store"
    });
    response.end(readFileSync(fullPath));
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
};

const normalizeText = (value) => String(value || "").trim();

const pathInside = ({ root, candidate }) => {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  const relativePath = relative(resolvedRoot, resolvedCandidate);
  return Boolean(relativePath) && !relativePath.startsWith("..") && !relativePath.startsWith("/");
};

const pathSameOrInside = ({ root, candidate }) => {
  const resolvedRoot = resolve(root);
  const resolvedCandidate = resolve(candidate);
  return resolvedRoot === resolvedCandidate || pathInside({ root: resolvedRoot, candidate: resolvedCandidate });
};

const normalizeWorkspaceRoots = (roots) =>
  Object.freeze([...(roots || [])].filter(Boolean).map((root) => resolve(String(root))));

const resolveRequestedWorkspace = ({ task, context, defaultWorkspace }) =>
  task?.metadata?.workspace ||
  context?.input?.metadata?.workspace ||
  context?.input?.metadata?.requestedWorkspace ||
  context?.input?.metadata?.repositoryWorkspace ||
  defaultWorkspace ||
  null;

const failedWorkRunnerOutput = ({ summary, reason, raw = {} }) =>
  Object.freeze({
    status: "failed",
    summary,
    artifacts: Object.freeze([]),
    raw: Object.freeze({
      reason,
      ...raw
    })
  });

const normalizeActor = ({ platform, platformUserId, displayName }) =>
  Object.freeze({
    platform,
    platformUserId: String(platformUserId || "unknown"),
    displayName: normalizeText(displayName) || "Anonymous"
  });

const buildTurn = ({ source, text, actor, metadata = {}, raw }) =>
  Object.freeze({
    source,
    modality: "text",
    text: normalizeText(text),
    actor,
    metadata: Object.freeze(metadata),
    raw
  });

const safeInlineJson = (value) => JSON.stringify(value).replace(/</g, "\\u003c");
const escapeHtmlText = (value) =>
  String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

export const createVsCodeCompanionAdapter = ({
  platformUserId = "vscode-local",
  displayName = "VS Code Developer",
  metadata = {}
} = {}) => {
  const actor = normalizeActor({
    platform: "vscode",
    platformUserId,
    displayName
  });

  return Object.freeze({
    id: "vscode-companion",
    platform: "vscode",
    actor,
    capabilities: Object.freeze(["text-chat", "developer-discussion", "micro-harness-delegation"]),
    createTurn({ text, modality = "text", workspace = null, raw = null } = {}) {
      return freezeTurn({
        source: "vscode",
        modality,
        text,
        actor,
        metadata: {
          ...metadata,
          workspace
        },
        raw
      });
    }
  });
};

const freezeTurn = ({ source, modality, text, actor, metadata = {}, raw }) =>
  Object.freeze({
    source,
    modality,
    text: normalizeText(text),
    actor,
    metadata: Object.freeze(metadata),
    raw
  });

export const createVsCodeCompanionWebviewHtml = ({
  serverUrl = "http://127.0.0.1:4178",
  title = "IroHarness",
  actor = {
    platform: "vscode",
    platformUserId: "vscode-local",
    displayName: "VS Code Developer"
  }
} = {}) => {
  const config = safeInlineJson({
    serverUrl: String(serverUrl || "http://127.0.0.1:4178").replace(/\/+$/, ""),
    actor
  });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtmlText(normalizeText(title) || "IroHarness")}</title>
    <style>
      :root { color-scheme: dark; font-family: var(--vscode-font-family); }
      body { margin: 0; padding: 12px; color: var(--vscode-foreground); background: var(--vscode-sideBar-background); }
      main { display: grid; gap: 10px; }
      #status { color: var(--vscode-descriptionForeground); font-size: 12px; }
      #events { display: grid; gap: 8px; max-height: 55vh; overflow: auto; }
      .event { border: 1px solid var(--vscode-panel-border); padding: 8px; background: var(--vscode-editor-background); }
      .event strong { display: block; margin-bottom: 4px; color: var(--vscode-textLink-foreground); }
      form { display: grid; gap: 8px; }
      textarea { width: 100%; min-height: 86px; box-sizing: border-box; color: var(--vscode-input-foreground); background: var(--vscode-input-background); border: 1px solid var(--vscode-input-border); padding: 8px; }
      button { color: var(--vscode-button-foreground); background: var(--vscode-button-background); border: 0; padding: 8px 10px; cursor: pointer; }
      button:hover { background: var(--vscode-button-hoverBackground); }
    </style>
  </head>
  <body>
    <main>
      <div id="status">Connecting to IroHarness...</div>
      <div id="events"></div>
      <form id="turn-form">
        <textarea id="text" placeholder="IroHarness と話す"></textarea>
        <button type="submit">Send</button>
      </form>
    </main>
    <script>
      const config = ${config};
      const status = document.querySelector("#status");
      const events = document.querySelector("#events");
      const form = document.querySelector("#turn-form");
      const text = document.querySelector("#text");

      const appendEvent = (label, value) => {
        const row = document.createElement("div");
        row.className = "event";
        const strong = document.createElement("strong");
        strong.textContent = label;
        const body = document.createElement("div");
        body.textContent = typeof value === "string" ? value : JSON.stringify(value);
        row.append(strong, body);
        events.prepend(row);
      };

      const loadState = async () => {
        const response = await fetch(config.serverUrl + "/state");
        const state = await response.json();
        status.textContent = state.character.name + " / " + state.mode + " / " + state.emotion;
      };

      const connectEvents = () => {
        const source = new EventSource(config.serverUrl + "/events");
        source.addEventListener("speech", (event) => {
          appendEvent("speech", JSON.parse(event.data));
        });
        source.addEventListener("task", (event) => {
          appendEvent("task", JSON.parse(event.data));
        });
        source.addEventListener("state", (event) => {
          const payload = JSON.parse(event.data);
          status.textContent = payload.state.mode + " / " + payload.state.emotion;
        });
        source.onerror = () => {
          status.textContent = "Reconnecting to " + config.serverUrl;
        };
      };

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        const value = text.value.trim();
        if (!value) return;
        await fetch(config.serverUrl + "/turn", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            source: "vscode",
            modality: "text",
            text: value,
            actor: config.actor
          })
        });
        text.value = "";
      });

      loadState().then(connectEvents).catch((error) => {
        status.textContent = String(error.message || error);
      });
    </script>
  </body>
</html>`;
};

const createObsRequestId = () =>
  `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const truncateDiscordMessage = (value) => String(value || "").slice(0, 2000);
const truncateSlackMessage = (value) => String(value || "").slice(0, 40000);

const createObsAuthentication = ({ password, salt, challenge }) => {
  const secret = createHash("sha256")
    .update(`${password}${salt}`)
    .digest("base64");
  return createHash("sha256")
    .update(`${secret}${challenge}`)
    .digest("base64");
};

export const createCodexAppServerTransport = ({
  command = "codex",
  args = ["app-server"],
  cwd = process.cwd(),
  clientInfo = {
    name: "iroharness",
    title: "IroHarness",
    version: "0.1.0"
  },
  onStderr = () => {},
  onExit = () => {}
} = {}) => {
  let processRef = null;
  let nextId = 1;
  let initialized = false;
  let listeners = [];
  const pending = new Map();

  const emit = (event) => {
    listeners.forEach((listener) => listener(event));
  };

  const start = () => {
    if (processRef) {
      return processRef;
    }
    processRef = spawn(command, args, {
      cwd,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const lines = createInterface({ input: processRef.stdout });
    lines.on("line", (line) => {
      try {
        const message = JSON.parse(line);
        if (typeof message.id === "number" && pending.has(message.id)) {
          const entry = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) {
            entry.reject(new Error(message.error.message || "Codex app-server request failed"));
          } else {
            entry.resolve(message.result);
          }
        }
        emit(message);
      } catch (error) {
        emit({
          method: "transport/error",
          params: {
            message: error.message,
            line
          }
        });
      }
    });
    processRef.stderr.on("data", (chunk) => onStderr(chunk.toString("utf8")));
    processRef.on("exit", (code, signal) => {
      processRef = null;
      initialized = false;
      onExit({ code, signal });
    });
    return processRef;
  };

  const sendNotification = (method, params = {}) => {
    const child = start();
    child.stdin.write(`${JSON.stringify({ method, params })}\n`);
  };

  const sendRequest = (method, params = {}) => {
    const child = start();
    const id = nextId;
    nextId += 1;
    const promise = new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
    child.stdin.write(`${JSON.stringify({ method, id, params })}\n`);
    return promise;
  };

  const initialize = async () => {
    if (initialized) {
      return;
    }
    await sendRequest("initialize", { clientInfo });
    sendNotification("initialized", {});
    initialized = true;
  };

  const subscribe = (listener) => {
    listeners = [...listeners, listener];
    return () => {
      listeners = listeners.filter((candidate) => candidate !== listener);
    };
  };

  const close = () => {
    if (processRef) {
      processRef.kill("SIGTERM");
    }
    processRef = null;
    initialized = false;
    pending.clear();
  };

  return Object.freeze({
    initialize,
    sendRequest,
    sendNotification,
    subscribe,
    close
  });
};

const extractCodexText = (events) =>
  events
    .filter((event) => event.method === "item/agentMessage/delta")
    .map((event) => event.params?.delta || event.params?.text || "")
    .join("")
    .trim();

export const createCodexAppServerMicroHarness = ({
  id = "codex",
  cwd = process.cwd(),
  model = "gpt-5.4",
  approvalPolicy = "on-request",
  sandboxPolicy = {
    type: "workspaceWrite",
    writableRoots: [cwd],
    networkAccess: false
  },
  threadSandbox = "workspace-write",
  serviceName = "iroharness",
  timeoutMs = 10 * 60_000,
  capabilities = ["code", "files", "review"],
  transport = createCodexAppServerTransport({ cwd })
} = {}) => {
  let threadId = null;

  const ensureThread = async () => {
    await transport.initialize?.();
    if (threadId) {
      return threadId;
    }
    const result = await transport.sendRequest("thread/start", {
      model,
      cwd,
      approvalPolicy,
      sandbox: threadSandbox,
      serviceName
    });
    const nextThreadId = result?.thread?.id;
    if (!nextThreadId) {
      throw new Error("Codex app-server did not return a thread id");
    }
    threadId = nextThreadId;
    return threadId;
  };

  const run = async (task, context = {}) => {
    const nextThreadId = await ensureThread();
    const inputText = [
      task.purpose || task.title,
      "",
      context.actor
        ? `Actor: ${context.actor.user?.displayName || context.actor.identity?.displayName || "unknown"}`
        : "",
      `Ticket: ${task.id}`
    ]
      .filter(Boolean)
      .join("\n");
    const events = [];
    const unsubscribe = transport.subscribe?.((event) => {
      events.push(event);
    });
    try {
      const waitForCompletion = new Promise((resolve) => {
        const stop = transport.subscribe?.((event) => {
          if (event.method === "turn/completed") {
            stop?.();
            resolve(event);
          }
        });
      });
      const turn = await transport.sendRequest("turn/start", {
        threadId: nextThreadId,
        input: [{ type: "text", text: inputText }],
        cwd,
        approvalPolicy,
        sandboxPolicy
      });
      await withTimeout(
        waitForCompletion,
        timeoutMs,
        `Codex app-server turn timed out after ${timeoutMs}ms`
      );
      const summary = extractCodexText(events) || "Codex turn completed.";
      return Object.freeze({
        status: "completed",
        summary,
        artifacts: Object.freeze([
          {
            kind: "codex-events",
            uri: `memory://codex/${task.id}`,
            title: "Codex app-server events"
          }
        ]),
        raw: Object.freeze({
          threadId: nextThreadId,
          turn,
          events
        })
      });
    } catch (error) {
      return Object.freeze({
        status: "failed",
        summary: error.message,
        artifacts: Object.freeze([]),
        raw: Object.freeze({
          threadId: nextThreadId,
          events
        })
      });
    } finally {
      unsubscribe?.();
    }
  };

  return Object.freeze({
    id,
    capabilities: Object.freeze([...capabilities]),
    run,
    close() {
      transport.close?.();
      threadId = null;
    }
  });
};

export const createScopedWorkRunnerMicroHarness = ({
  id = null,
  worker,
  policy = {
    kind: "iroharness.workRunnerPolicy",
    zone: "owner",
    delegation: "allowed",
    boundary: "runner-only",
    runnerAccess: {
      repositoryWork: "scoped-workspace",
      browserControl: "scoped-session",
      defaultSandbox: "workspace-write"
    }
  },
  allowedWorkspaces = [],
  defaultWorkspace = null,
  capabilities = null
} = {}) => {
  if (!worker || typeof worker.run !== "function") {
    throw new Error("createScopedWorkRunnerMicroHarness requires worker.run");
  }
  const runnerId = id || worker.id || "work-runner";
  const workspaceRoots = normalizeWorkspaceRoots(allowedWorkspaces);
  const resolvedDefaultWorkspace = defaultWorkspace ? resolve(defaultWorkspace) : null;
  const policyDelegation = policy?.delegation || "denied";
  const repositoryWork = policy?.runnerAccess?.repositoryWork || "none";

  const scopeWorkspace = ({ task, context }) => {
    const requested = resolveRequestedWorkspace({
      task,
      context,
      defaultWorkspace: resolvedDefaultWorkspace
    });
    if (!requested) {
      return {
        ok: false,
        reason: "workspace_required",
        summary: "Work Runner requires an explicit workspace."
      };
    }
    const resolvedWorkspace = resolve(String(requested));
    const matchedRoot = workspaceRoots.find((root) =>
      pathSameOrInside({ root, candidate: resolvedWorkspace })
    );
    if (!matchedRoot) {
      return {
        ok: false,
        reason: "workspace_out_of_scope",
        summary: `Workspace is outside the allowed Work Runner scope: ${resolvedWorkspace}`,
        workspace: resolvedWorkspace
      };
    }
    return {
      ok: true,
      workspace: resolvedWorkspace,
      root: matchedRoot
    };
  };

  const run = async (task, context = {}) => {
    if (policyDelegation === "denied") {
      return failedWorkRunnerOutput({
        summary: "Work Runner delegation is denied for this view.",
        reason: "delegation_denied",
        raw: { policy }
      });
    }
    if (policyDelegation === "permission-required" && !context.audience?.canDelegateWork) {
      return failedWorkRunnerOutput({
        summary: "Work Runner delegation requires delegate_work permission.",
        reason: "permission_required",
        raw: { policy }
      });
    }
    if (repositoryWork === "none") {
      return failedWorkRunnerOutput({
        summary: "Repository work is not enabled for this Work Runner policy.",
        reason: "repository_work_disabled",
        raw: { policy }
      });
    }
    const scoped = scopeWorkspace({ task, context });
    if (!scoped.ok) {
      return failedWorkRunnerOutput({
        summary: scoped.summary,
        reason: scoped.reason,
        raw: {
          policy,
          workspace: scoped.workspace || null,
          allowedWorkspaces: workspaceRoots
        }
      });
    }
    const scopedTask = Object.freeze({
      ...task,
      metadata: Object.freeze({
        ...(task.metadata || {}),
        workspace: scoped.workspace,
        workRunnerRoot: scoped.root
      })
    });
    return worker.run(scopedTask, {
      ...context,
      workRunner: Object.freeze({
        id: runnerId,
        policy,
        workspace: scoped.workspace,
        root: scoped.root,
        allowedWorkspaces: workspaceRoots
      })
    });
  };

  return Object.freeze({
    id: runnerId,
    capabilities: Object.freeze([...(capabilities || worker.capabilities || [])]),
    run,
    close() {
      worker.close?.();
    }
  });
};

const formatCodexBrainContext = ({ slot, model, context }) =>
  [
    "You are the current IroHarness brain for this character.",
    "Answer as the character. Do not claim to be Codex unless the user asks about the backend.",
    "Keep character identity, audience permissions, and Project OS context stable.",
    "Do not modify files or run development work from this brain path; delegate work belongs to micro harnesses.",
    "Always answer in natural Japanese unless the user explicitly asks for another language.",
    "For voice or StackChan input, produce one or two short spoken Japanese sentences.",
    "Avoid Markdown, bullet lists, code blocks, URLs, emoji, and English filler in voice replies.",
    "Do not include backend labels such as TEXT, VOICE, Codex, model names, or route names unless the user asks.",
    "",
    `Brain slot: ${slot}`,
    `Model: ${model || "default"}`,
    "",
    "Character:",
    JSON.stringify(context.character || {}, null, 2),
    "",
    "Actor:",
    JSON.stringify(context.actor || {}, null, 2),
    "",
    "Audience:",
    JSON.stringify(context.audience || {}, null, 2),
    "",
    "Route:",
    JSON.stringify(context.route || {}, null, 2),
    "",
    "Project OS snapshot:",
    JSON.stringify(context.projectOs || {}, null, 2),
    "",
    "User message:",
    context.input?.text || ""
  ].join("\n");

export const createCodexAppServerBrain = ({
  id = "codex-brain",
  slot = "text",
  cwd = process.cwd(),
  model = "gpt-5.4",
  approvalPolicy = "never",
  sandboxPolicy = {
    type: "readOnly",
    writableRoots: [],
    networkAccess: false
  },
  threadSandbox = "read-only",
  serviceName = "iroharness-brain",
  timeoutMs = 2 * 60_000,
  transport = createCodexAppServerTransport({ cwd }),
  formatContext = formatCodexBrainContext
} = {}) => {
  let threadId = null;

  const ensureThread = async () => {
    await transport.initialize?.();
    if (threadId) {
      return threadId;
    }
    const result = await transport.sendRequest("thread/start", {
      model,
      cwd,
      approvalPolicy,
      sandbox: threadSandbox,
      serviceName
    });
    const nextThreadId = result?.thread?.id;
    if (!nextThreadId) {
      throw new Error("Codex app-server brain did not return a thread id");
    }
    threadId = nextThreadId;
    return threadId;
  };

  return Object.freeze({
    id,
    async respond(context) {
      const nextThreadId = await ensureThread();
      const events = [];
      const unsubscribe = transport.subscribe?.((event) => {
        events.push(event);
      });
      try {
        const waitForCompletion = new Promise((resolve) => {
          const stop = transport.subscribe?.((event) => {
            if (event.method === "turn/completed") {
              stop?.();
              resolve(event);
            }
          });
        });
        await transport.sendRequest("turn/start", {
          threadId: nextThreadId,
          input: [
            {
              type: "text",
              text: formatContext({ slot, model, context })
            }
          ],
          cwd,
          approvalPolicy,
          sandboxPolicy
        });
        await withTimeout(
          waitForCompletion,
          timeoutMs,
          `Codex app-server brain ${id} timed out after ${timeoutMs}ms`
        );
        return Object.freeze({
          text: extractCodexText(events) || "受け取ったよ。",
          emotion: context.audience?.responseDepth === "standard" ? "focused" : "attentive",
          raw: Object.freeze({
            provider: "codex",
            model,
            threadId: nextThreadId,
            events
          })
        });
      } finally {
        unsubscribe?.();
      }
    },
    close() {
      transport.close?.();
      threadId = null;
    }
  });
};

const extractOpenAiResponsesText = (payload = {}) => {
  if (typeof payload.output_text === "string") {
    return payload.output_text;
  }
  const output = Array.isArray(payload.output) ? payload.output : [];
  return output
    .flatMap((item) => (Array.isArray(item.content) ? item.content : []))
    .map((content) => content.text || "")
    .join("")
    .trim();
};

const formatOpenAiBrainPrompt = ({ slot, context }) => {
  const character = context.character || {};
  const audience = context.audience || {};
  const actor = context.actor || {};
  const input = context.input || {};

  const system = [
    `あなたは${character.name || character.id || "IroHarness character"}です。`,
    "IroHarnessの同じ人格として、自然な日本語で返答してください。",
    slot === "voice"
      ? "音声会話用です。最初に短い相づちを置いてもよいです。返答は1〜2文、30文字前後を目安にしてください。"
      : "テキスト会話用です。必要な範囲で自然に返答してください。",
    "音声合成される可能性があるため、Markdown、箇条書き、コード、URL、絵文字、XMLタグ、モデル名、backend名は使わないでください。",
    "ユーザーの入力は音声認識結果の可能性があります。文脈上おかしい場合は、元の発話を推測してください。",
    character.soul ? `SOUL:\n${character.soul}` : null,
    character.identity ? `IDENTITY:\n${character.identity}` : null,
    character.memory ? `MEMORY:\n${character.memory}` : null,
    character.voiceStyle ? `VOICE:\n${character.voiceStyle}` : null
  ]
    .filter(Boolean)
    .join("\n\n");

  const user = [
    `actor: ${actor.displayName || actor.user?.displayName || "user"}`,
    `relationship: ${audience.relationship || "public"}`,
    `modality: ${input.modality || "text"}`,
    "",
    input.text || ""
  ].join("\n");

  return Object.freeze({ system, user });
};

export const createOpenAiResponsesBrain = ({
  id = "openai-responses-brain",
  slot = "voice",
  apiKey = process.env.OPENAI_API_KEY || "",
  baseUrl = process.env.OPENAI_BASE_URL || "https://api.openai.com/v1",
  model = "gpt-5.5",
  maxOutputTokens = slot === "voice" ? 96 : 700,
  fetchImpl = globalThis.fetch
} = {}) => {
  if (!apiKey) {
    throw new Error("createOpenAiResponsesBrain requires OPENAI_API_KEY");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createOpenAiResponsesBrain requires fetchImpl");
  }
  const endpoint = `${String(baseUrl).replace(/\/+$/, "")}/responses`;
  return Object.freeze({
    id,
    async respond(context) {
      const prompt = formatOpenAiBrainPrompt({ slot, context });
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          authorization: `Bearer ${apiKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          model,
          instructions: prompt.system,
          input: prompt.user,
          max_output_tokens: maxOutputTokens
        })
      });
      const payload = await parseJsonResponse({ response, label: `OpenAI brain ${id}` });
      const text = normalizeSpeechText(extractOpenAiResponsesText(payload));
      return Object.freeze({
        text: text || "うん、聞いてるよ。",
        emotion: "attentive",
        raw: Object.freeze({
          provider: "openai",
          model,
          payload
        })
      });
    }
  });
};

export const createDiscordMessageAdapter = ({
  ignoreBots = true,
  mentionOnly = false,
  botUserId = null
} = {}) =>
  Object.freeze({
    id: "discord-message-adapter",
    platform: "discord",
    normalize(payload) {
      const author = payload.author || payload.member?.user || {};
      if (ignoreBots && author.bot) {
        return null;
      }
      const content = normalizeText(payload.content);
      const mentions = Array.isArray(payload.mentions) ? payload.mentions : [];
      const mentionsBot =
        botUserId && mentions.some((mention) => String(mention.id) === String(botUserId));
      if (mentionOnly && !mentionsBot) {
        return null;
      }
      return buildTurn({
        source: "discord",
        text: content,
        actor: normalizeActor({
          platform: "discord",
          platformUserId: author.id || payload.userId,
          displayName: author.global_name || author.username || payload.displayName
        }),
        metadata: {
          channelId: payload.channel_id || payload.channelId || null,
          guildId: payload.guild_id || payload.guildId || null,
          messageId: payload.id || payload.messageId || null,
          mentionOnly,
          mentionsBot
        },
        raw: payload
      });
    }
  });

export const createYouTubeLiveChatAdapter = () =>
  Object.freeze({
    id: "youtube-live-chat-adapter",
    platform: "youtube",
    normalize(payload) {
      const snippet = payload.snippet || {};
      const author = payload.authorDetails || payload.author || {};
      return buildTurn({
        source: "youtube",
        text:
          snippet.displayMessage ||
          snippet.textMessageDetails?.messageText ||
          payload.message ||
          payload.text,
        actor: normalizeActor({
          platform: "youtube",
          platformUserId: author.channelId || payload.authorChannelId || payload.userId,
          displayName: author.displayName || payload.displayName
        }),
        metadata: {
          liveChatId: snippet.liveChatId || payload.liveChatId || null,
          messageId: payload.id || payload.messageId || null,
          isChatOwner: Boolean(author.isChatOwner),
          isChatModerator: Boolean(author.isChatModerator),
          isChatSponsor: Boolean(author.isChatSponsor)
        },
        raw: payload
      });
    }
  });

export const createSlackMessageAdapter = ({
  ignoreBots = true,
  mentionOnly = false,
  botUserId = null,
  stripMention = true
} = {}) =>
  Object.freeze({
    id: "slack-message-adapter",
    platform: "slack",
    normalize(payload) {
      const event = payload.event || payload;
      if (!event || !["message", "app_mention"].includes(event.type)) {
        return null;
      }
      if (ignoreBots && (event.bot_id || event.subtype === "bot_message")) {
        return null;
      }
      const rawText = normalizeText(event.text);
      const mentionsBot = botUserId ? rawText.includes(`<@${botUserId}>`) : false;
      if (mentionOnly && event.type !== "app_mention" && !mentionsBot) {
        return null;
      }
      const text =
        stripMention && botUserId
          ? rawText.replace(new RegExp(`<@${botUserId}>`, "g"), "").trim()
          : rawText;
      const profile = event.user_profile || event.message?.user_profile || {};
      return buildTurn({
        source: "slack",
        text,
        actor: normalizeActor({
          platform: "slack",
          platformUserId: event.user || payload.userId,
          displayName:
            profile.display_name ||
            profile.real_name ||
            event.username ||
            payload.displayName ||
            event.user
        }),
        metadata: {
          teamId: payload.team_id || event.team || null,
          channelId: event.channel || payload.channelId || null,
          messageTs: event.ts || payload.ts || null,
          threadTs: event.thread_ts || event.ts || payload.threadTs || null,
          eventType: event.type,
          mentionOnly,
          mentionsBot
        },
        raw: payload
      });
    }
  });

export const createPlatformAdapterRegistry = (adapters = []) => {
  const byPlatform = new Map(adapters.map((adapter) => [adapter.platform, adapter]));
  return Object.freeze({
    normalize(platform, payload) {
      const adapter = byPlatform.get(platform);
      if (!adapter) {
        throw new Error(`Platform adapter not found: ${platform}`);
      }
      return adapter.normalize(payload);
    },
    platforms() {
      return Object.freeze([...byPlatform.keys()]);
    }
  });
};

const normalizeSessionPlatform = (session) => session.platform || session.source || null;

const normalizeSessionChannelId = (session) =>
  session.platformChannelId || session.platform_channel_id || session.channelId || null;

const candidateTurnChannelIds = (turn) =>
  Object.freeze(
    [
      turn.metadata?.streamChannelId,
      turn.metadata?.liveChatId,
      turn.metadata?.channelId,
      turn.metadata?.guildId,
      turn.metadata?.teamId
    ]
      .filter(Boolean)
      .map((value) => String(value))
  );

export const createSnapshotStreamSessionResolver = ({
  snapshot,
  includeStatuses = ["live", "paused"]
}) => {
  if (!snapshot) {
    throw new Error("createSnapshotStreamSessionResolver requires snapshot");
  }

  return async (turn) => {
    const currentSnapshot = typeof snapshot === "function" ? await snapshot() : snapshot;
    const sessions = Array.isArray(currentSnapshot?.streamSessions)
      ? currentSnapshot.streamSessions
      : [];
    const platform = turn.source || turn.actor?.platform || null;
    const channelIds = candidateTurnChannelIds(turn);
    return (
      sessions.find((session) => {
        const sessionPlatform = normalizeSessionPlatform(session);
        const sessionChannelId = normalizeSessionChannelId(session);
        return (
          sessionPlatform === platform &&
          channelIds.includes(String(sessionChannelId)) &&
          includeStatuses.includes(session.status)
        );
      }) || null
    );
  };
};

export const createStreamContextEnricher = ({ resolveStreamSession }) => {
  if (typeof resolveStreamSession !== "function") {
    throw new Error("createStreamContextEnricher requires resolveStreamSession");
  }

  return async (turn) => {
    const session = await resolveStreamSession(turn);
    if (!session) {
      return turn;
    }
    return Object.freeze({
      ...turn,
      metadata: Object.freeze({
        ...(turn.metadata || {}),
        streamSessionId: session.id,
        streamPlatform: normalizeSessionPlatform(session),
        streamChannelId: normalizeSessionChannelId(session),
        streamTitle: session.title || null
      })
    });
  };
};

export const createDiscordBotRuntime = ({
  token,
  harness,
  WebSocketImpl = globalThis.WebSocket,
  fetchImpl = globalThis.fetch,
  gatewayUrl = "wss://gateway.discord.gg/?v=10&encoding=json",
  apiBaseUrl = "https://discord.com/api/v10",
  intents = 33280,
  adapter = createDiscordMessageAdapter(),
  respond = true,
  responseFormatter = ({ result }) => result.text || result.output?.summary || null,
  turnEnricher = async (turn) => turn,
  onReady = () => {},
  onResult = () => {},
  onError = () => {}
}) => {
  if (!token) {
    throw new Error("createDiscordBotRuntime requires token");
  }
  if (!harness || typeof harness.receive !== "function") {
    throw new Error("createDiscordBotRuntime requires harness.receive");
  }
  if (typeof WebSocketImpl !== "function") {
    throw new Error("createDiscordBotRuntime requires WebSocketImpl");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createDiscordBotRuntime requires fetchImpl");
  }

  let socket = null;
  let sequence = null;
  let heartbeatTimer = null;
  let sessionId = null;
  let botUserId = null;
  let active = false;

  const sendGateway = (payload) => {
    if (!socket || socket.readyState !== 1) {
      throw new Error("Discord Gateway is not open");
    }
    socket.send(JSON.stringify(payload));
  };

  const sendHeartbeat = () => {
    sendGateway({
      op: 1,
      d: sequence
    });
  };

  const identify = () => {
    sendGateway({
      op: 2,
      d: {
        token,
        intents,
        properties: {
          os: "iroharness",
          browser: "iroharness",
          device: "iroharness"
        }
      }
    });
  };

  const createMessage = async ({ channelId, content, messageReference = null }) => {
    const body = {
      content: truncateDiscordMessage(content)
    };
    if (messageReference) {
      body.message_reference = messageReference;
    }
    const response = await fetchImpl(`${apiBaseUrl}/channels/${channelId}/messages`, {
      method: "POST",
      headers: {
        authorization: `Bot ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Discord Create Message ${response.status}: ${responseText}`);
    }
    return responseText.trim() ? JSON.parse(responseText) : {};
  };

  const handleDispatch = async (message) => {
    if (message.t === "READY") {
      sessionId = message.d?.session_id || null;
      botUserId = message.d?.user?.id || null;
      onReady(Object.freeze({ sessionId, botUserId, raw: message.d }));
      return;
    }
    if (message.t !== "MESSAGE_CREATE") {
      return;
    }
    const author = message.d?.author || {};
    if (botUserId && String(author.id) === String(botUserId)) {
      return;
    }
    const turn = adapter.normalize(message.d);
    if (!turn || !turn.text) {
      return;
    }
    const enrichedTurn = await turnEnricher(turn);
    const result = await harness.receive(enrichedTurn);
    let reply = null;
    if (respond) {
      reply = responseFormatter({ turn: enrichedTurn, result });
      if (reply) {
        await createMessage({
          channelId: message.d.channel_id,
          content: reply,
          messageReference: {
            message_id: message.d.id,
            channel_id: message.d.channel_id,
            guild_id: message.d.guild_id,
            fail_if_not_exists: false
          }
        });
      }
    }
    onResult(Object.freeze({ turn: enrichedTurn, result, reply }));
  };

  const handleMessage = async (raw) => {
    const text = typeof raw === "string" ? raw : raw?.data || raw?.toString("utf8");
    const message = JSON.parse(text);
    if (typeof message.s === "number") {
      sequence = message.s;
    }
    if (message.op === 10) {
      heartbeatTimer = setInterval(sendHeartbeat, message.d.heartbeat_interval);
      identify();
      return;
    }
    if (message.op === 1) {
      sendHeartbeat();
      return;
    }
    if (message.op === 0) {
      await handleDispatch(message);
    }
  };

  const start = () => {
    if (active) {
      return;
    }
    active = true;
    socket = new WebSocketImpl(gatewayUrl);
    socket.addEventListener?.("message", (event) => {
      handleMessage(event).catch(onError);
    });
    socket.addEventListener?.("error", () => {
      onError(new Error("Discord Gateway connection error"));
    });
    socket.addEventListener?.("close", () => {
      active = false;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    });
    socket.onmessage = (event) => {
      handleMessage(event).catch(onError);
    };
    socket.onerror = () => {
      onError(new Error("Discord Gateway connection error"));
    };
    socket.onclose = () => {
      active = false;
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
    };
  };

  const stop = () => {
    active = false;
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    if (socket) {
      socket.close?.();
    }
    socket = null;
  };

  return Object.freeze({
    start,
    stop,
    createMessage,
    state() {
      return Object.freeze({
        active,
        sessionId,
        botUserId,
        sequence
      });
    }
  });
};

export const createSlackEventsRuntime = ({
  botToken,
  harness,
  adapter = createSlackMessageAdapter(),
  fetchImpl = globalThis.fetch,
  apiBaseUrl = "https://slack.com/api",
  respond = true,
  responseFormatter = ({ result }) => result.text || result.output?.summary || null,
  turnEnricher = async (turn) => turn,
  onResult = () => {},
  onError = () => {}
}) => {
  if (!botToken) {
    throw new Error("createSlackEventsRuntime requires botToken");
  }
  if (!harness || typeof harness.receive !== "function") {
    throw new Error("createSlackEventsRuntime requires harness.receive");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createSlackEventsRuntime requires fetchImpl");
  }

  const postMessage = async ({ channelId, text, threadTs = null }) => {
    const response = await fetchImpl(`${apiBaseUrl}/chat.postMessage`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${botToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        channel: channelId,
        text: truncateSlackMessage(text),
        ...(threadTs ? { thread_ts: threadTs } : {})
      })
    });
    const responseText = await response.text();
    const payload = responseText.trim() ? JSON.parse(responseText) : {};
    if (!response.ok || payload.ok === false) {
      throw new Error(`Slack chat.postMessage failed: ${response.status} ${responseText}`);
    }
    return payload;
  };

  const handlePayload = async (payload) => {
    if (payload?.type === "url_verification") {
      return Object.freeze({
        kind: "challenge",
        challenge: payload.challenge || ""
      });
    }
    if (payload?.type && payload.type !== "event_callback") {
      return Object.freeze({
        kind: "ignored",
        reason: `unsupported Slack payload type: ${payload.type}`
      });
    }
    const turn = adapter.normalize(payload);
    if (!turn || !turn.text) {
      return Object.freeze({
        kind: "ignored",
        reason: "adapter ignored payload"
      });
    }
    try {
      const enrichedTurn = await turnEnricher(turn);
      const result = await harness.receive(enrichedTurn);
      let reply = null;
      let posted = null;
      if (respond) {
        reply = responseFormatter({ turn: enrichedTurn, result });
        if (reply) {
          posted = await postMessage({
            channelId: enrichedTurn.metadata.channelId,
            text: reply,
            threadTs: enrichedTurn.metadata.threadTs
          });
        }
      }
      const event = Object.freeze({ turn: enrichedTurn, result, reply, posted });
      onResult(event);
      return event;
    } catch (error) {
      onError(error);
      throw error;
    }
  };

  return Object.freeze({
    handlePayload,
    postMessage
  });
};

export const createYouTubeLiveChatPollingRuntime = ({
  apiKey,
  liveChatId,
  harness,
  adapter = createYouTubeLiveChatAdapter(),
  fetchImpl = globalThis.fetch,
  intervalMs = 5_000,
  maxResults = 50,
  pageToken = null,
  turnEnricher = async (turn) => turn,
  onResult = () => {},
  onError = () => {}
}) => {
  if (!apiKey || !liveChatId) {
    throw new Error("createYouTubeLiveChatPollingRuntime requires apiKey and liveChatId");
  }
  if (!harness || typeof harness.receive !== "function") {
    throw new Error("createYouTubeLiveChatPollingRuntime requires harness.receive");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createYouTubeLiveChatPollingRuntime requires fetchImpl");
  }

  let active = false;
  let nextPageToken = pageToken;
  let nextIntervalMs = intervalMs;
  let timer = null;
  const seenIds = new Set();

  const buildUrl = () => {
    const url = new URL("https://www.googleapis.com/youtube/v3/liveChat/messages");
    url.searchParams.set("liveChatId", liveChatId);
    url.searchParams.set("part", "snippet,authorDetails");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("maxResults", String(maxResults));
    if (nextPageToken) {
      url.searchParams.set("pageToken", nextPageToken);
    }
    return url.toString();
  };

  const pollOnce = async () => {
    const response = await fetchImpl(buildUrl());
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`YouTube Live Chat API ${response.status}: ${responseText}`);
    }
    const payload = responseText.trim() ? JSON.parse(responseText) : {};
    nextPageToken = payload.nextPageToken || nextPageToken;
    nextIntervalMs = Number(payload.pollingIntervalMillis || intervalMs);

    const items = Array.isArray(payload.items) ? payload.items : [];
    const results = [];
    for (const item of items) {
      if (item.id && seenIds.has(item.id)) {
        continue;
      }
      if (item.id) {
        seenIds.add(item.id);
      }
      const turn = adapter.normalize(item);
      if (!turn || !turn.text) {
        continue;
      }
      const enrichedTurn = await turnEnricher(turn);
      const result = await harness.receive(enrichedTurn);
      const event = Object.freeze({ item, turn: enrichedTurn, result });
      results.push(event);
      onResult(event);
    }
    return Object.freeze({
      nextPageToken,
      pollingIntervalMillis: nextIntervalMs,
      results: Object.freeze(results)
    });
  };

  const scheduleNext = () => {
    if (!active) {
      return;
    }
    timer = setTimeout(async () => {
      try {
        await pollOnce();
      } catch (error) {
        onError(error);
      } finally {
        scheduleNext();
      }
    }, nextIntervalMs);
  };

  const start = () => {
    if (active) {
      return;
    }
    active = true;
    scheduleNext();
  };

  const stop = () => {
    active = false;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return Object.freeze({
    pollOnce,
    start,
    stop,
    state() {
      return Object.freeze({
        active,
        nextPageToken,
        nextIntervalMs,
        seenCount: seenIds.size
      });
    }
  });
};

export const createObsWebSocketAdapter = ({
  url = "ws://127.0.0.1:4455",
  password = null,
  WebSocketImpl = globalThis.WebSocket,
  timeoutMs = 10_000
} = {}) => {
  if (typeof WebSocketImpl !== "function") {
    throw new Error("createObsWebSocketAdapter requires WebSocketImpl");
  }

  let socket = null;
  let identified = false;
  let connectPromise = null;
  const pending = new Map();

  const send = (payload) => {
    if (!socket || socket.readyState !== 1) {
      throw new Error("OBS WebSocket is not open");
    }
    socket.send(JSON.stringify(payload));
  };

  const resolvePending = (message) => {
    const requestId = message.d?.requestId;
    if (!requestId || !pending.has(requestId)) {
      return;
    }
    const entry = pending.get(requestId);
    pending.delete(requestId);
    clearTimeout(entry.timer);
    const requestStatus = message.d?.requestStatus || {};
    if (requestStatus.result === false) {
      entry.reject(
        new Error(
          requestStatus.comment || `OBS request failed: ${message.d?.requestType || requestId}`
        )
      );
      return;
    }
    entry.resolve(Object.freeze(message.d || {}));
  };

  const handleMessage = (raw) => {
    const text = typeof raw === "string" ? raw : raw?.data || raw?.toString("utf8");
    const message = JSON.parse(text);
    if (message.op === 0) {
      const auth = message.d?.authentication;
      const identify = {
        op: 1,
        d: {
          rpcVersion: message.d?.rpcVersion || 1
        }
      };
      if (password && auth?.salt && auth?.challenge) {
        identify.d.authentication = createObsAuthentication({
          password,
          salt: auth.salt,
          challenge: auth.challenge
        });
      }
      send(identify);
      return;
    }
    if (message.op === 2) {
      identified = true;
      return;
    }
    if (message.op === 7) {
      resolvePending(message);
    }
  };

  const connect = () => {
    if (connectPromise) {
      return connectPromise;
    }
    connectPromise = new Promise((resolve, reject) => {
      socket = new WebSocketImpl(url);
      const timer = setTimeout(() => {
        reject(new Error(`OBS WebSocket connection timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const cleanup = () => clearTimeout(timer);
      socket.addEventListener?.("message", (event) => {
        handleMessage(event);
        if (identified) {
          cleanup();
          resolve(api);
        }
      });
      socket.addEventListener?.("error", () => {
        cleanup();
        reject(new Error("OBS WebSocket connection error"));
      });
      socket.addEventListener?.("close", () => {
        identified = false;
        connectPromise = null;
      });
      socket.onmessage = (event) => {
        handleMessage(event);
        if (identified) {
          cleanup();
          resolve(api);
        }
      };
      socket.onerror = () => {
        cleanup();
        reject(new Error("OBS WebSocket connection error"));
      };
      socket.onclose = () => {
        identified = false;
        connectPromise = null;
      };
    });
    return connectPromise;
  };

  const request = async (requestType, requestData = {}) => {
    await connect();
    const requestId = createObsRequestId();
    const response = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId);
        reject(new Error(`OBS request timed out: ${requestType}`));
      }, timeoutMs);
      pending.set(requestId, { resolve, reject, timer });
    });
    send({
      op: 6,
      d: {
        requestType,
        requestId,
        requestData
      }
    });
    return response;
  };

  const close = () => {
    if (socket) {
      socket.close?.();
    }
    socket = null;
    identified = false;
    connectPromise = null;
  };

  const api = Object.freeze({
    connect,
    request,
    setCurrentProgramScene(sceneName) {
      return request("SetCurrentProgramScene", { sceneName });
    },
    setInputSettings(inputName, inputSettings, overlay = true) {
      return request("SetInputSettings", {
        inputName,
        inputSettings,
        overlay
      });
    },
    setInputMute(inputName, inputMuted) {
      return request("SetInputMute", {
        inputName,
        inputMuted
      });
    },
    close,
    state() {
      return Object.freeze({
        url,
        identified,
        pending: pending.size
      });
    }
  });

  return api;
};

const inferObsStreamAction = ({
  input,
  overlayInputName,
  overlayUrl,
  overlayWidth,
  overlayHeight,
  defaultSceneName
}) => {
  const metadata = input.metadata || {};
  const text = normalizeText(input.text).toLowerCase();
  const requestedAction = metadata.obsAction || metadata.streamAction || null;
  const sceneName = metadata.obsSceneName || metadata.sceneName || defaultSceneName;
  const inputName = metadata.obsInputName || metadata.inputName || overlayInputName;
  const inputMuted =
    typeof metadata.inputMuted === "boolean"
      ? metadata.inputMuted
      : !(text.includes("unmute") || text.includes("ミュート解除"));

  if (
    requestedAction === "overlay" ||
    text.includes("overlay") ||
    text.includes("オーバーレイ") ||
    text.includes("browser source")
  ) {
    return Object.freeze({
      kind: "overlay",
      inputName,
      inputSettings: Object.freeze({
        url: metadata.overlayUrl || metadata.obsOverlayUrl || overlayUrl,
        width: Number(metadata.overlayWidth || overlayWidth),
        height: Number(metadata.overlayHeight || overlayHeight)
      })
    });
  }

  if (requestedAction === "mute" || text.includes("mute") || text.includes("ミュート")) {
    return Object.freeze({
      kind: "mute",
      inputName,
      inputMuted
    });
  }

  if (
    requestedAction === "scene" ||
    text.includes("scene") ||
    text.includes("シーン") ||
    text.includes("配信")
  ) {
    return Object.freeze({
      kind: "scene",
      sceneName
    });
  }

  return Object.freeze({
    kind: "unknown"
  });
};

export const createObsStreamController = ({
  id = "obs-stream-controller",
  obs,
  overlayInputName = "IroHarness Overlay",
  overlayUrl = "http://127.0.0.1:4178/?view=overlay",
  overlayWidth = 1280,
  overlayHeight = 720,
  defaultSceneName = null
} = {}) => {
  if (!obs || typeof obs.setCurrentProgramScene !== "function") {
    throw new Error("createObsStreamController requires an OBS adapter");
  }

  const execute = async ({ input, route, actor }) => {
    const action = inferObsStreamAction({
      input,
      overlayInputName,
      overlayUrl,
      overlayWidth,
      overlayHeight,
      defaultSceneName
    });

    if (action.kind === "scene") {
      if (!action.sceneName) {
        return Object.freeze({
          status: "failed",
          summary: "OBS scene action requires sceneName or defaultSceneName.",
          action,
          artifacts: Object.freeze([])
        });
      }
      const raw = await obs.setCurrentProgramScene(action.sceneName);
      return Object.freeze({
        status: "completed",
        summary: `OBS scene switched to ${action.sceneName}.`,
        action,
        raw,
        artifacts: Object.freeze([])
      });
    }

    if (action.kind === "overlay") {
      const raw = await obs.setInputSettings(action.inputName, action.inputSettings);
      return Object.freeze({
        status: "completed",
        summary: `OBS overlay updated for ${action.inputName}.`,
        action,
        raw,
        artifacts: Object.freeze([])
      });
    }

    if (action.kind === "mute") {
      const raw = await obs.setInputMute(action.inputName, action.inputMuted);
      return Object.freeze({
        status: "completed",
        summary: `OBS input ${action.inputName} mute=${action.inputMuted}.`,
        action,
        raw,
        artifacts: Object.freeze([])
      });
    }

    return Object.freeze({
      status: "failed",
      summary: "OBS stream action could not be inferred.",
      action: Object.freeze({
        ...action,
        route,
        actorUserId: actor?.user?.id || null
      }),
      artifacts: Object.freeze([])
    });
  };

  return Object.freeze({
    id,
    capabilities: Object.freeze(["obs", "scene", "overlay", "mute", "stream"]),
    execute,
    close() {
      obs.close?.();
    }
  });
};

export const createEventStreamDevice = (id = "event-stream") => {
  let clients = [];
  let events = [];

  const writeEvent = (response, event) => {
    response.write(`event: ${event.type}\n`);
    response.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  return Object.freeze({
    id,
    kind: "event-stream",
    capabilities: Object.freeze(["state", "speech", "task"]),
    emit(event) {
      const storedEvent = Object.freeze({ ...event });
      events = Object.freeze([...events.slice(-199), storedEvent]);
      clients.forEach((client) => writeEvent(client, storedEvent));
    },
    connect(request, response) {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      response.write(": connected\n\n");
      events.slice(-20).forEach((event) => writeEvent(response, event));
      clients = Object.freeze([...clients, response]);
      request.on("close", () => {
        clients = Object.freeze(clients.filter((client) => client !== response));
      });
    },
    events() {
      return Object.freeze([...events]);
    }
  });
};

const createBodyPayload = ({ id, kind, event, latestState, mapper, mapPayload }) => {
  const state = event.state || latestState || null;
  const mapped = state ? mapper.mapState(state) : null;
  const speechText = event.text || event.state?.speechText || state?.speechText || null;
  return Object.freeze({
    id,
    kind,
    eventType: event.type,
    state,
    mapped,
    speechText,
    payload: mapPayload({
      event,
      state,
      mapped,
      speechText
    })
  });
};

export const createMappedBodyBridgeDevice = ({
  id,
  kind = "body",
  mapper,
  capabilities = ["state", "speech", "task", "body-state"],
  mapPayload = ({ mapped }) => mapped
}) => {
  if (!id || !mapper || typeof mapper.mapState !== "function") {
    throw new Error("createMappedBodyBridgeDevice requires id and mapper.mapState");
  }

  let latestState = null;
  let latestPayload = null;
  let payloads = [];
  let clients = [];

  const writePayload = (response, payload) => {
    response.write(`event: body\n`);
    response.write(`data: ${JSON.stringify(payload)}\n\n`);
  };

  return Object.freeze({
    id,
    kind,
    capabilities: Object.freeze([...capabilities]),
    emit(event) {
      if (event.state) {
        latestState = event.state;
      }
      const payload = createBodyPayload({
        id,
        kind,
        event,
        latestState,
        mapper,
        mapPayload
      });
      latestPayload = payload;
      payloads = Object.freeze([...payloads.slice(-199), payload]);
      clients.forEach((client) => writePayload(client, payload));
    },
    snapshot() {
      return latestPayload;
    },
    payloads() {
      return Object.freeze([...payloads]);
    },
    connect(request, response) {
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache, no-transform",
        connection: "keep-alive",
        "x-accel-buffering": "no"
      });
      response.write(": connected\n\n");
      payloads.slice(-20).forEach((payload) => writePayload(response, payload));
      clients = Object.freeze([...clients, response]);
      request.on("close", () => {
        clients = Object.freeze(clients.filter((client) => client !== response));
      });
    }
  });
};

export const createIroHarnessDevServerHandler = ({
  harness,
  userRegistry = null,
  adminToken = null,
  eventStream,
  bodyDevices = [],
  platformAdapters = createPlatformAdapterRegistry([
    createDiscordMessageAdapter(),
    createSlackMessageAdapter(),
    createYouTubeLiveChatAdapter()
  ]),
  turnEnricher = async (turn) => turn,
  runtimeStatus = () => [],
  publicDir = defaultPublicDir()
}) => {
  if (!harness || !eventStream) {
    throw new Error("createIroHarnessDevServer requires harness and eventStream");
  }
  const audienceRegistry = userRegistry;
  const requireAudienceRegistry = (methodName) => {
    if (!audienceRegistry || typeof audienceRegistry[methodName] !== "function") {
      throw new Error(`audience registry does not support ${methodName}`);
    }
    return audienceRegistry;
  };
  const headerValue = (request, name) => {
    const headers = request.headers || {};
    return headers[name] || headers[name.toLowerCase()] || headers[name.toUpperCase()] || null;
  };
  const hasAdminAccess = (request) => {
    if (!adminToken) {
      return true;
    }
    const authorization = headerValue(request, "authorization");
    const token = authorization?.startsWith("Bearer ")
      ? authorization.slice("Bearer ".length)
      : headerValue(request, "x-iroharness-admin-token");
    return token === adminToken;
  };
  const audiencePath = (pathname) =>
    pathname === "/audience" || pathname.startsWith("/audience/");
  const packageInfo = readPackageInfo();
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const bodySummary = () =>
    bodyDevices.map((body) => ({
      id: body.id,
      kind: body.kind,
      capabilities: body.capabilities || []
    }));
  const brainSummary = () =>
    typeof harness.brains === "function" ? harness.brains() : [];

  return async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    try {
      if (audiencePath(url.pathname) && !hasAdminAccess(request)) {
        sendJson(response, 401, { error: "admin_token_required" });
        return;
      }
      if (request.method === "GET" && url.pathname === "/health") {
        const state = harness.state();
        const projectOs =
          typeof harness.projectOs === "function"
            ? harness.projectOs()
            : { tickets: [], runs: [], artifacts: [] };
        sendJson(response, 200, {
          ok: true,
          service: {
            ...packageInfo,
            startedAt,
            uptimeMs: Math.max(0, Date.now() - startedAtMs)
          },
          characterId: state.characterId,
          mode: state.mode,
          audienceRegistry: Boolean(audienceRegistry),
          adminProtected: Boolean(adminToken),
          brains: brainSummary(),
          bodies: bodySummary(),
          platforms: platformAdapters.platforms(),
          runtimes: runtimeStatus(),
          projectOs: {
            tickets: Array.isArray(projectOs.tickets) ? projectOs.tickets.length : 0,
            runs: Array.isArray(projectOs.runs) ? projectOs.runs.length : 0,
            artifacts: Array.isArray(projectOs.artifacts) ? projectOs.artifacts.length : 0
          }
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/events") {
        eventStream.connect(request, response);
        return;
      }
      if (request.method === "GET" && url.pathname === "/state") {
        sendJson(response, 200, harness.state());
        return;
      }
      if (request.method === "GET" && url.pathname === "/pjos") {
        sendJson(response, 200, harness.projectOs());
        return;
      }
      if (request.method === "GET" && url.pathname === "/openapi.json") {
        sendJson(response, 200, readOpenApiSpec());
        return;
      }
      if (request.method === "GET" && url.pathname === "/audience") {
        const snapshot =
          audienceRegistry && typeof audienceRegistry.snapshot === "function"
            ? await audienceRegistry.snapshot()
            : typeof harness.users === "function"
              ? await harness.users()
              : null;
        if (!snapshot) {
          sendJson(response, 404, { error: "audience_registry_not_configured" });
          return;
        }
        sendJson(response, 200, snapshot);
        return;
      }
      if (request.method === "GET" && url.pathname === "/audience/resolve") {
        if (!audienceRegistry || typeof audienceRegistry.resolveActor !== "function") {
          sendJson(response, 404, { error: "audience_registry_not_configured" });
          return;
        }
        const platform = url.searchParams.get("platform");
        const platformUserId = url.searchParams.get("platformUserId");
        if (!platform || !platformUserId) {
          sendJson(response, 400, {
            error: "invalid_audience_identity",
            message: "platform and platformUserId query parameters are required"
          });
          return;
        }
        const actor = await audienceRegistry.resolveActor({
          platform,
          platformUserId,
          displayName: url.searchParams.get("displayName") || ""
        });
        sendJson(response, 200, {
          known: actor.known,
          user: actor.user,
          identity: actor.identity
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/audience/users") {
        const payload = await readRequestJson(request);
        const user = await requireAudienceRegistry("registerUser").registerUser(payload);
        sendJson(response, 201, { user });
        return;
      }
      const userMatch = url.pathname.match(/^\/audience\/users\/([^/]+)$/);
      if (request.method === "PATCH" && userMatch) {
        const payload = await readRequestJson(request);
        const user = await requireAudienceRegistry("updateUser").updateUser(userMatch[1], payload);
        sendJson(response, 200, { user });
        return;
      }
      const identityMatch = url.pathname.match(/^\/audience\/users\/([^/]+)\/identities$/);
      if (request.method === "POST" && identityMatch) {
        const payload = await readRequestJson(request);
        const identity = await requireAudienceRegistry("linkIdentity").linkIdentity({
          ...payload,
          userId: identityMatch[1]
        });
        sendJson(response, 201, { identity });
        return;
      }
      const permissionMatch = url.pathname.match(/^\/audience\/users\/([^/]+)\/permissions$/);
      if (request.method === "POST" && permissionMatch) {
        const payload = await readRequestJson(request);
        const permissionOverride = await requireAudienceRegistry(
          "setPermissionOverride"
        ).setPermissionOverride({
          ...payload,
          userId: permissionMatch[1]
        });
        sendJson(response, 201, { permissionOverride });
        return;
      }
      if (request.method === "DELETE" && permissionMatch) {
        const permission = url.searchParams.get("permission");
        const scope = url.searchParams.get("scope") || "global";
        if (!permission) {
          sendJson(response, 400, {
            error: "invalid_permission_override",
            message: "permission query parameter is required"
          });
          return;
        }
        const result = await requireAudienceRegistry(
          "deletePermissionOverride"
        ).deletePermissionOverride({
          userId: permissionMatch[1],
          permission,
          scope
        });
        sendJson(response, 200, { permissionOverride: result });
        return;
      }
      if (request.method === "POST" && url.pathname === "/audience/stream-sessions") {
        const payload = await readRequestJson(request);
        const streamSession =
          await requireAudienceRegistry("createStreamSession").createStreamSession(payload);
        sendJson(response, 201, { streamSession });
        return;
      }
      const streamMatch = url.pathname.match(/^\/audience\/stream-sessions\/([^/]+)$/);
      if (request.method === "PATCH" && streamMatch) {
        const payload = await readRequestJson(request);
        const streamSession = await requireAudienceRegistry(
          "updateStreamSession"
        ).updateStreamSession(streamMatch[1], payload);
        sendJson(response, 200, { streamSession });
        return;
      }
      if (request.method === "GET" && url.pathname === "/bodies") {
        sendJson(response, 200, {
          bodies: bodySummary()
        });
        return;
      }
      const bodyMatch = url.pathname.match(/^\/body\/([^/]+)(\/events)?$/);
      if (request.method === "GET" && bodyMatch) {
        const body = bodyDevices.find((candidate) => candidate.id === bodyMatch[1]);
        if (!body) {
          sendJson(response, 404, { error: "body_not_found" });
          return;
        }
        if (bodyMatch[2]) {
          if (typeof body.connect !== "function") {
            sendJson(response, 400, { error: "body_stream_not_supported" });
            return;
          }
          body.connect(request, response);
          return;
        }
        sendJson(response, 200, {
          id: body.id,
          kind: body.kind,
          state: typeof body.snapshot === "function" ? body.snapshot() : null
        });
        return;
      }
      if (request.method === "POST" && url.pathname === "/turn") {
        const payload = await readRequestJson(request);
        const result = await harness.receive({
          source: payload.source || "browser",
          modality: payload.modality || "text",
          text: payload.text || "",
          actor: payload.actor || {
            platform: payload.source || "browser",
            platformUserId: payload.userId || "browser-guest",
            displayName: payload.displayName || "Browser Guest"
          }
        });
        sendJson(response, 200, result);
        return;
      }
      const platformMatch = url.pathname.match(/^\/platform\/([^/]+)\/message$/);
      if (request.method === "POST" && platformMatch) {
        const payload = await readRequestJson(request);
        const turn = platformAdapters.normalize(platformMatch[1], payload);
        if (!turn) {
          sendJson(response, 202, { ignored: true });
          return;
        }
        const enrichedTurn = await turnEnricher(turn);
        const result = await harness.receive(enrichedTurn);
        sendJson(response, 200, {
          turn: enrichedTurn,
          result
        });
        return;
      }
      if (request.method === "GET" && url.pathname === "/platforms") {
        sendJson(response, 200, { platforms: platformAdapters.platforms() });
        return;
      }
      if (request.method === "GET") {
        serveStatic(response, publicDir, url.pathname);
        return;
      }
      sendJson(response, 405, { error: "method_not_allowed" });
    } catch (error) {
      sendJson(response, 500, {
        error: "internal_error",
        message: error.message
      });
    }
  };
};

export const createIroHarnessDevServer = (options) => {
  const server = createServer(createIroHarnessDevServerHandler(options));

  return Object.freeze({
    server,
    listen({ port = 4178, host = "127.0.0.1" } = {}) {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          resolve({
            port: server.address().port,
            host,
            url: `http://${host}:${server.address().port}`
          });
        });
      });
    },
    close() {
      return new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });
};

export const createHttpMicroHarness = ({
  id,
  endpoint,
  capabilities = [],
  headers = {},
  fetchImpl = globalThis.fetch,
  buildRequest = ({ task, context }) => ({ task, context }),
  parseResponse = (payload) => payload,
  timeoutMs = 60_000
}) => {
  if (!id || !endpoint) {
    throw new Error("createHttpMicroHarness requires id and endpoint");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createHttpMicroHarness requires fetchImpl");
  }

  return Object.freeze({
    id,
    capabilities: Object.freeze([...capabilities]),
    async run(task, context) {
      const timeout = createTimeoutSignal(timeoutMs);
      try {
        const response = await fetchImpl(endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...headers
          },
          body: JSON.stringify(buildRequest({ task, context })),
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
        return normalizeMicroHarnessOutput(parseResponse(parsed), `${id} completed`);
      } finally {
        timeout.clear();
      }
    }
  });
};

export const createOpenClawMicroHarness = ({
  id = "openclaw",
  endpoint,
  apiKey = null,
  agentId = null,
  sessionId = null,
  capabilities = ["assistant", "tools", "memory", "automation"],
  fetchImpl = globalThis.fetch,
  timeoutMs = 120_000
}) =>
  createHttpMicroHarness({
    id,
    endpoint,
    capabilities,
    fetchImpl,
    timeoutMs,
    headers: {
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    buildRequest({ task, context }) {
      return {
        message: task.purpose || task.title,
        agentId,
        sessionId,
        source: "iroharness",
        task,
        context: {
          character: context.character,
          actor: context.actor,
          projectOs: context.projectOs
        }
      };
    },
    parseResponse(payload) {
      return {
        status: payload.status || payload.result?.status || "completed",
        summary:
          payload.summary ||
          payload.reply ||
          payload.message ||
          payload.result?.summary ||
          payload.result?.reply ||
          "OpenClaw completed.",
        artifacts: payload.artifacts || payload.result?.artifacts || [],
        raw: payload
      };
    }
  });

export const createHermesGatewayMicroHarness = ({
  id = "hermes",
  endpoint,
  apiKey = null,
  conversationId = null,
  capabilities = ["learning", "skills", "memory", "messaging"],
  fetchImpl = globalThis.fetch,
  timeoutMs = 120_000
}) =>
  createHttpMicroHarness({
    id,
    endpoint,
    capabilities,
    fetchImpl,
    timeoutMs,
    headers: {
      ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {})
    },
    buildRequest({ task, context }) {
      return {
        text: task.purpose || task.title,
        conversationId,
        source: "iroharness",
        metadata: {
          task,
          character: context.character,
          actor: context.actor,
          projectOs: context.projectOs
        }
      };
    },
    parseResponse(payload) {
      return {
        status: payload.status || payload.result?.status || "completed",
        summary:
          payload.summary ||
          payload.text ||
          payload.reply ||
          payload.message ||
          payload.result?.summary ||
          payload.result?.text ||
          "Hermes completed.",
        artifacts: payload.artifacts || payload.result?.artifacts || [],
        raw: payload
      };
    }
  });

export const createAIAvatarKitBridgeDevice = ({
  id = "aiavatarkit",
  eventEndpoint = null,
  stateEndpoint = null,
  speechEndpoint = null,
  headers = {},
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000
} = {}) => {
  if (!eventEndpoint && !stateEndpoint && !speechEndpoint) {
    throw new Error("createAIAvatarKitBridgeDevice requires at least one endpoint");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createAIAvatarKitBridgeDevice requires fetchImpl");
  }

  const post = async (endpoint, payload) => {
    if (!endpoint) {
      return null;
    }
    const timeout = createTimeoutSignal(timeoutMs);
    try {
      const response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...headers
        },
        body: JSON.stringify(payload),
        signal: timeout.signal
      });
      const responseText = await response.text();
      if (!response.ok) {
        throw new Error(`AIAvatarKit bridge ${response.status}: ${responseText}`);
      }
      return responseText.trim() ? JSON.parse(responseText) : {};
    } finally {
      timeout.clear();
    }
  };

  return Object.freeze({
    id,
    kind: "body",
    capabilities: Object.freeze(["state", "speech", "task", "avatar"]),
    emit(event) {
      const payload = {
        source: "iroharness",
        event,
        state: event.state || null,
        speechText: event.text || event.state?.speechText || null
      };
      post(eventEndpoint, payload).catch(() => {});
      if (event.type === "state") {
        post(stateEndpoint, payload).catch(() => {});
      }
      if (event.type === "speech") {
        post(speechEndpoint, payload).catch(() => {});
      }
    }
  });
};

export const createAzureSpeechStt = ({
  id = "azure-speech-stt",
  region,
  endpoint = null,
  subscriptionKey = null,
  authorizationToken = null,
  language = "ja-JP",
  alternativeLanguages = [],
  format = "detailed",
  mode = "classic",
  sampleRate = 16000,
  contentType = `audio/wav; codecs=audio/pcm; samplerate=${sampleRate}`,
  debugAudioDir = null,
  headers = {},
  fetchImpl = globalThis.fetch
} = {}) => {
  if (!endpoint && !region) {
    throw new Error("createAzureSpeechStt requires region or endpoint");
  }
  if (!subscriptionKey && !authorizationToken) {
    throw new Error("createAzureSpeechStt requires subscriptionKey or authorizationToken");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createAzureSpeechStt requires fetchImpl");
  }
  const url =
    endpoint ||
    (mode === "fast"
      ? `https://${region}.api.cognitive.microsoft.com/speechtotext/transcriptions:transcribe?api-version=2024-11-15`
      : `https://${region}.stt.speech.microsoft.com/speech/recognition/conversation/cognitiveservices/v1?language=${encodeURIComponent(language)}&format=${encodeURIComponent(format)}`);

  return Object.freeze({
    id,
    kind: "stt",
    capabilities: Object.freeze(["azure-speech", "short-audio-stt", "final-transcript"]),
    start({ onEvent = () => {} } = {}) {
      let sequence = 0;
      let closed = false;
      const buffers = [];
      const emit = (event) => {
        const nextEvent = createAdapterEvent({ adapterId: id, sequence, event });
        sequence += 1;
        onEvent(nextEvent);
        return nextEvent;
      };
      return Object.freeze({
        push(chunk = {}) {
          if (closed) {
            throw new Error(`${id} STT session is closed`);
          }
          const buffer = bufferFromAudioChunk(chunk);
          if (buffer.length > 0) {
            buffers.push(buffer);
          }
          return emit({
            type: "stt.audio_buffered",
            byteLength: buffer.length,
            final: false
          });
        },
        async end() {
          if (closed) {
            return Object.freeze([]);
          }
          closed = true;
          const audioBytes = Buffer.concat(buffers);
          const audio = isRiffWave(audioBytes)
            ? audioBytes
            : createPcm16WavBuffer({
                pcm: audioBytes,
                sampleRate,
                channels: 1
              });
          if (debugAudioDir) {
            mkdirSync(debugAudioDir, { recursive: true });
            const debugAudioPath = join(
              debugAudioDir,
              `${new Date().toISOString().replaceAll(":", "-")}-${id}-${sequence}.wav`
            );
            writeFileSync(debugAudioPath, audio);
            emit({
              type: "stt.debug_audio_saved",
              path: debugAudioPath,
              byteLength: audio.length
            });
          }
          const authHeaders = {
            ...(subscriptionKey ? { "Ocp-Apim-Subscription-Key": subscriptionKey } : {}),
            ...(authorizationToken ? { authorization: `Bearer ${authorizationToken}` } : {}),
            ...headers
          };
          const response =
            mode === "fast"
              ? await fetchImpl(url, {
                  method: "POST",
                  headers: {
                    accept: "application/json",
                    ...authHeaders
                  },
                  body: (() => {
                    const formData = new FormData();
                    formData.append("audio", new Blob([audio], { type: "audio/wav" }), "audio.wav");
                    formData.append(
                      "definition",
                      new Blob(
                        [
                          JSON.stringify({
                            locales: [language, ...alternativeLanguages],
                            channels: [0]
                          })
                        ],
                        { type: "application/json" }
                      )
                    );
                    return formData;
                  })()
                })
              : await fetchImpl(url, {
                  method: "POST",
                  headers: {
                    accept: "application/json;text/xml",
                    "content-type": contentType,
                    ...authHeaders
                  },
                  body: audio
                });
          const body = await parseJsonResponse({ response, label: `Azure Speech STT ${id}` });
          const text =
            body.DisplayText ||
            body.combinedPhrases?.[0]?.text ||
            body.NBest?.[0]?.Display ||
            body.NBest?.[0]?.Lexical ||
            body.Text ||
            "";
          return Object.freeze([
            emit({
              type: "stt.final",
              text,
              delta: text,
              final: true,
              raw: body
            })
          ]);
        },
        cancel(reason = "cancelled") {
          if (closed) {
            return null;
          }
          closed = true;
          return emit({
            type: "stt.cancelled",
            text: "",
            reason,
            final: false
          });
        }
      });
    }
  });
};

export const createAivisSpeechTts = ({
  id = "aivisspeech-tts",
  baseUrl = "http://127.0.0.1:10101",
  speaker,
  headers = {},
  fetchImpl = globalThis.fetch,
  useCancellableSynthesis = false,
  outputSamplingRate = null
} = {}) => {
  if (speaker === undefined || speaker === null || speaker === "") {
    throw new Error("createAivisSpeechTts requires speaker");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("createAivisSpeechTts requires fetchImpl");
  }
  const root = String(baseUrl).replace(/\/+$/g, "");
  return Object.freeze({
    id,
    kind: "tts",
    capabilities: Object.freeze(["aivisspeech", "voicevox-compatible", "audio-query", "wav"]),
    async stream({ text, voice = null, onEvent = () => {}, signal = null } = {}) {
      const chunks = [];
      let sequence = 0;
      const emit = (event) => {
        const nextEvent = createAdapterEvent({
          adapterId: id,
          sequence,
          event,
          extra: { voice: voice || speaker }
        });
        sequence += 1;
        chunks.push(nextEvent);
        onEvent(nextEvent);
        return nextEvent;
      };
      if (signal?.aborted) {
        emit({
          type: "tts.interrupted",
          text: String(text || ""),
          reason: signal.reason || "aborted"
        });
        return Object.freeze(chunks);
      }

      const queryUrl = `${root}/audio_query?speaker=${encodeURIComponent(speaker)}&text=${encodeURIComponent(String(text || ""))}`;
      const queryResponse = await fetchImpl(queryUrl, {
        method: "POST",
        headers: {
          accept: "application/json",
          ...headers
        },
        signal
      });
      const audioQuery = await parseJsonResponse({
        response: queryResponse,
        label: `AivisSpeech audio_query ${id}`
      });
      if (outputSamplingRate) {
        audioQuery.outputSamplingRate = outputSamplingRate;
      }
      if (signal?.aborted) {
        emit({
          type: "tts.interrupted",
          text: String(text || ""),
          reason: signal.reason || "aborted"
        });
        return Object.freeze(chunks);
      }

      const synthesisPath = useCancellableSynthesis ? "cancellable_synthesis" : "synthesis";
      const synthesisResponse = await fetchImpl(
        `${root}/${synthesisPath}?speaker=${encodeURIComponent(speaker)}`,
        {
          method: "POST",
          headers: {
            accept: "audio/wav",
            "content-type": "application/json",
            ...headers
          },
          body: JSON.stringify(audioQuery),
          signal
        }
      );
      if (!synthesisResponse.ok) {
        const responseText = await synthesisResponse.text();
        throw new Error(`AivisSpeech synthesis ${id} failed: ${synthesisResponse.status} ${responseText}`);
      }
      const audio = arrayBufferToBase64(await synthesisResponse.arrayBuffer());
      emit({
        type: "tts.audio",
        text: String(text || ""),
        audio,
        encoding: "wav",
        final: false
      });
      emit({
        type: "tts.completed",
        text: String(text || ""),
        audio: "",
        final: true
      });
      return Object.freeze(chunks);
    }
  });
};

export const createStackChanRealtimeRelay = ({
  id = "stackchan-realtime-relay",
  url,
  WebSocketImpl = globalThis.WebSocket,
  stt = null,
  tts = null,
  queue = null,
  latencyBudgetMs = 1000
} = {}) => {
  if (!url) {
    throw new Error("createStackChanRealtimeRelay requires url");
  }
  if (typeof WebSocketImpl !== "function") {
    throw new Error("createStackChanRealtimeRelay requires WebSocketImpl");
  }
  return Object.freeze({
    id,
    kind: "device-realtime-relay",
    capabilities: Object.freeze(["stackchan", "websocket", "audio-chunks", "ptt", "speech-playback"]),
    connect({ onEvent = () => {}, onTurn = () => {} } = {}) {
      const socket = new WebSocketImpl(url);
      let sequence = 0;
      let sttSession = null;
      const emit = (event) => {
        const nextEvent = createAdapterEvent({ adapterId: id, sequence, event });
        sequence += 1;
        onEvent(nextEvent);
        return nextEvent;
      };
      const send = (payload) => {
        const raw = JSON.stringify(payload);
        if (socket.readyState === 1 || socket.readyState === WebSocketImpl.OPEN) {
          socket.send(raw);
        }
        return raw;
      };
      const openHandler = () => {
        emit({
          type: "stackchan.connected",
          latencyBudgetMs
        });
        send({
          type: "hello",
          relayId: id,
          latencyBudgetMs
        });
      };
      const messageHandler = async (event) => {
        const payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        emit({
          type: "stackchan.message",
          messageType: payload.type || "unknown"
        });
        if (payload.type === "invoke") {
          await onTurn({
            source: "m5stack",
            modality: "text",
            text: payload.text || "",
            actor: {
              platform: "m5stack",
              platformUserId: payload.userId || payload.deviceId || "stackchan",
              displayName: payload.deviceId || "StackChan"
            },
            metadata: {
              deviceId: payload.deviceId || "stackchan",
              channel: payload.channel || "local",
              realtimeRelayId: id
            }
          });
          return;
        }
        if (payload.type === "audio" || payload.type === "audio.chunk" || payload.type === "ptt.audio") {
          if (!stt) {
            emit({
              type: "stackchan.audio.unhandled",
              reason: "stt_not_configured"
            });
            return;
          }
          sttSession =
            sttSession ||
            stt.start({
              onEvent(event) {
                emit({
                  ...event,
                  type: `stackchan.${event.type}`
                });
              }
            });
          const pushedEvents = await sttSession.push({
            audio:
              payload.audio || {
                encoding: payload.encoding || "pcm_s16le",
                sampleRate: payload.sampleRate || 16000,
                dataBase64: payload.dataBase64 || payload.audioBase64 || ""
              },
            final: Boolean(payload.final)
          });
          if (payload.final) {
            const finalEvents = await sttSession.end();
            sttSession = null;
            const allEvents = [
              ...(Array.isArray(pushedEvents) ? pushedEvents : [pushedEvents].filter(Boolean)),
              ...(Array.isArray(finalEvents) ? finalEvents : [finalEvents].filter(Boolean))
            ];
            const transcriptEvent = allEvents
              .reverse()
              .find((candidate) => candidate.type === "stt.final" && candidate.text);
            if (transcriptEvent) {
              await onTurn({
                source: "m5stack",
                modality: "voice",
                text: transcriptEvent.text,
                actor: {
                  platform: "m5stack",
                  platformUserId: payload.userId || payload.deviceId || "stackchan",
                  displayName: payload.deviceId || "StackChan"
                },
                metadata: {
                  deviceId: payload.deviceId || "stackchan",
                  channel: payload.channel || "local",
                  realtimeRelayId: id
                }
              });
            }
          }
        }
      };
      if (typeof socket.addEventListener === "function") {
        socket.addEventListener("open", openHandler);
        socket.addEventListener("message", (event) => {
          messageHandler(event).catch((error) => {
            emit({ type: "stackchan.error", message: error.message });
          });
        });
      } else {
        socket.onopen = openHandler;
        socket.onmessage = (event) => {
          messageHandler(event).catch((error) => {
            emit({ type: "stackchan.error", message: error.message });
          });
        };
      }
      return Object.freeze({
        socket,
        sendSpeech({ text, audio = null, voice = null } = {}) {
          const item = queue?.enqueue
            ? queue.enqueue({ text, audio, voice, source: id })
            : { id: `${id}:speech:${sequence}`, text, audio, voice };
          send({
            type: "speech.audio",
            itemId: item.id,
            text: String(text || ""),
            audio,
            voice
          });
          return item;
        },
        async synthesizeAndSend({ text, voice = null } = {}) {
          if (!tts) {
            throw new Error(`${id} requires tts for synthesizeAndSend`);
          }
          const events = await tts.stream({ text, voice });
          events
            .filter((event) => event.type === "tts.audio")
            .forEach((event) => {
              this.sendSpeech({
                text: event.text || text,
                audio: {
                  encoding: event.encoding || "wav",
                  dataBase64: event.audio
                },
                voice
              });
            });
          return Object.freeze(events);
        },
        close() {
          if (typeof socket.close === "function") {
            socket.close();
          }
          emit({ type: "stackchan.closed" });
        }
      });
    }
  });
};

const attachSocketListener = (socket, type, callback) => {
  if (typeof socket.addEventListener === "function") {
    socket.addEventListener(type, callback);
    return;
  }
  if (typeof socket.on === "function") {
    socket.on(type, callback);
    return;
  }
  socket[`on${type}`] = callback;
};

const parseSocketMessageData = (event) => {
  const data = event?.data ?? event;
  if (typeof data === "string") {
    return JSON.parse(data);
  }
  if (Buffer.isBuffer(data)) {
    return JSON.parse(data.toString("utf8"));
  }
  if (data instanceof ArrayBuffer) {
    return JSON.parse(Buffer.from(data).toString("utf8"));
  }
  return data;
};

const normalizeStackChanAudioPayload = (payload) =>
  payload.audio || {
    encoding:
      payload.encoding ||
      payload.metadata?.audio_format?.codec ||
      payload.metadata?.pcm_format?.codec ||
      "pcm_s16le",
    sampleRate:
      payload.sampleRate ||
      payload.metadata?.audio_format?.sample_rate ||
      payload.metadata?.pcm_format?.sample_rate ||
      16000,
    channels:
      payload.channels ||
      payload.metadata?.audio_format?.channels ||
      payload.metadata?.pcm_format?.channels ||
      1,
    bitsPerSample:
      payload.bitsPerSample ||
      payload.metadata?.audio_format?.bits_per_sample ||
      payload.metadata?.pcm_format?.bits_per_sample ||
      16,
    dataBase64: payload.dataBase64 || payload.audioBase64 || payload.audio_data || ""
  };

const analyzePcm16Audio = (audio = {}, { vadThresholdDb = -38 } = {}) => {
  const encoding = String(audio.encoding || "pcm16").toLowerCase();
  const pcm =
    encoding === "wav"
      ? Buffer.from(parsePcm16Wav(Buffer.from(audio.dataBase64 || "", "base64")).dataBase64, "base64")
      : Buffer.from(audio.dataBase64 || "", "base64");
  const sampleCount = Math.floor(pcm.length / 2);
  if (sampleCount === 0) {
    return Object.freeze({
      bytes: pcm.length,
      sampleCount,
      rmsDb: -Infinity,
      isSpeech: false
    });
  }
  let sumSquares = 0;
  for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
    const sample = pcm.readInt16LE(offset);
    sumSquares += sample * sample;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  const rmsDb = rms <= 0 ? -Infinity : 20 * Math.log10(rms / 32768);
  return Object.freeze({
    bytes: pcm.length,
    sampleCount,
    rmsDb,
    isSpeech: rmsDb >= vadThresholdDb
  });
};

const isAiAvatarStackChanClientMessage = (payload) =>
  ["start", "data"].includes(payload?.type) ||
  Boolean(payload?.session_id) ||
  Boolean(payload?.audio_data);

const toAiAvatarAudioFormat = (audio = {}) =>
  Object.freeze({
    codec:
      audio.encoding === "pcm_s16le" || audio.encoding === "pcm16"
        ? "pcm16"
        : audio.encoding || "pcm16",
    sample_rate: audio.sampleRate || 24000,
    channels: audio.channels || 1,
    bits_per_sample: audio.bitsPerSample || 16
  });

export const createStackChanRealtimeSessionHandler = ({
  id = "stackchan-realtime-session",
  harness,
  stt,
  tts,
  createQueue = null,
  deviceToken = null,
  latencyBudgetMs = 1000,
  sttAutoFinalMs = 0,
  sttAutoFinalMinBytes = 32000,
  vadThresholdDb = -38,
  vadSilenceMs = 700,
  vadMinSpeechMs = 250,
  vadMaxSpeechMs = 8000,
  vadMode = "node",
  minAudioBytes = 0,
  speechChunkBytes = 512,
  immediateAckText = "",
  voice = "iroha"
} = {}) => {
  if (!harness || typeof harness.receive !== "function") {
    throw new Error("createStackChanRealtimeSessionHandler requires harness.receive");
  }
  if (!stt || typeof stt.start !== "function") {
    throw new Error("createStackChanRealtimeSessionHandler requires stt");
  }
  if (!tts || typeof tts.stream !== "function") {
    throw new Error("createStackChanRealtimeSessionHandler requires tts");
  }

  return Object.freeze({
    id,
    kind: "stackchan-realtime-session-handler",
    capabilities: Object.freeze([
      "stackchan",
      "aiavatarstackchan-style",
      "websocket-session",
      "audio-chunks",
      "speech-playback"
    ]),
    handleConnection(socket, { deviceId = "stackchan", userId = deviceId, channel = "local", token = null, onEvent = () => {} } = {}) {
      let sequence = 0;
      let sttSession = null;
      let sttSessionStartedAt = 0;
      let sttSessionBytes = 0;
      let vadSpeechStartedAt = 0;
      let vadLastSpeechAt = 0;
      let protocol = "iroharness";
      let aiAvatarSessionId = id;
      let activeUserId = userId;
      let activeChannel = channel;
      let messageChain = Promise.resolve();
      let audioLevelDebugCounter = 0;
      let speechInFlight = false;
      let latencyTurnStartedAt = 0;
      const queue =
        typeof createQueue === "function"
          ? createQueue({ deviceId, userId, channel })
          : null;
      const providerOwnsVad = ["provider", "stt", "aiavatar", "aiavatar-silero-openai"].includes(
        String(vadMode || "node").toLowerCase()
      );

      const emit = (event) => {
        const nextEvent = createAdapterEvent({
          adapterId: id,
          sequence,
          event,
          extra: { deviceId, channel }
        });
        sequence += 1;
        onEvent(nextEvent);
        return nextEvent;
      };

      const send = (payload) => {
        const wirePayload =
          protocol === "aiavatarstackchan" ? toAiAvatarStackChanServerMessage(payload) : payload;
        const message = JSON.stringify({
          ...wirePayload,
          ...(protocol === "aiavatarstackchan"
            ? {}
            : {
                sessionId: id,
                deviceId,
                sequence,
                timestamp: nowIso()
              })
        });
        if (typeof socket.send === "function") {
          socket.send(message);
        }
        return message;
      };

      const toAiAvatarStackChanServerMessage = (payload) => {
        if (payload.type === "ready") {
          return {
            type: "connected",
            session_id: aiAvatarSessionId
          };
        }
        if (payload.type === "stt.event") {
          return payload.event?.final
            ? {
                type: "accepted",
                session_id: aiAvatarSessionId
              }
            : {
                type: "voiced",
                session_id: aiAvatarSessionId
              };
        }
        if (payload.type === "stt.empty") {
          return {
            type: "final",
            session_id: aiAvatarSessionId,
            text: "",
            metadata: {
              text: "",
              voice_text: "",
              reason: payload.reason || "empty"
            }
          };
        }
        if (payload.type === "response.start") {
          return {
            type: "start",
            session_id: aiAvatarSessionId,
            metadata: {
              request_text: payload.text || ""
            }
          };
        }
        if (payload.type === "speech.audio") {
          const audio = payload.audio || {};
          return {
            type: "chunk",
            session_id: aiAvatarSessionId,
            audio_data: audio.dataBase64 || "",
            metadata: {
              audio_format: toAiAvatarAudioFormat(audio),
              text: payload.text || ""
            },
            avatar_control_request: {
              face_name: payload.faceName || "neutral",
              face_duration: payload.faceDurationSec || 2
            }
          };
        }
        if (payload.type === "response.final") {
          return {
            type: "final",
            session_id: aiAvatarSessionId,
            text: payload.text || "",
            metadata: {
              text: payload.text || "",
              voice_text: payload.voiceText || payload.text || ""
            }
          };
        }
        if (payload.type === "speech.interrupted") {
          return {
            type: "stop",
            session_id: aiAvatarSessionId
          };
        }
        if (payload.type === "error") {
          return {
            type: "error",
            session_id: aiAvatarSessionId,
            code: payload.code,
            message: payload.message || payload.code || "error"
          };
        }
        return {
          ...payload,
          session_id: aiAvatarSessionId
        };
      };

      const actor = () =>
        Object.freeze({
          platform: "m5stack",
          platformUserId: activeUserId,
          displayName: deviceId
        });

      const receiveTurn = async ({ modality, text, metadata = {} }) =>
        harness.receive({
          source: "m5stack",
          modality,
          text,
          actor: actor(),
          metadata: {
            deviceId,
            channel: activeChannel,
            realtimeSessionId: id,
            aiAvatarSessionId: protocol === "aiavatarstackchan" ? aiAvatarSessionId : null,
            ...metadata
          }
        });

      const speak = async ({ text, role = "answer", sendFinal = true }) => {
        const responseText = normalizeSpeechText(text);
        if (!responseText) {
          return Object.freeze([]);
        }
        const ttsStartedAt = Date.now();
        let ttsFirstAudioAt = 0;
        emit({
          type: "stackchan.speech.started",
          role,
          textLength: responseText.length
        });
        send({
          type: "response.start",
          role,
          text: responseText
        });
        let speechChunkCount = 0;
        speechInFlight = true;
        try {
          const speechEvents = await tts.stream({
            text: responseText,
            voice,
            onEvent(event) {
              if (event.type !== "tts.audio") {
                return;
              }
              const audio = normalizeStackChanSpeechAudio(event);
              if (!ttsFirstAudioAt) {
                ttsFirstAudioAt = Date.now();
                emit({
                  type: "stackchan.tts.first_audio",
                  durationMs: ttsFirstAudioAt - ttsStartedAt,
                  textLength: responseText.length
                });
              }
              const audioChunks = splitStackChanSpeechAudio(audio, {
                maxBytes: speechChunkBytes
              });
              const item = queue?.enqueue
                ? queue.enqueue({
                    text: event.text || responseText,
                    audio: {
                      encoding: audio.encoding,
                      dataBase64: audio.dataBase64,
                      sampleRate: audio.sampleRate,
                      channels: audio.channels,
                      bitsPerSample: audio.bitsPerSample
                    },
                    voice,
                    source: id
                  })
                : {
                    id: `${id}:speech:${sequence}`,
                    text: event.text || responseText
                  };
              audioChunks.forEach((audioChunk, index) => {
                send({
                  type: "speech.audio",
                  itemId: item.id,
                  chunkIndex: index,
                  chunkCount: audioChunks.length,
                  role,
                  text: event.text || responseText,
                  audio: {
                    encoding: audioChunk.encoding,
                    dataBase64: audioChunk.dataBase64,
                    sampleRate: audioChunk.sampleRate,
                    channels: audioChunk.channels,
                    bitsPerSample: audioChunk.bitsPerSample
                  },
                  voice
                });
              });
              speechChunkCount += audioChunks.length;
              emit({
                type: "stackchan.speech.audio_sent",
                role,
                chunks: audioChunks.length,
                totalChunks: speechChunkCount,
                bytes: audio.dataBase64.length
              });
            }
          });
          const completed = queue?.snapshot?.().current;
          if (completed?.id && queue?.complete) {
            queue.complete(completed.id);
          }
          if (sendFinal) {
            send({
              type: "response.final",
              role,
              text: responseText
            });
          }
          emit({
            type: "stackchan.speech.completed",
            role,
            chunks: speechChunkCount,
            ttsDurationMs: Date.now() - ttsStartedAt,
            timeToFirstAudioMs: ttsFirstAudioAt ? ttsFirstAudioAt - ttsStartedAt : null
          });
          return Object.freeze(speechEvents);
        } finally {
          speechInFlight = false;
        }
      };

      const handleTurnResult = async (result) => {
        const text = result?.text || result?.output?.summary || "";
        if (!text) {
          send({
            type: "response.final",
            text: ""
          });
          return Object.freeze([]);
        }
        return speak({ text });
      };

      const resetAudioTurnState = () => {
        sttSession = null;
        sttSessionStartedAt = 0;
        sttSessionBytes = 0;
        vadSpeechStartedAt = 0;
        vadLastSpeechAt = 0;
      };

      const normalizeSttEvents = (events) =>
        Object.freeze(Array.isArray(events) ? events : [events].filter(Boolean));

      const findFinalTranscriptEvent = (events, { requireText = true } = {}) =>
        [...normalizeSttEvents(events)]
          .reverse()
          .find(
            (candidate) =>
              candidate.type === "stt.final" &&
              (!requireText || String(candidate.text || "").trim())
          );

      const handleEmptyTranscript = ({ reason, sttDurationMs = 0, sinceSpeechStartMs = null } = {}) => {
        emit({
          type: "stackchan.latency.stt_finalized",
          reason,
          hasText: false,
          sttDurationMs,
          sinceSpeechStartMs
        });
        send({
          type: "stt.empty",
          reason
        });
        return Object.freeze([]);
      };

      const handleTranscriptTurn = async ({
        transcriptEvent,
        payload,
        reason = "final",
        sttDurationMs = 0,
        completedAt = Date.now()
      }) => {
        emit({
          type: "stackchan.latency.stt_finalized",
          reason,
          hasText: true,
          sttDurationMs,
          sinceSpeechStartMs: latencyTurnStartedAt ? completedAt - latencyTurnStartedAt : null,
          transcriptLength: transcriptEvent.text.length
        });
        const brainStartedAt = Date.now();
        emit({
          type: "stackchan.latency.brain_started",
          transcriptLength: transcriptEvent.text.length
        });
        const ackText =
          typeof immediateAckText === "function"
            ? immediateAckText({
                text: transcriptEvent.text,
                reason,
                deviceId,
                channel: activeChannel
              })
            : immediateAckText;
        const ackPromise = normalizeSpeechText(ackText)
          ? speak({
              text: ackText,
              role: "ack",
              sendFinal: false
            }).catch((error) => {
              emit({
                type: "stackchan.ack.error",
                message: error.message
              });
              return Object.freeze([]);
            })
          : null;
        const result = await receiveTurn({
          modality: "voice",
          text: transcriptEvent.text,
          metadata: {
            audio: normalizeStackChanAudioPayload(payload),
            sttFinalizeReason: reason
          }
        });
        emit({
          type: "stackchan.latency.brain_completed",
          durationMs: Date.now() - brainStartedAt,
          resultKind: result?.kind || null,
          textLength: String(result?.text || result?.output?.summary || "").length
        });
        if (ackPromise) {
          await ackPromise;
        }
        return handleTurnResult(result);
      };

      const finalizeAudioTurn = async ({ pushedEvents = [], payload, reason = "final" }) => {
        if (!sttSession) {
          return Object.freeze([]);
        }
        const sttFinalizeStartedAt = Date.now();
        const finalEvents = await sttSession.end();
        const sttFinalizeCompletedAt = Date.now();
        resetAudioTurnState();
        const transcriptEvent = findFinalTranscriptEvent([
          ...normalizeSttEvents(pushedEvents),
          ...normalizeSttEvents(finalEvents)
        ]);
        if (!transcriptEvent) {
          return handleEmptyTranscript({
            reason,
            sttDurationMs: sttFinalizeCompletedAt - sttFinalizeStartedAt,
            sinceSpeechStartMs: latencyTurnStartedAt ? sttFinalizeCompletedAt - latencyTurnStartedAt : null
          });
        }
        return handleTranscriptTurn({
          transcriptEvent,
          payload,
          reason,
          sttDurationMs: sttFinalizeCompletedAt - sttFinalizeStartedAt,
          completedAt: sttFinalizeCompletedAt
        });
      };

      const handleAudio = async (payload) => {
        const audio = normalizeStackChanAudioPayload(payload);
        const now = Date.now();
        const vad = analyzePcm16Audio(audio, { vadThresholdDb });
        const audioLevelDebugEvery = Number(process.env.IROHARNESS_STACKCHAN_AUDIO_LEVEL_DEBUG_EVERY || "0");
        if (audioLevelDebugEvery > 0 && audioLevelDebugCounter % audioLevelDebugEvery === 0) {
          emit({
            type: "stackchan.audio_level",
            messageType: payload.type || "audio",
            bytes: vad.bytes,
            rmsDb: vad.rmsDb,
            isSpeech: vad.isSpeech,
            thresholdDb: vadThresholdDb
          });
        }
        audioLevelDebugCounter += 1;
        if (speechInFlight && !payload.final) {
          return Object.freeze([]);
        }
        if (!providerOwnsVad && vad.bytes < minAudioBytes && !payload.final && !sttSession) {
          return Object.freeze([]);
        }
        const deviceFinal = Boolean(payload.final);
        const shouldStart = providerOwnsVad ? deviceFinal || vad.bytes > 0 : deviceFinal || vad.isSpeech;
        if (!sttSession && !shouldStart) {
          return Object.freeze([]);
        }
        sttSession =
          sttSession ||
          stt.start({
            onEvent(event) {
              emit({
                ...event,
                type: `stackchan.${event.type}`
              });
              send({
                type: "stt.event",
                event
              });
            }
          });
        if (!sttSessionStartedAt) {
          sttSessionStartedAt = now;
          sttSessionBytes = 0;
          if (providerOwnsVad && !latencyTurnStartedAt) {
            latencyTurnStartedAt = now;
          }
        }
        if (vad.isSpeech) {
          if (!vadSpeechStartedAt) {
            vadSpeechStartedAt = now;
            latencyTurnStartedAt = now;
            emit({
              type: "stackchan.stt.speech_started",
              rmsDb: vad.rmsDb
            });
          }
          vadLastSpeechAt = now;
        }
        const dataBytes = vad.bytes;
        sttSessionBytes += dataBytes;
        const pushedEvents = await sttSession.push({
          audio,
          final: deviceFinal
        });
        if (providerOwnsVad) {
          const transcriptEvent = findFinalTranscriptEvent(pushedEvents, { requireText: false });
          if (transcriptEvent) {
            const completedAt = Date.now();
            const hasText = String(transcriptEvent.text || "").trim();
            resetAudioTurnState();
            if (!hasText) {
              return handleEmptyTranscript({
                reason: "provider-vad",
                sttDurationMs: completedAt - now,
                sinceSpeechStartMs: latencyTurnStartedAt ? completedAt - latencyTurnStartedAt : null
              });
            }
            return handleTranscriptTurn({
              transcriptEvent,
              payload,
              reason: "provider-vad",
              sttDurationMs: completedAt - now,
              completedAt
            });
          }
          if (!deviceFinal) {
            return Object.freeze(pushedEvents);
          }
        }
        const elapsedSpeechMs = vadSpeechStartedAt ? now - vadSpeechStartedAt : 0;
        const silenceMs = vadLastSpeechAt ? now - vadLastSpeechAt : 0;
        const shouldVadFinal =
          !deviceFinal &&
          vadSpeechStartedAt > 0 &&
          !vad.isSpeech &&
          silenceMs >= vadSilenceMs &&
          elapsedSpeechMs >= vadMinSpeechMs;
        const shouldMaxFinal =
          !deviceFinal &&
          vadSpeechStartedAt > 0 &&
          vadMaxSpeechMs > 0 &&
          elapsedSpeechMs >= vadMaxSpeechMs;
        const shouldAutoFinal =
          !deviceFinal &&
          vadSpeechStartedAt > 0 &&
          sttAutoFinalMs > 0 &&
          sttSessionBytes >= sttAutoFinalMinBytes &&
          elapsedSpeechMs >= sttAutoFinalMs;
        if (!deviceFinal && !shouldVadFinal && !shouldMaxFinal && !shouldAutoFinal) {
          return Object.freeze(pushedEvents);
        }
        return finalizeAudioTurn({
          pushedEvents,
          payload,
          reason: deviceFinal
            ? "device-final"
            : shouldVadFinal
              ? "vad-silence"
              : shouldMaxFinal
                ? "vad-max-duration"
                : "auto-final"
        });
      };

      const handlePayload = async (payload) => {
        if (isAiAvatarStackChanClientMessage(payload)) {
          protocol = "aiavatarstackchan";
          aiAvatarSessionId = payload.session_id || aiAvatarSessionId;
          activeUserId = payload.user_id || activeUserId;
          activeChannel = payload.channel || activeChannel;
        }
        emit({
          type: "stackchan.message",
          messageType: payload.type || "unknown"
        });
        if (payload.type === "start") {
          send({
            type: "ready",
            latencyBudgetMs,
            acceptedAudio: ["pcm16", "pcm_s16le", "wav"],
            acceptedInput: ["data", "invoke", "stop"]
          });
          return null;
        }
        if (payload.type === "hello" || payload.type === "config") {
          send({
            type: "ready",
            latencyBudgetMs,
            acceptedAudio: ["pcm_s16le", "wav"],
            acceptedInput: ["audio.chunk", "ptt.audio", "invoke", "vision", "interrupt"]
          });
          return null;
        }
        if (payload.type === "data") {
          return handleAudio({
            ...payload,
            type: "audio.chunk",
            final: Boolean(payload.final)
          });
        }
        if (payload.type === "audio.chunk" || payload.type === "audio" || payload.type === "ptt.audio") {
          return handleAudio(payload);
        }
        if (payload.type === "invoke" || payload.type === "vision") {
          if (payload.audio_data) {
            return handleAudio({
              ...payload,
              type: "ptt.audio",
              final: true
            });
          }
          if (protocol === "aiavatarstackchan") {
            send({
              type: "accepted"
            });
          }
          const imageDataUrl =
            payload.imageDataUrl || payload.files?.find?.((file) => file?.url)?.url || null;
          const result = await receiveTurn({
            modality: payload.type === "vision" || imageDataUrl ? "vision" : "text",
            text: payload.text || "",
            metadata: {
              imageDataUrl,
              invokeType: payload.type
            }
          });
          return handleTurnResult(result);
        }
        if (payload.type === "interrupt" || payload.type === "stop") {
          queue?.interrupt?.("device-interrupt", { clearPending: true });
          send({
            type: "speech.interrupted",
            reason: "device-interrupt"
          });
          return null;
        }
        send({
          type: "error",
          message: `Unsupported StackChan realtime message: ${payload.type || "(missing)"}`
        });
        return null;
      };

      if (deviceToken && token !== deviceToken) {
        send({
          type: "error",
          code: "invalid_device_token"
        });
        if (typeof socket.close === "function") {
          socket.close();
        }
        return Object.freeze({
          accepted: false,
          send,
          close: () => {}
        });
      }

      attachSocketListener(socket, "message", (event) => {
        messageChain = messageChain
          .then(() => handlePayload(parseSocketMessageData(event)))
          .catch((error) => {
            emit({
              type: "stackchan.error",
              message: error.message
            });
            send({
              type: "error",
              message: error.message
            });
          });
      });
      attachSocketListener(socket, "close", () => {
        sttSession?.cancel?.("socket-closed");
        sttSession = null;
        sttSessionStartedAt = 0;
        sttSessionBytes = 0;
        vadSpeechStartedAt = 0;
        vadLastSpeechAt = 0;
        queue?.clear?.("socket-closed");
        emit({
          type: "stackchan.closed"
        });
      });
      send({
        type: "ready",
        latencyBudgetMs,
        acceptedAudio: ["pcm_s16le", "wav"],
        acceptedInput: ["audio.chunk", "ptt.audio", "invoke", "vision", "interrupt"]
      });
      emit({
        type: "stackchan.accepted",
        latencyBudgetMs
      });
      return Object.freeze({
        accepted: true,
        send,
        speak,
        close() {
          if (typeof socket.close === "function") {
            socket.close();
          }
        }
      });
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

export const createJsonlRealtimeCoreProcess = ({
  id = "jsonl-realtime-core",
  command,
  args = [],
  cwd,
  env = {},
  eventCapacity = 256,
  messageCapacity = 256,
  clock = () => Date.now(),
  timestamp = () => new Date().toISOString(),
  onMessage = () => {},
  onStderr = () => {},
  onExit = () => {}
} = {}) => {
  if (!command) {
    throw new Error("createJsonlRealtimeCoreProcess requires command");
  }
  if (!Number.isInteger(eventCapacity) || eventCapacity < 1) {
    throw new Error("createJsonlRealtimeCoreProcess requires a positive eventCapacity");
  }
  if (!Number.isInteger(messageCapacity) || messageCapacity < 1) {
    throw new Error("createJsonlRealtimeCoreProcess requires a positive messageCapacity");
  }

  let processRef = null;
  let events = Object.freeze([]);
  let messages = Object.freeze([]);
  let marks = Object.freeze({});
  let measures = Object.freeze([]);
  let speaking = false;
  let interrupted = false;
  let sequence = 0;

  const recordMessage = (message) => {
    messages = Object.freeze([...messages, message].slice(-messageCapacity));
    onMessage(message);
    return message;
  };

  const start = () => {
    if (processRef) {
      return processRef;
    }
    processRef = spawn(command, args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio: ["pipe", "pipe", "pipe"]
    });
    const lines = createInterface({ input: processRef.stdout });
    lines.on("line", (line) => {
      try {
        recordMessage(JSON.parse(line));
      } catch (error) {
        recordMessage({
          type: "parse_error",
          message: error.message,
          line
        });
      }
    });
    processRef.stderr.on("data", (chunk) => onStderr(chunk.toString("utf8")));
    processRef.on("error", (error) => {
      recordMessage({
        type: "process_error",
        message: error.message
      });
    });
    processRef.on("exit", (code, signal) => {
      processRef = null;
      onExit({ code, signal });
    });
    return processRef;
  };

  const send = (op, payload = {}) => {
    const child = start();
    child.stdin.write(
      `${JSON.stringify({
        op,
        coreId: id,
        sequence,
        timestamp: timestamp(),
        ...payload
      })}\n`
    );
    sequence += 1;
  };

  const publish = (event) => {
    const nextEvent = Object.freeze({
      ...event,
      realtimeCoreId: id,
      timestamp: event?.timestamp || timestamp()
    });
    events = Object.freeze([...events, nextEvent].slice(-eventCapacity));
    send("publish", { event: nextEvent });
    return nextEvent;
  };

  const mark = (name, at = clock()) => {
    marks = Object.freeze({
      ...marks,
      [name]: at
    });
    const nextMark = Object.freeze({ name, at });
    send("mark", { mark: nextMark });
    return nextMark;
  };

  const measure = (name, startMark, endMark) => {
    const startAt = marks[startMark];
    const endAt = marks[endMark];
    if (typeof startAt !== "number" || typeof endAt !== "number") {
      throw new Error(`realtime core measure ${name} requires marks: ${startMark}, ${endMark}`);
    }
    const nextMeasure = Object.freeze({
      name,
      startMark,
      endMark,
      start: startAt,
      end: endAt,
      durationMs: endAt - startAt
    });
    measures = Object.freeze([...measures, nextMeasure]);
    send("measure", { measure: nextMeasure });
    return nextMeasure;
  };

  const startSpeaking = () => {
    speaking = true;
    interrupted = false;
    const state = Object.freeze({ speaking, interrupted });
    send("startSpeaking", { state });
    return state;
  };

  const finishSpeaking = () => {
    speaking = false;
    const state = Object.freeze({ speaking, interrupted });
    send("finishSpeaking", { state });
    return state;
  };

  const shouldInterrupt = (event) => {
    const shouldInterruptNow =
      speaking &&
      event?.type === "stt.partial" &&
      String(event.delta || event.text || "").trim().length > 0;
    if (shouldInterruptNow) {
      interrupted = true;
    }
    send("shouldInterrupt", {
      event,
      result: shouldInterruptNow
    });
    return shouldInterruptNow;
  };

  const snapshot = () =>
    Object.freeze({
      id,
      kind: "realtime-core",
      implementation: "jsonl-process",
      process: Object.freeze({
        running: Boolean(processRef),
        command,
        args: Object.freeze([...args])
      }),
      events: Object.freeze([...events]),
      messages: Object.freeze([...messages]),
      latency: Object.freeze({
        marks: Object.freeze({ ...marks }),
        measures: Object.freeze([...measures])
      }),
      bargeIn: Object.freeze({
        speaking,
        interrupted
      })
    });

  const close = () => {
    if (!processRef) {
      return null;
    }
    const child = processRef;
    child.stdin.end();
    child.kill("SIGTERM");
    processRef = null;
    return true;
  };

  return Object.freeze({
    id,
    kind: "realtime-core",
    implementation: "jsonl-process",
    capabilities: Object.freeze(["event-bus", "latency", "barge-in", "jsonl-process"]),
    start,
    publish,
    push: publish,
    mark,
    measure,
    startSpeaking,
    finishSpeaking,
    shouldInterrupt,
    snapshot,
    close
  });
};

export const createTextProcessMicroHarness = ({
  id,
  command,
  args = [],
  cwd,
  env = {},
  capabilities = [],
  timeoutMs = 120_000,
  buildInput = ({ task, context }) =>
    buildDefaultMicroHarnessPrompt({ task, context, label: id }),
  parseOutput = ({ stdout, stderr, code }) => {
    const parsed = tryParseJsonLine(stdout);
    if (parsed) {
      return parsed;
    }
    return {
      status: code === 0 ? "completed" : "failed",
      summary: stdout.trim() || stderr.trim() || `${id} exited with ${code}`,
      artifacts: [],
      raw: { stdout, stderr, code }
    };
  }
}) => {
  if (!id || !command) {
    throw new Error("createTextProcessMicroHarness requires id and command");
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
          finish(parseOutput({ stdout, stderr, code, task, context }));
        });
        child.stdin.end(buildInput({ task, context }));
      });
    }
  });
};

export const createClaudeCodeCliMicroHarness = ({
  id = "claude-code",
  command = "claude",
  args = ["-p"],
  cwd,
  env = {},
  capabilities = ["code", "files", "review", "claude-code"],
  timeoutMs = 10 * 60_000,
  buildPrompt = ({ task, context }) =>
    buildDefaultMicroHarnessPrompt({ task, context, label: "Claude Code" }),
  parseOutput
} = {}) =>
  createTextProcessMicroHarness({
    id,
    command,
    args,
    cwd,
    env,
    capabilities,
    timeoutMs,
    buildInput: ({ task, context }) => buildPrompt({ task, context }),
    ...(parseOutput ? { parseOutput } : {})
  });

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

export const createMotionPngTuberRendererBridge = ({
  id = "motionpngtuber",
  assets = {
    mouth_on_eye_on: "mouth_on_eye_on.png",
    mouth_off_eye_on: "mouth_off_eye_on.png",
    mouth_off_eye_off: "mouth_off_eye_off.png"
  }
} = {}) => {
  const mapper = createMotionPngTuberMapper();
  return createMappedBodyBridgeDevice({
    id,
    kind: "motionpngtuber",
    mapper,
    capabilities: ["state", "speech", "task", "png-state", "sse"],
    mapPayload({ state, mapped, speechText }) {
      return Object.freeze({
        stateKey: mapped,
        asset: assets[mapped] || null,
        mode: state?.mode || null,
        emotion: state?.emotion || null,
        speechText
      });
    }
  });
};

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

export const createM5StackBodyBridge = ({ id = "m5stack-face" } = {}) => {
  const mapper = createM5StackFaceMapper();
  return createMappedBodyBridgeDevice({
    id,
    kind: "m5stack",
    mapper,
    capabilities: ["state", "speech", "task", "face", "sse"],
    mapPayload({ state, mapped, speechText }) {
      return Object.freeze({
        face: mapped,
        mode: state?.mode || null,
        text: speechText ? speechText.slice(0, 40) : ""
      });
    }
  });
};

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

export const createEvenG2DisplayBridge = ({ id = "even-g2-display" } = {}) => {
  const mapper = createEvenG2DisplayMapper();
  return createMappedBodyBridgeDevice({
    id,
    kind: "even-g2",
    mapper,
    capabilities: ["state", "speech", "task", "display", "sse"],
    mapPayload({ state, mapped, speechText }) {
      return Object.freeze({
        text: speechText ? speechText.slice(0, 80) : mapped,
        mode: state?.mode || null
      });
    }
  });
};

const createExpressionMapper = ({
  id,
  expressions = {},
  motions = {},
  fallbackExpression = "neutral",
  fallbackMotion = "idle"
}) =>
  Object.freeze({
    id,
    mapState(state) {
      const expression =
        expressions[state.emotion] || expressions[state.mode] || fallbackExpression;
      const motion = motions[state.motion] || motions[state.mode] || fallbackMotion;
      return Object.freeze({
        expression,
        motion,
        speaking: state.mode === "speaking",
        mode: state.mode,
        emotion: state.emotion || "neutral"
      });
    }
  });

export const createLive2DBodyBridge = ({
  id = "live2d",
  expressions = {
    attentive: "smile",
    focused: "serious",
    careful: "serious",
    relieved: "smile",
    error: "troubled"
  },
  motions = {
    idle: "Idle",
    listening: "Listen",
    thinking: "Think",
    speaking: "Talk",
    working: "Work",
    error: "Error"
  }
} = {}) => {
  const mapper = createExpressionMapper({
    id: "live2d-expression-mapper",
    expressions,
    motions,
    fallbackExpression: "neutral",
    fallbackMotion: "Idle"
  });
  return createMappedBodyBridgeDevice({
    id,
    kind: "live2d",
    mapper,
    capabilities: ["state", "speech", "task", "expression", "motion", "lip-sync", "sse"],
    mapPayload({ state, mapped, speechText }) {
      return Object.freeze({
        expression: mapped.expression,
        motion: mapped.motion,
        lipSync: {
          active: Boolean(mapped.speaking),
          text: speechText || ""
        },
        parameters: {
          mouthOpenY: mapped.speaking ? 1 : 0,
          eyeOpenLeft: state?.mode === "error" ? 0 : 1,
          eyeOpenRight: state?.mode === "error" ? 0 : 1
        },
        mode: mapped.mode,
        emotion: mapped.emotion
      });
    }
  });
};

export const createVrmBodyBridge = ({
  id = "vrm",
  expressions = {
    attentive: "happy",
    focused: "serious",
    careful: "serious",
    relieved: "relaxed",
    error: "sad"
  },
  motions = {
    idle: "idle",
    listening: "listen",
    thinking: "think",
    speaking: "talk",
    working: "work",
    error: "error"
  }
} = {}) => {
  const mapper = createExpressionMapper({
    id: "vrm-expression-mapper",
    expressions,
    motions,
    fallbackExpression: "neutral",
    fallbackMotion: "idle"
  });
  return createMappedBodyBridgeDevice({
    id,
    kind: "vrm",
    mapper,
    capabilities: ["state", "speech", "task", "expression", "animation", "gaze", "sse"],
    mapPayload({ state, mapped, speechText }) {
      return Object.freeze({
        expression: mapped.expression,
        animation: mapped.motion,
        gaze: state?.gaze || "user",
        speaking: Boolean(mapped.speaking),
        caption: speechText || "",
        mode: mapped.mode,
        emotion: mapped.emotion
      });
    }
  });
};
