import assert from "node:assert/strict";
import test from "node:test";

import {
  createOpenAiVoiceTaskPlanner,
  createVoiceTaskOrchestrator,
} from "../src/voice-pipeline/task-orchestrator.js";

const collectStream = async (opened) => {
  let text = "";
  for await (const chunk of opened.stream) {
    text += chunk.delta || "";
  }
  return { text, result: await opened.finalize(text) };
};

const waitFor = async (predicate, timeoutMs = 250) => {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

const createBaseHarness = () => {
  const calls = [];
  return {
    calls,
    async receive(input) {
      calls.push(input);
      return { kind: "response", text: `base:${input.text}` };
    },
    async receiveStream(input) {
      calls.push(input);
      return {
        stream: (async function* stream() {
          yield { delta: `base:${input.text}` };
        })(),
        finalize: async (text) => ({ kind: "response", text }),
        abandon: () => {},
      };
    },
  };
};

test("voice task orchestrator starts a background task and delivers voice on completion", async () => {
  let releaseTask;
  const taskDone = new Promise((resolve) => {
    releaseTask = resolve;
  });
  const voiceDeliveries = [];
  const events = [];
  const orchestrator = createVoiceTaskOrchestrator({
    harness: createBaseHarness(),
    planner: async () => ({
      intent: "start_task",
      ack: "調べるね。",
      task: { type: "research", title: "AI調査", prompt: "AIについて調べて", report_channel: "voice" },
    }),
    runTask: async () => taskDone,
    deliverVoice: async ({ text }) => voiceDeliveries.push(text),
    onEvent: (event) => events.push(event),
  });

  const opened = await orchestrator.receiveStream({ source: "m5stack", modality: "voice", text: "AIについて調べて" });
  const immediate = await collectStream(opened);
  assert.equal(immediate.text, "調べるね。");
  assert.equal(immediate.result.kind, "voice_task_started");
  assert.equal(orchestrator.latestTask().status, "running");

  releaseTask({ summary: "AI調査の結果です。" });
  await waitFor(() => orchestrator.latestTask().status === "completed");

  assert.deepEqual(voiceDeliveries, ["AI調査の結果です。"]);
  assert.equal(orchestrator.latestTask().status, "completed");
  assert.ok(events.some((event) => event.type === "voice_task.completed"));
});

test("update_active_task switches a running task to Slack delivery", async () => {
  let releaseTask;
  const taskDone = new Promise((resolve) => {
    releaseTask = resolve;
  });
  const slackDeliveries = [];
  let turn = 0;
  const orchestrator = createVoiceTaskOrchestrator({
    harness: createBaseHarness(),
    planner: async () => {
      turn += 1;
      if (turn === 1) {
        return {
          intent: "start_task",
          ack: "調べるね。",
          task: { type: "research", title: "AI調査", prompt: "AIについて調べて", report_channel: "voice" },
        };
      }
      return {
        intent: "update_active_task",
        ack: "Slackに送るね。",
        task_id: "latest",
        updates: { report_channel: "slack", slack_target: "C123" },
      };
    },
    runTask: async () => taskDone,
    deliverVoice: async () => {
      throw new Error("voice should not be used after Slack switch");
    },
    deliverSlack: async (delivery) => slackDeliveries.push(delivery),
  });

  await collectStream(await orchestrator.receiveStream({ source: "m5stack", modality: "voice", text: "AIを調べて" }));
  const update = await collectStream(
    await orchestrator.receiveStream({ source: "m5stack", modality: "voice", text: "Slackに送っておいて" }),
  );
  assert.equal(update.text, "Slackに送るね。");

  releaseTask({ summary: "Slack向け結果" });
  await waitFor(() => orchestrator.latestTask().status === "completed");

  assert.equal(slackDeliveries.length, 1);
  assert.equal(slackDeliveries[0].target, "C123");
  assert.equal(slackDeliveries[0].text, "Slack向け結果");
});

test("update_active_task redelivers an already completed task to Slack", async () => {
  let turn = 0;
  const slackDeliveries = [];
  const orchestrator = createVoiceTaskOrchestrator({
    harness: createBaseHarness(),
    planner: async () => {
      turn += 1;
      return turn === 1
        ? {
            intent: "start_task",
            ack: "やるね。",
            task: { title: "完了済みタスク", prompt: "短い仕事", report_channel: "none" },
          }
        : {
            intent: "update_active_task",
            ack: "送っておくね。",
            task_id: "latest",
            updates: { report_channel: "slack", slack_target: "C999" },
          };
    },
    runTask: async () => ({ summary: "完了結果" }),
    deliverSlack: async (delivery) => slackDeliveries.push(delivery),
  });

  await collectStream(await orchestrator.receiveStream({ source: "m5stack", modality: "voice", text: "やって" }));
  await waitFor(() => orchestrator.latestTask().status === "completed");
  assert.equal(slackDeliveries.length, 0);

  await collectStream(await orchestrator.receiveStream({ source: "m5stack", modality: "voice", text: "Slackに送って" }));
  assert.equal(slackDeliveries.length, 1);
  assert.equal(slackDeliveries[0].target, "C999");
});

test("start_task uses default report channel when planner omits delivery", async () => {
  const slackDeliveries = [];
  const orchestrator = createVoiceTaskOrchestrator({
    harness: createBaseHarness(),
    planner: async () => ({
      intent: "start_task",
      ack: "やるね。",
      task: { title: "既定送信", prompt: "結果を作る" },
    }),
    runTask: async () => ({ summary: "既定送信の結果" }),
    deliverSlack: async (delivery) => slackDeliveries.push(delivery),
    defaultReportChannel: "slack",
    defaultSlackTarget: "CDEFAULT",
  });

  await collectStream(await orchestrator.receiveStream({ source: "m5stack", modality: "voice", text: "調べて" }));
  await waitFor(() => orchestrator.latestTask().status === "completed");

  assert.equal(slackDeliveries.length, 1);
  assert.equal(slackDeliveries[0].target, "CDEFAULT");
});

test("cancel_task prevents delivery when background task later resolves", async () => {
  let releaseTask;
  const taskDone = new Promise((resolve) => {
    releaseTask = resolve;
  });
  const voiceDeliveries = [];
  const events = [];
  let turn = 0;
  const orchestrator = createVoiceTaskOrchestrator({
    harness: createBaseHarness(),
    planner: async () => {
      turn += 1;
      return turn === 1
        ? {
            intent: "start_task",
            ack: "始めるね。",
            task: { title: "長い仕事", prompt: "長い仕事", report_channel: "voice" },
          }
        : {
            intent: "cancel_task",
            ack: "止めるね。",
            task_id: "latest",
          };
    },
    runTask: async () => taskDone,
    deliverVoice: async ({ text }) => voiceDeliveries.push(text),
    onEvent: (event) => events.push(event),
  });

  await collectStream(await orchestrator.receiveStream({ source: "m5stack", modality: "voice", text: "長い仕事して" }));
  await collectStream(await orchestrator.receiveStream({ source: "m5stack", modality: "voice", text: "やっぱり止めて" }));
  assert.equal(orchestrator.latestTask().status, "canceled");

  releaseTask({ summary: "遅れて完了" });
  await waitFor(() => events.some((event) => event.type === "voice_task.completed_after_cancel"));
  assert.deepEqual(voiceDeliveries, []);
});

test("planner error delegates to the base harness stream", async () => {
  const baseHarness = createBaseHarness();
  const orchestrator = createVoiceTaskOrchestrator({
    harness: baseHarness,
    planner: async () => {
      throw new Error("planner down");
    },
    runTask: async () => ({ summary: "unused" }),
  });

  const opened = await orchestrator.receiveStream({ source: "m5stack", modality: "voice", text: "こんにちは" });
  const collected = await collectStream(opened);
  assert.equal(collected.text, "base:こんにちは");
  assert.equal(baseHarness.calls.length, 1);
});

test("OpenAI voice task planner sends low-latency options and parses output_text JSON", async () => {
  const requests = [];
  const planner = createOpenAiVoiceTaskPlanner({
    apiKey: "test-key",
    model: "gpt-test",
    reasoningEffort: "none",
    textVerbosity: "low",
    fetchImpl: async (url, init) => {
      requests.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return {
        ok: true,
        async text() {
          return JSON.stringify({
            output_text: JSON.stringify({
              intent: "start_task",
              ack: "調べるね。",
              task: { title: "AI調査", prompt: "AIを調べる", report_channel: "slack" },
            }),
          });
        },
      };
    },
  });

  const decision = await planner({
    input: { text: "AIを調べて", modality: "voice" },
    activeTask: null,
    tasks: [],
  });

  assert.equal(decision.intent, "start_task");
  assert.equal(requests[0].url, "https://api.openai.com/v1/responses");
  assert.equal(requests[0].body.model, "gpt-test");
  assert.deepEqual(requests[0].body.reasoning, { effort: "none" });
  assert.equal(requests[0].body.text.verbosity, "low");
  assert.equal(requests[0].body.text.format.type, "json_schema");
  assert.equal(requests[0].body.text.format.name, "voice_task_decision");
  assert.equal(requests[0].body.text.format.strict, true);
});

test("OpenAI voice task planner ignores response text metadata object and parses output content", async () => {
  const planner = createOpenAiVoiceTaskPlanner({
    apiKey: "test-key",
    fetchImpl: async () => ({
      ok: true,
      async text() {
        return JSON.stringify({
          text: {
            format: {
              type: "json_schema",
              name: "voice_task_decision",
            },
          },
          output: [
            {
              type: "message",
              content: [
                {
                  type: "output_text",
                  text: JSON.stringify({
                    intent: "start_task",
                    ack: "調べるね。",
                    reply: "",
                    task_id: "",
                    task: {
                      type: "research",
                      title: "AI調査",
                      prompt: "AIを調べる",
                      report_channel: "voice",
                      slack_target: "",
                    },
                    updates: { report_channel: "", slack_target: "" },
                  }),
                },
              ],
            },
          ],
        });
      },
    }),
  });

  const decision = await planner({ input: { text: "AIを調べて", modality: "voice" } });
  assert.equal(decision.intent, "start_task");
  assert.equal(decision.task.title, "AI調査");
});
