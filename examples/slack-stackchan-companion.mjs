import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import {
  createEchoBrain,
  createFileCharacterProfile,
  createFileProjectOs,
  createFileUserRegistry,
  createHeuristicRouter,
  createHttpStreamingStt,
  createSpeechPlaybackQueue,
  createIroHarness
} from "../src/index.js";
import {
  createAivisSpeechTts,
  createAzureSpeechStt,
  createCodexAppServerBrain,
  createCodexAppServerMicroHarness,
  createM5StackBodyBridge,
  createStackChanRealtimeSessionHandler,
  createSlackEventsRuntime,
  createSlackMessageAdapter
} from "../src/adapters/index.js";

const requireEnv = (name) => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name}.`);
  }
  return value;
};

const readBody = (request) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks)));
    request.on("error", reject);
  });

const sendJson = (response, status, payload) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(payload));
};

const safeEqual = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
};

const verifySlackSignature = ({ body, headers, signingSecret }) => {
  const timestamp = headers["x-slack-request-timestamp"];
  const signature = headers["x-slack-signature"];
  if (!timestamp || !signature) {
    return false;
  }
  const ageSeconds = Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp));
  if (!Number.isFinite(ageSeconds) || ageSeconds > 60 * 5) {
    return false;
  }
  const base = `v0:${timestamp}:${body.toString("utf8")}`;
  const digest = createHmac("sha256", signingSecret).update(base).digest("hex");
  return safeEqual(`v0=${digest}`, signature);
};

const parseJson = (body) => {
  try {
    return JSON.parse(body.toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid JSON payload: ${error.message}`);
  }
};

const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const encodeWebSocketTextFrame = (text) => {
  const payload = Buffer.from(String(text), "utf8");
  if (payload.length < 126) {
    return Buffer.concat([Buffer.from([0x81, payload.length]), payload]);
  }
  if (payload.length <= 65535) {
    const header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
    return Buffer.concat([header, payload]);
  }
  const header = Buffer.alloc(10);
  header[0] = 0x81;
  header[1] = 127;
  header.writeBigUInt64BE(BigInt(payload.length), 2);
  return Buffer.concat([header, payload]);
};

const decodeWebSocketFrames = (buffer) => {
  const messages = [];
  let offset = 0;
  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let payloadLength = second & 0x7f;
    let headerLength = 2;
    if (payloadLength === 126) {
      if (buffer.length - offset < 4) {
        break;
      }
      payloadLength = buffer.readUInt16BE(offset + 2);
      headerLength = 4;
    } else if (payloadLength === 127) {
      if (buffer.length - offset < 10) {
        break;
      }
      payloadLength = Number(buffer.readBigUInt64BE(offset + 2));
      headerLength = 10;
    }
    const maskLength = masked ? 4 : 0;
    const frameLength = headerLength + maskLength + payloadLength;
    if (buffer.length - offset < frameLength) {
      break;
    }
    const mask = masked ? buffer.subarray(offset + headerLength, offset + headerLength + 4) : null;
    const payloadStart = offset + headerLength + maskLength;
    const payload = Buffer.from(buffer.subarray(payloadStart, payloadStart + payloadLength));
    if (mask) {
      payload.forEach((byte, index) => {
        payload[index] = byte ^ mask[index % 4];
      });
    }
    messages.push({
      opcode,
      text: payload.toString("utf8")
    });
    offset += frameLength;
  }
  return Object.freeze({
    messages,
    rest: buffer.subarray(offset)
  });
};

const createWebSocketAdapter = (socket) => {
  const listeners = new Map();
  let pending = Buffer.alloc(0);
  const emit = (type, event) => {
    (listeners.get(type) || []).forEach((listener) => listener(event));
  };
  socket.on("data", (chunk) => {
    pending = Buffer.concat([pending, chunk]);
    const decoded = decodeWebSocketFrames(pending);
    pending = decoded.rest;
    decoded.messages.forEach((message) => {
      if (message.opcode === 0x8) {
        emit("close", {});
        socket.end();
        return;
      }
      if (message.opcode === 0x1) {
        emit("message", { data: message.text });
      }
    });
  });
  socket.on("close", () => emit("close", {}));
  socket.on("error", (error) => emit("error", error));
  return Object.freeze({
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      listeners.set(type, [...callbacks, callback]);
    },
    send(text) {
      socket.write(encodeWebSocketTextFrame(text));
    },
    close() {
      socket.end(Buffer.from([0x88, 0x00]));
    }
  });
};

