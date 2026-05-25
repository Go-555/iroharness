import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createAIAvatarKitBridgeDevice,
  createCodexAppServerMicroHarness,
  createDiscordBotRuntime,
  createDiscordMessageAdapter,
  createEventStreamDevice,
  createHermesGatewayMicroHarness,
  createHttpMicroHarness,
  createJsonlProcessMicroHarness,
  createObsWebSocketAdapter,
  createOpenClawMicroHarness,
  createPlatformAdapterRegistry,
  createYouTubeLiveChatAdapter,
  createYouTubeLiveChatPollingRuntime
} from "../src/adapters/index.js";

const createFakeObsWebSocket = ({ sent }) => {
  return class FakeObsWebSocket {
    static instances = [];

    constructor() {
      this.readyState = 1;
      this.listeners = new Map();
      FakeObsWebSocket.instances.push(this);
      setTimeout(() => {
        this.emit({
          op: 0,
          d: {
            rpcVersion: 1
          }
        });
      }, 0);
    }

    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) || [];
      this.listeners.set(type, [...callbacks, callback]);
    }

    emit(message) {
      const event = { data: JSON.stringify(message) };
      (this.listeners.get("message") || []).forEach((callback) => callback(event));
    }

    send(raw) {
      const message = JSON.parse(raw);
      sent.push(message);
      if (message.op === 1) {
        setTimeout(() => this.emit({ op: 2, d: {} }), 0);
      }
      if (message.op === 6) {
        setTimeout(
          () =>
            this.emit({
              op: 7,
              d: {
                requestType: message.d.requestType,
                requestId: message.d.requestId,
                requestStatus: { result: true, code: 100 },
                responseData: { ok: true }
              }
            }),
          0
        );
      }
    }

    close() {
      this.readyState = 3;
    }
  };
};

const createFakeDiscordGatewayWebSocket = ({ sent }) => {
  return class FakeDiscordGatewayWebSocket {
    static instances = [];

    constructor() {
      this.readyState = 1;
      this.listeners = new Map();
      FakeDiscordGatewayWebSocket.instances.push(this);
      setTimeout(() => {
        this.emit({
          op: 10,
          d: {
            heartbeat_interval: 60_000
          }
        });
      }, 0);
    }

    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) || [];
      this.listeners.set(type, [...callbacks, callback]);
    }

    emit(message) {
      const event = { data: JSON.stringify(message) };
      (this.listeners.get("message") || []).forEach((callback) => callback(event));
    }

    send(raw) {
      const message = JSON.parse(raw);
      sent.push(message);
      if (message.op === 2) {
        setTimeout(
          () =>
            this.emit({
              op: 0,
              t: "READY",
              s: 1,
              d: {
                session_id: "session_1",
                user: { id: "bot-user" }
              }
            }),
          0
        );
      }
    }

    close() {
      this.readyState = 3;
    }
  };
};

const createFakeCodexTransport = () => {
  let listeners = [];
  const requests = [];
  const emit = (event) => {
    listeners.forEach((listener) => listener(event));
  };
  return {
    requests,
    async initialize() {
      requests.push({ method: "initialize" });
    },
    async sendRequest(method, params) {
      requests.push({ method, params });
      if (method === "thread/start") {
        return { thread: { id: "thread_1" } };
      }
      if (method === "turn/start") {
        setTimeout(() => {
          emit({
            method: "item/agentMessage/delta",
            params: { delta: "実装を確認しました。" }
          });
          emit({
            method: "turn/completed",
            params: { turn: { id: "turn_1" } }
          });
        }, 0);
        return { turn: { id: "turn_1" } };
      }
      return {};
    },
    subscribe(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener);
      };
    },
    close() {}
  };
};

test("HTTP micro harness posts task context and normalizes response", async () => {
  const fetchImpl = async (_endpoint, options) => {
    const payload = JSON.parse(options.body);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          status: "completed",
          summary: `received ${payload.task.id}`,
          artifacts: [{ kind: "log", uri: "memory://run", title: "Run log" }]
        });
      }
    };
  };

  const harness = createHttpMicroHarness({
    id: "openclaw",
    endpoint: "http://127.0.0.1:8787/run",
    capabilities: ["assistant"],
    fetchImpl
  });

  const output = await harness.run({ id: "ticket_1" }, { character: { id: "iroha" } });
  assert.equal(output.status, "completed");
  assert.equal(output.summary, "received ticket_1");
  assert.equal(output.artifacts.length, 1);
});

