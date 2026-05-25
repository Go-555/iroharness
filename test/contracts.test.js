import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { createEchoBrain } from "../src/index.js";
import {
  createEventStreamDevice,
  createHttpMicroHarness,
  createOpenClawMicroHarness
} from "../src/adapters/index.js";
import {
  assertBrainContract,
  assertDeviceContract,
  assertMicroHarnessContract
} from "../src/testing/index.js";

const readFixture = (name) =>
  JSON.parse(readFileSync(join("fixtures", "golden", name), "utf8"));
const readProtocol = (name) => JSON.parse(readFileSync(join("protocols", name), "utf8"));

test("micro harness contract validates generic HTTP adapters with golden fixture", async () => {
  const { task, context } = readFixture("micro-task.json");
  const adapter = createHttpMicroHarness({
    id: "fixture-http",
    endpoint: "http://127.0.0.1:8787/run",
    capabilities: ["code"],
    fetchImpl: async (_endpoint, options) => {
      const payload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            status: "completed",
            summary: `validated ${payload.task.id}`,
            artifacts: [{ kind: "log", uri: "memory://contract", title: "contract log" }]
          });
        }
      };
    }
  });

  const result = await assertMicroHarnessContract(adapter, { task, context });

  assert.equal(result.adapterId, "fixture-http");
  assert.equal(result.status, "completed");
  assert.equal(result.summary, "validated ticket_golden_001");
  assert.equal(result.artifacts.length, 1);
});

test("micro harness contract validates named OpenClaw bridge", async () => {
  const { task, context } = readFixture("micro-task.json");
  const adapter = createOpenClawMicroHarness({
    endpoint: "http://127.0.0.1:8787/openclaw/run",
    fetchImpl: async (_endpoint, options) => {
      const payload = JSON.parse(options.body);
      return {
        ok: true,
        status: 200,
        async text() {
          return JSON.stringify({
            reply: `openclaw accepted ${payload.task.id}`
          });
        }
      };
    }
  });

  const result = await assertMicroHarnessContract(adapter, { task, context });

  assert.equal(result.adapterId, "openclaw");
  assert.equal(result.summary, "openclaw accepted ticket_golden_001");
});

test("device contract validates event-stream compatible bodies", async () => {
  const { events } = readFixture("body-events.json");
  const device = createEventStreamDevice("contract-events");

  const result = await assertDeviceContract(device, { events });

  assert.equal(result.adapterId, "contract-events");
  assert.equal(result.eventCount, 3);
  assert.equal(device.events().length, 3);
});

test("brain contract validates response engines with golden context", async () => {
  const { context } = readFixture("brain-context.json");
  const brain = createEchoBrain("contract-brain");

  const result = await assertBrainContract(brain, { context });

  assert.equal(result.adapterId, "contract-brain");
  assert.equal(result.emotion, "attentive");
  assert.match(result.text, /Iroha/);
});

test("contract tester rejects malformed adapters", async () => {
  const { task, context } = readFixture("micro-task.json");

  await assert.rejects(
    () => assertMicroHarnessContract({ id: "broken", capabilities: [] }, { task, context }),
    /microHarness.run/
  );
});

test("realtime core JSONL command and message schemas cover golden fixtures", () => {
  const commandSchema = readProtocol("realtime-core-command.schema.json");
  const messageSchema = readProtocol("realtime-core-message.schema.json");
  const command = readFixture("realtime-core-command.json");
  const message = readFixture("realtime-core-message.json");

  commandSchema.required.forEach((field) => {
    assert.notEqual(command[field], undefined);
  });
  messageSchema.required.forEach((field) => {
    assert.notEqual(message[field], undefined);
  });

  assert.equal(commandSchema.properties.op.enum.includes(command.op), true);
  assert.equal(commandSchema.properties.op.enum.includes("shouldInterrupt"), true);
  assert.equal(command.event.type, "realtime.speaking");
  assert.equal(message.type, "ack");
  assert.equal(message.op, command.op);
  assert.equal(message.coreId, command.coreId);
});
