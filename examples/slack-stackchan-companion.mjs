import { createHmac, timingSafeEqual } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, resolve } from "node:path";

import {
  createEchoBrain,
  createFileCharacterProfile,
  createFileProjectOs,
  createFileUserRegistry,
  createHeuristicRouter,
  createIroHarness
} from "../src/index.js";
import {
  createCodexAppServerBrain,
  createCodexAppServerMicroHarness,
  createM5StackBodyBridge,
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

const createSlackStackChanCompanion = () => {
  const botToken = requireEnv("SLACK_BOT_TOKEN");
  const signingSecret = requireEnv("SLACK_SIGNING_SECRET");
  const stackchanDeviceToken = requireEnv("STACKCHAN_DEVICE_TOKEN");
  const port = Number(process.env.PORT || "4182");
  const host = process.env.HOST || "127.0.0.1";
  const codexWorkspace = process.env.CODEX_WORKSPACE || process.cwd();
  const runtimePaths = resolveRuntimePaths();
  const stackchan = createM5StackBodyBridge({
    id: process.env.STACKCHAN_BODY_ID || "stackchan"
  });

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
      text: createBrainForSlot({ slot: "text", codexWorkspace }),
      deep: createBrainForSlot({ slot: "deep", codexWorkspace })
    },
    devices: [stackchan],
    microHarnesses
  });

  const seenEventIds = new Set();
  const runtime = createSlackEventsRuntime({
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
  });

  const handleDeviceInvoke = async (payload) => {
    const text =
      payload.text ||
      (payload.type === "touch"
        ? "$頭を撫でられました。短く反応してください。"
        : "$StackChanからイベントが届きました。短く反応してください。");
    const result = await harness.receive({
      source: "m5stack",
      modality: payload.type === "audio" ? "voice" : "text",
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
        ...(payload.metadata || {})
      }
    });
    return {
      ok: true,
      resultKind: result.kind,
      text: result.text || result.output?.summary || "",
      face: stackchan.snapshot()?.payload || null
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

  return Object.freeze({
    listen() {
      return new Promise((resolve) => {
        server.listen(port, host, () => {
          resolve({
            slackEventsUrl: `http://${host}:${port}/slack/events`,
            stackchanFaceUrl: `http://${host}:${port}/stackchan/face`,
            stackchanInvokeUrl: `http://${host}:${port}/device/stackchan/invoke`,
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
console.log(`StackChan SSE: ${urls.stackchanEventsUrl}`);
if (process.env.IROHARNESS_VIEW_DIR) {
  console.log(`IroHarness view: ${resolve(process.env.IROHARNESS_VIEW_DIR)}`);
}
