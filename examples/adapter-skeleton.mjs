import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  assertBrainContract,
  assertDeviceContract,
  assertMicroHarnessContract
} from "../src/testing/index.js";

const readFixture = (name) => JSON.parse(readFileSync(join("fixtures", "golden", name), "utf8"));

export const createSkeletonMicroHarness = ({
  id = "skeleton-worker",
  capabilities = ["review"],
  runImpl = async ({ task }) => ({
    status: "completed",
    summary: `Skeleton worker handled ${task.id}`,
    artifacts: []
  })
} = {}) =>
  Object.freeze({
    id,
    capabilities: Object.freeze([...capabilities]),
    async run(task, context) {
      const output = await runImpl({ task, context });
      return Object.freeze({
        status: output.status || "completed",
        summary: output.summary || "Skeleton worker completed the task.",
        artifacts: Object.freeze(output.artifacts || []),
        raw: output
      });
    }
  });

export const createSkeletonBodyDevice = ({
  id = "skeleton-body",
  send = async () => {}
} = {}) =>
  Object.freeze({
    id,
    kind: "body",
    capabilities: Object.freeze(["state", "speech", "task"]),
    async emit(event) {
      if (event.type === "state") {
        await send({
          type: "state",
          mode: event.state.mode,
          emotion: event.state.emotion
        });
        return;
      }
      if (event.type === "speech") {
        await send({
          type: "speech",
          text: event.text
        });
        return;
      }
      if (event.type === "task") {
        await send({
          type: "task",
          taskRef: event.taskRef,
          status: event.status
        });
      }
    }
  });

export const createSkeletonBrain = ({
  id = "skeleton-brain",
  generate = async ({ character, input }) => ({
    text: `${character.name} received: ${input.text}`,
    emotion: "attentive"
  })
} = {}) =>
  Object.freeze({
    id,
    async respond(context) {
      const output = await generate(context);
      return Object.freeze({
        text: output.text,
        emotion: output.emotion || "attentive",
        raw: output
      });
    }
  });

const microFixture = readFixture("micro-task.json");
const bodyFixture = readFixture("body-events.json");
const brainFixture = readFixture("brain-context.json");
const sentBodyEvents = [];

const microResult = await assertMicroHarnessContract(createSkeletonMicroHarness(), microFixture);
const bodyResult = await assertDeviceContract(
  createSkeletonBodyDevice({
    send: async (value) => {
      sentBodyEvents.push(value);
    }
  }),
  bodyFixture
);
const brainResult = await assertBrainContract(createSkeletonBrain(), brainFixture);

console.log(
  JSON.stringify(
    {
      ok: true,
      microHarness: {
        id: microResult.adapterId,
        status: microResult.status
      },
      body: {
        id: bodyResult.adapterId,
        eventCount: bodyResult.eventCount,
        sentCount: sentBodyEvents.length
      },
      brain: {
        id: brainResult.adapterId,
        emotion: brainResult.emotion
      }
    },
    null,
    2
  )
);