test("OpenClaw micro harness sends an IroHarness task envelope", async () => {
  const calls = [];
  const harness = createOpenClawMicroHarness({
    endpoint: "http://127.0.0.1:8787/agent/run",
    apiKey: "test-key",
    agentId: "iroha-openclaw",
    sessionId: "session_1",
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            reply: "OpenClaw finished",
            artifacts: [{ kind: "note", uri: "memory://openclaw", title: "run" }]
          });
        }
      };
    }
  });

  const output = await harness.run(
    { id: "ticket_1", title: "Review", purpose: "レビューして" },
    {
      character: { id: "iroha" },
      actor: { user: { id: "dev" } },
      projectOs: { tickets: [] }
    }
  );

  assert.equal(calls[0].endpoint, "http://127.0.0.1:8787/agent/run");
  assert.equal(calls[0].options.headers.authorization, "Bearer test-key");
  assert.equal(calls[0].body.agentId, "iroha-openclaw");
  assert.equal(calls[0].body.message, "レビューして");
  assert.equal(calls[0].body.context.character.id, "iroha");
  assert.equal(output.summary, "OpenClaw finished");
  assert.equal(output.artifacts.length, 1);
});

test("Hermes gateway micro harness sends text and macro metadata", async () => {
  const calls = [];
  const harness = createHermesGatewayMicroHarness({
    endpoint: "http://127.0.0.1:8765/message",
    conversationId: "conversation_1",
    fetchImpl: async (_endpoint, options) => {
      calls.push(JSON.parse(options.body));
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            text: "Hermes learned this"
          });
        }
      };
    }
  });

  const output = await harness.run(
    { id: "ticket_2", title: "Remember", purpose: "この判断を覚えて" },
    {
      character: { id: "iroha" },
      actor: { user: { id: "dev" } },
      projectOs: { tickets: [] }
    }
  );

  assert.equal(calls[0].text, "この判断を覚えて");
  assert.equal(calls[0].conversationId, "conversation_1");
  assert.equal(calls[0].metadata.character.id, "iroha");
  assert.equal(output.summary, "Hermes learned this");
});

test("AIAvatarKit bridge device posts speech and state events", async () => {
  const calls = [];
  const device = createAIAvatarKitBridgeDevice({
    eventEndpoint: "http://127.0.0.1:8000/iroharness/events",
    stateEndpoint: "http://127.0.0.1:8000/iroharness/state",
    speechEndpoint: "http://127.0.0.1:8000/iroharness/speech",
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async text() {
          return "{}";
        }
      };
    }
  });

  device.emit({
    type: "state",
    state: {
      characterId: "iroha",
      mode: "speaking",
      speechText: "こんにちは"
    }
  });
  device.emit({
    type: "speech",
    text: "こんにちは"
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(calls.length, 4);
  assert.equal(calls[0].endpoint, "http://127.0.0.1:8000/iroharness/events");
  assert.equal(calls[1].endpoint, "http://127.0.0.1:8000/iroharness/state");
  assert.equal(calls[2].endpoint, "http://127.0.0.1:8000/iroharness/events");
  assert.equal(calls[3].endpoint, "http://127.0.0.1:8000/iroharness/speech");
  assert.equal(calls[3].body.speechText, "こんにちは");
});

test("Codex app-server micro harness starts thread and returns assistant deltas", async () => {
  const transport = createFakeCodexTransport();
  const harness = createCodexAppServerMicroHarness({
    cwd: "/tmp/project",
    model: "gpt-test",
    transport,
    timeoutMs: 1000
  });

  const output = await harness.run(
    {
      id: "ticket_1",
      title: "Review README",
      purpose: "CodexでREADMEをレビューして"
    },
    {
      actor: {
        user: { displayName: "Developer" }
      }
    }
  );

  assert.equal(output.status, "completed");
  assert.equal(output.summary, "実装を確認しました。");
  assert.equal(output.artifacts[0].kind, "codex-events");
  assert.equal(transport.requests[0].method, "initialize");
  assert.equal(transport.requests[1].method, "thread/start");
  assert.equal(transport.requests[1].params.model, "gpt-test");
  assert.equal(transport.requests[2].method, "turn/start");
  assert.equal(transport.requests[2].params.threadId, "thread_1");
});

test("JSONL process micro harness sends one task and parses final JSON line", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-process-"));
  const scriptPath = join(dir, "worker.mjs");
  writeFileSync(
    scriptPath,
    [
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk.toString('utf8'); });",
      "process.stdin.on('end', () => {",
      "  const payload = JSON.parse(input);",
      "  console.log(JSON.stringify({",
      "    status: 'completed',",
      "    summary: `processed ${payload.task.id}`,",
      "    artifacts: []",
      "  }));",
      "});"
    ].join("\n"),
    "utf8"
  );
  chmodSync(scriptPath, 0o755);

  const harness = createJsonlProcessMicroHarness({
    id: "hermes",
    command: process.execPath,
    args: [scriptPath],
    capabilities: ["learning"]
  });

  const output = await harness.run({ id: "ticket_2" }, { character: { id: "iroha" } });
  assert.equal(output.status, "completed");
  assert.equal(output.summary, "processed ticket_2");
});

