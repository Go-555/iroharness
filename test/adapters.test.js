import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  createAIAvatarKitBridgeDevice,
  createAivisSpeechTts,
  createAzureSpeechStt,
  createClaudeCodeCliMicroHarness,
  createCodexAppServerBrain,
  createCodexAppServerMicroHarness,
  createDiscordBotRuntime,
  createDiscordMessageAdapter,
  createEvenG2DisplayBridge,
  createEventStreamDevice,
  createHermesGatewayMicroHarness,
  createHttpMicroHarness,
  createIroHarnessDevServerHandler,
  createJsonlRealtimeCoreProcess,
  createJsonlProcessMicroHarness,
  createLive2DBodyBridge,
  createM5StackBodyBridge,
  createMotionPngTuberRendererBridge,
  createObsStreamController,
  createObsWebSocketAdapter,
  createOpenClawMicroHarness,
  createPlatformAdapterRegistry,
  createScopedWorkRunnerMicroHarness,
  createSlackEventsRuntime,
  createSlackMessageAdapter,
  createSnapshotStreamSessionResolver,
  createStackChanRealtimeRelay,
  createStackChanRealtimeSessionHandler,
  createStreamContextEnricher,
  createTextProcessMicroHarness,
  createVrmBodyBridge,
  createYouTubeLiveChatAdapter,
  createYouTubeLiveChatPollingRuntime,
  createVsCodeCompanionAdapter,
  createVsCodeCompanionWebviewHtml
} from "../src/adapters/index.js";
import { createInMemoryUserRegistry, createSpeechPlaybackQueue } from "../src/index.js";

const createPcm16WavBase64 = ({ sampleRate = 24000, channels = 1, samples = [0, 1000, -1000, 0] } = {}) => {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
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
  return wav.toString("base64");
};

const createPcm16Base64 = ({ samples = [0, 1000, -1000, 0] } = {}) => {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((sample, index) => data.writeInt16LE(sample, index * 2));
  return data.toString("base64");
};

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

const createFakeStackChanWebSocket = ({ sent }) => {
  return class FakeStackChanWebSocket {
    static instances = [];

    constructor() {
      this.readyState = 1;
      this.listeners = new Map();
      FakeStackChanWebSocket.instances.push(this);
      setTimeout(() => this.emit("open", {}), 0);
    }

    addEventListener(type, callback) {
      const callbacks = this.listeners.get(type) || [];
      this.listeners.set(type, [...callbacks, callback]);
    }

    emit(type, event) {
      (this.listeners.get(type) || []).forEach((callback) => callback(event));
    }

    receive(payload) {
      this.emit("message", { data: JSON.stringify(payload) });
    }

    send(raw) {
      sent.push(JSON.parse(raw));
    }

    close() {
      this.readyState = 3;
    }
  };
};

const createFakeServerSocket = ({ sent }) => {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      const callbacks = listeners.get(type) || [];
      listeners.set(type, [...callbacks, callback]);
    },
    receive(payload) {
      (listeners.get("message") || []).forEach((callback) =>
        callback({ data: JSON.stringify(payload) })
      );
    },
    send(raw) {
      sent.push(JSON.parse(raw));
    },
    close() {
      (listeners.get("close") || []).forEach((callback) => callback({}));
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

const callHandler = async (
  handler,
  { method = "GET", url = "/", json = null, headers = {} } = {}
) => {
  let statusCode = null;
  let body = "";
  const requestBody = json === null ? "" : JSON.stringify(json);
  const response = {
    writeHead(status) {
      statusCode = status;
    },
    write(chunk) {
      body += chunk;
    },
    end(chunk = "") {
      body += chunk;
    }
  };
  await handler(
    {
      method,
      url,
      headers,
      on(event, callback) {
        if (event === "data" && requestBody) {
          setTimeout(() => callback(Buffer.from(requestBody)), 0);
        }
        if (event === "end") {
          setTimeout(callback, 0);
        }
      }
    },
    response
  );
  return {
    statusCode,
    body,
    json: body.trim() ? JSON.parse(body) : null
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

test("Azure Speech STT adapter posts buffered audio and emits final transcript", async () => {
  const calls = [];
  const debugAudioDir = mkdtempSync(join(tmpdir(), "iroharness-stt-debug-"));
  const stt = createAzureSpeechStt({
    id: "azure-test",
    region: "japaneast",
    subscriptionKey: "key-test",
    debugAudioDir,
    fetchImpl: async (endpoint, options) => {
      calls.push({
        endpoint,
        headers: options.headers,
        byteLength: options.body.length
      });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            RecognitionStatus: "Success",
            DisplayText: "こんにちは。"
          });
        }
      };
    }
  });
  const events = [];
  const session = stt.start({
    onEvent(event) {
      events.push(event);
    }
  });

  session.push({ audio: { dataBase64: Buffer.from("wav").toString("base64") } });
  const finalEvents = await session.end();

  assert.equal(stt.kind, "stt");
  assert.match(calls[0].endpoint, /japaneast\.stt\.speech\.microsoft\.com/);
  assert.equal(calls[0].headers["Ocp-Apim-Subscription-Key"], "key-test");
  assert.equal(calls[0].byteLength, 47);
  const debugEvent = events.find((event) => event.type === "stt.debug_audio_saved");
  assert.equal(readFileSync(debugEvent.path).toString("ascii", 0, 4), "RIFF");
  assert.equal(finalEvents[0].type, "stt.final");
  assert.equal(finalEvents[0].text, "こんにちは。");
  assert.equal(events.at(-1).adapterId, "azure-test");
});

