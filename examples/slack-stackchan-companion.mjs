import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { join } from "node:path";

import {
  createEchoBrain,
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
  if (!signingSecret) {
    return true;
  }
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
  const signingSecret = process.env.SLACK_SIGNING_SECRET || "";
  const port = Number(process.env.PORT || "4182");
  const host = process.env.HOST || "127.0.0.1";
  const codexWorkspace = process.env.CODEX_WORKSPACE || process.cwd();
  const stackchan = createM5StackBodyBridge({
    id: process.env.STACKCHAN_BODY_ID || "stackchan"
  });

  const projectOs = createFileProjectOs({
    path: join(process.cwd(), ".iroharness", "slack-stackchan-pjos.json")
  });
  const userRegistry = createFileUserRegistry({
    path: join(process.cwd(), ".iroharness", "users.json")
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
    character: {
      id: process.env.IROHARNESS_CHARACTER_ID || "iroha",
      name: process.env.IROHARNESS_CHARACTER_NAME || "Iroha",
      soul:
        process.env.IROHARNESS_CHARACTER_SOUL ||
        "A stable character macro harness that talks in Slack and appears through StackChan.",
      voiceStyle: process.env.IROHARNESS_CHARACTER_VOICE || "short, practical, warm"
    },
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

  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, {
        ok: true,
        service: "iroharness-slack-stackchan",
        body: stackchan.id
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
console.log(`StackChan SSE: ${urls.stackchanEventsUrl}`);