test("event stream device records emitted state events", () => {
  const device = createEventStreamDevice("events");
  device.emit({
    type: "state",
    state: {
      characterId: "iroha",
      mode: "speaking",
      emotion: "attentive"
    }
  });

  assert.equal(device.events().length, 1);
  assert.equal(device.events()[0].type, "state");
  assert.equal(device.events()[0].state.mode, "speaking");
});

test("Discord message adapter normalizes multi-person chat payloads", () => {
  const adapter = createDiscordMessageAdapter();
  const turn = adapter.normalize({
    id: "message_1",
    channel_id: "channel_1",
    guild_id: "guild_1",
    content: "Codexでこの設計をレビューして",
    author: {
      id: "discord-user-1",
      username: "Fan One"
    }
  });

  assert.equal(turn.source, "discord");
  assert.equal(turn.text, "Codexでこの設計をレビューして");
  assert.equal(turn.actor.platform, "discord");
  assert.equal(turn.actor.platformUserId, "discord-user-1");
  assert.equal(turn.metadata.channelId, "channel_1");
});

test("Discord message adapter can ignore bots and non-mentions", () => {
  assert.equal(
    createDiscordMessageAdapter().normalize({
      content: "hello",
      author: { id: "bot", username: "Bot", bot: true }
    }),
    null
  );

  assert.equal(
    createDiscordMessageAdapter({ mentionOnly: true, botUserId: "iroha" }).normalize({
      content: "hello",
      author: { id: "user", username: "Fan" },
      mentions: []
    }),
    null
  );
});

test("YouTube live chat adapter normalizes author identity", () => {
  const adapter = createYouTubeLiveChatAdapter();
  const turn = adapter.normalize({
    id: "chat_1",
    snippet: {
      liveChatId: "live_1",
      displayMessage: "こんにちは"
    },
    authorDetails: {
      channelId: "UC123",
      displayName: "Viewer",
      isChatSponsor: true
    }
  });

  assert.equal(turn.source, "youtube");
  assert.equal(turn.text, "こんにちは");
  assert.equal(turn.actor.platform, "youtube");
  assert.equal(turn.actor.platformUserId, "UC123");
  assert.equal(turn.metadata.isChatSponsor, true);
});

test("platform adapter registry dispatches by platform", () => {
  const registry = createPlatformAdapterRegistry([createYouTubeLiveChatAdapter()]);
  assert.deepEqual(registry.platforms(), ["youtube"]);
  const turn = registry.normalize("youtube", {
    message: "hello",
    authorChannelId: "UC999",
    displayName: "Viewer"
  });

  assert.equal(turn.actor.platformUserId, "UC999");
});

test("YouTube live chat polling runtime fetches messages and sends turns to harness", async () => {
  const receivedTurns = [];
  const harness = {
    async receive(turn) {
      receivedTurns.push(turn);
      return { kind: "response", text: "ok" };
    }
  };
  const fetchCalls = [];
  const fetchImpl = async (url) => {
    fetchCalls.push(url);
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({
          nextPageToken: "next-token",
          pollingIntervalMillis: 9000,
          items: [
            {
              id: "chat_1",
              snippet: {
                liveChatId: "live_1",
                displayMessage: "こんにちは"
              },
              authorDetails: {
                channelId: "UC123",
                displayName: "Viewer"
              }
            }
          ]
        });
      }
    };
  };

  const runtime = createYouTubeLiveChatPollingRuntime({
    apiKey: "test-key",
    liveChatId: "live_1",
    harness,
    fetchImpl
  });
  const result = await runtime.pollOnce();

  assert.equal(receivedTurns.length, 1);
  assert.equal(receivedTurns[0].source, "youtube");
  assert.equal(receivedTurns[0].actor.platformUserId, "UC123");
  assert.equal(result.nextPageToken, "next-token");
  assert.equal(runtime.state().nextIntervalMs, 9000);
  assert.equal(new URL(fetchCalls[0]).searchParams.get("liveChatId"), "live_1");
});