const acceptWebSocket = ({ request, socket }) => {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
    socket.destroy();
    return false;
  }
  const accept = createHash("sha1").update(`${key}${websocketGuid}`).digest("base64");
  socket.write(
    [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${accept}`,
      "\r\n"
    ].join("\r\n")
  );
  return true;
};

const readOptionalJson = (path) => {
  if (!existsSync(path)) {
    return null;
  }
  return JSON.parse(readFileSync(path, "utf8"));
};

const resolveRuntimePaths = () => {
  const viewDir = process.env.IROHARNESS_VIEW_DIR;
  if (!viewDir) {
    const stateDir = process.env.IROHARNESS_STATE_DIR || join(process.cwd(), ".iroharness");
    return Object.freeze({
      profileDir: resolve(process.env.IROHARNESS_PROFILE_DIR || process.cwd()),
      stateDir: resolve(stateDir),
      viewDir: null,
      manifest: null
    });
  }
  const root = resolve(viewDir);
  const currentDir = join(root, "current");
  return Object.freeze({
    profileDir: currentDir,
    stateDir: resolve(process.env.IROHARNESS_STATE_DIR || join(root, "state")),
    viewDir: root,
    manifest: readOptionalJson(join(currentDir, "view-manifest.json"))
  });
};

const createCharacterFromRuntime = ({ profileDir }) => {
  const fileCharacter = createFileCharacterProfile({
    dir: profileDir,
    id: process.env.IROHARNESS_CHARACTER_ID || "iroha",
    name: process.env.IROHARNESS_CHARACTER_NAME || "Iroha"
  });
  return Object.freeze({
    ...fileCharacter,
    id: process.env.IROHARNESS_CHARACTER_ID || fileCharacter.id,
    name: process.env.IROHARNESS_CHARACTER_NAME || fileCharacter.name,
    soul:
      process.env.IROHARNESS_CHARACTER_SOUL ||
      fileCharacter.soul ||
      "A stable character macro harness that talks in Slack and appears through StackChan.",
    voiceStyle:
      process.env.IROHARNESS_CHARACTER_VOICE || fileCharacter.voiceStyle || "short, practical, warm"
  });
};

const createBrainForSlot = ({ slot, codexWorkspace }) => {
  const prefix = `IROHARNESS_${slot.toUpperCase()}_BRAIN`;
  const provider = process.env[`${prefix}_PROVIDER`] || "echo";
  if (provider === "codex") {
    const model =
      process.env[`${prefix}_MODEL`] || process.env.CODEX_BRAIN_MODEL || process.env.CODEX_MODEL || "gpt-5.4";
    return createCodexAppServerBrain({
      id: `${slot}-codex-${model}`,
      slot,
      cwd: codexWorkspace,
      model
    });
  }
  return createEchoBrain(`${slot}-echo`);
};

const createStackChanStt = () => {
  const provider = process.env.IROHARNESS_STACKCHAN_STT_PROVIDER || "http";
  if (provider === "mock") {
    const transcript = process.env.IROHARNESS_STACKCHAN_MOCK_TRANSCRIPT || "こんにちは";
    return Object.freeze({
      id: "stackchan-mock-stt",
      kind: "stt",
      start({ onEvent = () => {} } = {}) {
        let pushed = false;
        return Object.freeze({
          async push() {
            pushed = true;
            const partial = {
              type: "stt.partial",
              text: transcript.slice(0, Math.max(1, Math.ceil(transcript.length / 2))),
              delta: transcript.slice(0, Math.max(1, Math.ceil(transcript.length / 2))),
              final: false
            };
            onEvent(partial);
            return [partial];
          },
          async end() {
            const final = {
              type: "stt.final",
              text: pushed ? transcript : "",
              delta: "",
              final: true
            };
            onEvent(final);
            return [final];
          },
          cancel() {
            return null;
          }
        });
      }
    });
  }
  if (provider === "azure") {
    return createAzureSpeechStt({
      id: "stackchan-azure-stt",
      region: process.env.AZURE_SPEECH_REGION,
      endpoint: process.env.AZURE_SPEECH_STT_ENDPOINT || null,
      subscriptionKey: process.env.AZURE_SPEECH_KEY || null,
      authorizationToken: process.env.AZURE_SPEECH_AUTHORIZATION_TOKEN || null,
      language: process.env.AZURE_SPEECH_LANGUAGE || "ja-JP",
      mode: process.env.AZURE_SPEECH_STT_MODE || "classic",
      sampleRate: Number(process.env.IROHARNESS_STACKCHAN_AUDIO_SAMPLE_RATE || "16000"),
      debugAudioDir: process.env.IROHARNESS_STACKCHAN_STT_DEBUG_AUDIO_DIR || null
    });
  }
  const endpoint = process.env.IROHARNESS_STACKCHAN_STT_ENDPOINT;
  if (!endpoint) {
    return null;
  }
  const authorization = process.env.IROHARNESS_STACKCHAN_STT_AUTHORIZATION;
  return createHttpStreamingStt({
    id: "stackchan-http-stt",
    endpoint,
    headers: authorization ? { authorization } : {}
  });
};

const createStackChanTts = () => {
  const provider = process.env.IROHARNESS_STACKCHAN_TTS_PROVIDER || "none";
  if (provider === "mock") {
    return Object.freeze({
      id: "stackchan-mock-tts",
      kind: "tts",
      async stream({ text, onEvent = () => {} }) {
        const audio = Buffer.from(`mock-audio:${text || ""}`).toString("base64");
        const events = [
          {
            type: "tts.audio",
            text,
            audio,
            encoding: "wav",
            final: false
          },
          {
            type: "tts.completed",
            text,
            audio: "",
            final: true
          }
        ];
        events.forEach(onEvent);
        return Object.freeze(events);
      }
    });
  }
  if (provider !== "aivis") {
    return null;
  }
  return createAivisSpeechTts({
    id: "stackchan-aivis-tts",
    baseUrl: process.env.AIVIS_SPEECH_BASE_URL || "http://127.0.0.1:10101",
    speaker: process.env.AIVIS_SPEECH_SPEAKER,
    useCancellableSynthesis: process.env.AIVIS_SPEECH_CANCELLABLE === "1"
  });
};

const transcribeStackChanAudio = async ({ stt, audio, fallbackText }) => {
  if (!stt || !audio?.dataBase64) {
    return fallbackText;
  }
  const events = [];
  const session = stt.start({
    onEvent(event) {
      events.push(event);
    }
  });
  await session.push({
    audio,
    final: false
  });
  await session.end();
  const transcriptEvent =
    events.findLast((event) => event.type === "stt.final" && event.text) ||
    events.findLast((event) => event.text);
  return transcriptEvent?.text || fallbackText;
};

const createSlackStackChanCompanion = () => {
  const botToken = process.env.SLACK_BOT_TOKEN || null;
  const signingSecret = process.env.SLACK_SIGNING_SECRET || null;
  const slackEnabled = Boolean(botToken && signingSecret);
  const stackchanDeviceToken = requireEnv("STACKCHAN_DEVICE_TOKEN");
  const port = Number(process.env.PORT || "4182");
  const host = process.env.HOST || "127.0.0.1";
  const codexWorkspace = process.env.CODEX_WORKSPACE || process.cwd();
  const runtimePaths = resolveRuntimePaths();
  const stackchan = createM5StackBodyBridge({
    id: process.env.STACKCHAN_BODY_ID || "stackchan"
  });
  const stackchanStt = createStackChanStt();
  const stackchanTts = createStackChanTts();

  const projectOs = createFileProjectOs({
    path: join(runtimePaths.stateDir, "slack-stackchan-pjos.json")
  });
  const userRegistry = createFileUserRegistry({
    path: resolve(process.env.IROHARNESS_USERS_PATH || join(runtimePaths.stateDir, "users.json"))
  });

  if (process.env.IROHARNESS_SLACK_OWNER_USER_ID) {
    userRegistry.registerUser({
      id: process.env.IROHARNESS_SLACK_OWNER_ID || "owner",
      displayName: process.env.IROHARNESS_SLACK_OWNER_NAME || "Owner",
      role: "owner",
      identities: {
        slack: process.env.IROHARNESS_SLACK_OWNER_USER_ID
      }
    });
  }
  userRegistry.registerUser({
    id: process.env.IROHARNESS_STACKCHAN_USER_ID || "stackchan-device",
    displayName: process.env.IROHARNESS_STACKCHAN_USER_NAME || "StackChan",
    role: process.env.IROHARNESS_STACKCHAN_USER_ROLE || "member",
    identities: {
      m5stack: process.env.IROHARNESS_STACKCHAN_USER_PLATFORM_ID || stackchan.id
    }
  });

  const microHarnesses =
    process.env.IROHARNESS_RUN_CODEX === "1"
      ? [
          createCodexAppServerMicroHarness({
            cwd: codexWorkspace,
            model: process.env.CODEX_MODEL || "gpt-5.4",
            approvalPolicy: process.env.CODEX_APPROVAL_POLICY || "on-request",
            threadSandbox: process.env.CODEX_THREAD_SANDBOX || "workspace-write",
            sandboxPolicy: {
              type: "workspaceWrite",
              writableRoots: [codexWorkspace],
              networkAccess: process.env.CODEX_NETWORK_ACCESS === "1"
            }
          })
        ]
      : [];

  const harness = createIroHarness({
    character: createCharacterFromRuntime(runtimePaths),
    projectOs,
    userRegistry,
    router: createHeuristicRouter(),
    brains: {
      voice: createBrainForSlot({ slot: "voice", codexWorkspace }),
      text: createBrainForSlot({ slot: "text", codexWorkspace })
    },
    devices: [stackchan],
    microHarnesses
  });
  const realtimeHandler =
    stackchanStt && stackchanTts
      ? createStackChanRealtimeSessionHandler({
          id: "stackchan-realtime",
          harness,
          stt: stackchanStt,
          tts: stackchanTts,
          deviceToken: stackchanDeviceToken,
          voice: process.env.IROHARNESS_STACKCHAN_VOICE || "iroha",
          latencyBudgetMs: Number(process.env.IROHARNESS_STACKCHAN_LATENCY_BUDGET_MS || "1000"),
          sttAutoFinalMs: Number(process.env.IROHARNESS_STACKCHAN_STT_AUTO_FINAL_MS || "1800"),
          sttAutoFinalMinBytes: Number(process.env.IROHARNESS_STACKCHAN_STT_AUTO_FINAL_MIN_BYTES || "32000"),
          vadThresholdDb: Number(process.env.IROHARNESS_STACKCHAN_VAD_THRESHOLD_DB || "-38"),
          vadSilenceMs: Number(process.env.IROHARNESS_STACKCHAN_VAD_SILENCE_MS || "700"),
          vadMinSpeechMs: Number(process.env.IROHARNESS_STACKCHAN_VAD_MIN_SPEECH_MS || "250"),
          vadMaxSpeechMs: Number(process.env.IROHARNESS_STACKCHAN_VAD_MAX_SPEECH_MS || "8000"),
          minAudioBytes: Number(process.env.IROHARNESS_STACKCHAN_MIN_AUDIO_BYTES || "320"),
          createQueue: () =>
            createSpeechPlaybackQueue({
              id: "stackchan-speech-queue"
            })
        })
      : null;
  let activeRealtimeSession = null;

  const seenEventIds = new Set();
  const runtime = slackEnabled
    ? createSlackEventsRuntime({
        botToken,
        harness,
        adapter: createSlackMessageAdapter({
          mentionOnly: process.env.SLACK_MENTION_ONLY !== "0",
          botUserId: process.env.SLACK_BOT_USER_ID || null
        }),
        responseFormatter({ result }) {
          if (result.kind === "permission_denied") {
            return result.text;
          }
          return result.text || result.output?.summary || null;
        },
        onResult({ turn, result, reply }) {
          console.log(
            JSON.stringify({
              from: turn.actor.displayName,
              userId: turn.actor.platformUserId,
              text: turn.text,
              resultKind: result.kind,
              route: result.route?.kind || null,
              stackchan: stackchan.snapshot()?.payload || null,
              replied: Boolean(reply)
            })
          );
        },
        onError(error) {
          console.error(error.stack || error.message);
        }
      })
    : null;

  const handleDeviceInvoke = async (payload) => {
    const fallbackText =
      payload.type === "touch"
        ? "$頭を撫でられました。短く反応してください。"
        : payload.type === "audio" || payload.type === "ptt"
          ? "$StackChanから音声入力が届きました。短く反応してください。"
          : payload.type === "vision"
            ? "$見えているものに反応してください。"
            : "$StackChanからイベントが届きました。短く反応してください。";
    const text =
      payload.text ||
      (payload.type === "audio" || payload.type === "ptt"
        ? await transcribeStackChanAudio({
            stt: stackchanStt,
            audio: payload.audio,
            fallbackText
          })
        : fallbackText);
    const result = await harness.receive({
      source: "m5stack",
      modality: payload.type === "audio" || payload.type === "ptt" ? "voice" : "text",
      text,
      actor: {
        platform: "m5stack",
        platformUserId: payload.userId || payload.deviceId || stackchan.id,
        displayName: payload.deviceId || "StackChan"
      },
      metadata: {
        deviceId: payload.deviceId || stackchan.id,
        deviceInvokeType: payload.type || "custom",
        channel: payload.channel || "local",
        imageDataUrl: payload.imageDataUrl || null,
        audio: payload.audio || null,
        sttConfigured: Boolean(stackchanStt),
        ...(payload.metadata || {})
      }
    });
    const outputText = result.text || result.output?.summary || "";
    const shouldSpeak =
      stackchanTts &&
      (payload.type === "audio" || payload.type === "ptt" || payload.speak === true);
    const realtimeSpeech =
      shouldSpeak && activeRealtimeSession?.accepted && typeof activeRealtimeSession.speak === "function"
        ? await activeRealtimeSession.speak({
            text: outputText
          })
        : null;
    const localSpeech =
      shouldSpeak && !realtimeSpeech
        ? await stackchanTts.stream({
            text: outputText,
            voice: process.env.IROHARNESS_STACKCHAN_VOICE || "iroha"
          })
        : null;
    return {
      ok: true,
      resultKind: result.kind,
      text: outputText,
      face: stackchan.snapshot()?.payload || null,
      deliveredToRealtime: Boolean(realtimeSpeech),
      speech: realtimeSpeech || localSpeech
    };
  };

  const verifyDeviceToken = (request) => {
    const headerToken = request.headers["x-iroharness-device-token"];
    const authorization = request.headers.authorization || "";
    const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    return [headerToken, bearerToken].some(
      (candidate) => typeof candidate === "string" && safeEqual(candidate, stackchanDeviceToken)
    );
  };

  const readDeviceToken = (request) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    const queryToken = url.searchParams.get("token");
    const headerToken = request.headers["x-iroharness-device-token"];
    const authorization = request.headers.authorization || "";
    const bearerToken = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length) : "";
    return queryToken || headerToken || bearerToken || null;
  };

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "iroharness-slack-stackchan",
        body: stackchan.id,
        view: runtimePaths.viewDir
          ? {
              zone: runtimePaths.manifest?.zone || null,
              profileDir: runtimePaths.profileDir,
              stateDir: runtimePaths.stateDir
            }
          : null
      });
      return;
    }
    if (request.method === "GET" && request.url === "/bodies") {
      sendJson(response, 200, {
        bodies: [
          {
            id: stackchan.id,
            kind: stackchan.kind,
            capabilities: stackchan.capabilities
          }
        ]
      });
      return;
    }
    if (request.method === "GET" && request.url === `/body/${stackchan.id}`) {
      sendJson(response, 200, {
        id: stackchan.id,
        kind: stackchan.kind,
        state: stackchan.snapshot()
      });
      return;
    }
    if (request.method === "GET" && request.url === "/stackchan/face") {
      sendJson(response, 200, stackchan.snapshot()?.payload || { face: ":)", mode: "idle", text: "" });
      return;
    }
    if (request.method === "GET" && request.url === `/body/${stackchan.id}/events`) {
      stackchan.connect(request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/device/stackchan/invoke") {
      if (!verifyDeviceToken(request)) {
        sendJson(response, 401, { ok: false, error: "invalid_device_token" });
        return;
      }
      try {
        const body = await readBody(request);
        const payload = parseJson(body);
        const result = await handleDeviceInvoke(payload);
        sendJson(response, 200, result);
      } catch (error) {
        sendJson(response, 400, { ok: false, error: error.message });
      }
      return;
    }
    if (request.method !== "POST" || request.url !== "/slack/events") {
      sendJson(response, 404, { ok: false, error: "not_found" });
      return;
    }
    if (!slackEnabled || !runtime) {
      sendJson(response, 503, { ok: false, error: "slack_disabled" });
      return;
    }

    const body = await readBody(request);
    if (!verifySlackSignature({ body, headers: request.headers, signingSecret })) {
      sendJson(response, 401, { ok: false, error: "invalid_slack_signature" });
      return;
    }

    const payload = parseJson(body);
    if (payload.type === "url_verification") {
      response.writeHead(200, { "content-type": "text/plain" });
      response.end(payload.challenge || "");
      return;
    }

    if (payload.event_id && seenEventIds.has(payload.event_id)) {
      sendJson(response, 200, { ok: true, duplicate: true });
      return;
    }
    if (payload.event_id) {
      seenEventIds.add(payload.event_id);
      setTimeout(() => seenEventIds.delete(payload.event_id), 10 * 60_000).unref?.();
    }

    sendJson(response, 200, { ok: true });
    runtime.handlePayload(payload).catch((error) => {
      console.error(error.stack || error.message);
    });
  });
  server.on("upgrade", (request, socket) => {
    const url = new URL(request.url || "/", `http://${request.headers.host || "localhost"}`);
    if (url.pathname !== `/device/${stackchan.id}/realtime`) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    if (!realtimeHandler) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\ncontent-type: text/plain\r\n\r\nSet StackChan STT and TTS providers before using realtime WebSocket.\n");
      socket.destroy();
      return;
    }
    if (!acceptWebSocket({ request, socket })) {
      return;
    }
    const websocket = createWebSocketAdapter(socket);
    let session = null;
    session = realtimeHandler.handleConnection(websocket, {
      deviceId: stackchan.id,
      userId: url.searchParams.get("userId") || stackchan.id,
      channel: url.searchParams.get("channel") || "local",
      token: readDeviceToken(request),
      onEvent(event) {
        console.log(
          JSON.stringify({
            realtime: event.type,
            deviceId: event.deviceId,
            channel: event.channel,
            sequence: event.sequence,
            message: event.message || null,
            messageType: event.messageType || undefined,
            rmsDb: typeof event.rmsDb === "number" ? event.rmsDb : undefined,
            bytes: event.bytes || undefined,
            isSpeech: typeof event.isSpeech === "boolean" ? event.isSpeech : undefined,
            thresholdDb: typeof event.thresholdDb === "number" ? event.thresholdDb : undefined,
            hasText: typeof event.text === "string" && event.text.length > 0 ? true : undefined
          })
        );
        if (event.type === "stackchan.closed" && activeRealtimeSession === session) {
          activeRealtimeSession = null;
        }
      }
    });
    if (session.accepted) {
      activeRealtimeSession = session;
    }
  });

  return Object.freeze({
    listen() {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          resolve({
            slackEventsUrl: `http://${host}:${port}/slack/events`,
            stackchanFaceUrl: `http://${host}:${port}/stackchan/face`,
            stackchanInvokeUrl: `http://${host}:${port}/device/stackchan/invoke`,
            stackchanRealtimeUrl: `ws://${host}:${port}/device/${stackchan.id}/realtime`,
            stackchanEventsUrl: `http://${host}:${port}/body/${stackchan.id}/events`
          });
        });
      });
    },
    close() {
      server.close();
    }
  });
};

const companion = createSlackStackChanCompanion();
const urls = await companion.listen();
console.log(`Slack Events URL: ${urls.slackEventsUrl}`);
console.log(`StackChan face JSON: ${urls.stackchanFaceUrl}`);
console.log(`StackChan invoke URL: ${urls.stackchanInvokeUrl}`);
console.log(`StackChan realtime WS: ${urls.stackchanRealtimeUrl}`);
console.log(`StackChan SSE: ${urls.stackchanEventsUrl}`);
if (process.env.IROHARNESS_VIEW_DIR) {
  console.log(`IroHarness view: ${resolve(process.env.IROHARNESS_VIEW_DIR)}`);
}
