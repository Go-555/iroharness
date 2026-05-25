import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { readFileSync, statSync } from "node:fs";
import { extname, join, normalize } from "node:path";
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

const createObsRequestId = () =>
  `obs_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const truncateDiscordMessage = (value) => String(value || "").slice(0, 2000);

const createObsAuthentication = ({ password, salt, challenge }) => {
  const secret = createHash("sha256")
    .update(`${password}${salt}`)
    .digest("base64");
  return createHash("sha256")
    .update(`${secret}${challenge}`)
    .digest("base64");
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
    const result = await harness.receive(turn);
    let reply = null;
    if (respond) {
      reply = responseFormatter({ turn, result });
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
    onResult(Object.freeze({ turn, result, reply }));
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

export const createYouTubeLiveChatPollingRuntime = ({
  apiKey,
  liveChatId,
  harness,
  adapter = createYouTubeLiveChatAdapter(),
  fetchImpl = globalThis.fetch,
  intervalMs = 5_000,
  maxResults = 50,
  pageToken = null,
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
      const result = await harness.receive(turn);
      const event = Object.freeze({ item, turn, result });
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

export const createIroHarnessDevServer = ({
  harness,
  eventStream,
  platformAdapters = createPlatformAdapterRegistry([
    createDiscordMessageAdapter(),
    createYouTubeLiveChatAdapter()
  ]),
  publicDir = defaultPublicDir()
}) => {
  if (!harness || !eventStream) {
    throw new Error("createIroHarnessDevServer requires harness and eventStream");
  }

  const server = createServer(async (request, response) => {
    const url = new URL(request.url, "http://127.0.0.1");
    try {
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
        const result = await harness.receive(turn);
        sendJson(response, 200, {
          turn,
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
  });

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
