import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { createConnection } from "node:net";

const websocketGuid = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Minimal PCM16 WAV reader for --audio-file (16-bit mono expected; fmt/data
// chunk scan mirrors the host-side parser).
const readWavPcm16 = (path) => {
  const buffer = readFileSync(path);
  if (buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error(`not a RIFF/WAVE file: ${path}`);
  }
  let fmt = null;
  let data = null;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;
    if (chunkId === "fmt ") {
      fmt = {
        sampleRate: buffer.readUInt32LE(chunkStart + 4),
        bitsPerSample: buffer.readUInt16LE(chunkStart + 14)
      };
    }
    if (chunkId === "data") {
      data = buffer.subarray(chunkStart, chunkStart + chunkSize);
    }
    offset = chunkStart + chunkSize + (chunkSize % 2);
  }
  if (!fmt || !data || fmt.bitsPerSample !== 16) {
    throw new Error(`expected PCM16 WAV with fmt/data chunks: ${path}`);
  }
  return { pcm: data, sampleRate: fmt.sampleRate };
};

const parseArgs = (argv) => {
  const pairs = argv.reduce(
    (state, arg) => {
      if (arg.startsWith("--")) {
        return { ...state, key: arg.slice(2), values: { ...state.values, [arg.slice(2)]: true } };
      }
      if (!state.key) {
        return state;
      }
      return {
        key: null,
        values: {
          ...state.values,
          [state.key]: arg
        }
      };
    },
    { key: null, values: {} }
  );
  return pairs.values;
};

const encodeClientTextFrame = (text) => {
  const payload = Buffer.from(String(text), "utf8");
  const mask = randomBytes(4);
  const length =
    payload.length < 126
      ? Buffer.from([0x81, 0x80 | payload.length])
      : payload.length <= 65535
        ? Buffer.from([0x81, 0x80 | 126, payload.length >> 8, payload.length & 0xff])
        : null;
  if (!length) {
    throw new Error("Simulator frame is too large.");
  }
  const masked = Buffer.from(payload);
  masked.forEach((byte, index) => {
    masked[index] = byte ^ mask[index % 4];
  });
  return Buffer.concat([length, mask, masked]);
};

const decodeServerFrames = (buffer) => {
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
    }
    if (payloadLength === 127) {
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
    messages.push({ opcode, text: payload.toString("utf8") });
    offset += frameLength;
  }
  return Object.freeze({
    messages,
    rest: buffer.subarray(offset)
  });
};

