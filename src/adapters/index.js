import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
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
  const bodySummary = () =>
    bodyDevices.map((body) => ({
      id: body.id,
      kind: body.kind,
      capabilities: body.capabilities || []
    }));

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
          characterId: state.characterId,
          mode: state.mode,
          audienceRegistry: Boolean(audienceRegistry),
          adminProtected: Boolean(adminToken),
          bodies: bodySummary(),
          platforms: platformAdapters.platforms(),
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