test("AivisSpeech TTS adapter calls audio_query then synthesis", async () => {
  const calls = [];
  const tts = createAivisSpeechTts({
    id: "aivis-test",
    baseUrl: "http://127.0.0.1:10101",
    speaker: 888753760,
    fetchImpl: async (endpoint, options) => {
      calls.push({ endpoint, body: options.body || null });
      if (endpoint.includes("/audio_query")) {
        return {
          ok: true,
          status: 200,
          async text() {
            return JSON.stringify({ accent_phrases: [], speedScale: 1 });
          }
        };
      }
      return {
        ok: true,
        status: 200,
        async arrayBuffer() {
          return Buffer.from("wav-audio").buffer;
        }
      };
    }
  });

  const events = await tts.stream({ text: "こんにちは", voice: "iroha" });

  assert.equal(tts.kind, "tts");
  assert.match(calls[0].endpoint, /\/audio_query\?/);
  assert.match(calls[0].endpoint, /speaker=888753760/);
  assert.match(calls[0].endpoint, /text=/);
  assert.match(calls[1].endpoint, /\/synthesis\?/);
  assert.equal(events[0].type, "tts.audio");
  assert.equal(events[0].encoding, "wav");
  assert.equal(events.at(-1).type, "tts.completed");
});

test("StackChan realtime relay turns final audio chunks into voice turns", async () => {
  const sent = [];
  const turns = [];
  const events = [];
  const WebSocketImpl = createFakeStackChanWebSocket({ sent });
  const relay = createStackChanRealtimeRelay({
    url: "ws://stackchan.local/ws",
    WebSocketImpl,
    latencyBudgetMs: 1000,
    queue: createSpeechPlaybackQueue({ id: "relay-queue" }),
    stt: {
      id: "fake-stt",
      start({ onEvent }) {
        return {
          async push() {
            const event = {
              type: "stt.partial",
              text: "こん",
              delta: "こん",
              final: false
            };
            onEvent(event);
            return [event];
          },
          async end() {
            const event = {
              type: "stt.final",
              text: "こんにちは",
              delta: "にちは",
              final: true
            };
            onEvent(event);
            return [event];
          }
        };
      }
    }
  });

  const connection = relay.connect({
    onEvent(event) {
      events.push(event);
    },
    onTurn(turn) {
      turns.push(turn);
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  WebSocketImpl.instances[0].receive({
    type: "audio.chunk",
    deviceId: "stackchan",
    dataBase64: Buffer.from("pcm").toString("base64"),
    final: true
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const speechItem = connection.sendSpeech({
    text: "返事です",
    audio: { encoding: "wav", dataBase64: "audio" },
    voice: "iroha"
  });

  assert.equal(relay.kind, "device-realtime-relay");
  assert.equal(sent[0].type, "hello");
  assert.equal(turns[0].modality, "voice");
  assert.equal(turns[0].text, "こんにちは");
  assert.equal(speechItem.source, "stackchan-realtime-relay");
  assert.equal(sent.at(-1).type, "speech.audio");
  assert.equal(events.some((event) => event.type === "stackchan.stt.final"), true);
});

test("StackChan realtime session handler accepts firmware audio and returns speech", async () => {
  const sent = [];
  const turns = [];
  const events = [];
  const socket = createFakeServerSocket({ sent });
  const handler = createStackChanRealtimeSessionHandler({
    deviceToken: "device-token",
    createQueue: () => createSpeechPlaybackQueue({ id: "server-queue" }),
    harness: {
      async receive(turn) {
        turns.push(turn);
        return {
          kind: "spoken",
          text: `返事: ${turn.text}`
        };
      }
    },
    stt: {
      id: "fake-stt",
      start({ onEvent }) {
        return {
          async push() {
            const event = {
              type: "stt.partial",
              text: "こん",
              delta: "こん",
              final: false
            };
            onEvent(event);
            return [event];
          },
          async end() {
            const event = {
              type: "stt.final",
              text: "こんにちは",
              delta: "にちは",
              final: true
            };
            onEvent(event);
            return [event];
          },
          cancel() {
            return null;
          }
        };
      }
    },
    tts: {
      id: "fake-tts",
      async stream({ text, onEvent }) {
        const events = [
          {
            type: "tts.audio",
            text,
            audio: createPcm16WavBase64({
              sampleRate: 24000,
              samples: [0, 800, -800, 0]
            }),
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
        return events;
      }
    }
  });

  const session = handler.handleConnection(socket, {
    deviceId: "stackchan",
    token: "device-token",
    onEvent(event) {
      events.push(event);
    }
  });
  socket.receive({
    type: "hello"
  });
  socket.receive({
    type: "audio.chunk",
    dataBase64: Buffer.from("pcm").toString("base64"),
    final: true
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(handler.kind, "stackchan-realtime-session-handler");
  assert.equal(session.accepted, true);
  assert.equal(sent[0].type, "ready");
  assert.equal(sent.some((message) => message.type === "stt.event"), true);
  assert.equal(sent.some((message) => message.type === "speech.audio"), true);
  assert.equal(sent.at(-1).type, "response.final");
  assert.equal(turns[0].modality, "voice");
  assert.equal(turns[0].text, "こんにちは");
  assert.equal(events.some((event) => event.type === "stackchan.accepted"), true);
});

test("StackChan realtime session handler finalizes mic audio on VAD silence", async () => {
  const sent = [];
  const turns = [];
  const socket = createFakeServerSocket({ sent });
  const handler = createStackChanRealtimeSessionHandler({
    deviceToken: "device-token",
    sttAutoFinalMs: 0,
    vadThresholdDb: -40,
    vadSilenceMs: 1,
    vadMinSpeechMs: 0,
    harness: {
      async receive(turn) {
        turns.push(turn);
        return {
          kind: "spoken",
          text: `返事: ${turn.text}`
        };
      }
    },
    stt: {
      id: "fake-stt",
      start({ onEvent }) {
        return {
          async push() {
            const event = {
              type: "stt.audio_buffered",
              byteLength: 4,
              final: false
            };
            onEvent(event);
            return [event];
          },
          async end() {
            const event = {
              type: "stt.final",
              text: "おはよう",
              final: true
            };
            onEvent(event);
            return [event];
          },
          cancel() {
            return null;
          }
        };
      }
    },
    tts: {
      id: "fake-tts",
      async stream({ text, onEvent }) {
        const events = [
          {
            type: "tts.audio",
            text,
            audio: createPcm16WavBase64(),
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
        return events;
      }
    }
  });

  handler.handleConnection(socket, {
    deviceId: "stackchan",
    token: "device-token"
  });
  socket.receive({
    type: "start",
    session_id: "avatar-session"
  });
  socket.receive({
    type: "data",
    session_id: "avatar-session",
    audio_data: createPcm16Base64({ samples: [0, 0, 0, 0] })
  });
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(turns.length, 0);

  socket.receive({
    type: "data",
    session_id: "avatar-session",
    audio_data: createPcm16Base64({ samples: [4000, -4000, 4000, -4000] })
  });
  await new Promise((resolve) => setTimeout(resolve, 2));
  socket.receive({
    type: "data",
    session_id: "avatar-session",
    audio_data: createPcm16Base64({ samples: [0, 0, 0, 0] })
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(turns[0].text, "おはよう");
  assert.equal(turns[0].metadata.sttFinalizeReason, "vad-silence");
  assert.equal(sent.some((message) => message.type === "chunk"), true);
});

test("StackChan realtime session handler clears firmware processing on empty STT", async () => {
  const sent = [];
  const turns = [];
  const socket = createFakeServerSocket({ sent });
  const handler = createStackChanRealtimeSessionHandler({
    deviceToken: "device-token",
    harness: {
      async receive(turn) {
        turns.push(turn);
        return {
          kind: "spoken",
          text: `返事: ${turn.text}`
        };
      }
    },
    stt: {
      id: "empty-stt",
      start({ onEvent }) {
        return {
          async push() {
            return [];
          },
          async end() {
            const event = {
              type: "stt.final",
              text: "",
              final: true
            };
            onEvent(event);
            return [event];
          },
          cancel() {
            return null;
          }
        };
      }
    },
    tts: {
      id: "fake-tts",
      async stream() {
        return [];
      }
    }
  });

  handler.handleConnection(socket, {
    deviceId: "stackchan",
    token: "device-token"
  });
  socket.receive({
    type: "start",
    session_id: "avatar-session"
  });
  socket.receive({
    type: "data",
    session_id: "avatar-session",
    audio_data: createPcm16Base64({ samples: [4000, -4000, 4000, -4000] }),
    final: true
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(turns.length, 0);
  assert.equal(sent.some((message) => message.type === "accepted"), true);
  assert.equal(sent.at(-1).type, "final");
  assert.equal(sent.at(-1).text, "");
});

test("StackChan realtime session handler speaks AIAvatarStackChan websocket messages", async () => {
  const sent = [];
  const turns = [];
  const socket = createFakeServerSocket({ sent });
  const handler = createStackChanRealtimeSessionHandler({
    deviceToken: "device-token",
    harness: {
      async receive(turn) {
        turns.push(turn);
        return {
          kind: "spoken",
          text: `返事: ${turn.text}`
        };
      }
    },
    stt: {
      id: "unused-stt",
      start() {
        return {
          async push() {
            return [];
          },
          async end() {
            return [];
          },
          cancel() {
            return null;
          }
        };
      }
    },
    tts: {
      id: "fake-tts",
      async stream({ text, onEvent }) {
        const events = [
          {
            type: "tts.audio",
            text,
            audio: createPcm16WavBase64({
              sampleRate: 24000,
              samples: Array.from({ length: 5000 }, (_, index) => (index % 2 === 0 ? 1200 : -1200))
            }),
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
        return events;
      }
    }
  });

  const session = handler.handleConnection(socket, {
    deviceId: "stackchan",
    token: "device-token"
  });
  socket.receive({
    type: "start",
    session_id: "avatar-session",
    user_id: "stackchan",
    channel: "local"
  });
  socket.receive({
    type: "invoke",
    session_id: "avatar-session",
    user_id: "stackchan",
    channel: "local",
    text: "こんにちは",
    allow_merge: false,
    wait_in_queue: true
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(sent[0].type, "ready");
  assert.equal(sent.some((message) => message.type === "connected"), true);
  assert.equal(sent.some((message) => message.type === "accepted"), true);
  assert.equal(sent.some((message) => message.type === "start"), true);
  assert.equal(sent.some((message) => message.type === "chunk"), true);
  const chunk = sent.find((message) => message.type === "chunk");
  assert.equal(chunk.metadata.audio_format.codec, "pcm16");
  assert.equal(chunk.metadata.audio_format.sample_rate, 24000);
  assert.equal(Buffer.from(chunk.audio_data, "base64").length, 8192);
  assert.equal(sent.filter((message) => message.type === "chunk").length, 2);
  assert.equal(sent.at(-1).type, "final");
  assert.equal(sent.at(-1).session_id, "avatar-session");
  assert.equal(turns[0].modality, "text");
  assert.equal(turns[0].metadata.aiAvatarSessionId, "avatar-session");

  await session.speak({ text: "外から話す" });
  assert.equal(sent.filter((message) => message.type === "chunk").length, 4);
});

test("StackChan realtime session handler rejects invalid device token", () => {
  const sent = [];
  const socket = createFakeServerSocket({ sent });
  const handler = createStackChanRealtimeSessionHandler({
    deviceToken: "device-token",
    harness: {
      async receive() {
        return { text: "unused" };
      }
    },
    stt: {
      start() {
        return {};
      }
    },
    tts: {
      async stream() {
        return [];
      }
    }
  });

  const session = handler.handleConnection(socket, {
    token: "wrong-token"
  });

  assert.equal(session.accepted, false);
  assert.equal(sent[0].type, "error");
  assert.equal(sent[0].code, "invalid_device_token");
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

test("Scoped Work Runner wraps a worker with policy and workspace boundaries", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-work-runner-"));
  const repo = join(dir, "repo");
  const outside = join(dir, "outside");
  const calls = [];
  const worker = {
    id: "codex",
    capabilities: ["code"],
    async run(task, context) {
      calls.push({ task, context });
      return {
        status: "completed",
        summary: `scoped ${context.workRunner.workspace}`,
        artifacts: []
      };
    }
  };
  const runner = createScopedWorkRunnerMicroHarness({
    worker,
    policy: {
      kind: "iroharness.workRunnerPolicy",
      zone: "trusted",
      delegation: "permission-required",
      boundary: "runner-only",
      runnerAccess: {
        repositoryWork: "scoped-workspace",
        browserControl: "scoped-session",
        defaultSandbox: "workspace-write"
      }
    },
    allowedWorkspaces: [repo]
  });

  const deniedByPermission = await runner.run(
    { id: "ticket_1", title: "Work", metadata: { workspace: repo } },
    { audience: { canDelegateWork: false } }
  );
  const deniedByScope = await runner.run(
    { id: "ticket_2", title: "Work", metadata: { workspace: outside } },
    { audience: { canDelegateWork: true } }
  );
  const allowed = await runner.run(
    { id: "ticket_3", title: "Work", metadata: { workspace: join(repo, "app") } },
    { audience: { canDelegateWork: true } }
  );

  assert.equal(runner.id, "codex");
  assert.equal(deniedByPermission.status, "failed");
  assert.equal(deniedByPermission.raw.reason, "permission_required");
  assert.equal(deniedByScope.status, "failed");
  assert.equal(deniedByScope.raw.reason, "workspace_out_of_scope");
  assert.equal(allowed.status, "completed");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].context.workRunner.root, repo);
  assert.equal(calls[0].task.metadata.workRunnerRoot, repo);
  assert.match(calls[0].context.workRunner.workspace, /repo\/app$/);
});

test("Scoped Work Runner denies public-view delegation before worker execution", async () => {
  let called = false;
  const runner = createScopedWorkRunnerMicroHarness({
    worker: {
      id: "codex",
      async run() {
        called = true;
        return { status: "completed", summary: "should not run", artifacts: [] };
      }
    },
    policy: {
      kind: "iroharness.workRunnerPolicy",
      zone: "public",
      delegation: "denied",
      boundary: "runner-only",
      runnerAccess: {
        repositoryWork: "none"
      }
    },
    allowedWorkspaces: [tmpdir()]
  });

  const output = await runner.run(
    { id: "ticket_public", title: "Try work", metadata: { workspace: tmpdir() } },
    { audience: { canDelegateWork: true } }
  );

  assert.equal(output.status, "failed");
  assert.equal(output.raw.reason, "delegation_denied");
  assert.equal(called, false);
});

test("Codex app-server brain uses selected model and returns assistant deltas", async () => {
  const transport = createFakeCodexTransport();
  const brain = createCodexAppServerBrain({
    id: "codex-text",
    slot: "text",
    cwd: "/tmp/project",
    model: "gpt-brain-test",
    transport,
    timeoutMs: 1000
  });

  const output = await brain.respond({
    character: {
      id: "iroha",
      name: "Iroha",
      soul: "Stable macro identity."
    },
    actor: {
      user: {
        displayName: "Developer"
      }
    },
    audience: {
      permissions: ["deep_discussion"]
    },
    input: {
      text: "こんにちは"
    },
    route: {
      kind: "text"
    },
    state: {},
    projectOs: {
      tickets: []
    }
  });

  assert.equal(output.text, "実装を確認しました。");
  assert.equal(output.raw.provider, "codex");
  assert.equal(output.raw.model, "gpt-brain-test");
  assert.equal(transport.requests[0].method, "initialize");
  assert.equal(transport.requests[1].method, "thread/start");
  assert.equal(transport.requests[1].params.model, "gpt-brain-test");
  assert.equal(transport.requests[1].params.sandbox, "read-only");
  assert.equal(transport.requests[2].method, "turn/start");
  assert.match(transport.requests[2].params.input[0].text, /Brain slot: text/);
  assert.match(transport.requests[2].params.input[0].text, /Iroha/);
  assert.match(transport.requests[2].params.input[0].text, /こんにちは/);
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

test("JSONL realtime core process streams events and keeps local interruption state", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-realtime-core-"));
  const scriptPath = join(dir, "realtime-core.mjs");
  writeFileSync(
    scriptPath,
    [
      "import { createInterface } from 'node:readline';",
      "const lines = createInterface({ input: process.stdin });",
      "lines.on('line', (line) => {",
      "  const message = JSON.parse(line);",
      "  console.log(JSON.stringify({",
      "    type: 'ack',",
      "    op: message.op,",
      "    coreId: message.coreId,",
      "    eventType: message.event?.type || null,",
      "    markName: message.mark?.name || null,",
      "    result: message.result ?? null",
      "  }));",
      "});"
    ].join("\n"),
    "utf8"
  );

  const received = [];
  const core = createJsonlRealtimeCoreProcess({
    id: "process-core-test",
    command: process.execPath,
    args: [scriptPath],
    clock: () => 1000,
    onMessage(message) {
      received.push(message);
    }
  });

  core.publish({ type: "realtime.listening" });
  core.mark("audio.received");
  core.startSpeaking();
  const interrupted = core.shouldInterrupt({
    type: "stt.partial",
    delta: "待って"
  });
  core.finishSpeaking();

  await new Promise((resolve) => setTimeout(resolve, 50));
  const snapshot = core.snapshot();
  core.close();

  assert.equal(interrupted, true);
  assert.equal(snapshot.implementation, "jsonl-process");
  assert.equal(snapshot.events.at(-1).type, "realtime.listening");
  assert.equal(snapshot.latency.marks["audio.received"], 1000);
  assert.equal(snapshot.bargeIn.interrupted, true);
  assert.equal(received.some((message) => message.op === "publish"), true);
  assert.equal(received.some((message) => message.op === "shouldInterrupt"), true);
});

test("text process micro harness sends a prompt and accepts plain text output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-text-process-"));
  const scriptPath = join(dir, "worker.mjs");
  writeFileSync(
    scriptPath,
    [
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk.toString('utf8'); });",
      "process.stdin.on('end', () => {",
      "  console.log(`plain reply ${input.includes('IroHarness')}`);",
      "});"
    ].join("\n"),
    "utf8"
  );

  const harness = createTextProcessMicroHarness({
    id: "plain-worker",
    command: process.execPath,
    args: [scriptPath],
    capabilities: ["text"],
    timeoutMs: 1000
  });

  const output = await harness.run(
    { id: "ticket_3", title: "Explain" },
    { character: { id: "iroha" } }
  );

  assert.equal(output.status, "completed");
  assert.equal(output.summary, "plain reply true");
});

test("Claude Code CLI micro harness builds an IroHarness prompt and parses JSON output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "iroharness-claude-code-"));
  const scriptPath = join(dir, "claude-worker.mjs");
  writeFileSync(
    scriptPath,
    [
      "let input = '';",
      "process.stdin.on('data', (chunk) => { input += chunk.toString('utf8'); });",
      "process.stdin.on('end', () => {",
      "  console.error(input.includes('Project OS') ? 'pj-os-present' : 'missing');",
      "  console.log(JSON.stringify({",
      "    status: 'completed',",
      "    summary: `claude saw ${input.includes('Claude Code task from IroHarness.')}`,",
      "    artifacts: [{ kind: 'patch', uri: 'memory://claude-code/ticket_4', title: 'Patch' }]",
      "  }));",
      "});"
    ].join("\n"),
    "utf8"
  );

  const harness = createClaudeCodeCliMicroHarness({
    command: process.execPath,
    args: [scriptPath],
    timeoutMs: 1000
  });

  const output = await harness.run(
    { id: "ticket_4", title: "Review README", purpose: "READMEをレビューして" },
    {
      character: { id: "iroha", name: "Iroha" },
      actor: { user: { id: "dev", displayName: "Developer" } },
      projectOs: { tickets: [{ id: "ticket_4" }] }
    }
  );

  assert.equal(harness.id, "claude-code");
  assert.equal(harness.capabilities.includes("claude-code"), true);
  assert.equal(output.status, "completed");
  assert.equal(output.summary, "claude saw true");
  assert.equal(output.artifacts[0].kind, "patch");
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

test("MotionPNGTuber renderer bridge maps character state to PNG state", () => {
  const body = createMotionPngTuberRendererBridge({
    assets: {
      mouth_on_eye_on: "/assets/talking.png",
      mouth_off_eye_on: "/assets/idle.png",
      mouth_off_eye_off: "/assets/error.png"
    }
  });

  body.emit({
    type: "state",
    state: {
      characterId: "iroha",
      mode: "speaking",
      emotion: "attentive",
      speechText: "こんにちは"
    }
  });

  const snapshot = body.snapshot();
  assert.equal(snapshot.kind, "motionpngtuber");
  assert.equal(snapshot.mapped, "mouth_on_eye_on");
  assert.equal(snapshot.payload.asset, "/assets/talking.png");
  assert.equal(snapshot.payload.speechText, "こんにちは");
});

test("M5Stack and Even G2 bridges map the same state into device payloads", () => {
  const state = {
    characterId: "iroha",
    mode: "working",
    emotion: "focused",
    speechText: "作業中だよ"
  };
  const m5 = createM5StackBodyBridge();
  const even = createEvenG2DisplayBridge();

  m5.emit({ type: "state", state });
  even.emit({ type: "state", state });

  assert.equal(m5.snapshot().payload.face, ">_>");
  assert.equal(m5.snapshot().payload.text, "作業中だよ");
  assert.equal(even.snapshot().payload.text, "作業中だよ");
});

test("Live2D bridge maps character state to expression, motion, and lip sync", () => {
  const body = createLive2DBodyBridge();
  body.emit({
    type: "state",
    state: {
      characterId: "iroha",
      mode: "speaking",
      emotion: "focused",
      speechText: "説明するね",
      mouth: "talking"
    }
  });

  const payload = body.snapshot().payload;
  assert.equal(body.snapshot().kind, "live2d");
  assert.equal(payload.expression, "serious");
  assert.equal(payload.motion, "Talk");
  assert.equal(payload.lipSync.active, true);
  assert.equal(payload.parameters.mouthOpenY, 1);
});

test("VRM bridge maps character state to expression, animation, and gaze", () => {
  const body = createVrmBodyBridge();
  body.emit({
    type: "state",
    state: {
      characterId: "iroha",
      mode: "thinking",
      emotion: "attentive",
      gaze: "left",
      speechText: null
    }
  });

  const payload = body.snapshot().payload;
  assert.equal(body.snapshot().kind, "vrm");
  assert.equal(payload.expression, "happy");
  assert.equal(payload.animation, "think");
  assert.equal(payload.gaze, "left");
  assert.equal(payload.speaking, false);
});

test("dev server exposes body bridge snapshots", async () => {
  const eventStream = createEventStreamDevice("events");
  const body = createMotionPngTuberRendererBridge();
  body.emit({
    type: "state",
    state: {
      characterId: "iroha",
      mode: "speaking",
      emotion: "attentive",
      speechText: "こんにちは"
    }
  });
  const handler = createIroHarnessDevServerHandler({
    eventStream,
    bodyDevices: [body],
    harness: {
      state() {
        return { characterId: "iroha", mode: "idle" };
      },
      projectOs() {
        return { tickets: [], runs: [], artifacts: [] };
      },
      async receive() {
        return { kind: "response", text: "ok" };
      }
    },
    publicDir: process.cwd()
  });

  const bodies = await callHandler(handler, { url: "/bodies" });
  const snapshot = await callHandler(handler, { url: "/body/motionpngtuber" });

  assert.equal(bodies.statusCode, 200);
  assert.equal(bodies.json.bodies.length, 1);
  assert.equal(bodies.json.bodies[0].id, "motionpngtuber");
  assert.equal(snapshot.statusCode, 200);
  assert.equal(snapshot.json.state.payload.stateKey, "mouth_on_eye_on");
});

test("dev server exposes the OpenAPI document", async () => {
  const eventStream = createEventStreamDevice("events");
  const handler = createIroHarnessDevServerHandler({
    eventStream,
    harness: {
      state() {
        return { characterId: "iroha", mode: "idle" };
      },
      projectOs() {
        return { tickets: [], runs: [], artifacts: [] };
      },
      async receive() {
        return { kind: "response", text: "ok" };
      }
    },
    publicDir: process.cwd()
  });

  const response = await callHandler(handler, { url: "/openapi.json" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.openapi, "3.1.0");
  assert.equal(Boolean(response.json.paths["/health"]), true);
  assert.equal(
    response.json.paths["/turn"].post.summary,
    "Send a normalized turn to the macro harness"
  );
  assert.equal(Boolean(response.json.paths["/audience/resolve"]), true);
  assert.equal(Boolean(response.json.paths["/audience/users/{userId}/permissions"]), true);
});

test("dev server exposes public health metadata without audience records", async () => {
  const eventStream = createEventStreamDevice("events");
  const userRegistry = createInMemoryUserRegistry();
  userRegistry.registerUser({
    id: "owner",
    displayName: "Owner",
    role: "owner",
    identities: {
      youtube: "UCOWNER"
    }
  });
  const handler = createIroHarnessDevServerHandler({
    eventStream,
    userRegistry,
    adminToken: "secret",
    bodyDevices: [createMotionPngTuberRendererBridge()],
    harness: {
      state() {
        return { characterId: "iroha", mode: "idle" };
      },
      brains() {
        return [
          { slot: "voice", id: "voice-fast" },
          { slot: "text", id: "text-deep" }
        ];
      },
      projectOs() {
        return {
          tickets: [{ id: "ticket_1" }],
          runs: [{ id: "run_1" }],
          artifacts: []
        };
      },
      async receive() {
        return { kind: "response", text: "ok" };
      }
    },
    runtimeStatus: () => [
      {
        id: "youtube",
        state: {
          active: true,
          seenCount: 2
        }
      }
    ],
    publicDir: process.cwd()
  });

  const response = await callHandler(handler, { url: "/health" });

  assert.equal(response.statusCode, 200);
  assert.equal(response.json.ok, true);
  assert.equal(response.json.service.name, "iroharness");
  assert.equal(response.json.service.version, "0.1.0");
  assert.match(response.json.service.startedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(typeof response.json.service.uptimeMs, "number");
  assert.equal(response.json.characterId, "iroha");
  assert.equal(response.json.audienceRegistry, true);
  assert.equal(response.json.adminProtected, true);
  assert.deepEqual(response.json.brains, [
    { slot: "voice", id: "voice-fast" },
    { slot: "text", id: "text-deep" }
  ]);
  assert.equal(response.json.bodies[0].id, "motionpngtuber");
  assert.equal(response.json.platforms.includes("youtube"), true);
  assert.equal(response.json.runtimes[0].id, "youtube");
  assert.equal(response.json.runtimes[0].state.active, true);
  assert.equal(response.json.projectOs.tickets, 1);
  assert.equal(response.json.users, undefined);
  assert.equal(response.json.userIdentities, undefined);
});

test("dev server manages audience users, identities, permissions, and stream sessions", async () => {
  const eventStream = createEventStreamDevice("events");
  const userRegistry = createInMemoryUserRegistry();
  const handler = createIroHarnessDevServerHandler({
    eventStream,
    userRegistry,
    harness: {
      state() {
        return { characterId: "iroha", mode: "idle" };
      },
      projectOs() {
        return { tickets: [], runs: [], artifacts: [] };
      },
      async receive() {
        return { kind: "response", text: "ok" };
      },
      users() {
        return userRegistry.snapshot();
      }
    },
    publicDir: process.cwd()
  });

  const created = await callHandler(handler, {
    method: "POST",
    url: "/audience/users",
    json: {
      id: "dev_1",
      displayName: "Developer",
      role: "developer",
      relationship: "core-developer",
      identities: { discord: "DDEV" }
    }
  });
  const identity = await callHandler(handler, {
    method: "POST",
    url: "/audience/users/dev_1/identities",
    json: {
      platform: "youtube",
      platformUserId: "UCDEV",
      displayName: "Dev Channel"
    }
  });
  const permission = await callHandler(handler, {
    method: "POST",
    url: "/audience/users/dev_1/permissions",
    json: {
      permission: "manage_stream",
      effect: "allow",
      scope: "stream:youtube",
      reason: "trusted stream host"
    }
  });
  const revoked = await callHandler(handler, {
    method: "DELETE",
    url: "/audience/users/dev_1/permissions?permission=manage_stream&scope=stream%3Ayoutube"
  });
  const permissionAgain = await callHandler(handler, {
    method: "POST",
    url: "/audience/users/dev_1/permissions",
    json: {
      permission: "manage_stream",
      effect: "allow",
      scope: "stream:youtube",
      reason: "trusted stream host"
    }
  });
  const stream = await callHandler(handler, {
    method: "POST",
    url: "/audience/stream-sessions",
    json: {
      id: "stream_1",
      platform: "youtube",
      platformChannelId: "live_1",
      title: "Dev Stream",
      hostUserId: "dev_1"
    }
  });
  const paused = await callHandler(handler, {
    method: "PATCH",
    url: "/audience/stream-sessions/stream_1",
    json: {
      status: "paused"
    }
  });
  const resolved = await callHandler(handler, {
    url: "/audience/resolve?platform=youtube&platformUserId=UCDEV&displayName=Dev%20Channel"
  });
  const snapshot = await callHandler(handler, { url: "/audience" });

  assert.equal(created.statusCode, 201);
  assert.equal(created.json.user.id, "dev_1");
  assert.equal(identity.statusCode, 201);
  assert.equal(identity.json.identity.platform, "youtube");
  assert.equal(permission.statusCode, 201);
  assert.equal(permission.json.permissionOverride.permission, "manage_stream");
  assert.equal(revoked.statusCode, 200);
  assert.equal(revoked.json.permissionOverride.deleted, true);
  assert.equal(permissionAgain.statusCode, 201);
  assert.equal(stream.statusCode, 201);
  assert.equal(stream.json.streamSession.id, "stream_1");
  assert.equal(paused.statusCode, 200);
  assert.equal(paused.json.streamSession.status, "paused");
  assert.equal(resolved.statusCode, 200);
  assert.equal(resolved.json.known, true);
  assert.equal(resolved.json.user.id, "dev_1");
  assert.equal(resolved.json.identity.platform, "youtube");
  assert.equal(snapshot.json.users[0].identities.discord, "DDEV");
  assert.equal(snapshot.json.users[0].identities.youtube, "UCDEV");
  assert.equal(snapshot.json.permissionOverrides[0].scope, "stream:youtube");
  assert.equal(snapshot.json.streamSessions[0].status, "paused");
});

test("dev server audience management can require an admin token", async () => {
  const eventStream = createEventStreamDevice("events");
  const userRegistry = createInMemoryUserRegistry();
  const handler = createIroHarnessDevServerHandler({
    eventStream,
    userRegistry,
    adminToken: "secret",
    harness: {
      state() {
        return { characterId: "iroha", mode: "idle" };
      },
      projectOs() {
        return { tickets: [], runs: [], artifacts: [] };
      },
      async receive() {
        return { kind: "response", text: "ok" };
      }
    },
    publicDir: process.cwd()
  });

  const denied = await callHandler(handler, {
    method: "POST",
    url: "/audience/users",
    json: {
      id: "fan_1",
      displayName: "Fan"
    }
  });
  const allowed = await callHandler(handler, {
    method: "POST",
    url: "/audience/users",
    headers: {
      authorization: "Bearer secret"
    },
    json: {
      id: "fan_1",
      displayName: "Fan"
    }
  });

  assert.equal(denied.statusCode, 401);
  assert.equal(denied.json.error, "admin_token_required");
  assert.equal(allowed.statusCode, 201);
  assert.equal(userRegistry.snapshot().users.length, 1);
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

test("Slack message adapter normalizes app mention payloads", () => {
  const adapter = createSlackMessageAdapter({
    mentionOnly: true,
    botUserId: "UIROHA"
  });
  const turn = adapter.normalize({
    team_id: "T123",
    event: {
      type: "app_mention",
      user: "U123",
      channel: "C123",
      ts: "1710000000.000100",
      text: "<@UIROHA> Codexで設計をレビューして",
      user_profile: {
        display_name: "Developer"
      }
    }
  });

  assert.equal(turn.source, "slack");
  assert.equal(turn.text, "Codexで設計をレビューして");
  assert.equal(turn.actor.platform, "slack");
  assert.equal(turn.actor.platformUserId, "U123");
  assert.equal(turn.actor.displayName, "Developer");
  assert.equal(turn.metadata.channelId, "C123");
  assert.equal(turn.metadata.threadTs, "1710000000.000100");
});

test("Slack message adapter ignores bot messages and non-mentions", () => {
  assert.equal(
    createSlackMessageAdapter().normalize({
      event: {
        type: "message",
        bot_id: "B123",
        text: "hello"
      }
    }),
    null
  );

  assert.equal(
    createSlackMessageAdapter({ mentionOnly: true, botUserId: "UIROHA" }).normalize({
      event: {
        type: "message",
        user: "U123",
        channel: "C123",
        text: "hello"
      }
    }),
    null
  );
});

test("platform adapter registry dispatches by platform", () => {
  const registry = createPlatformAdapterRegistry([
    createSlackMessageAdapter(),
    createYouTubeLiveChatAdapter()
  ]);
  assert.deepEqual(registry.platforms(), ["slack", "youtube"]);
  const turn = registry.normalize("slack", {
    event: {
      type: "message",
      user: "U999",
      channel: "C999",
      text: "hello"
    }
  });

  assert.equal(turn.actor.platformUserId, "U999");
});

test("VS Code companion adapter creates canonical vscode turns", () => {
  const adapter = createVsCodeCompanionAdapter({
    platformUserId: "machine-1",
    displayName: "Local Developer",
    metadata: {
      trust: "developer"
    }
  });

  const turn = adapter.createTurn({
    text: "Codexでレビューして",
    workspace: "/repo"
  });

  assert.equal(adapter.platform, "vscode");
  assert.equal(turn.source, "vscode");
  assert.equal(turn.actor.platformUserId, "machine-1");
  assert.equal(turn.metadata.workspace, "/repo");
  assert.equal(turn.metadata.trust, "developer");
});

test("VS Code companion webview posts to the IroHarness dev server", () => {
  const html = createVsCodeCompanionWebviewHtml({
    serverUrl: "http://127.0.0.1:4178/",
    actor: {
      platform: "vscode",
      platformUserId: "machine-1",
      displayName: "Local Developer"
    }
  });

  assert.match(html, /EventSource\(config\.serverUrl \+ "\/events"\)/);
  assert.match(html, /fetch\(config\.serverUrl \+ "\/turn"/);
  assert.match(html, /source: "vscode"/);
  assert.match(html, /"platformUserId":"machine-1"/);
  assert.doesNotMatch(html, /4178\//);
});

test("stream context enricher attaches live stream session metadata", async () => {
  const resolver = createSnapshotStreamSessionResolver({
    snapshot: {
      streamSessions: [
        {
          id: "stream_1",
          platform: "youtube",
          platformChannelId: "live_1",
          status: "live",
          title: "Dev Stream"
        }
      ]
    }
  });
  const enrichTurn = createStreamContextEnricher({
    resolveStreamSession: resolver
  });

  const turn = createYouTubeLiveChatAdapter().normalize({
    id: "chat_1",
    snippet: {
      liveChatId: "live_1",
      displayMessage: "こんにちは"
    },
    authorDetails: {
      channelId: "UC123",
      displayName: "Viewer"
    }
  });
  const enriched = await enrichTurn(turn);

  assert.equal(enriched.metadata.streamSessionId, "stream_1");
  assert.equal(enriched.metadata.streamChannelId, "live_1");
  assert.equal(enriched.metadata.streamTitle, "Dev Stream");
});

test("Slack events runtime handles challenge, receives events, and replies in thread", async () => {
  const receivedTurns = [];
  const restCalls = [];
  const runtime = createSlackEventsRuntime({
    botToken: "xoxb-test",
    adapter: createSlackMessageAdapter({
      mentionOnly: true,
      botUserId: "UIROHA"
    }),
    harness: {
      async receive(turn) {
        receivedTurns.push(turn);
        return { kind: "response", text: `reply to ${turn.actor.displayName}` };
      }
    },
    fetchImpl: async (url, options) => {
      restCalls.push({ url, options, body: JSON.parse(options.body) });
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({ ok: true, ts: "1710000000.000200" });
        }
      };
    }
  });

  const challenge = await runtime.handlePayload({
    type: "url_verification",
    challenge: "challenge-token"
  });
  const result = await runtime.handlePayload({
    type: "event_callback",
    team_id: "T123",
    event: {
      type: "app_mention",
      user: "U123",
      channel: "C123",
      ts: "1710000000.000100",
      text: "<@UIROHA> こんにちは",
      user_profile: {
        display_name: "Developer"
      }
    }
  });

  assert.equal(challenge.kind, "challenge");
  assert.equal(challenge.challenge, "challenge-token");
  assert.equal(receivedTurns.length, 1);
  assert.equal(receivedTurns[0].actor.platformUserId, "U123");
  assert.equal(result.reply, "reply to Developer");
  assert.equal(restCalls.length, 1);
  assert.equal(restCalls[0].url, "https://slack.com/api/chat.postMessage");
  assert.equal(restCalls[0].body.channel, "C123");
  assert.equal(restCalls[0].body.thread_ts, "1710000000.000100");
});

test("YouTube live chat polling runtime fetches messages and sends turns to harness", async () => {
  const receivedTurns = [];
  const enrichTurn = createStreamContextEnricher({
    resolveStreamSession: createSnapshotStreamSessionResolver({
      snapshot: {
        streamSessions: [
          {
            id: "youtube_stream_1",
            platform: "youtube",
            platformChannelId: "live_1",
            status: "live"
          }
        ]
      }
    })
  });
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
    fetchImpl,
    turnEnricher: enrichTurn
  });
  const result = await runtime.pollOnce();

  assert.equal(receivedTurns.length, 1);
  assert.equal(receivedTurns[0].source, "youtube");
  assert.equal(receivedTurns[0].actor.platformUserId, "UC123");
  assert.equal(receivedTurns[0].metadata.streamSessionId, "youtube_stream_1");
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

test("OBS stream controller maps approved scene operations to OBS WebSocket requests", async () => {
  const sent = [];
  const obs = createObsWebSocketAdapter({
    WebSocketImpl: createFakeObsWebSocket({ sent })
  });
  const controller = createObsStreamController({
    obs,
    defaultSceneName: "Iroha Stream"
  });

  const output = await controller.execute({
    input: {
      text: "OBSのシーンを配信用に変えて",
      metadata: {}
    },
    route: { kind: "stream" },
    actor: { user: { id: "moderator" } }
  });

  const request = sent.find((message) => message.op === 6);
  assert.equal(output.status, "completed");
  assert.equal(output.action.kind, "scene");
  assert.equal(request.d.requestType, "SetCurrentProgramScene");
  assert.equal(request.d.requestData.sceneName, "Iroha Stream");
  controller.close();
});

test("OBS stream controller maps overlay and mute actions to OBS requests", async () => {
  const overlaySent = [];
  const overlayController = createObsStreamController({
    obs: createObsWebSocketAdapter({
      WebSocketImpl: createFakeObsWebSocket({ sent: overlaySent })
    }),
    overlayInputName: "IroHarness Overlay",
    overlayUrl: "http://127.0.0.1:4178/?view=overlay"
  });

  const overlayOutput = await overlayController.execute({
    input: {
      text: "overlayを更新して",
      metadata: {}
    },
    route: { kind: "stream" },
    actor: { user: { id: "moderator" } }
  });
  const overlayRequest = overlaySent.find((message) => message.op === 6);

  assert.equal(overlayOutput.status, "completed");
  assert.equal(overlayRequest.d.requestType, "SetInputSettings");
  assert.equal(overlayRequest.d.requestData.inputName, "IroHarness Overlay");
  assert.equal(
    overlayRequest.d.requestData.inputSettings.url,
    "http://127.0.0.1:4178/?view=overlay"
  );
  overlayController.close();

  const muteSent = [];
  const muteController = createObsStreamController({
    obs: createObsWebSocketAdapter({
      WebSocketImpl: createFakeObsWebSocket({ sent: muteSent })
    }),
    overlayInputName: "Mic"
  });

  const muteOutput = await muteController.execute({
    input: {
      text: "Micをミュートして",
      metadata: { obsAction: "mute", inputMuted: true }
    },
    route: { kind: "stream" },
    actor: { user: { id: "moderator" } }
  });
  const muteRequest = muteSent.find((message) => message.op === 6);

  assert.equal(muteOutput.status, "completed");
  assert.equal(muteRequest.d.requestType, "SetInputMute");
  assert.equal(muteRequest.d.requestData.inputName, "Mic");
  assert.equal(muteRequest.d.requestData.inputMuted, true);
  muteController.close();
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