const connectWebSocket = ({ url, token }) =>
  new Promise((resolve, reject) => {
    const target = new URL(url);
    const port = Number(target.port || (target.protocol === "wss:" ? "443" : "80"));
    if (target.protocol === "wss:") {
      reject(new Error("This no-dependency simulator supports ws:// only. Use a local tunnel terminator for wss://."));
      return;
    }
    const key = randomBytes(16).toString("base64");
    const socket = createConnection({ host: target.hostname, port });
    let pending = Buffer.alloc(0);
    let upgraded = false;
    const listeners = [];
    const emitMessage = (message) => {
      listeners.forEach((listener) => listener(message));
    };
    socket.on("connect", () => {
      const expectedAccept = createHash("sha1").update(`${key}${websocketGuid}`).digest("base64");
      const request = [
        `GET ${target.pathname}${target.search} HTTP/1.1`,
        `Host: ${target.host}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        token ? `x-iroharness-device-token: ${token}` : "",
        token ? `Authorization: Bearer ${token}` : "",
        "\r\n"
      ]
        .filter((line) => line !== "")
        .join("\r\n");
      socket.write(request);
      socket.once("data", (chunk) => {
        const response = chunk.toString("utf8");
        const headerEnd = response.indexOf("\r\n\r\n");
        if (!response.startsWith("HTTP/1.1 101")) {
          reject(new Error(`WebSocket upgrade failed: ${response.split("\r\n")[0]}`));
          socket.destroy();
          return;
        }
        if (!response.includes(`Sec-WebSocket-Accept: ${expectedAccept}`)) {
          reject(new Error("WebSocket upgrade returned an invalid Sec-WebSocket-Accept header."));
          socket.destroy();
          return;
        }
        upgraded = true;
        const rest = chunk.subarray(Buffer.byteLength(response.slice(0, headerEnd + 4)));
        pending = Buffer.concat([pending, rest]);
        resolve(
          Object.freeze({
            onMessage(listener) {
              listeners.push(listener);
            },
            send(payload) {
              socket.write(encodeClientTextFrame(JSON.stringify(payload)));
            },
            close() {
              socket.end(Buffer.from([0x88, 0x80, 0, 0, 0, 0]));
            }
          })
        );
      });
    });
    socket.on("data", (chunk) => {
      if (!upgraded) {
        return;
      }
      pending = Buffer.concat([pending, chunk]);
      const decoded = decodeServerFrames(pending);
      pending = decoded.rest;
      decoded.messages
        .filter((message) => message.opcode === 0x1)
        .map((message) => JSON.parse(message.text))
        .forEach(emitMessage);
    });
    socket.on("error", reject);
  });

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const createLatencyProbe = ({ budgetMs }) => {
  const startedAt = Date.now();
  const marks = new Map([["started", startedAt]]);
  // first_audio_total_ms from response.final.metrics (streaming mode only)
  let pipelineFirstAudioTotalMs = null;
  const mark = (name) => {
    if (!marks.has(name)) {
      marks.set(name, Date.now());
    }
  };
  const delta = (name) => {
    const value = marks.get(name);
    return typeof value === "number" ? value - startedAt : null;
  };
  return Object.freeze({
    mark,
    observe(message) {
      if (message.type === "ready" || message.type === "connected") {
        mark("ready");
      }
      if (
        (message.type === "stt.event" && message.event?.type === "stt.final") ||
        message.type === "accepted"
      ) {
        mark("stt.final");
      }
      if (message.type === "response.start" || message.type === "start") {
        mark("response.start");
      }
      if (message.type === "speech.audio" || message.type === "chunk") {
        mark("speech.audio");
      }
      if (message.type === "response.final" || message.type === "final") {
        mark("response.final");
        // Capture pipeline-side first_audio_total_ms when streaming mode
        // sends it in response.final.metrics (absent in legacy mode).
        if (
          message.type === "response.final" &&
          message.metrics?.first_audio_total_ms != null &&
          pipelineFirstAudioTotalMs === null
        ) {
          pipelineFirstAudioTotalMs = message.metrics.first_audio_total_ms;
        }
      }
      if (message.type === "speech.interrupted" || message.type === "stop") {
        mark("speech.interrupted");
      }
    },
    summary({ url, deviceId, receivedCount }) {
      const firstAudioMs = delta("speech.audio");
      return Object.freeze({
        url,
        deviceId,
        receivedCount,
        budgetMs,
        withinBudget: typeof firstAudioMs === "number" ? firstAudioMs <= budgetMs : false,
        marksMs: Object.freeze({
          ready: delta("ready"),
          audioSent: delta("audio.sent"),
          sttFinal: delta("stt.final"),
          responseStart: delta("response.start"),
          firstAudio: firstAudioMs,
          // first_audio_total_ms from pipeline metrics (streaming mode).
          // null means the response.final carried no metrics (legacy mode).
          firstAudioTotalMs:
            pipelineFirstAudioTotalMs !== null
              ? pipelineFirstAudioTotalMs
              : "n/a (legacy mode)",
          responseFinal: delta("response.final"),
          interrupted: delta("speech.interrupted")
        })
      });
    }
  });
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const url =
    args.url ||
    process.env.STACKCHAN_REALTIME_URL ||
    "ws://127.0.0.1:4182/device/stackchan/realtime";
  const token = args.token || process.env.STACKCHAN_DEVICE_TOKEN || "";
  const deviceId = args["device-id"] || process.env.STACKCHAN_BODY_ID || "stackchan";
  const userId = args["user-id"] || deviceId;
  const protocol = args.protocol || process.env.IROHARNESS_STACKCHAN_SIM_PROTOCOL || "iroharness";
  const sessionId = args["session-id"] || "simulator-session";
  const text = args.text || process.env.IROHARNESS_STACKCHAN_SIM_TEXT || "こんにちは";
  const audioBase64 =
    args["audio-base64"] ||
    process.env.IROHARNESS_STACKCHAN_SIM_AUDIO_BASE64 ||
    Buffer.from("simulated-pcm-audio").toString("base64");
  const keepOpenMs = Number(args["keep-open-ms"] || process.env.IROHARNESS_STACKCHAN_SIM_KEEP_OPEN_MS || "1500");
  const budgetMs = Number(args["budget-ms"] || process.env.IROHARNESS_STACKCHAN_SIM_BUDGET_MS || "1000");
  const dryRun = Boolean(args["dry-run"]);
  // Real-audio measurement mode: stream a WAV in VAD-sized chunks with a
  // silence tail so the streaming pipeline's VAD can close the utterance.
  const audioFile = args["audio-file"] || process.env.IROHARNESS_STACKCHAN_SIM_AUDIO_FILE || null;
  const silenceTailMs = Number(args["silence-tail-ms"] || "800");
  const chunkSamples = Number(args["chunk-samples"] || "512");
  const noInvoke = Boolean(args["no-invoke"]);
  const printSummary = Boolean(args.summary || args["json-summary"]);
  const failOverBudget = Boolean(args["fail-over-budget"]);
  const messages =
    protocol === "aiavatarstackchan"
      ? [
          {
            type: "start",
            session_id: sessionId,
            user_id: userId,
            channel: "local"
          },
          {
            type: "invoke",
            session_id: sessionId,
            user_id: userId,
            channel: "local",
            text,
            allow_merge: false,
            wait_in_queue: true
          },
          {
            type: "invoke",
            session_id: sessionId,
            user_id: userId,
            channel: "local",
            text: "",
            audio_data: audioBase64,
            metadata: {
              audio_format: {
                codec: "pcm16",
                sample_rate: 16000,
                channels: 1,
                bits_per_sample: 16
              }
            },
            allow_merge: false,
            wait_in_queue: true
          }
        ]
      : (() => {
          const base = [
            {
              type: "hello",
              deviceId,
              userId,
              latencyBudgetMs: 1000
            }
          ];
          if (!noInvoke) {
            base.push({
              type: "invoke",
              deviceId,
              userId,
              text
            });
          }
          if (!audioFile) {
            base.push({
              type: "audio.chunk",
              deviceId,
              userId,
              encoding: "pcm_s16le",
              sampleRate: 16000,
              dataBase64: audioBase64,
              final: true
            });
            return base;
          }
          const { pcm, sampleRate } = readWavPcm16(audioFile);
          const speechSamples = Math.floor(pcm.length / 2);
          const silenceSamples = Math.round((silenceTailMs / 1000) * sampleRate);
          const total = new Int16Array(speechSamples + silenceSamples);
          for (let index = 0; index < speechSamples; index += 1) {
            total[index] = pcm.readInt16LE(index * 2);
          }
          for (let offset = 0; offset < total.length; offset += chunkSamples) {
            const slice = total.subarray(offset, Math.min(offset + chunkSamples, total.length));
            base.push({
              type: "audio.chunk",
              deviceId,
              userId,
              encoding: "pcm_s16le",
              sampleRate,
              dataBase64: Buffer.from(slice.buffer, slice.byteOffset, slice.length * 2).toString("base64"),
              final: offset + chunkSamples >= total.length
            });
          }
          return base;
        })();
  const latency = createLatencyProbe({ budgetMs });
  const received = [];

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          url,
          deviceId,
          protocol,
          budgetMs,
          messageTypes: messages.map((message) => message.type),
          auth: token ? "device-token" : "none",
          summary: printSummary
        },
        null,
        2
      )
    );
    return;
  }

  const socket = await connectWebSocket({ url, token });
  socket.onMessage((message) => {
    received.push(message);
    latency.observe(message);
    console.log(JSON.stringify(message));
  });
  messages.forEach((message) => {
    if (message.type === "audio.chunk" || message.audio_data) {
      latency.mark("audio.sent");
    }
    socket.send(message);
  });
  await wait(keepOpenMs);
  socket.send(
    protocol === "aiavatarstackchan"
      ? {
          type: "stop",
          session_id: sessionId,
          user_id: userId
        }
      : {
          type: "interrupt",
          deviceId,
          userId
        }
  );
  await wait(100);
  socket.close();
  if (printSummary) {
    const summary = latency.summary({ url, deviceId, receivedCount: received.length });
    console.log(JSON.stringify({ type: "simulator.summary", ...summary }));
    if (failOverBudget && !summary.withinBudget) {
      process.exitCode = 1;
    }
  }
};

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