test("YouTube live chat polling runtime skips duplicate message IDs", async () => {
  const receivedTurns = [];
  const harness = {
    async receive(turn) {
      receivedTurns.push(turn);
      return { kind: "response", text: "ok" };
    }
  };
  const fetchImpl = async () => ({
    ok: true,
    status: 200,
    async text() {
      return JSON.stringify({
        items: [
          {
            id: "chat_1",
            snippet: { displayMessage: "hello" },
            authorDetails: { channelId: "UC123", displayName: "Viewer" }
          }
        ]
      });
    }
  });

  const runtime = createYouTubeLiveChatPollingRuntime({
    apiKey: "test-key",
    liveChatId: "live_1",
    harness,
    fetchImpl
  });
  await runtime.pollOnce();
  await runtime.pollOnce();

  assert.equal(receivedTurns.length, 1);
  assert.equal(runtime.state().seenCount, 1);
});

test("OBS WebSocket adapter identifies and sends scene requests", async () => {
  const sent = [];
  const adapter = createObsWebSocketAdapter({
    WebSocketImpl: createFakeObsWebSocket({ sent })
  });

  await adapter.connect();
  const response = await adapter.setCurrentProgramScene("Iroha Stream");

  assert.equal(adapter.state().identified, true);
  assert.equal(sent[0].op, 1);
  assert.equal(sent[1].op, 6);
  assert.equal(sent[1].d.requestType, "SetCurrentProgramScene");
  assert.equal(sent[1].d.requestData.sceneName, "Iroha Stream");
  assert.deepEqual(response.responseData, { ok: true });
  adapter.close();
});

test("OBS WebSocket adapter sends browser source input settings", async () => {
  const sent = [];
  const adapter = createObsWebSocketAdapter({
    WebSocketImpl: createFakeObsWebSocket({ sent })
  });

  await adapter.setInputSettings("IroHarness Overlay", {
    url: "http://127.0.0.1:4178/?view=overlay",
    width: 1280,
    height: 720
  });

  const request = sent.find((message) => message.op === 6);
  assert.equal(request.d.requestType, "SetInputSettings");
  assert.equal(request.d.requestData.inputName, "IroHarness Overlay");
  assert.equal(
    request.d.requestData.inputSettings.url,
    "http://127.0.0.1:4178/?view=overlay"
  );
  adapter.close();
});

test("Discord bot runtime identifies, receives messages, and replies", async () => {
  const sentGateway = [];
  const restCalls = [];
  const receivedTurns = [];
  const Gateway = createFakeDiscordGatewayWebSocket({ sent: sentGateway });
  const harness = {
    async receive(turn) {
      receivedTurns.push(turn);
      return { kind: "response", text: `reply to ${turn.actor.displayName}` };
    }
  };
  const fetchImpl = async (url, options) => {
    restCalls.push({ url, options });
    return {
      ok: true,
      status: 200,
      async text() {
        return JSON.stringify({ id: "reply_1" });
      }
    };
  };

  const runtime = createDiscordBotRuntime({
    token: "discord-token",
    harness,
    WebSocketImpl: Gateway,
    fetchImpl
  });
  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 10));

  Gateway.instances[0].emit({
    op: 0,
    t: "MESSAGE_CREATE",
    s: 2,
    d: {
      id: "message_1",
      channel_id: "channel_1",
      guild_id: "guild_1",
      content: "こんにちは",
      author: {
        id: "discord-user-1",
        username: "Fan One"
      }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(sentGateway[0].op, 2);
  assert.equal(sentGateway[0].d.token, "discord-token");
  assert.equal(runtime.state().botUserId, "bot-user");
  assert.equal(receivedTurns.length, 1);
  assert.equal(receivedTurns[0].source, "discord");
  assert.equal(restCalls.length, 1);
  assert.equal(restCalls[0].url, "https://discord.com/api/v10/channels/channel_1/messages");
  assert.equal(JSON.parse(restCalls[0].options.body).content, "reply to Fan One");
  runtime.stop();
});

test("Discord bot runtime ignores messages from itself", async () => {
  const sentGateway = [];
  const receivedTurns = [];
  const Gateway = createFakeDiscordGatewayWebSocket({ sent: sentGateway });
  const runtime = createDiscordBotRuntime({
    token: "discord-token",
    harness: {
      async receive(turn) {
        receivedTurns.push(turn);
        return { kind: "response", text: "ok" };
      }
    },
    WebSocketImpl: Gateway,
    fetchImpl: async () => ({
      ok: true,
      status: 200,
      async text() {
        return "{}";
      }
    })
  });
  runtime.start();
  await new Promise((resolve) => setTimeout(resolve, 10));

  Gateway.instances[0].emit({
    op: 0,
    t: "MESSAGE_CREATE",
    s: 2,
    d: {
      id: "message_1",
      channel_id: "channel_1",
      content: "self message",
      author: {
        id: "bot-user",
        username: "Iroha"
      }
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.equal(receivedTurns.length, 0);
  runtime.stop();
});
